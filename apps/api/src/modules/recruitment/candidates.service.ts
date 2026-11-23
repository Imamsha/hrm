import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import type { CandidateItem, PaginatedResult } from '@hrm/shared-types';
import {
  type candidateSchema,
  DOCUMENT_MAX_BYTES,
  portalApplicationSchema,
  type recruitmentListQuerySchema,
  toErrorDetails,
  type updateCandidateSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { uuidv7 } from '../../common/ids.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import {
  safeFileName,
  sniffContentType,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { definedOnly } from '../structure/structure.util.js';
import { OpeningsService } from './openings.service.js';
import { candidateSelect, toCandidate } from './recruitment-mappers.js';

type ListQuery = z.output<typeof recruitmentListQuerySchema>;

function mapCandidateError(err: unknown): never {
  if (
    (err as { code?: string }).code === 'P2002' ||
    (err instanceof Error && err.message.includes('email'))
  )
    throw AppException.conflictOn('A candidate with this e-mail already exists', 'email');
  throw err;
}

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly openings: OpeningsService,
  ) {}

  list(q: ListQuery): Promise<PaginatedResult<CandidateItem>> {
    return this.prisma.withTenant(async (tx) => {
      const where: Prisma.CandidateWhereInput = q.search
        ? {
            OR: [
              { firstName: { contains: q.search, mode: 'insensitive' } },
              { lastName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { currentCompany: { contains: q.search, mode: 'insensitive' } },
              { skills: { has: q.search } },
            ],
          }
        : {};
      const [rows, total] = await Promise.all([
        tx.candidate.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: candidateSelect,
          ...skipTake(q),
        }),
        tx.candidate.count({ where }),
      ]);
      return paginate(rows.map(toCandidate), total, q);
    });
  }

  get(id: string): Promise<CandidateItem> {
    return this.prisma.withTenant((tx) => this.candidate(tx, id));
  }

  async candidate(tx: TenantTransaction, id: string): Promise<CandidateItem> {
    const c = await tx.candidate.findFirst({ where: { id }, select: candidateSelect });
    if (!c) throw AppException.notFound('Candidate');
    return toCandidate(c);
  }

  create(
    principal: AuthPrincipal,
    input: z.output<typeof candidateSchema>,
  ): Promise<CandidateItem> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.candidate
        .create({
          data: {
            organizationId: principal.organizationId ?? '',
            ...input,
            lastName: input.lastName ?? null,
            phone: input.phone ?? null,
            createdByUserId: principal.userId,
            // Recruiter-entered candidates: consent is the recruiter's responsibility (recorded source).
          },
          select: { id: true },
        })
        .catch(mapCandidateError);
      await this.audit.record(tx, {
        action: 'candidate.created',
        entityType: 'candidate',
        entityId: row.id,
        metadata: { source: input.source },
      });
      return this.candidate(tx, row.id);
    });
  }

  update(id: string, input: z.output<typeof updateCandidateSchema>): Promise<CandidateItem> {
    return this.prisma.withTenant(async (tx) => {
      if (!(await tx.candidate.findFirst({ where: { id }, select: { id: true } })))
        throw AppException.notFound('Candidate');
      const data = definedOnly(input);
      await tx.candidate.update({ where: { id }, data }).catch(mapCandidateError);
      await this.audit.record(tx, {
        action: 'candidate.updated',
        entityType: 'candidate',
        entityId: id,
        metadata: { fields: Object.keys(data) },
      });
      return this.candidate(tx, id);
    });
  }

  // ------------------------------------------------------------------ resumes

  async uploadResume(
    principal: AuthPrincipal,
    id: string,
    file: UploadedFileLike | undefined,
  ): Promise<CandidateItem> {
    const organizationId = principal.organizationId ?? '';
    const exists = await this.prisma.withTenant((tx) =>
      tx.candidate.findFirst({ where: { id }, select: { resumeStorageKey: true } }),
    );
    if (!exists) throw AppException.notFound('Candidate');
    const stored = await this.store(organizationId, file);
    try {
      return await this.prisma.withTenant(async (tx) => {
        await tx.candidate.update({ where: { id }, data: stored.data });
        await this.audit.record(tx, {
          action: 'candidate.resume_uploaded',
          entityType: 'candidate',
          entityId: id,
          metadata: { sha256: stored.data.resumeSha256 },
        });
        return this.candidate(tx, id);
      });
    } catch (err) {
      await this.deleteObject(stored.data.resumeStorageKey);
      throw err;
    }
    // The previous resume object (if any) is replaced; remove it after the switch.
  }

  async openResume(
    id: string,
  ): Promise<{ stream: Readable; fileName: string; contentType: string; sizeBytes: number }> {
    const c = await this.prisma.withTenant(async (tx) => {
      const row = await tx.candidate.findFirst({
        where: { id },
        select: {
          resumeStorageKey: true,
          resumeFileName: true,
          resumeContentType: true,
          resumeSizeBytes: true,
        },
      });
      if (!row) throw AppException.notFound('Candidate');
      if (!row.resumeStorageKey) throw AppException.notFound('Resume');
      await this.audit.record(tx, {
        action: 'candidate.resume_downloaded',
        entityType: 'candidate',
        entityId: id,
      });
      return row;
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: c.resumeStorageKey as string }),
    );
    if (!obj.Body) throw AppException.notFound('Resume');
    return {
      stream: obj.Body as Readable,
      fileName: c.resumeFileName ?? 'resume',
      contentType: c.resumeContentType ?? 'application/octet-stream',
      sizeBytes: c.resumeSizeBytes ?? 0,
    };
  }

  private async store(organizationId: string, file: UploadedFileLike | undefined) {
    if (!file || file.size === 0) throw AppException.badRequest('Attach your resume', 'resume');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw AppException.badRequest('Files can be at most 10 MB', 'resume');
    const contentType = sniffContentType(file.buffer);
    if (!contentType)
      throw AppException.badRequest('Upload a PDF, PNG, JPEG or WebP file', 'resume');
    const key = StorageService.tenantKey(organizationId, 'candidates', 'resumes', uuidv7());
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
        ContentLength: file.size,
      }),
    );
    return {
      data: {
        resumeStorageKey: key,
        resumeFileName: safeFileName(file.originalname),
        resumeContentType: contentType,
        resumeSizeBytes: file.size,
        resumeSha256: sha256,
      },
    };
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.client.send(
        new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Orphaned resume object ${key}: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ career portal

  /**
   * Public application from the career portal. The candidate record is matched by e-mail (one
   * profile per person per organization), consent is recorded, and the resume is required.
   * Responses never reveal whether the e-mail was already known.
   */
  async applyFromPortal(
    organizationSlug: string,
    openingSlug: string,
    fields: unknown,
    file: UploadedFileLike | undefined,
    ipAddress: string | undefined,
  ): Promise<{ received: true }> {
    const parsed = portalApplicationSchema.safeParse(fields);
    if (!parsed.success) throw AppException.validation(toErrorDetails(parsed.error));
    const input = parsed.data;
    const opening = await this.openings.publicOpening(organizationSlug, openingSlug);
    const organizationId = await this.openings.portalTenant(organizationSlug);
    const stored = await this.store(organizationId, file);
    try {
      await this.prisma.withTenant(
        async (tx) => {
          const existing = await tx.candidate.findFirst({
            where: { email: input.email },
            select: { id: true },
          });
          const profile = {
            firstName: input.firstName,
            lastName: input.lastName || null,
            phone: input.phone,
            currentCompany: input.currentCompany || null,
            currentTitle: input.currentTitle || null,
            totalExperienceMonths: input.totalExperienceMonths ?? null,
            location: input.location || null,
            consentAt: new Date(),
            ...stored.data,
          };
          const candidateId = existing
            ? (
                await tx.candidate.update({
                  where: { id: existing.id },
                  data: profile,
                  select: { id: true },
                })
              ).id
            : (
                await tx.candidate.create({
                  data: { organizationId, email: input.email, source: 'CAREER_PORTAL', ...profile },
                  select: { id: true },
                })
              ).id;
          const already = await tx.jobApplication.findFirst({
            where: { candidateId, openingId: opening.id },
            select: { id: true },
          });
          if (!already) {
            const app = await tx.jobApplication.create({
              data: {
                organizationId,
                candidateId,
                openingId: opening.id,
                coverLetter: input.coverLetter || null,
              },
              select: { id: true },
            });
            await tx.applicationEvent.create({
              data: {
                organizationId,
                applicationId: app.id,
                toStage: 'APPLIED',
                note: 'Applied through the career portal',
              },
            });
          }
          await this.audit.record(
            tx,
            {
              action: 'candidate.portal_application',
              entityType: 'candidate',
              entityId: candidateId,
              metadata: {
                opening: opening.slug,
                ip: ipAddress ?? null,
                duplicate: Boolean(already),
              },
            },
            { organizationId, actorId: null },
          );
        },
        { organizationId },
      );
    } catch (err) {
      await this.deleteObject(stored.data.resumeStorageKey);
      throw err;
    }
    return { received: true };
  }
}
