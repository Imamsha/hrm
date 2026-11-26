import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CATEGORY_SUBJECT,
  Decimal,
  MERGE_FIELDS,
  nextSigner,
  renderTemplate,
  signatureState,
  type TemplateCategory,
  validateTemplate,
} from '@hrm/business-rules';
import {
  type DocumentTemplateItem,
  type GeneratedDocumentItem,
  PERMISSIONS,
  type PublicAcceptanceItem,
} from '@hrm/shared-types';
import type {
  declineSchema,
  documentTemplateSchema,
  generateDocumentSchema,
  templateVersionSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import { uuidv7 } from '../../common/ids.js';
import { AppException } from '../../common/http/app.exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { displayName, inForceWhere, isoDate, todayIso } from '../employees/employee-scope.js';
import { MailService } from '../notifications/mail.service.js';
import { empSelect, myEmployeeId, ref } from '../talent/talent-common.js';
import { acceptanceEmail, acceptanceCodeEmail } from './documents-mail.js';
import { PdfService } from './pdf.service.js';

const P = PERMISSIONS;
type In<S extends z.ZodType> = z.output<S>;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;

const docSelect = {
  id: true,
  title: true,
  category: true,
  sha256: true,
  status: true,
  certificateKey: true,
  createdAt: true,
  offerId: true,
  employee: { select: empSelect },
  templateVersion: { select: { version: true, template: { select: { id: true, name: true } } } },
  signers: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.GeneratedDocumentSelect;
type DocRow = Prisma.GeneratedDocumentGetPayload<{ select: typeof docSelect }>;

export interface SignerContext {
  ip: string | null;
  userAgent: string | null;
}

/** Templates, generated letters and their e-acceptance (ADR-018). */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---------------------------------------------------------------------------- templates

  private toTemplate(t: {
    id: string;
    name: string;
    category: TemplateCategory;
    status: 'ACTIVE' | 'INACTIVE';
    currentVersion: number;
    versions: { version: number; title: string; body: string; createdAt: Date }[];
  }): DocumentTemplateItem {
    const current = t.versions.find((v) => v.version === t.currentVersion);
    return {
      id: t.id,
      name: t.name,
      category: t.category,
      status: t.status,
      version: t.currentVersion,
      title: current?.title ?? '',
      body: current?.body ?? '',
      mergeFields: [...MERGE_FIELDS[t.category]],
      versions: t.versions.map((v) => ({
        version: v.version,
        title: v.title,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  private templateSelect = {
    id: true,
    name: true,
    category: true,
    status: true,
    currentVersion: true,
    versions: {
      orderBy: { version: 'desc' as const },
      select: { version: true, title: true, body: true, createdAt: true },
    },
  } as const;

  templates(): Promise<DocumentTemplateItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.documentTemplate.findMany({
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
          select: this.templateSelect,
        })
      ).map((t) => this.toTemplate(t)),
    );
  }

  createTemplate(
    principal: AuthPrincipal,
    input: In<typeof documentTemplateSchema>,
  ): Promise<DocumentTemplateItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const org = principal.organizationId ?? '';
        let id: string;
        try {
          id = (
            await tx.documentTemplate.create({
              data: { organizationId: org, name: input.name, category: input.category },
              select: { id: true },
            })
          ).id;
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002')
            throw AppException.conflictOn('A template with this name already exists', 'name');
          throw err;
        }
        await tx.documentTemplateVersion.create({
          data: {
            organizationId: org,
            templateId: id,
            version: 1,
            title: input.title,
            body: input.body,
            createdByUserId: principal.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'documents.template.created',
          entityType: 'document_template',
          entityId: id,
          metadata: { category: input.category },
        });
      })
      .then(() => this.templates());
  }

  /** A new version; documents already generated keep the version they were made from. */
  newVersion(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof templateVersionSchema>,
  ): Promise<DocumentTemplateItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const t = await tx.documentTemplate.findFirst({
          where: { id },
          select: { category: true, currentVersion: true, organizationId: true },
        });
        if (!t) throw AppException.notFound('Template');
        const issues = validateTemplate(t.category, `${input.title}\n${input.body}`);
        if (issues.length) throw AppException.badRequest(issues[0] ?? 'Check the template', 'body');
        const version = t.currentVersion + 1;
        await tx.documentTemplateVersion.create({
          data: {
            organizationId: t.organizationId,
            templateId: id,
            version,
            title: input.title,
            body: input.body,
            createdByUserId: principal.userId,
          },
        });
        await tx.documentTemplate.update({ where: { id }, data: { currentVersion: version } });
        await this.audit.record(tx, {
          action: 'documents.template.versioned',
          entityType: 'document_template',
          entityId: id,
          metadata: { version },
        });
      })
      .then(() => this.templates());
  }

  setTemplateStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): Promise<DocumentTemplateItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const n = await tx.documentTemplate.updateMany({ where: { id }, data: { status } });
        if (!n.count) throw AppException.notFound('Template');
      })
      .then(() => this.templates());
  }

  // ---------------------------------------------------------------------------- merge values

  /** Values for the catalogue fields, from stored data. Missing ones stay undefined. */
  private async mergeValues(
    tx: TenantTransaction,
    subject: { employeeId?: string | undefined; offerId?: string | undefined },
  ): Promise<{
    values: Record<string, string>;
    employeeName: string | null;
    candidate: { name: string; email: string } | null;
  }> {
    const org = await tx.organization.findFirstOrThrow({ select: { name: true } });
    const values: Record<string, string> = { 'organization.name': org.name, today: todayIso() };
    if (subject.employeeId) {
      const e = await tx.employee.findFirst({
        where: { id: subject.employeeId },
        select: {
          ...empSelect,
          dateOfJoining: true,
          workEmail: true,
          employmentRecords: {
            where: inForceWhere(todayIso()),
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            select: {
              designation: { select: { name: true } },
              department: { select: { name: true } },
              company: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
          salaries: {
            where: { effectiveFrom: { lte: new Date(`${todayIso()}T00:00:00Z`) } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            select: { annualCtc: true },
          },
        },
      });
      if (!e) throw AppException.badRequest('The employee does not exist', 'employeeId');
      const job = e.employmentRecords[0];
      const set = (k: string, v: string | null | undefined) => {
        if (v) values[k] = v;
      };
      set('employee.name', displayName(e));
      set('employee.firstName', e.preferredName ?? e.firstName);
      set('employee.number', e.employeeNumber);
      set('employee.designation', job?.designation?.name);
      set('employee.department', job?.department?.name);
      set('employee.company', job?.company.name);
      set('employee.location', job?.branch?.name);
      set('employee.dateOfJoining', isoDate(e.dateOfJoining));
      set('employee.workEmail', e.workEmail);
      const ctc = e.salaries[0]?.annualCtc;
      set('employee.ctc', ctc ? new Decimal(ctc.toString()).toFixed(2) : null);
      return { values, employeeName: displayName(e), candidate: null };
    }
    const o = await tx.offer.findFirst({
      where: { id: subject.offerId ?? '' },
      select: {
        annualCtc: true,
        currency: true,
        joiningDate: true,
        designation: { select: { name: true } },
        application: {
          select: {
            candidate: { select: { firstName: true, lastName: true, email: true } },
            opening: {
              select: {
                title: true,
                location: true,
                department: { select: { name: true } },
                branch: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!o) throw AppException.badRequest('The offer does not exist', 'offerId');
    const c = o.application.candidate;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    Object.assign(values, {
      'candidate.name': name,
      'candidate.email': c.email,
      'offer.jobTitle': o.designation?.name ?? o.application.opening.title,
      'offer.ctc': new Decimal(o.annualCtc.toString()).toFixed(2),
      'offer.currency': o.currency,
      'offer.joiningDate': isoDate(o.joiningDate),
    });
    const dept = o.application.opening.department?.name;
    const loc = o.application.opening.location ?? o.application.opening.branch?.name;
    if (dept) values['offer.department'] = dept;
    if (loc) values['offer.location'] = loc;
    return { values, employeeName: null, candidate: { name, email: c.email } };
  }

  // ---------------------------------------------------------------------------- generated documents

  private async toItem(
    tx: TenantTransaction,
    d: DocRow,
    me: string | null,
  ): Promise<GeneratedDocumentItem> {
    const offer = d.offerId
      ? await tx.offer.findFirst({
          where: { id: d.offerId },
          select: {
            id: true,
            application: { select: { candidate: { select: { firstName: true, lastName: true } } } },
          },
        })
      : null;
    const next = nextSigner(d.signers);
    return {
      id: d.id,
      title: d.title,
      category: d.category,
      template: {
        id: d.templateVersion.template.id,
        name: d.templateVersion.template.name,
        version: d.templateVersion.version,
      },
      employee: d.employee ? ref(d.employee) : null,
      offer: offer
        ? {
            id: offer.id,
            candidateName: [
              offer.application.candidate.firstName,
              offer.application.candidate.lastName,
            ]
              .filter(Boolean)
              .join(' '),
          }
        : null,
      sha256: d.sha256,
      status: d.status,
      signers: d.signers.map((s) => ({
        id: s.id,
        order: s.order,
        kind: s.kind,
        name: s.name,
        email: s.email,
        status: s.status,
        method: s.method,
        at: s.signedAt?.toISOString() ?? null,
        ip: s.ip,
        reason: s.declineReason,
      })),
      canAccept:
        d.status === 'AWAITING_ACCEPTANCE' &&
        !!next &&
        next.kind === 'EMPLOYEE' &&
        next.employeeId === me,
      hasCertificate: !!d.certificateKey,
      createdAt: d.createdAt.toISOString(),
    };
  }

  /** Managers of documents see all; employees see letters about them and ones they must accept. */
  private async visibleWhere(
    tx: TenantTransaction,
    principal: AuthPrincipal,
  ): Promise<Prisma.GeneratedDocumentWhereInput> {
    if (can(principal, P.DOCUMENTS_DOCUMENT_GENERATE, {})) return {};
    const me = await myEmployeeId(tx, principal);
    if (!me) return { id: { in: [] } };
    return { OR: [{ employeeId: me }, { signers: { some: { employeeId: me } } }] };
  }

  list(
    principal: AuthPrincipal,
    q: { employeeId?: string | undefined; offerId?: string | undefined },
  ): Promise<GeneratedDocumentItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      const rows = await tx.generatedDocument.findMany({
        where: {
          AND: [
            await this.visibleWhere(tx, principal),
            q.employeeId ? { employeeId: q.employeeId } : {},
            q.offerId ? { offerId: q.offerId } : {},
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: docSelect,
        take: 300,
      });
      return Promise.all(rows.map((r) => this.toItem(tx, r, me)));
    });
  }

  private async one(tx: TenantTransaction, principal: AuthPrincipal, id: string): Promise<DocRow> {
    const d = await tx.generatedDocument.findFirst({
      where: { AND: [{ id }, await this.visibleWhere(tx, principal)] },
      select: docSelect,
    });
    if (!d) throw AppException.notFound('Document');
    return d;
  }

  get(principal: AuthPrincipal, id: string): Promise<GeneratedDocumentItem> {
    return this.prisma.withTenant(async (tx) =>
      this.toItem(tx, await this.one(tx, principal, id), await myEmployeeId(tx, principal)),
    );
  }

  private async put(key: string, body: Uint8Array): Promise<void> {
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
        ContentLength: body.length,
      }),
    );
  }

  private async read(key: string): Promise<Uint8Array> {
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: key }),
    );
    if (!obj.Body) throw AppException.notFound('Document file');
    return obj.Body.transformToByteArray();
  }

  private async drop(key: string): Promise<void> {
    try {
      await this.storage.client.send(
        new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Orphaned document object ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Renders a template version for an employee or an offer into a PDF, stores it with its
   * SHA-256, and (optionally) asks signers to accept it in order.
   */
  async generate(
    principal: AuthPrincipal,
    input: In<typeof generateDocumentSchema>,
  ): Promise<GeneratedDocumentItem> {
    const org = principal.organizationId ?? '';
    const prepared = await this.prisma.withTenant(async (tx) => {
      const t = await tx.documentTemplate.findFirst({
        where: { id: input.templateId, status: 'ACTIVE' },
        select: {
          name: true,
          category: true,
          currentVersion: true,
          versions: { select: { id: true, version: true, title: true, body: true } },
        },
      });
      if (!t)
        throw AppException.badRequest('The template does not exist or is inactive', 'templateId');
      const subjectKind = CATEGORY_SUBJECT[t.category];
      if (subjectKind === 'OFFER' && !input.offerId)
        throw AppException.badRequest('Offer letters are generated for an offer', 'offerId');
      if (subjectKind === 'EMPLOYEE' && !input.employeeId)
        throw AppException.badRequest('This letter is generated for an employee', 'employeeId');
      const v = t.versions.find((x) => x.version === t.currentVersion);
      if (!v) throw AppException.conflict('The template has no current version');
      const merged = await this.mergeValues(tx, {
        employeeId: input.employeeId,
        offerId: input.offerId,
      });
      // Only catalogue fields may be supplied by hand (e.g. a last working day).
      const allowed = new Set(MERGE_FIELDS[t.category]);
      for (const k of Object.keys(input.values))
        if (!allowed.has(k)) throw AppException.badRequest(`Unknown merge field ${k}`, 'values');
      const values = { ...merged.values, ...input.values };
      const title = renderTemplate(v.title, values);
      const body = renderTemplate(v.body, values);
      const missing = [...new Set([...title.missing, ...body.missing])];
      if (missing.length) throw AppException.badRequest(`Fill in: ${missing.join(', ')}`, 'values');
      const signers: Prisma.DocumentSignerCreateManyDocumentInput[] = [];
      for (const [i, s] of input.signers.entries()) {
        if (s.kind === 'EMPLOYEE') {
          const e = await tx.employee.findFirst({
            where: { id: s.employeeId, status: { not: 'SEPARATED' } },
            select: { ...empSelect, workEmail: true },
          });
          if (!e)
            throw AppException.badRequest(
              `Signer ${String(i + 1)} does not exist or has left`,
              'signers',
            );
          signers.push({
            order: i + 1,
            kind: 'EMPLOYEE',
            employeeId: e.id,
            name: displayName(e),
            email: e.workEmail,
          });
        } else {
          if (!merged.candidate)
            throw AppException.badRequest('Only offer letters have a candidate signer', 'signers');
          signers.push({
            order: i + 1,
            kind: 'CANDIDATE',
            name: merged.candidate.name,
            email: merged.candidate.email,
          });
        }
      }
      return {
        t,
        v,
        values,
        title: title.text,
        body: body.text,
        signers,
        organizationName: values['organization.name'] ?? '',
      };
    });
    const pdf = await this.pdf.letter({
      organizationName: prepared.organizationName,
      title: prepared.title,
      body: prepared.body,
      footer: `${prepared.t.name} v${String(prepared.v.version)}`,
    });
    const key = StorageService.tenantKey(org, 'documents', 'generated', uuidv7());
    await this.put(key, pdf);
    try {
      const { id, tokens } = await this.prisma.withTenant(async (tx) => {
        // Candidates open the acceptance page from an e-mailed link; only its hash is stored.
        const tokens: { email: string; name: string; token: string }[] = [];
        const signers = prepared.signers.map((s) => {
          if (s.kind !== 'CANDIDATE') return s;
          const token = randomBytes(32).toString('base64url');
          tokens.push({ email: s.email ?? '', name: s.name, token });
          return { ...s, accessTokenHash: sha256(Buffer.from(token)) };
        });
        const d = await tx.generatedDocument.create({
          data: {
            organizationId: org,
            templateVersionId: prepared.v.id,
            category: prepared.t.category,
            title: prepared.title.slice(0, 200),
            employeeId: input.employeeId ?? null,
            offerId: input.offerId ?? null,
            storageKey: key,
            sha256: sha256(pdf),
            fileSize: pdf.length,
            mergedValues: prepared.values,
            status: signers.length ? 'AWAITING_ACCEPTANCE' : 'FINAL',
            createdByUserId: principal.userId,
            signers: { createMany: { data: signers } },
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'documents.document.generated',
          entityType: 'generated_document',
          entityId: d.id,
          metadata: {
            template: prepared.t.name,
            version: prepared.v.version,
            sha256: sha256(pdf),
            signers: signers.length,
          },
        });
        return { id: d.id, tokens };
      });
      // The first signer is invited; later ones when their turn comes.
      await this.notifyNext(id, prepared.organizationName, tokens);
      return await this.get(principal, id);
    } catch (err) {
      await this.drop(key);
      throw err;
    }
  }

  private async notifyNext(
    id: string,
    organizationName: string,
    tokens: { email: string; name: string; token: string }[],
  ): Promise<void> {
    const next = await this.prisma.withTenant(async (tx) => {
      const d = await tx.generatedDocument.findFirst({
        where: { id },
        select: { title: true, signers: true },
      });
      return d ? { title: d.title, signer: nextSigner(d.signers) } : null;
    });
    if (!next?.signer?.email) return;
    const t =
      next.signer.kind === 'CANDIDATE'
        ? tokens.find((x) => x.email === next.signer?.email)
        : undefined;
    const link =
      next.signer.kind === 'CANDIDATE' && t
        ? `${this.config.APP_WEB_URL}/accept-document?token=${encodeURIComponent(t.token)}`
        : `${this.config.APP_WEB_URL}/me/documents`;
    await this.mail.send({
      to: next.signer.email,
      ...acceptanceEmail({ organizationName, title: next.title, name: next.signer.name, link }),
    });
  }

  /** Streams the original PDF, or the version with the acceptance certificate. */
  async open(
    principal: AuthPrincipal,
    id: string,
    certificate: boolean,
  ): Promise<{ stream: Readable; fileName: string; size: number }> {
    const d = await this.prisma.withTenant(async (tx) => {
      await this.one(tx, principal, id);
      return tx.generatedDocument.findFirstOrThrow({
        where: { id },
        select: { title: true, storageKey: true, certificateKey: true, fileSize: true },
      });
    });
    const key = certificate ? d.certificateKey : d.storageKey;
    if (!key) throw AppException.notFound('Acceptance certificate');
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: key }),
    );
    if (!obj.Body) throw AppException.notFound('Document file');
    return {
      stream: obj.Body as Readable,
      fileName: `${d.title}${certificate ? ' (accepted)' : ''}.pdf`,
      size: obj.ContentLength ?? d.fileSize,
    };
  }

  // ---------------------------------------------------------------------------- acceptance

  /**
   * Records an acceptance after checking the stored file still has the hash shown to the
   * signer. When everyone has accepted, a certificate page is appended to a new PDF.
   */
  private async recordAcceptance(
    organizationId: string | null,
    documentId: string,
    signerId: string,
    method: 'LOGIN' | 'EMAIL_OTP',
    ctx: SignerContext,
  ): Promise<void> {
    const opts = organizationId ? { organizationId } : {};
    const d = await this.prisma.withTenant(
      (tx) =>
        tx.generatedDocument.findFirstOrThrow({
          where: { id: documentId },
          select: {
            storageKey: true,
            sha256: true,
            title: true,
            offerId: true,
            category: true,
            organizationId: true,
          },
        }),
      opts,
    );
    const bytes = await this.read(d.storageKey);
    if (sha256(bytes) !== d.sha256)
      throw AppException.conflict('The stored document no longer matches; acceptance is refused');
    const done = await this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM generated_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
      const signers = await tx.documentSigner.findMany({ where: { documentId } });
      const next = nextSigner(signers);
      if (next?.id !== signerId) throw AppException.conflict('It is not this signer’s turn');
      await tx.documentSigner.update({
        where: { id: signerId },
        data: {
          status: 'ACCEPTED',
          method,
          signedAt: new Date(),
          ip: ctx.ip,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
          acceptedSha256: d.sha256,
          otpHash: null,
        },
      });
      const after = signers.map((s) =>
        s.id === signerId ? { ...s, status: 'ACCEPTED' as const } : s,
      );
      const state = signatureState(after);
      if (state === 'COMPLETED') {
        await tx.generatedDocument.update({
          where: { id: documentId },
          data: { status: 'ACCEPTED' },
        });
        if (d.category === 'OFFER_LETTER' && d.offerId)
          await tx.offer.updateMany({
            where: { id: d.offerId, status: 'SENT' },
            data: { status: 'ACCEPTED', respondedAt: new Date() },
          });
      }
      await this.audit.record(tx, {
        action: 'documents.document.accepted',
        entityType: 'generated_document',
        entityId: documentId,
        metadata: { signerId, method, sha256: d.sha256, ip: ctx.ip },
      });
      return state === 'COMPLETED';
    }, opts);
    if (done) await this.certify(organizationId, documentId, bytes);
    else await this.notifyNext(documentId, await this.orgName(organizationId), []);
  }

  private async orgName(organizationId: string | null): Promise<string> {
    return this.prisma.withTenant(
      async (tx) => (await tx.organization.findFirstOrThrow({ select: { name: true } })).name,
      organizationId ? { organizationId } : {},
    );
  }

  private async certify(
    organizationId: string | null,
    documentId: string,
    original: Uint8Array,
  ): Promise<void> {
    const opts = organizationId ? { organizationId } : {};
    const d = await this.prisma.withTenant(
      (tx) =>
        tx.generatedDocument.findFirstOrThrow({
          where: { id: documentId },
          select: {
            organizationId: true,
            title: true,
            sha256: true,
            signers: { orderBy: { order: 'asc' } },
          },
        }),
      opts,
    );
    const pdf = await this.pdf.withCertificate(original, {
      organizationName: await this.orgName(organizationId),
      documentTitle: d.title,
      sha256: d.sha256,
      records: d.signers.map((s) => ({
        name: s.name,
        method: s.method ?? 'LOGIN',
        at: s.signedAt?.toISOString() ?? '',
        ip: s.ip,
        hash: s.acceptedSha256 ?? '',
      })),
    });
    const key = StorageService.tenantKey(d.organizationId, 'documents', 'certified', uuidv7());
    await this.put(key, pdf);
    await this.prisma.withTenant(async (tx) => {
      await tx.generatedDocument.update({
        where: { id: documentId },
        data: { certificateKey: key, certificateSha256: sha256(pdf) },
      });
      await this.audit.record(tx, {
        action: 'documents.document.certified',
        entityType: 'generated_document',
        entityId: documentId,
        metadata: { sha256: sha256(pdf) },
      });
    }, opts);
  }

  private async declineIn(
    organizationId: string | null,
    documentId: string,
    signerId: string,
    reason: string,
    ctx: SignerContext,
  ): Promise<void> {
    await this.prisma.withTenant(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM generated_documents WHERE id = ${documentId}::uuid FOR UPDATE`;
        const d = await tx.generatedDocument.findFirstOrThrow({
          where: { id: documentId },
          select: { category: true, offerId: true, signers: true },
        });
        if (nextSigner(d.signers)?.id !== signerId)
          throw AppException.conflict('It is not this signer’s turn');
        await tx.documentSigner.update({
          where: { id: signerId },
          data: {
            status: 'DECLINED',
            signedAt: new Date(),
            declineReason: reason,
            ip: ctx.ip,
            userAgent: ctx.userAgent?.slice(0, 500) ?? null,
            otpHash: null,
          },
        });
        await tx.generatedDocument.update({
          where: { id: documentId },
          data: { status: 'DECLINED' },
        });
        if (d.category === 'OFFER_LETTER' && d.offerId)
          await tx.offer.updateMany({
            where: { id: d.offerId, status: 'SENT' },
            data: { status: 'DECLINED', respondedAt: new Date() },
          });
        await this.audit.record(tx, {
          action: 'documents.document.declined',
          entityType: 'generated_document',
          entityId: documentId,
          metadata: { signerId, reason },
        });
      },
      organizationId ? { organizationId } : {},
    );
  }

  /** A signed-in employee accepts when it is their turn. */
  async accept(
    principal: AuthPrincipal,
    id: string,
    ctx: SignerContext,
  ): Promise<GeneratedDocumentItem> {
    const signerId = await this.prisma.withTenant(async (tx) => {
      const d = await this.one(tx, principal, id);
      const me = await myEmployeeId(tx, principal);
      const next = nextSigner(d.signers);
      if (
        d.status !== 'AWAITING_ACCEPTANCE' ||
        !next ||
        next.kind !== 'EMPLOYEE' ||
        next.employeeId !== me
      )
        throw AppException.forbidden('This document is not waiting for you');
      return next.id;
    });
    await this.recordAcceptance(null, id, signerId, 'LOGIN', ctx);
    return this.get(principal, id);
  }

  async decline(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof declineSchema>,
    ctx: SignerContext,
  ): Promise<GeneratedDocumentItem> {
    const signerId = await this.prisma.withTenant(async (tx) => {
      const d = await this.one(tx, principal, id);
      const me = await myEmployeeId(tx, principal);
      const next = nextSigner(d.signers);
      if (d.status !== 'AWAITING_ACCEPTANCE' || next?.kind !== 'EMPLOYEE' || next.employeeId !== me)
        throw AppException.forbidden('This document is not waiting for you');
      return next.id;
    });
    await this.declineIn(null, id, signerId, input.reason, ctx);
    return this.get(principal, id);
  }

  // ---------------------------------------------------------------------------- candidate (public)

  private async tokenTenant(token: string): Promise<{ organizationId: string; hash: string }> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw AppException.notFound('Document');
    const hash = sha256(Buffer.from(token));
    const rows = await this.prisma.$queryRaw<
      { id: string | null }[]
    >`SELECT app.signer_token_tenant(${hash})::text AS id`;
    const organizationId = rows[0]?.id;
    if (!organizationId) throw AppException.notFound('Document');
    return { organizationId, hash };
  }

  private async signerByToken(token: string) {
    const { organizationId, hash } = await this.tokenTenant(token);
    const s = await this.prisma.withTenant(
      (tx) =>
        tx.documentSigner.findFirst({
          where: { accessTokenHash: hash },
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            otpHash: true,
            otpExpiresAt: true,
            otpAttempts: true,
            document: {
              select: { id: true, title: true, sha256: true, storageKey: true, status: true },
            },
          },
        }),
      { organizationId },
    );
    if (!s) throw AppException.notFound('Document');
    return { organizationId, s };
  }

  async publicView(token: string): Promise<PublicAcceptanceItem> {
    const { organizationId, s } = await this.signerByToken(token);
    return {
      organizationName: await this.orgName(organizationId),
      title: s.document.title,
      candidateName: s.name,
      status: s.status,
      sha256: s.document.sha256,
    };
  }

  async publicFile(token: string): Promise<{ stream: Readable; fileName: string; size: number }> {
    const { s } = await this.signerByToken(token);
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: s.document.storageKey }),
    );
    if (!obj.Body) throw AppException.notFound('Document file');
    return {
      stream: obj.Body as Readable,
      fileName: `${s.document.title}.pdf`,
      size: obj.ContentLength ?? 0,
    };
  }

  /** E-mails a one-time code to the signer's address on record. */
  async sendCode(token: string): Promise<{ sent: true }> {
    const { organizationId, s } = await this.signerByToken(token);
    if (s.status !== 'PENDING' || s.document.status !== 'AWAITING_ACCEPTANCE')
      throw AppException.conflict('This document is no longer waiting for you');
    if (s.otpAttempts >= OTP_MAX_ATTEMPTS)
      throw AppException.tooManyRequests('Too many attempts; ask the sender for a new link');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.withTenant(
      (tx) =>
        tx.documentSigner.update({
          where: { id: s.id },
          data: {
            otpHash: sha256(Buffer.from(`${s.id}:${code}`)),
            otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          },
        }),
      { organizationId },
    );
    await this.mail.send({
      to: s.email ?? '',
      ...acceptanceCodeEmail({
        organizationName: await this.orgName(organizationId),
        title: s.document.title,
        code,
        minutes: OTP_TTL_MS / 60_000,
      }),
    });
    return { sent: true };
  }

  /** Runs a public (token) call inside the tenant the token belongs to (lookups, audit). */
  private async asTenant<T>(token: string, fn: () => Promise<T>): Promise<T> {
    const { organizationId } = await this.tokenTenant(token);
    const ctx = RequestContext.get();
    return RequestContext.run(
      { ...ctx, requestId: ctx?.requestId ?? 'public', organizationId },
      fn,
    );
  }

  publicAccept(token: string, code: string, ctx: SignerContext): Promise<PublicAcceptanceItem> {
    return this.asTenant(token, () => this.publicAcceptIn(token, code, ctx));
  }

  publicDecline(token: string, reason: string, ctx: SignerContext): Promise<PublicAcceptanceItem> {
    return this.asTenant(token, () => this.publicDeclineIn(token, reason, ctx));
  }

  private async publicAcceptIn(
    token: string,
    code: string,
    ctx: SignerContext,
  ): Promise<PublicAcceptanceItem> {
    const { organizationId, s } = await this.signerByToken(token);
    if (s.status !== 'PENDING')
      throw AppException.conflict('This document is no longer waiting for you');
    if (s.otpAttempts >= OTP_MAX_ATTEMPTS)
      throw AppException.tooManyRequests('Too many attempts; ask the sender for a new link');
    const expected = s.otpHash ? Buffer.from(s.otpHash) : null;
    const given = Buffer.from(sha256(Buffer.from(`${s.id}:${code}`)));
    const ok =
      !!expected &&
      !!s.otpExpiresAt &&
      s.otpExpiresAt.getTime() > Date.now() &&
      timingSafeEqual(expected, given);
    if (!ok) {
      await this.prisma.withTenant(
        (tx) =>
          tx.documentSigner.update({
            where: { id: s.id },
            data: { otpAttempts: { increment: 1 } },
          }),
        { organizationId },
      );
      throw AppException.badRequest('The code is wrong or has expired', 'code');
    }
    await this.recordAcceptance(organizationId, s.document.id, s.id, 'EMAIL_OTP', ctx);
    return this.publicView(token);
  }

  private async publicDeclineIn(
    token: string,
    reason: string,
    ctx: SignerContext,
  ): Promise<PublicAcceptanceItem> {
    const { organizationId, s } = await this.signerByToken(token);
    if (s.status !== 'PENDING')
      throw AppException.conflict('This document is no longer waiting for you');
    await this.declineIn(organizationId, s.document.id, s.id, reason, ctx);
    return this.publicView(token);
  }
}
