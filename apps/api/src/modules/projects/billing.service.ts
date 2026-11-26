import { Injectable } from '@nestjs/common';
import {
  billingRate,
  canMoveInvoice,
  Decimal,
  dueDate,
  invoiceBalance,
  invoiceNumber,
  invoiceTotals,
} from '@hrm/business-rules';
import type {
  BillingSettingsItem,
  InvoiceDetails,
  InvoiceItem,
  TaxRateItem,
} from '@hrm/shared-types';
import type {
  billingSettingsSchema,
  invoiceSchema,
  issueInvoiceSchema,
  paymentSchema,
  taxRateSchema,
  voidInvoiceSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { StatementsService } from '../documents/statements.service.js';
import { isoDate, isoOrNull, todayIso, toDate } from '../employees/employee-scope.js';
import { clientRefSelect, empSelect, money, ref } from './projects-common.js';

type In<S extends z.ZodType> = z.output<S>;

const invoiceSelect = {
  id: true,
  number: true,
  currency: true,
  status: true,
  issuedOn: true,
  dueOn: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  paidTotal: true,
  createdAt: true,
  client: { select: clientRefSelect },
} satisfies Prisma.InvoiceSelect;
type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>;

export const toInvoiceItem = (i: InvoiceRow, today = todayIso()): InvoiceItem => {
  const total = i.total.toString();
  const b = invoiceBalance(total, [i.paidTotal.toString()]);
  const due = isoOrNull(i.dueOn);
  return {
    id: i.id,
    number: i.number,
    client: i.client,
    currency: i.currency,
    status: i.status,
    issuedOn: isoOrNull(i.issuedOn),
    dueOn: due,
    subtotal: money(i.subtotal) ?? '0.00',
    taxTotal: money(i.taxTotal) ?? '0.00',
    total: money(i.total) ?? '0.00',
    paid: b.paid.toFixed(2),
    balance: b.balance.toFixed(2),
    overdue: i.status === 'ISSUED' && !!due && due < today,
    createdAt: i.createdAt.toISOString(),
  };
};

const dateIn = (d: string) => ({
  effectiveFrom: { lte: toDate(d) },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(d) } }],
});

/** Tax rates, invoice numbering, invoices built from approved time, payments (ADR-017). */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statements: StatementsService,
  ) {}

  /** The invoice as a PDF from its stored figures (ADR-018). */
  async pdf(
    id: string,
    where: Prisma.InvoiceWhereInput = {},
  ): Promise<{ body: Uint8Array; fileName: string }> {
    const { inv, org } = await this.prisma.withTenant(async (tx) => ({
      inv: await this.details(tx, id, where),
      org: (await tx.organization.findFirstOrThrow({ select: { name: true } })).name,
    }));
    return {
      body: await this.statements.invoice(inv, org),
      fileName: `${inv.number ?? 'Draft invoice'}.pdf`,
    };
  }

  // ---------------------------------------------------------------------------- configuration

  taxRates(): Promise<TaxRateItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (await tx.taxRate.findMany({ orderBy: [{ name: 'asc' }, { effectiveFrom: 'desc' }] })).map(
        (t) => ({
          id: t.id,
          name: t.name,
          ratePercent: new Decimal(t.ratePercent.toString()).toString(),
          effectiveFrom: isoDate(t.effectiveFrom),
          effectiveTo: isoOrNull(t.effectiveTo),
        }),
      ),
    );
  }

  createTaxRate(principal: AuthPrincipal, input: In<typeof taxRateSchema>): Promise<TaxRateItem[]> {
    return this.prisma
      .withTenant(async (tx) => {
        const t = await tx.taxRate.create({
          data: {
            organizationId: principal.organizationId ?? '',
            name: input.name,
            ratePercent: input.ratePercent,
            effectiveFrom: toDate(input.effectiveFrom),
            effectiveTo: input.effectiveTo ? toDate(input.effectiveTo) : null,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'projects.tax_rate.created',
          entityType: 'tax_rate',
          entityId: t.id,
          metadata: { ...input },
        });
      })
      .then(() => this.taxRates());
  }

  private async settingsIn(tx: TenantTransaction, org: string) {
    return (
      (await tx.billingSettings.findFirst({
        select: { invoicePrefix: true, nextSequence: true },
      })) ??
      (await tx.billingSettings.create({
        data: { organizationId: org },
        select: { invoicePrefix: true, nextSequence: true },
      }))
    );
  }

  settings(principal: AuthPrincipal): Promise<BillingSettingsItem> {
    return this.prisma.withTenant((tx) => this.settingsIn(tx, principal.organizationId ?? ''));
  }

  updateSettings(
    principal: AuthPrincipal,
    input: In<typeof billingSettingsSchema>,
  ): Promise<BillingSettingsItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.settingsIn(tx, principal.organizationId ?? '');
      const s = await tx.billingSettings.update({
        where: { organizationId: principal.organizationId ?? '' },
        data: { invoicePrefix: input.invoicePrefix },
        select: { invoicePrefix: true, nextSequence: true },
      });
      await this.audit.record(tx, {
        action: 'projects.billing_settings.updated',
        entityType: 'billing_settings',
        metadata: { ...input },
      });
      return s;
    });
  }

  // ---------------------------------------------------------------------------- invoices

  list(q: { status?: string; clientId?: string }): Promise<InvoiceItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.clientId ? { clientId: q.clientId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        select: invoiceSelect,
        take: 500,
      });
      return rows.map((r) => toInvoiceItem(r));
    });
  }

  get(id: string): Promise<InvoiceDetails> {
    return this.prisma.withTenant((tx) => this.details(tx, id));
  }

  async details(
    tx: TenantTransaction,
    id: string,
    where: Prisma.InvoiceWhereInput = {},
  ): Promise<InvoiceDetails> {
    const i = await tx.invoice.findFirst({
      where: { id, ...where },
      select: {
        ...invoiceSelect,
        notes: true,
        voidReason: true,
        lines: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            description: true,
            source: true,
            quantity: true,
            unitPrice: true,
            amount: true,
            taxName: true,
            taxPercent: true,
            tax: true,
            total: true,
            project: { select: { id: true, key: true, name: true } },
          },
        },
        payments: {
          orderBy: { receivedOn: 'asc' },
          select: { id: true, amount: true, receivedOn: true, reference: true },
        },
      },
    });
    if (!i) throw AppException.notFound('Invoice');
    return {
      ...toInvoiceItem(i),
      notes: i.notes,
      voidReason: i.voidReason,
      lines: i.lines.map((l) => ({
        id: l.id,
        description: l.description,
        project: l.project,
        source: l.source,
        quantity: new Decimal(l.quantity.toString()).toString(),
        unitPrice: money(l.unitPrice) ?? '0.00',
        amount: money(l.amount) ?? '0.00',
        taxName: l.taxName,
        taxPercent: l.taxPercent ? new Decimal(l.taxPercent.toString()).toString() : null,
        tax: money(l.tax) ?? '0.00',
        total: money(l.total) ?? '0.00',
      })),
      payments: i.payments.map((p) => ({
        id: p.id,
        amount: money(p.amount) ?? '0.00',
        receivedOn: isoDate(p.receivedOn),
        reference: p.reference,
      })),
    };
  }

  private async taxRate(
    tx: TenantTransaction,
    id: string | null | undefined,
    on: string,
    path: string,
  ) {
    if (!id) return null;
    const t = await tx.taxRate.findFirst({
      where: { id, ...dateIn(on) },
      select: { id: true, name: true, ratePercent: true },
    });
    if (!t) throw AppException.badRequest('The tax rate does not exist or is not in force', path);
    return { id: t.id, name: t.name, percent: t.ratePercent.toString() };
  }

  /**
   * A draft invoice for one client: approved, billable, not-yet-invoiced time of the client's
   * time & materials projects in the period (one line per project and person, at the member's
   * rate or the project rate), plus manual lines. The time entries are reserved by the draft.
   */
  create(principal: AuthPrincipal, input: In<typeof invoiceSchema>): Promise<InvoiceDetails> {
    return this.prisma.withTenant(async (tx) => {
      const org = principal.organizationId ?? '';
      const client = await tx.client.findFirst({
        where: { id: input.clientId },
        select: { id: true, currency: true, status: true },
      });
      if (!client) throw AppException.badRequest('The client does not exist', 'clientId');
      if (client.status !== 'ACTIVE')
        throw AppException.badRequest('The client is inactive', 'clientId');
      const today = todayIso();

      interface Draft {
        description: string;
        projectId: string | null;
        source: 'TIME' | 'MANUAL';
        quantity: string;
        unitPrice: string;
        tax: { id: string; name: string; percent: string } | null;
        entryIds: string[];
      }
      const drafts: Draft[] = [];

      if (input.timeFrom && input.timeTo) {
        const tax = await this.taxRate(tx, input.timeTaxRateId, today, 'timeTaxRateId');
        // Lock the candidate entries so two drafts cannot reserve the same time.
        const entries = await tx.timeEntry.findMany({
          where: {
            invoiceLineId: null,
            billable: true,
            date: { gte: toDate(input.timeFrom), lte: toDate(input.timeTo) },
            timesheet: { status: 'APPROVED' },
            project: { clientId: client.id, billingType: 'TIME_AND_MATERIALS' },
          },
          select: {
            id: true,
            hours: true,
            employeeId: true,
            project: {
              select: {
                id: true,
                key: true,
                hourlyRate: true,
                members: { select: { employeeId: true, billingRate: true } },
              },
            },
          },
          orderBy: [{ projectId: 'asc' }, { employeeId: 'asc' }],
        });
        if (entries.length) {
          await tx.$queryRaw`SELECT id FROM time_entries WHERE id = ANY(${entries.map((e) => e.id)}::uuid[]) FOR UPDATE`;
          const people = await tx.employee.findMany({
            where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
            select: empSelect,
          });
          const groups = new Map<
            string,
            {
              project: (typeof entries)[number]['project'];
              employeeId: string;
              hours: Decimal;
              ids: string[];
            }
          >();
          for (const e of entries) {
            const k = `${e.project.id}:${e.employeeId}`;
            const g = groups.get(k) ?? {
              project: e.project,
              employeeId: e.employeeId,
              hours: new Decimal(0),
              ids: [],
            };
            g.hours = g.hours.plus(e.hours.toString());
            g.ids.push(e.id);
            groups.set(k, g);
          }
          const missing: string[] = [];
          for (const g of groups.values()) {
            const person = people.find((p) => p.id === g.employeeId);
            const name = person ? ref(person).displayName : 'Unknown';
            const rate = billingRate(
              g.project.members
                .find((m) => m.employeeId === g.employeeId)
                ?.billingRate?.toString() ?? null,
              g.project.hourlyRate?.toString() ?? null,
            );
            if (!rate) {
              missing.push(`${g.project.key} — ${name}`);
              continue;
            }
            drafts.push({
              description: `${g.project.key} — ${name}: ${g.hours.toString()} h (${input.timeFrom} to ${input.timeTo})`,
              projectId: g.project.id,
              source: 'TIME',
              quantity: g.hours.toString(),
              unitPrice: rate.toFixed(2),
              tax,
              entryIds: g.ids,
            });
          }
          if (missing.length)
            throw AppException.badRequest(
              `Set a billing rate first: ${missing.join(', ')}`,
              'timeFrom',
            );
        }
      }

      for (const [i, l] of input.lines.entries()) {
        if (l.projectId) {
          const p = await tx.project.findFirst({
            where: { id: l.projectId, clientId: client.id },
            select: { id: true },
          });
          if (!p)
            throw AppException.badRequest(
              `Line ${String(i + 1)}: the project is not this client's`,
              'lines',
            );
        }
        drafts.push({
          description: l.description,
          projectId: l.projectId ?? null,
          source: 'MANUAL',
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          tax: await this.taxRate(tx, l.taxRateId, today, 'lines'),
          entryIds: [],
        });
      }
      if (!drafts.length)
        throw AppException.badRequest(
          'There is no unbilled approved time in this period and no lines',
          'timeFrom',
        );

      const totals = invoiceTotals(
        drafts.map((d) => ({
          quantity: d.quantity,
          unitPrice: d.unitPrice,
          taxPercent: d.tax?.percent ?? null,
        })),
      );
      const inv = await tx.invoice.create({
        data: {
          organizationId: org,
          clientId: client.id,
          currency: client.currency,
          subtotal: totals.subtotal.toFixed(2),
          taxTotal: totals.tax.toFixed(2),
          total: totals.total.toFixed(2),
          notes: input.notes ?? null,
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      for (const [position, d] of drafts.entries()) {
        const amounts = totals.lines[position];
        if (!amounts) continue;
        const line = await tx.invoiceLine.create({
          data: {
            organizationId: org,
            invoiceId: inv.id,
            position,
            source: d.source,
            projectId: d.projectId,
            description: d.description,
            quantity: d.quantity,
            unitPrice: d.unitPrice,
            amount: amounts.amount.toFixed(2),
            taxRateId: d.tax?.id ?? null,
            taxName: d.tax?.name ?? null,
            taxPercent: d.tax?.percent ?? null,
            tax: amounts.tax.toFixed(2),
            total: amounts.total.toFixed(2),
          },
          select: { id: true },
        });
        if (d.entryIds.length)
          await tx.timeEntry.updateMany({
            where: { id: { in: d.entryIds } },
            data: { invoiceLineId: line.id },
          });
      }
      await this.audit.record(tx, {
        action: 'projects.invoice.drafted',
        entityType: 'invoice',
        entityId: inv.id,
        metadata: { clientId: client.id, total: totals.total.toFixed(2) },
      });
      return this.details(tx, inv.id);
    });
  }

  private async releaseTime(tx: TenantTransaction, invoiceId: string): Promise<void> {
    await tx.timeEntry.updateMany({
      where: { invoiceLine: { invoiceId } },
      data: { invoiceLineId: null },
    });
  }

  /** Deletes a draft and releases its time. */
  deleteDraft(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const i = await tx.invoice.findFirst({ where: { id }, select: { status: true } });
      if (!i) throw AppException.notFound('Invoice');
      if (i.status !== 'DRAFT')
        throw AppException.conflict('Only a draft can be deleted; void an issued invoice');
      await this.releaseTime(tx, id);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'projects.invoice.deleted',
        entityType: 'invoice',
        entityId: id,
      });
    });
  }

  /** Numbers the invoice from the organization's sequence (under a lock) and sets the due date. */
  issue(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof issueInvoiceSchema>,
  ): Promise<InvoiceDetails> {
    return this.prisma.withTenant(async (tx) => {
      const i = await tx.invoice.findFirst({
        where: { id },
        select: { status: true, client: { select: { paymentTermsDays: true } } },
      });
      if (!i) throw AppException.notFound('Invoice');
      if (!canMoveInvoice(i.status, 'ISSUED'))
        throw AppException.conflict('Only a draft can be issued');
      const org = principal.organizationId ?? '';
      await this.settingsIn(tx, org);
      await tx.$queryRaw`SELECT organization_id FROM billing_settings WHERE organization_id = ${org}::uuid FOR UPDATE`;
      const s = await tx.billingSettings.update({
        where: { organizationId: org },
        data: { nextSequence: { increment: 1 } },
        select: { invoicePrefix: true, nextSequence: true },
      });
      const number = invoiceNumber(
        s.invoicePrefix,
        Number(input.issuedOn.slice(0, 4)),
        s.nextSequence - 1,
      );
      await tx.invoice.update({
        where: { id },
        data: {
          status: 'ISSUED',
          number,
          issuedOn: toDate(input.issuedOn),
          dueOn: toDate(dueDate(input.issuedOn, i.client.paymentTermsDays)),
        },
      });
      await this.audit.record(tx, {
        action: 'projects.invoice.issued',
        entityType: 'invoice',
        entityId: id,
        metadata: { number },
      });
      return this.details(tx, id);
    });
  }

  recordPayment(
    principal: AuthPrincipal,
    id: string,
    input: In<typeof paymentSchema>,
  ): Promise<InvoiceDetails> {
    return this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
      const i = await tx.invoice.findFirst({
        where: { id },
        select: { status: true, total: true, paidTotal: true, issuedOn: true },
      });
      if (!i) throw AppException.notFound('Invoice');
      if (i.status !== 'ISSUED')
        throw AppException.conflict('Payments are recorded against issued invoices');
      if (i.issuedOn && input.receivedOn < isoDate(i.issuedOn))
        throw AppException.badRequest(
          'The payment cannot be before the invoice date',
          'receivedOn',
        );
      const b = invoiceBalance(i.total.toString(), [i.paidTotal.toString(), input.amount]);
      if (b.overpaid)
        throw AppException.badRequest(
          `The balance is ${invoiceBalance(i.total.toString(), [i.paidTotal.toString()]).balance.toFixed(2)}`,
          'amount',
        );
      await tx.invoicePayment.create({
        data: {
          organizationId: principal.organizationId ?? '',
          invoiceId: id,
          amount: input.amount,
          receivedOn: toDate(input.receivedOn),
          reference: input.reference ?? null,
          recordedByUserId: principal.userId,
        },
      });
      await tx.invoice.update({
        where: { id },
        data: { paidTotal: b.paid.toFixed(2), ...(b.settled ? { status: 'PAID' } : {}) },
      });
      await this.audit.record(tx, {
        action: 'projects.invoice.payment_recorded',
        entityType: 'invoice',
        entityId: id,
        metadata: { amount: input.amount, settled: b.settled },
      });
      return this.details(tx, id);
    });
  }

  /** Voids an issued invoice without payments; its time becomes billable again. */
  void(id: string, input: In<typeof voidInvoiceSchema>): Promise<InvoiceDetails> {
    return this.prisma.withTenant(async (tx) => {
      const i = await tx.invoice.findFirst({
        where: { id },
        select: { status: true, paidTotal: true },
      });
      if (!i) throw AppException.notFound('Invoice');
      if (i.status !== 'ISSUED')
        throw AppException.conflict(
          i.status === 'DRAFT'
            ? 'Delete a draft instead of voiding it'
            : 'Only an issued invoice can be voided',
        );
      if (!new Decimal(i.paidTotal.toString()).isZero())
        throw AppException.conflict('An invoice with payments cannot be voided');
      await this.releaseTime(tx, id);
      await tx.invoice.update({
        where: { id },
        data: { status: 'VOID', voidReason: input.reason, voidedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'projects.invoice.voided',
        entityType: 'invoice',
        entityId: id,
        metadata: { reason: input.reason },
      });
      return this.details(tx, id);
    });
  }
}
