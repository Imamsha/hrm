import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import {
  canMoveClaim,
  checkExpenseItems,
  convertAmount,
  Decimal,
  type ExpenseIssue,
  type ExpensePolicy,
} from '@hrm/business-rules';
import {
  type ExpenseCategoryItem,
  type ExpenseClaimDetails,
  type ExpenseClaimItem,
  type ExpenseSettingsItem,
  type PaginatedResult,
  PERMISSIONS,
} from '@hrm/shared-types';
import {
  DOCUMENT_MAX_BYTES,
  type expenseCategorySchema,
  type expenseClaimSchema,
  type expenseListQuerySchema,
  type expenseSettingsSchema,
  type financeDecisionSchema,
  type managerDecisionSchema,
  type markPaidSchema,
  type updateExpenseCategorySchema,
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
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import {
  safeFileName,
  sniffContentType,
  type UploadedFileLike,
} from '../employees/employee-documents.service.js';
import { displayName, isoDate, isoOrNull, toDate, todayIso } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { definedOnly, mapWriteError } from '../structure/structure.util.js';
import { subjectOf } from '../time/time-context.js';

const P = PERMISSIONS;
type ClaimInput = z.output<typeof expenseClaimSchema>;
const money = (v: { toString(): string } | null | undefined) =>
  v === null || v === undefined ? null : new Decimal(v.toString()).toFixed(2);
const COUNTED: ('SUBMITTED' | 'MANAGER_APPROVED' | 'FINANCE_APPROVED' | 'REIMBURSED')[] = [
  'SUBMITTED',
  'MANAGER_APPROVED',
  'FINANCE_APPROVED',
  'REIMBURSED',
];

const empSelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  preferredName: true,
  membershipId: true,
} as const;
const claimSelect = {
  id: true,
  employeeId: true,
  title: true,
  status: true,
  totalClaimed: true,
  totalApproved: true,
  payoutMethod: true,
  approverEmployeeId: true,
  submittedAt: true,
  decisionNote: true,
  paidOn: true,
  paidReference: true,
  reimbursedAt: true,
  payrollRunId: true,
  createdAt: true,
  employee: { select: empSelect },
  trip: { select: { id: true, purpose: true } },
  _count: { select: { items: true } },
} satisfies Prisma.ExpenseClaimSelect;
type ClaimRow = Prisma.ExpenseClaimGetPayload<{ select: typeof claimSelect }>;

const categorySelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  maxPerItem: true,
  maxPerMonth: true,
  receiptRequiredAbove: true,
  dailyLimit: true,
  taxable: true,
  status: true,
} satisfies Prisma.ExpenseCategorySelect;
type CategoryRow = Prisma.ExpenseCategoryGetPayload<{ select: typeof categorySelect }>;
const toCategory = (c: CategoryRow): ExpenseCategoryItem => ({
  ...c,
  maxPerItem: money(c.maxPerItem),
  maxPerMonth: money(c.maxPerMonth),
  receiptRequiredAbove: money(c.receiptRequiredAbove),
  dailyLimit: money(c.dailyLimit),
});
const toPolicy = (c: CategoryRow): ExpensePolicy => ({
  categoryId: c.id,
  name: c.name,
  active: c.status === 'ACTIVE',
  maxPerItem: money(c.maxPerItem),
  maxPerMonth: money(c.maxPerMonth),
  receiptRequiredAbove: money(c.receiptRequiredAbove),
  dailyLimit: money(c.dailyLimit),
});

/** The caller's employee id, or null when the login is not linked to an employee. */
async function myEmployeeId(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string | null> {
  if (!principal.membershipId) return null;
  const e = await tx.employee.findFirst({
    where: { membershipId: principal.membershipId },
    select: { id: true },
  });
  return e?.id ?? null;
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------------------ settings

  settings(): Promise<ExpenseSettingsItem> {
    return this.prisma.withTenant(async (tx) => settingsOf(tx));
  }

  putSettings(
    principal: AuthPrincipal,
    input: z.output<typeof expenseSettingsSchema>,
  ): Promise<ExpenseSettingsItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const before = await settingsOf(tx);
      await tx.expenseSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...input },
        update: input,
      });
      await this.audit.record(tx, {
        action: 'expenses.settings.updated',
        entityType: 'expense_settings',
        entityId: organizationId,
        changes: diffChanges({ ...before }, input),
      });
      return settingsOf(tx);
    });
  }

  // ------------------------------------------------------------------------------ categories

  categories(includeInactive: boolean): Promise<ExpenseCategoryItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.expenseCategory.findMany({
          where: includeInactive ? {} : { status: 'ACTIVE' },
          orderBy: { name: 'asc' },
          select: categorySelect,
        })
      ).map(toCategory),
    );
  }

  createCategory(
    principal: AuthPrincipal,
    input: z.output<typeof expenseCategorySchema>,
  ): Promise<ExpenseCategoryItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      try {
        const c = await tx.expenseCategory.create({
          data: { organizationId, ...input, description: input.description ?? null },
          select: categorySelect,
        });
        await this.audit.record(tx, {
          action: 'expenses.category.created',
          entityType: 'expense_category',
          entityId: c.id,
          metadata: { code: c.code },
        });
        return toCategory(c);
      } catch (err) {
        mapWriteError(err, { entity: 'category', uniqueField: 'code' });
      }
    });
  }

  updateCategory(
    id: string,
    input: z.output<typeof updateExpenseCategorySchema>,
  ): Promise<ExpenseCategoryItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.expenseCategory.findFirst({ where: { id }, select: categorySelect });
      if (!before) throw AppException.notFound('Category');
      const data = definedOnly(input);
      const c = await tx.expenseCategory.update({ where: { id }, data, select: categorySelect });
      await this.audit.record(tx, {
        action: 'expenses.category.updated',
        entityType: 'expense_category',
        entityId: id,
        changes: diffChanges(toCategory(before) as unknown as Record<string, unknown>, data),
      });
      return toCategory(c);
    });
  }

  // ------------------------------------------------------------------------------ claims: reading

  private async toItem(
    tx: TenantTransaction,
    c: ClaimRow,
    principal: AuthPrincipal,
    me: string | null,
  ): Promise<ExpenseClaimItem> {
    const approver = c.approverEmployeeId
      ? await tx.employee.findFirst({ where: { id: c.approverEmployeeId }, select: empSelect })
      : null;
    const own = me !== null && c.employeeId === me;
    const verify = can(principal, P.EXPENSES_CLAIM_VERIFY, {});
    return {
      id: c.id,
      employee: {
        id: c.employee.id,
        employeeNumber: c.employee.employeeNumber,
        displayName: displayName(c.employee),
      },
      title: c.title,
      trip: c.trip,
      status: c.status,
      totalClaimed: money(c.totalClaimed) ?? '0.00',
      totalApproved: money(c.totalApproved),
      payoutMethod: c.payoutMethod,
      approver: approver
        ? {
            id: approver.id,
            employeeNumber: approver.employeeNumber,
            displayName: displayName(approver),
          }
        : null,
      submittedAt: c.submittedAt?.toISOString() ?? null,
      decisionNote: c.decisionNote,
      paidOn: isoOrNull(c.paidOn),
      paidReference: c.paidReference,
      reimbursedAt: c.reimbursedAt?.toISOString() ?? null,
      payrollRunId: c.payrollRunId,
      createdAt: c.createdAt.toISOString(),
      itemCount: c._count.items,
      can: {
        edit: own && c.status === 'DRAFT',
        submit: own && c.status === 'DRAFT',
        cancel: own && (c.status === 'DRAFT' || c.status === 'SUBMITTED'),
        reopen: own && (c.status === 'REJECTED' || c.status === 'SUBMITTED'),
        managerDecide:
          !own && c.status === 'SUBMITTED' && me !== null && c.approverEmployeeId === me,
        financeDecide: !own && verify && c.status === 'MANAGER_APPROVED',
        markPaid:
          !own && verify && c.status === 'FINANCE_APPROVED' && c.payoutMethod === 'EXTERNAL',
      },
    };
  }

  /** Own claims, claims awaiting the caller as manager, or all claims (expenses.claim.read). */
  list(
    principal: AuthPrincipal,
    scope: 'mine' | 'approvals' | 'all',
    q: z.output<typeof expenseListQuerySchema>,
  ): Promise<PaginatedResult<ExpenseClaimItem>> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      let where: Prisma.ExpenseClaimWhereInput;
      if (scope === 'mine') {
        if (!me) throw AppException.notFound('Employee record linked to your account');
        where = { employeeId: me };
      } else if (scope === 'approvals') {
        where = me ? { approverEmployeeId: me, status: 'SUBMITTED' } : { id: { in: [] } };
      } else {
        if (
          !can(principal, P.EXPENSES_CLAIM_READ, {}) &&
          !can(principal, P.EXPENSES_CLAIM_VERIFY, {})
        )
          throw AppException.forbidden();
        where = {};
      }
      where = {
        ...where,
        ...(q.status && scope !== 'approvals' ? { status: q.status as ClaimRow['status'] } : {}),
        ...(q.employeeId && scope === 'all' ? { employeeId: q.employeeId } : {}),
        ...(q.tripId ? { tripId: q.tripId } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.expenseClaim.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          select: claimSelect,
          ...skipTake(q),
        }),
        tx.expenseClaim.count({ where }),
      ]);
      return paginate(
        await Promise.all(rows.map((r) => this.toItem(tx, r, principal, me))),
        total,
        q,
      );
    });
  }

  get(principal: AuthPrincipal, id: string): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => this.detailsIn(tx, principal, id));
  }

  private async visible(tx: TenantTransaction, principal: AuthPrincipal, id: string) {
    const c = await tx.expenseClaim.findFirst({ where: { id }, select: claimSelect });
    if (!c) throw AppException.notFound('Expense claim');
    const me = await myEmployeeId(tx, principal);
    const allowed =
      (me !== null && (c.employeeId === me || c.approverEmployeeId === me)) ||
      can(principal, P.EXPENSES_CLAIM_READ, {}) ||
      can(principal, P.EXPENSES_CLAIM_VERIFY, {});
    if (!allowed) throw AppException.notFound('Expense claim');
    return { claim: c, me };
  }

  private async detailsIn(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<ExpenseClaimDetails> {
    const { claim, me } = await this.visible(tx, principal, id);
    const [items, events] = await Promise.all([
      tx.expenseItem.findMany({
        where: { claimId: id },
        orderBy: { sortOrder: 'asc' },
        include: { category: { select: { id: true, code: true, name: true } } },
      }),
      tx.expenseClaimEvent.findMany({ where: { claimId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const names = await userNames(
      tx,
      events.map((e) => e.actorUserId),
    );
    const issues =
      claim.status === 'DRAFT'
        ? await this.check(tx, claim.employeeId, id, items)
        : items.flatMap((it, i) =>
            (it.issues as unknown as ExpenseIssue[]).map((x) => ({ ...x, item: i })),
          );
    return {
      ...(await this.toItem(tx, claim, principal, me)),
      items: items.map((it) => ({
        id: it.id,
        category: it.category,
        date: isoDate(it.date),
        days: it.days,
        description: it.description,
        merchant: it.merchant,
        currency: it.currency,
        originalAmount: money(it.originalAmount) ?? '0.00',
        exchangeRate: new Decimal(it.exchangeRate.toString()).toString(),
        amount: money(it.amount) ?? '0.00',
        approvedAmount: money(it.approvedAmount),
        financeNote: it.financeNote,
        justification: it.justification,
        issues: it.issues as unknown as ExpenseIssue[],
        receipt: it.receiptStorageKey
          ? {
              fileName: it.receiptFileName ?? 'receipt',
              contentType: it.receiptContentType ?? '',
              sizeBytes: it.receiptSizeBytes ?? 0,
            }
          : null,
      })),
      events: events.map((e) => ({
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
        at: e.createdAt.toISOString(),
      })),
      issues,
    };
  }

  /** Policy check of a claim's items against categories and the employee's month-to-date spend. */
  private async check(
    tx: TenantTransaction,
    employeeId: string,
    claimId: string,
    items: {
      categoryId: string;
      date: Date;
      days: number;
      amount: { toString(): string };
      receiptStorageKey: string | null;
      justification: string | null;
    }[],
  ): Promise<ExpenseIssue[]> {
    const [categories, settings] = await Promise.all([
      tx.expenseCategory.findMany({ select: categorySelect }),
      settingsOf(tx),
    ]);
    const months = [...new Set(items.map((i) => isoDate(i.date).slice(0, 7)))];
    const monthToDate: Record<string, string> = {};
    for (const month of months) {
      const [y, m] = month.split('-').map(Number) as [number, number];
      const spent = await tx.expenseItem.findMany({
        where: {
          claim: { employeeId, status: { in: COUNTED }, id: { not: claimId } },
          date: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) },
        },
        select: { categoryId: true, amount: true, approvedAmount: true },
      });
      for (const s of spent) {
        const key = `${s.categoryId}|${month}`;
        monthToDate[key] = new Decimal(monthToDate[key] ?? 0)
          .plus((s.approvedAmount ?? s.amount).toString())
          .toString();
      }
    }
    return checkExpenseItems({
      items: items.map((i) => ({
        categoryId: i.categoryId,
        date: isoDate(i.date),
        days: i.days,
        amount: i.amount.toString(),
        hasReceipt: !!i.receiptStorageKey,
        justification: i.justification,
      })),
      policies: categories.map(toPolicy),
      today: todayIso(),
      claimWindowDays: settings.claimWindowDays,
      monthToDate,
    });
  }

  // ------------------------------------------------------------------------------ claims: drafts

  create(principal: AuthPrincipal, input: ClaimInput): Promise<ExpenseClaimDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      if (!me) throw AppException.notFound('Employee record linked to your account');
      await this.assertTrip(tx, me, input.tripId);
      const c = await tx.expenseClaim.create({
        data: { organizationId, employeeId: me, title: input.title, tripId: input.tripId },
        select: { id: true },
      });
      await this.writeItems(tx, organizationId, c.id, input);
      await tx.expenseClaimEvent.create({
        data: { organizationId, claimId: c.id, toStatus: 'DRAFT', actorUserId: principal.userId },
      });
      await this.audit.record(tx, {
        action: 'expenses.claim.created',
        entityType: 'expense_claim',
        entityId: c.id,
      });
      return this.detailsIn(tx, principal, c.id);
    });
  }

  /** Replaces a draft's items; receipts are kept for items matched by position. */
  update(principal: AuthPrincipal, id: string, input: ClaimInput): Promise<ExpenseClaimDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.employeeId !== me)
        throw AppException.forbidden('Only the claimant can edit a claim');
      if (claim.status !== 'DRAFT') throw AppException.conflict('Only a draft can be edited');
      if (!me) throw AppException.forbidden();
      await this.assertTrip(tx, me, input.tripId);
      await tx.expenseClaim.update({
        where: { id },
        data: { title: input.title, tripId: input.tripId },
      });
      await this.writeItems(tx, organizationId, id, input);
      return this.detailsIn(tx, principal, id);
    });
  }

  private async assertTrip(tx: TenantTransaction, employeeId: string, tripId: string | null) {
    if (!tripId) return;
    const t = await tx.travelRequest.findFirst({
      where: { id: tripId },
      select: { employeeId: true, status: true },
    });
    if (!t || t.employeeId !== employeeId)
      throw AppException.badRequest('Choose one of your own trips', 'tripId');
    if (t.status !== 'APPROVED')
      throw AppException.badRequest(
        'Expenses can be added only to an approved, unsettled trip',
        'tripId',
      );
  }

  private async writeItems(
    tx: TenantTransaction,
    organizationId: string,
    claimId: string,
    input: ClaimInput,
  ) {
    const categories = await tx.expenseCategory.findMany({
      where: { id: { in: input.items.map((i) => i.categoryId) } },
      select: { id: true },
    });
    const known = new Set(categories.map((c) => c.id));
    input.items.forEach((it, i) => {
      if (!known.has(it.categoryId))
        throw AppException.badRequest(
          'The category does not exist',
          `items.${String(i)}.categoryId`,
        );
    });
    const old = await tx.expenseItem.findMany({
      where: { claimId },
      orderBy: { sortOrder: 'asc' },
      select: {
        receiptStorageKey: true,
        receiptFileName: true,
        receiptContentType: true,
        receiptSizeBytes: true,
      },
    });
    await tx.expenseItem.deleteMany({ where: { claimId } });
    let total = new Decimal(0);
    const settings = await settingsOf(tx);
    for (const [i, it] of input.items.entries()) {
      const rate = it.currency === settings.currency ? '1' : it.exchangeRate;
      const amount = convertAmount(it.originalAmount, rate);
      total = total.plus(amount);
      const receipt = old[i];
      await tx.expenseItem.create({
        data: {
          organizationId,
          claimId,
          categoryId: it.categoryId,
          date: toDate(it.date),
          days: it.days,
          description: it.description,
          merchant: it.merchant ?? null,
          currency: it.currency,
          originalAmount: it.originalAmount,
          exchangeRate: rate,
          amount: amount.toFixed(2),
          justification: it.justification ?? null,
          sortOrder: i,
          ...(receipt?.receiptStorageKey ? receipt : {}),
        },
      });
    }
    // Receipts of removed trailing items are orphaned objects; delete them after commit.
    for (const r of old.slice(input.items.length))
      if (r.receiptStorageKey) void this.deleteObject(r.receiptStorageKey);
    await tx.expenseClaim.update({
      where: { id: claimId },
      data: { totalClaimed: total.toFixed(2) },
    });
  }

  async uploadReceipt(
    principal: AuthPrincipal,
    claimId: string,
    itemId: string,
    file: UploadedFileLike | undefined,
  ): Promise<ExpenseClaimDetails> {
    const organizationId = principal.organizationId ?? '';
    if (!file || file.size === 0) throw AppException.badRequest('Attach the receipt', 'file');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw AppException.badRequest('Files can be at most 10 MB', 'file');
    const contentType = sniffContentType(file.buffer);
    if (!contentType) throw AppException.badRequest('Upload a PDF, PNG, JPEG or WebP file', 'file');
    const previous = await this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, claimId);
      if (claim.employeeId !== me)
        throw AppException.forbidden('Only the claimant can add receipts');
      if (claim.status !== 'DRAFT')
        throw AppException.conflict('Receipts can be added only to a draft');
      const item = await tx.expenseItem.findFirst({
        where: { id: itemId, claimId },
        select: { receiptStorageKey: true },
      });
      if (!item) throw AppException.notFound('Expense item');
      return item.receiptStorageKey;
    });
    const key = StorageService.tenantKey(organizationId, 'expenses', 'receipts', uuidv7());
    await this.storage.client.send(
      new PutObjectCommand({
        Bucket: this.storage.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
        ContentLength: file.size,
      }),
    );
    try {
      const out = await this.prisma.withTenant(async (tx) => {
        await tx.expenseItem.update({
          where: { id: itemId },
          data: {
            receiptStorageKey: key,
            receiptFileName: safeFileName(file.originalname),
            receiptContentType: contentType,
            receiptSizeBytes: file.size,
          },
        });
        await this.audit.record(tx, {
          action: 'expenses.receipt.uploaded',
          entityType: 'expense_item',
          entityId: itemId,
          metadata: { sha256: createHash('sha256').update(file.buffer).digest('hex') },
        });
        return this.detailsIn(tx, principal, claimId);
      });
      if (previous) void this.deleteObject(previous);
      return out;
    } catch (err) {
      await this.deleteObject(key);
      throw err;
    }
  }

  async openReceipt(
    principal: AuthPrincipal,
    claimId: string,
    itemId: string,
  ): Promise<{ stream: Readable; fileName: string; contentType: string; sizeBytes: number }> {
    const item = await this.prisma.withTenant(async (tx) => {
      await this.visible(tx, principal, claimId);
      const it = await tx.expenseItem.findFirst({
        where: { id: itemId, claimId },
        select: {
          receiptStorageKey: true,
          receiptFileName: true,
          receiptContentType: true,
          receiptSizeBytes: true,
        },
      });
      if (!it?.receiptStorageKey) throw AppException.notFound('Receipt');
      return it;
    });
    const obj = await this.storage.client.send(
      new GetObjectCommand({ Bucket: this.storage.bucket, Key: item.receiptStorageKey ?? '' }),
    );
    if (!obj.Body) throw AppException.notFound('Receipt');
    return {
      stream: obj.Body as Readable,
      fileName: item.receiptFileName ?? 'receipt',
      contentType: item.receiptContentType ?? 'application/octet-stream',
      sizeBytes: item.receiptSizeBytes ?? 0,
    };
  }

  private async deleteObject(key: string): Promise<void> {
    try {
      await this.storage.client.send(
        new DeleteObjectCommand({ Bucket: this.storage.bucket, Key: key }),
      );
    } catch (err) {
      this.logger.warn(`Orphaned receipt object ${key}: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------ claims: workflow

  private async move(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
    from: ClaimRow['status'],
    to: ClaimRow['status'],
    data: Prisma.ExpenseClaimUpdateInput,
    note: string | null,
  ) {
    if (!canMoveClaim(from, to))
      throw AppException.conflict(
        `A ${from.toLowerCase().replace('_', ' ')} claim cannot become ${to.toLowerCase().replace('_', ' ')}`,
      );
    await tx.expenseClaim.update({ where: { id }, data: { ...data, status: to } });
    await tx.expenseClaimEvent.create({
      data: {
        organizationId: principal.organizationId ?? '',
        claimId: id,
        fromStatus: from,
        toStatus: to,
        note,
        actorUserId: principal.userId,
      },
    });
    await this.audit.record(tx, {
      action: `expenses.claim.${to.toLowerCase()}`,
      entityType: 'expense_claim',
      entityId: id,
      metadata: { from, note },
    });
  }

  /**
   * Submits a draft: blocking policy issues refuse it; warnings must carry a justification. The
   * reporting manager approves next; without one, the claim goes straight to finance.
   */
  submit(principal: AuthPrincipal, id: string): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.employeeId !== me)
        throw AppException.forbidden('Only the claimant can submit a claim');
      await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id}::uuid FOR UPDATE`;
      const items = await tx.expenseItem.findMany({
        where: { claimId: id },
        orderBy: { sortOrder: 'asc' },
      });
      if (!items.length) throw AppException.badRequest('Add at least one item');
      const issues = await this.check(tx, claim.employeeId, id, items);
      if (issues.length) {
        throw AppException.validation(
          issues.map((x) => ({
            path: `items.${String(x.item)}`,
            code: x.code,
            message: x.message,
          })),
          'The claim does not meet the expense policy',
        );
      }
      // Record the warnings that justifications answered, for approvers.
      const answered = (
        await this.check(
          tx,
          claim.employeeId,
          id,
          items.map((i) => ({ ...i, justification: null })),
        )
      ).filter((x) => x.severity === 'WARN');
      for (const [i, it] of items.entries())
        await tx.expenseItem.update({
          where: { id: it.id },
          data: {
            issues: answered.filter((x) => x.item === i) as unknown as Prisma.InputJsonValue,
          },
        });
      const subject = await subjectOf(tx, claim.employeeId);
      const manager =
        subject?.managerId && subject.managerId !== claim.employeeId ? subject.managerId : null;
      await this.move(
        tx,
        principal,
        id,
        'DRAFT',
        'SUBMITTED',
        { submittedAt: new Date(), approverEmployeeId: manager },
        null,
      );
      if (!manager) {
        await this.move(
          tx,
          principal,
          id,
          'SUBMITTED',
          'MANAGER_APPROVED',
          {},
          'No reporting manager: routed directly to finance',
        );
      }
      return this.detailsIn(tx, principal, id);
    });
  }

  cancel(principal: AuthPrincipal, id: string): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.employeeId !== me)
        throw AppException.forbidden('Only the claimant can cancel a claim');
      await this.move(tx, principal, id, claim.status, 'CANCELLED', {}, null);
      return this.detailsIn(tx, principal, id);
    });
  }

  /** Back to draft after a rejection (or before the manager decides) to correct and resubmit. */
  reopen(principal: AuthPrincipal, id: string): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.employeeId !== me)
        throw AppException.forbidden('Only the claimant can reopen a claim');
      await this.move(
        tx,
        principal,
        id,
        claim.status,
        'DRAFT',
        { submittedAt: null, approverEmployeeId: null, decisionNote: null },
        null,
      );
      return this.detailsIn(tx, principal, id);
    });
  }

  managerDecision(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof managerDecisionSchema>,
  ): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.status !== 'SUBMITTED')
        throw AppException.conflict('Only a submitted claim awaits the manager');
      if (!me || claim.approverEmployeeId !== me)
        throw AppException.forbidden('Only the claimant’s reporting manager can decide this step');
      if (claim.employeeId === me)
        throw AppException.forbidden('You cannot approve your own claim');
      await this.move(
        tx,
        principal,
        id,
        'SUBMITTED',
        input.decision === 'APPROVED' ? 'MANAGER_APPROVED' : 'REJECTED',
        {
          managerDecidedByUserId: principal.userId,
          managerDecidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
        input.note ?? null,
      );
      return this.detailsIn(tx, principal, id);
    });
  }

  /** Finance verification: approved amount per item (≤ claimed) and how it is paid. */
  financeDecision(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof financeDecisionSchema>,
  ): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim, me } = await this.visible(tx, principal, id);
      if (claim.status !== 'MANAGER_APPROVED')
        throw AppException.conflict('Only a manager-approved claim awaits finance');
      if (claim.employeeId === me) throw AppException.forbidden('You cannot verify your own claim');
      if (input.decision === 'REJECTED') {
        await this.move(
          tx,
          principal,
          id,
          'MANAGER_APPROVED',
          'REJECTED',
          {
            financeDecidedByUserId: principal.userId,
            financeDecidedAt: new Date(),
            decisionNote: input.note ?? null,
          },
          input.note ?? null,
        );
        return this.detailsIn(tx, principal, id);
      }
      const items = await tx.expenseItem.findMany({
        where: { claimId: id },
        select: { id: true, amount: true },
      });
      const byId = new Map(items.map((i) => [i.id, i]));
      const decided = new Map(input.items.map((x) => [x.itemId, x]));
      for (const [itemId, x] of decided) {
        const it = byId.get(itemId);
        if (!it) throw AppException.badRequest('An item does not belong to this claim', 'items');
        if (new Decimal(x.approvedAmount).greaterThan(it.amount.toString()))
          throw AppException.badRequest(
            'An approved amount cannot exceed the claimed amount',
            'items',
          );
      }
      let total = new Decimal(0);
      for (const it of items) {
        const x = decided.get(it.id);
        const approved = x ? new Decimal(x.approvedAmount) : new Decimal(it.amount.toString());
        total = total.plus(approved);
        await tx.expenseItem.update({
          where: { id: it.id },
          data: { approvedAmount: approved.toFixed(2), financeNote: x?.note ?? null },
        });
      }
      const settings = await settingsOf(tx);
      await this.move(
        tx,
        principal,
        id,
        'MANAGER_APPROVED',
        'FINANCE_APPROVED',
        {
          financeDecidedByUserId: principal.userId,
          financeDecidedAt: new Date(),
          totalApproved: total.toFixed(2),
          payoutMethod: input.payoutMethod ?? settings.defaultPayoutMethod,
          decisionNote: input.note ?? null,
        },
        input.note ?? null,
      );
      return this.detailsIn(tx, principal, id);
    });
  }

  /** EXTERNAL payout: mark a finance-approved claim as paid (claims on a trip with an advance settle with the trip). */
  markPaid(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof markPaidSchema>,
  ): Promise<ExpenseClaimDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { claim } = await this.visible(tx, principal, id);
      if (claim.status !== 'FINANCE_APPROVED' || claim.payoutMethod !== 'EXTERNAL')
        throw AppException.conflict(
          'Only a finance-approved claim paid outside payroll can be marked paid',
        );
      if (claim.trip && (await tx.travelAdvance.count({ where: { tripId: claim.trip.id } })) > 0)
        throw AppException.conflict(
          'This claim belongs to a trip with an advance and is paid through the trip settlement',
        );
      await this.move(
        tx,
        principal,
        id,
        'FINANCE_APPROVED',
        'REIMBURSED',
        { paidOn: toDate(input.paidOn), paidReference: input.reference, reimbursedAt: new Date() },
        input.reference,
      );
      return this.detailsIn(tx, principal, id);
    });
  }
}

export async function settingsOf(tx: TenantTransaction): Promise<ExpenseSettingsItem> {
  const [s, org] = await Promise.all([
    tx.expenseSettings.findFirst({}),
    tx.organization.findFirst({ select: { defaultCurrency: true } }),
  ]);
  return {
    claimWindowDays: s?.claimWindowDays ?? null,
    defaultPayoutMethod: s?.defaultPayoutMethod ?? 'PAYROLL',
    currency: org?.defaultCurrency ?? 'INR',
  };
}
