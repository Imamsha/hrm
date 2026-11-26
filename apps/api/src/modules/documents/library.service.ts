import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { type LibraryDocumentItem, PERMISSIONS } from '@hrm/shared-types';
import type { libraryDocumentSchema } from '@hrm/validation';
import type { z } from 'zod';
import { uuidv7 } from '../../common/ids.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { DOCUMENT_MAX_BYTES } from '@hrm/validation';
import {
  safeFileName,
  sniffContentType,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { audienceEmployees, inAudience, myEmployeeId } from '../talent/talent-common.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;

const docSelect = {
  id: true,
  title: true,
  category: true,
  description: true,
  requiresAcknowledgement: true,
  status: true,
  currentVersion: true,
  audienceCompanyId: true,
  audienceDepartmentId: true,
  versions: {
    orderBy: { version: 'desc' as const },
    take: 1,
    select: { fileName: true, size: true, createdAt: true, version: true },
  },
} as const;

/** Company documents (policies) with versions and acknowledgements (ADR-018). */
@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async items(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    ids?: string[],
  ): Promise<LibraryDocumentItem[]> {
    const manage = can(principal, P.DOCUMENTS_LIBRARY_MANAGE, {});
    const me = await myEmployeeId(tx, principal);
    const rows = await tx.libraryDocument.findMany({
      where: { ...(ids ? { id: { in: ids } } : {}), ...(manage ? {} : { status: 'PUBLISHED' }) },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      select: docSelect,
    });
    const out: LibraryDocumentItem[] = [];
    for (const d of rows) {
      const audience = { companyId: d.audienceCompanyId, departmentId: d.audienceDepartmentId };
      if (!manage && (!me || !(await inAudience(tx, me, audience)))) continue;
      const v = d.versions[0];
      const ack = me
        ? await tx.libraryAcknowledgement.findFirst({
            where: { documentId: d.id, version: d.currentVersion, employeeId: me },
            select: { acknowledgedAt: true },
          })
        : null;
      let stats: LibraryDocumentItem['stats'] = null;
      if (manage) {
        const people = await audienceEmployees(tx, audience);
        stats = {
          audience: people.length,
          acknowledged: await tx.libraryAcknowledgement.count({
            where: {
              documentId: d.id,
              version: d.currentVersion,
              employeeId: { in: people.map((p) => p.id) },
            },
          }),
        };
      }
      out.push({
        id: d.id,
        title: d.title,
        category: d.category,
        description: d.description,
        requiresAcknowledgement: d.requiresAcknowledgement,
        status: d.status,
        version: d.currentVersion,
        fileName: v?.fileName ?? '',
        size: v?.size ?? 0,
        publishedAt: v?.createdAt.toISOString() ?? '',
        audience,
        acknowledgedAt: ack?.acknowledgedAt.toISOString() ?? null,
        stats,
      });
    }
    return out;
  }

  list(principal: AuthPrincipal): Promise<LibraryDocumentItem[]> {
    return this.prisma.withTenant((tx) => this.items(tx, principal));
  }

  private async upload(organizationId: string, file: UploadedFileLike | undefined) {
    if (!file?.buffer.length) throw AppException.badRequest('Choose a PDF file', 'file');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw AppException.badRequest('The file is too large', 'file');
    if (sniffContentType(file.buffer) !== 'application/pdf')
      throw AppException.badRequest('Company documents must be PDF files', 'file');
    const key = StorageService.tenantKey(organizationId, 'documents', 'library', uuidv7());
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: 'application/pdf',
        ContentLength: file.size,
      }),
    );
    return {
      key,
      fileName: safeFileName(file.originalname),
      size: file.size,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  private async drop(key: string): Promise<void> {
    try {
      await this.storage.client.send(
        new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Orphaned library object ${key}: ${(err as Error).message}`);
    }
  }

  async create(
    principal: AuthPrincipal,
    input: In<typeof libraryDocumentSchema>,
    file: UploadedFileLike | undefined,
  ): Promise<LibraryDocumentItem[]> {
    const org = principal.organizationId ?? '';
    const f = await this.upload(org, file);
    try {
      return await this.prisma.withTenant(async (tx) => {
        const d = await tx.libraryDocument.create({
          data: {
            organizationId: org,
            title: input.title,
            category: input.category,
            description: input.description ?? null,
            requiresAcknowledgement: input.requiresAcknowledgement,
            audienceCompanyId: input.audienceCompanyId,
            audienceDepartmentId: input.audienceDepartmentId,
          },
          select: { id: true },
        });
        await tx.libraryDocumentVersion.create({
          data: {
            organizationId: org,
            documentId: d.id,
            version: 1,
            storageKey: f.key,
            fileName: f.fileName,
            contentType: 'application/pdf',
            size: f.size,
            sha256: f.sha256,
            createdByUserId: principal.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'documents.library.published',
          entityType: 'library_document',
          entityId: d.id,
          metadata: { version: 1, sha256: f.sha256 },
        });
        return this.items(tx, principal);
      });
    } catch (err) {
      await this.drop(f.key);
      throw err;
    }
  }

  /** A new version: earlier acknowledgements stay with their version; people acknowledge again. */
  async newVersion(
    principal: AuthPrincipal,
    id: string,
    file: UploadedFileLike | undefined,
  ): Promise<LibraryDocumentItem[]> {
    const org = principal.organizationId ?? '';
    const f = await this.upload(org, file);
    try {
      return await this.prisma.withTenant(async (tx) => {
        await tx.$queryRaw`SELECT id FROM library_documents WHERE id = ${id}::uuid FOR UPDATE`;
        const d = await tx.libraryDocument.findFirst({
          where: { id },
          select: { currentVersion: true },
        });
        if (!d) throw AppException.notFound('Document');
        const version = d.currentVersion + 1;
        await tx.libraryDocumentVersion.create({
          data: {
            organizationId: org,
            documentId: id,
            version,
            storageKey: f.key,
            fileName: f.fileName,
            contentType: 'application/pdf',
            size: f.size,
            sha256: f.sha256,
            createdByUserId: principal.userId,
          },
        });
        await tx.libraryDocument.update({
          where: { id },
          data: { currentVersion: version, status: 'PUBLISHED' },
        });
        await this.audit.record(tx, {
          action: 'documents.library.versioned',
          entityType: 'library_document',
          entityId: id,
          metadata: { version, sha256: f.sha256 },
        });
        return this.items(tx, principal);
      });
    } catch (err) {
      await this.drop(f.key);
      throw err;
    }
  }

  setStatus(
    principal: AuthPrincipal,
    id: string,
    status: 'PUBLISHED' | 'ARCHIVED',
  ): Promise<LibraryDocumentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const n = await tx.libraryDocument.updateMany({ where: { id }, data: { status } });
      if (!n.count) throw AppException.notFound('Document');
      await this.audit.record(tx, {
        action: `documents.library.${status.toLowerCase()}`,
        entityType: 'library_document',
        entityId: id,
      });
      return this.items(tx, principal);
    });
  }

  acknowledge(principal: AuthPrincipal, id: string): Promise<LibraryDocumentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const [item] = await this.items(tx, principal, [id]);
      const me = await myEmployeeId(tx, principal);
      if (!item || !me) throw AppException.notFound('Document');
      if (!item.requiresAcknowledgement)
        throw AppException.badRequest('This document does not need acknowledgement');
      if (!item.acknowledgedAt)
        await tx.libraryAcknowledgement.create({
          data: {
            organizationId: principal.organizationId ?? '',
            documentId: id,
            version: item.version,
            employeeId: me,
          },
        });
      return this.items(tx, principal);
    });
  }

  async open(
    principal: AuthPrincipal,
    id: string,
  ): Promise<{ stream: Readable; fileName: string; size: number }> {
    const v = await this.prisma.withTenant(async (tx) => {
      const [item] = await this.items(tx, principal, [id]);
      if (!item) throw AppException.notFound('Document');
      return tx.libraryDocumentVersion.findFirstOrThrow({
        where: { documentId: id, version: item.version },
        select: { storageKey: true, fileName: true, size: true },
      });
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: v.storageKey }),
    );
    if (!obj.Body) throw AppException.notFound('Document file');
    return { stream: obj.Body as Readable, fileName: v.fileName, size: v.size };
  }
}
