import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { type EmployeeDocumentItem, PERMISSIONS } from '@hrm/shared-types';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  documentMetadataSchema,
  toErrorDetails,
  type updateDocumentSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import { uuidv7 } from '../../common/ids.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { definedOnly } from '../structure/structure.util.js';
import { authorize, isSelf, loadTarget } from './employees.service.js';

const P = PERMISSIONS;

/** The parts of a multer file the service uses (memory storage). */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  size: number;
}

type ContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/**
 * Detects the real type from the file's magic bytes. The client-declared MIME type is never
 * trusted, so an executable renamed to `.pdf` is rejected.
 */
export function sniffContentType(buf: Buffer): ContentType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Keeps a display-safe file name: no path parts or control characters, max 200 chars. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '_').trim();
  return (cleaned || 'file').slice(-200);
}

const docSelect = {
  id: true,
  category: true,
  title: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedByUserId: true,
} as const;

type DocRow = {
  id: string;
  category: EmployeeDocumentItem['category'];
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  uploadedByUserId: string | null;
};

/**
 * Employee documents in S3-compatible storage under `org/<tenant>/employees/<id>/documents/`.
 * Downloads stream through the API after authorization (no long-lived public URLs).
 */
@Injectable()
export class EmployeeDocumentsService {
  private readonly logger = new Logger(EmployeeDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  list(
    principal: AuthPrincipal,
    employeeId: string,
    self = false,
  ): Promise<EmployeeDocumentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      await this.readable(tx, principal, employeeId, self);
      const rows = await tx.employeeDocument.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
        select: docSelect,
      });
      return this.items(tx, rows);
    });
  }

  async upload(
    principal: AuthPrincipal,
    employeeId: string,
    file: UploadedFileLike | undefined,
    fields: unknown,
    /** The employee uploads their own document (onboarding tasks); HR needs document.manage. */
    asSelf = false,
  ): Promise<EmployeeDocumentItem> {
    const meta = documentMetadataSchema.safeParse(fields);
    if (!meta.success) throw AppException.validation(toErrorDetails(meta.error));
    if (!file || file.size === 0) throw AppException.badRequest('Choose a file to upload', 'file');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw AppException.badRequest('Files can be at most 10 MB', 'file');
    const contentType = sniffContentType(file.buffer);
    if (!contentType)
      throw AppException.badRequest('Only PDF, PNG, JPEG and WebP files are accepted', 'file');

    const organizationId = principal.organizationId ?? '';
    // Authorize before touching storage.
    await this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, employeeId);
      if (asSelf) {
        if (!isSelf(principal, target)) throw AppException.notFound('Employee');
      } else authorize(principal, P.EMPLOYEES_DOCUMENT_MANAGE, target);
    });

    const id = uuidv7();
    const storageKey = StorageService.tenantKey(
      organizationId,
      'employees',
      employeeId,
      'documents',
      id,
    );
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: storageKey,
        Body: file.buffer,
        ContentType: contentType,
        ContentLength: file.size,
        Metadata: { sha256 },
      }),
    );
    try {
      return await this.prisma.withTenant(async (tx) => {
        const row = await tx.employeeDocument.create({
          data: {
            id,
            organizationId,
            employeeId,
            category: meta.data.category,
            title: meta.data.title,
            fileName: safeFileName(file.originalname),
            contentType,
            sizeBytes: file.size,
            sha256,
            storageKey,
            uploadedByUserId: principal.userId,
          },
          select: docSelect,
        });
        await this.audit.record(tx, {
          action: 'employee_document.uploaded',
          entityType: 'employee_document',
          entityId: id,
          metadata: { employeeId, category: row.category, sizeBytes: row.sizeBytes, sha256 },
        });
        return (await this.items(tx, [row]))[0] as EmployeeDocumentItem;
      });
    } catch (err) {
      await this.deleteObject(storageKey);
      throw err;
    }
  }

  update(
    principal: AuthPrincipal,
    employeeId: string,
    id: string,
    input: z.output<typeof updateDocumentSchema>,
  ): Promise<EmployeeDocumentItem> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, employeeId);
      authorize(principal, P.EMPLOYEES_DOCUMENT_MANAGE, target);
      const before = await tx.employeeDocument.findFirst({
        where: { id, employeeId },
        select: { id: true },
      });
      if (!before) throw AppException.notFound('Document');
      const row = await tx.employeeDocument.update({
        where: { id },
        data: definedOnly(input),
        select: docSelect,
      });
      await this.audit.record(tx, {
        action: 'employee_document.updated',
        entityType: 'employee_document',
        entityId: id,
        metadata: { employeeId, fields: Object.keys(input) },
      });
      return (await this.items(tx, [row]))[0] as EmployeeDocumentItem;
    });
  }

  async remove(principal: AuthPrincipal, employeeId: string, id: string): Promise<void> {
    const key = await this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, employeeId);
      authorize(principal, P.EMPLOYEES_DOCUMENT_MANAGE, target);
      const doc = await tx.employeeDocument.findFirst({
        where: { id, employeeId },
        select: { storageKey: true, title: true },
      });
      if (!doc) throw AppException.notFound('Document');
      await tx.employeeDocument.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'employee_document.deleted',
        entityType: 'employee_document',
        entityId: id,
        metadata: { employeeId, title: doc.title },
      });
      return doc.storageKey;
    });
    // The record is gone; a failed object delete leaves an orphan that is logged, not exposed.
    await this.deleteObject(key);
  }

  /** Authorizes, audits and opens the object stream for download. */
  async open(
    principal: AuthPrincipal,
    employeeId: string,
    id: string,
    self = false,
  ): Promise<{ stream: Readable; fileName: string; contentType: string; sizeBytes: number }> {
    const doc = await this.prisma.withTenant(async (tx) => {
      await this.readable(tx, principal, employeeId, self);
      const row = await tx.employeeDocument.findFirst({
        where: { id, employeeId },
        select: { storageKey: true, fileName: true, contentType: true, sizeBytes: true },
      });
      if (!row) throw AppException.notFound('Document');
      await this.audit.record(tx, {
        action: 'employee_document.downloaded',
        entityType: 'employee_document',
        entityId: id,
        metadata: { employeeId, by: self ? 'self' : 'hr' },
      });
      return row;
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: doc.storageKey }),
    );
    if (!obj.Body) throw AppException.notFound('Document file');
    return {
      stream: obj.Body as Readable,
      fileName: doc.fileName,
      contentType: doc.contentType,
      sizeBytes: doc.sizeBytes,
    };
  }

  private async readable(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
    self: boolean,
  ) {
    const target = await loadTarget(tx, principal, employeeId);
    if (self) {
      if (!isSelf(principal, target)) throw AppException.notFound('Employee');
      return;
    }
    if (!can(principal, P.EMPLOYEES_DOCUMENT_READ, target.attributes))
      throw AppException.forbidden();
  }

  private async items(tx: TenantTransaction, rows: DocRow[]): Promise<EmployeeDocumentItem[]> {
    const userIds = [
      ...new Set(rows.map((r) => r.uploadedByUserId).filter((x): x is string => !!x)),
    ];
    const users = userIds.length
      ? await tx.membership.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, user: { select: { fullName: true } } },
        })
      : [];
    const names = new Map(users.map((u) => [u.userId, u.user.fullName]));
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      uploadedAt: r.createdAt.toISOString(),
      uploadedBy: r.uploadedByUserId ? (names.get(r.uploadedByUserId) ?? null) : null,
    }));
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.client.send(
        new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Orphaned document object ${key}: ${(err as Error).message}`);
    }
  }
}
