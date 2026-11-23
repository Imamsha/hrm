import { Injectable } from '@nestjs/common';
import { Decimal, travelSettlement } from '@hrm/business-rules';
import {
  type PaginatedResult,
  PERMISSIONS,
  type TravelLegItem,
  type TravelRequestDetails,
  type TravelRequestItem,
} from '@hrm/shared-types';
import type {
  expenseListQuerySchema,
  travelAdvanceSchema,
  travelBookingSchema,
  travelDecisionSchema,
  travelRequestSchema,
  travelSettleSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { paginate, skipTake } from '../../common/pagination.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { displayName, isoDate, toDate } from '../employees/employee-scope.js';
import { userNames } from '../recruitment/recruitment-mappers.js';
import { subjectOf } from '../time/time-context.js';

const P = PERMISSIONS;
const money = (v: { toString(): string } | null | undefined) =>
  v === null || v === undefined ? null : new Decimal(v.toString()).toFixed(2);
const empSelect = {
  id: true,
  employeeNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  preferredName: true,
} as const;
const tripSelect = {
  id: true,
  employeeId: true,
  purpose: true,
  startDate: true,
  endDate: true,
  legs: true,
  estimatedCost: true,
  advanceRequested: true,
  notes: true,
  status: true,
  approverEmployeeId: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionNote: true,
  settlementBalance: true,
  recoveryMethod: true,
  recoveryReference: true,
  recoveredAt: true,
  settledAt: true,
  createdAt: true,
  employee: { select: empSelect },
} satisfies Prisma.TravelRequestSelect;
type TripRow = Prisma.TravelRequestGetPayload<{ select: typeof tripSelect }>;
const ref = (e: {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  preferredName: string | null;
}) => ({
  id: e.id,
  employeeNumber: e.employeeNumber,
  displayName: displayName(e),
});

async function myEmployeeId(
  tx: TenantTransaction,
  principal: AuthPrincipal,
): Promise<string | null> {
  if (!principal.membershipId) return null;
  return (
    (
      await tx.employee.findFirst({
        where: { membershipId: principal.membershipId },
        select: { id: true },
      })
    )?.id ?? null
  );
}

/**
 * Trip settlement figures. Claims already reimbursed on their own count as paid; the balance is
 * the approved, not yet reimbursed claims minus the advances.
 */
export async function tripFigures(tx: TenantTransaction, tripId: string) {
  const [advances, claims] = await Promise.all([
    tx.travelAdvance.findMany({ where: { tripId }, select: { amount: true } }),
    tx.expenseClaim.findMany({
      where: { tripId, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      select: { status: true, totalApproved: true, payrollRunId: true },
    }),
  ]);
  // Claims already carried by a payroll run are paid there, not through the trip.
  const approvedUnpaid = claims
    .filter((c) => c.status === 'FINANCE_APPROVED' && c.payrollRunId === null)
    .map((c) => (c.totalApproved ?? 0).toString());
  const s = travelSettlement({
    advancesPaid: advances.map((a) => a.amount.toString()),
    approvedClaims: approvedUnpaid,
  });
  return {
    ...s,
    pendingClaims: claims.filter(
      (c) => c.status === 'DRAFT' || c.status === 'SUBMITTED' || c.status === 'MANAGER_APPROVED',
    ).length,
  };
}

@Injectable()
export class TravelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async toItem(
    tx: TenantTransaction,
    t: TripRow,
    principal: AuthPrincipal,
    me: string | null,
  ): Promise<TravelRequestItem> {
    const [approver, names] = await Promise.all([
      t.approverEmployeeId
        ? tx.employee.findFirst({ where: { id: t.approverEmployeeId }, select: empSelect })
        : null,
      userNames(tx, [t.decidedByUserId]),
    ]);
    const own = me !== null && t.employeeId === me;
    const fallback = t.approverEmployeeId === null && can(principal, P.TRAVEL_REQUEST_APPROVE, {});
    return {
      id: t.id,
      employee: ref(t.employee),
      purpose: t.purpose,
      startDate: isoDate(t.startDate),
      endDate: isoDate(t.endDate),
      legs: t.legs as unknown as TravelLegItem[],
      estimatedCost: money(t.estimatedCost),
      advanceRequested: money(t.advanceRequested),
      notes: t.notes,
      status: t.status,
      approver: approver ? ref(approver) : null,
      decidedBy: t.decidedByUserId ? (names.get(t.decidedByUserId) ?? null) : null,
      decidedAt: t.decidedAt?.toISOString() ?? null,
      decisionNote: t.decisionNote,
      settlementBalance: money(t.settlementBalance),
      recoveryMethod: t.recoveryMethod,
      recoveryReference: t.recoveryReference,
      recoveredAt: t.recoveredAt?.toISOString() ?? null,
      settledAt: t.settledAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      can: {
        decide:
          !own &&
          t.status === 'SUBMITTED' &&
          ((me !== null && t.approverEmployeeId === me) || fallback),
        cancel: own && (t.status === 'SUBMITTED' || t.status === 'APPROVED'),
        desk: can(principal, P.TRAVEL_DESK_MANAGE, {}) && t.status === 'APPROVED',
      },
    };
  }

  list(
    principal: AuthPrincipal,
    scope: 'mine' | 'approvals' | 'all',
    q: z.output<typeof expenseListQuerySchema>,
  ): Promise<PaginatedResult<TravelRequestItem>> {
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      let where: Prisma.TravelRequestWhereInput;
      if (scope === 'mine') {
        if (!me) throw AppException.notFound('Employee record linked to your account');
        where = { employeeId: me };
      } else if (scope === 'approvals') {
        const fallback = can(principal, P.TRAVEL_REQUEST_APPROVE, {});
        where = {
          status: 'SUBMITTED',
          OR: [
            ...(me ? [{ approverEmployeeId: me }] : []),
            ...(fallback ? [{ approverEmployeeId: null }] : []),
          ],
          ...(me ? { NOT: { employeeId: me } } : {}),
        };
        if (!me && !fallback) where = { id: { in: [] } };
      } else {
        if (!can(principal, P.TRAVEL_REQUEST_READ, {}) && !can(principal, P.TRAVEL_DESK_MANAGE, {}))
          throw AppException.forbidden();
        where = {
          ...(q.status ? { status: q.status as TripRow['status'] } : {}),
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        };
      }
      const [rows, total] = await Promise.all([
        tx.travelRequest.findMany({
          where,
          orderBy: { startDate: 'desc' },
          select: tripSelect,
          ...skipTake(q),
        }),
        tx.travelRequest.count({ where }),
      ]);
      return paginate(
        await Promise.all(rows.map((r) => this.toItem(tx, r, principal, me))),
        total,
        q,
      );
    });
  }

  private async visible(tx: TenantTransaction, principal: AuthPrincipal, id: string) {
    const t = await tx.travelRequest.findFirst({ where: { id }, select: tripSelect });
    if (!t) throw AppException.notFound('Travel request');
    const me = await myEmployeeId(tx, principal);
    const allowed =
      (me !== null && (t.employeeId === me || t.approverEmployeeId === me)) ||
      can(principal, P.TRAVEL_REQUEST_READ, {}) ||
      can(principal, P.TRAVEL_DESK_MANAGE, {}) ||
      (t.approverEmployeeId === null && can(principal, P.TRAVEL_REQUEST_APPROVE, {}));
    if (!allowed) throw AppException.notFound('Travel request');
    return { trip: t, me };
  }

  get(principal: AuthPrincipal, id: string): Promise<TravelRequestDetails> {
    return this.prisma.withTenant(async (tx) => this.detailsIn(tx, principal, id));
  }

  private async detailsIn(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    id: string,
  ): Promise<TravelRequestDetails> {
    const { trip, me } = await this.visible(tx, principal, id);
    const [bookings, advances, claims, figures] = await Promise.all([
      tx.travelBooking.findMany({ where: { tripId: id }, orderBy: { bookedOn: 'asc' } }),
      tx.travelAdvance.findMany({ where: { tripId: id }, orderBy: { paidOn: 'asc' } }),
      tx.expenseClaim.findMany({
        where: { tripId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, status: true, totalClaimed: true, totalApproved: true },
      }),
      tripFigures(tx, id),
    ]);
    return {
      ...(await this.toItem(tx, trip, principal, me)),
      bookings: bookings.map((b) => ({
        id: b.id,
        type: b.type,
        vendor: b.vendor,
        reference: b.reference,
        bookedOn: isoDate(b.bookedOn),
        amount: money(b.amount) ?? '0.00',
        paidByCompany: b.paidByCompany,
        notes: b.notes,
      })),
      advances: advances.map((a) => ({
        id: a.id,
        amount: money(a.amount) ?? '0.00',
        paidOn: isoDate(a.paidOn),
        reference: a.reference,
      })),
      claims: claims.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        totalClaimed: money(c.totalClaimed) ?? '0.00',
        totalApproved: money(c.totalApproved),
      })),
      settlement: {
        advances: figures.advances.toFixed(2),
        claimed: figures.claimed.toFixed(2),
        balance: figures.balance.toFixed(2),
        direction: figures.direction,
        pendingClaims: figures.pendingClaims,
      },
    };
  }

  create(
    principal: AuthPrincipal,
    input: z.output<typeof travelRequestSchema>,
  ): Promise<TravelRequestDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const me = await myEmployeeId(tx, principal);
      if (!me) throw AppException.notFound('Employee record linked to your account');
      const subject = await subjectOf(tx, me);
      const manager = subject?.managerId && subject.managerId !== me ? subject.managerId : null;
      const t = await tx.travelRequest.create({
        data: {
          organizationId,
          employeeId: me,
          purpose: input.purpose,
          startDate: toDate(input.startDate),
          endDate: toDate(input.endDate),
          legs: input.legs,
          estimatedCost: input.estimatedCost,
          advanceRequested: input.advanceRequested,
          notes: input.notes ?? null,
          approverEmployeeId: manager,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'travel.request.submitted',
        entityType: 'travel_request',
        entityId: t.id,
        metadata: { startDate: input.startDate, endDate: input.endDate },
      });
      return this.detailsIn(tx, principal, t.id);
    });
  }

  decide(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof travelDecisionSchema>,
  ): Promise<TravelRequestDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { trip, me } = await this.visible(tx, principal, id);
      if (trip.status !== 'SUBMITTED')
        throw AppException.conflict('Only a submitted request can be decided');
      if (me !== null && trip.employeeId === me)
        throw AppException.forbidden('You cannot approve your own travel');
      const isApprover = me !== null && trip.approverEmployeeId === me;
      const isFallback =
        trip.approverEmployeeId === null && can(principal, P.TRAVEL_REQUEST_APPROVE, {});
      if (!isApprover && !isFallback)
        throw AppException.forbidden(
          'Only the traveller’s reporting manager can decide this request',
        );
      await tx.travelRequest.update({
        where: { id },
        data: {
          status: input.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          decidedByUserId: principal.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
        },
      });
      await this.audit.record(tx, {
        action: `travel.request.${input.decision.toLowerCase()}`,
        entityType: 'travel_request',
        entityId: id,
        metadata: { note: input.note ?? null },
      });
      return this.detailsIn(tx, principal, id);
    });
  }

  cancel(principal: AuthPrincipal, id: string): Promise<TravelRequestDetails> {
    return this.prisma.withTenant(async (tx) => {
      const { trip, me } = await this.visible(tx, principal, id);
      if (me === null || trip.employeeId !== me)
        throw AppException.forbidden('Only the traveller can cancel the request');
      if (trip.status !== 'SUBMITTED' && trip.status !== 'APPROVED')
        throw AppException.conflict('This request can no longer be cancelled');
      const [advances, claims, bookings] = await Promise.all([
        tx.travelAdvance.count({ where: { tripId: id } }),
        tx.expenseClaim.count({ where: { tripId: id, status: { notIn: ['CANCELLED', 'DRAFT'] } } }),
        tx.travelBooking.count({ where: { tripId: id } }),
      ]);
      if (advances || claims || bookings)
        throw AppException.conflict(
          'The trip has bookings, advances or claims; ask the travel desk to settle it',
        );
      await tx.travelRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        action: 'travel.request.cancelled',
        entityType: 'travel_request',
        entityId: id,
      });
      return this.detailsIn(tx, principal, id);
    });
  }

  // ------------------------------------------------------------------------------ travel desk

  private async desk(tx: TenantTransaction, principal: AuthPrincipal, id: string) {
    const { trip } = await this.visible(tx, principal, id);
    if (!can(principal, P.TRAVEL_DESK_MANAGE, {})) throw AppException.forbidden();
    if (trip.status !== 'APPROVED')
      throw AppException.conflict(
        'Bookings and advances are recorded on approved, unsettled trips',
      );
    return trip;
  }

  addBooking(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof travelBookingSchema>,
  ): Promise<TravelRequestDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      await this.desk(tx, principal, id);
      const b = await tx.travelBooking.create({
        data: {
          organizationId,
          tripId: id,
          ...input,
          reference: input.reference ?? null,
          bookedOn: toDate(input.bookedOn),
          notes: input.notes ?? null,
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'travel.booking.created',
        entityType: 'travel_booking',
        entityId: b.id,
        metadata: { tripId: id, type: input.type },
      });
      return this.detailsIn(tx, principal, id);
    });
  }

  deleteBooking(
    principal: AuthPrincipal,
    id: string,
    bookingId: string,
  ): Promise<TravelRequestDetails> {
    return this.prisma.withTenant(async (tx) => {
      await this.desk(tx, principal, id);
      const b = await tx.travelBooking.findFirst({
        where: { id: bookingId, tripId: id },
        select: { id: true },
      });
      if (!b) throw AppException.notFound('Booking');
      await tx.travelBooking.delete({ where: { id: bookingId } });
      await this.audit.record(tx, {
        action: 'travel.booking.deleted',
        entityType: 'travel_booking',
        entityId: bookingId,
        metadata: { tripId: id },
      });
      return this.detailsIn(tx, principal, id);
    });
  }

  addAdvance(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof travelAdvanceSchema>,
  ): Promise<TravelRequestDetails> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      await this.desk(tx, principal, id);
      const a = await tx.travelAdvance.create({
        data: {
          organizationId,
          tripId: id,
          amount: input.amount,
          paidOn: toDate(input.paidOn),
          reference: input.reference,
          createdByUserId: principal.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        action: 'travel.advance.paid',
        entityType: 'travel_advance',
        entityId: a.id,
        metadata: { tripId: id, reference: input.reference },
      });
      return this.detailsIn(tx, principal, id);
    });
  }

  /**
   * Settles a trip once no claim is pending: approved trip claims are reimbursed against the
   * advances; the net balance is paid or recovered through payroll, or marked settled outside it.
   */
  settle(
    principal: AuthPrincipal,
    id: string,
    input: z.output<typeof travelSettleSchema>,
  ): Promise<TravelRequestDetails> {
    return this.prisma.withTenant(async (tx) => {
      await tx.$queryRaw`SELECT id FROM travel_requests WHERE id = ${id}::uuid FOR UPDATE`;
      await this.desk(tx, principal, id);
      const f = await tripFigures(tx, id);
      if (f.pendingClaims)
        throw AppException.conflict(
          `${String(f.pendingClaims)} claim(s) of this trip are still awaiting a decision`,
        );
      if (!f.balance.isZero() && !input.recovery)
        throw AppException.badRequest('Choose how the balance is settled', 'recovery');
      if (input.recovery === 'REPAID' && !f.balance.isZero() && !input.reference)
        throw AppException.badRequest('Give the payment reference', 'reference');
      // Approved claims are now settled through the trip.
      const claims = await tx.expenseClaim.findMany({
        where: { tripId: id, status: 'FINANCE_APPROVED', payrollRunId: null },
        select: { id: true },
      });
      for (const c of claims) {
        await tx.expenseClaim.update({
          where: { id: c.id },
          data: {
            status: 'REIMBURSED',
            reimbursedAt: new Date(),
            paidOn: new Date(),
            paidReference: 'Trip settlement',
            payrollRunId: null,
          },
        });
        await tx.expenseClaimEvent.create({
          data: {
            organizationId: principal.organizationId ?? '',
            claimId: c.id,
            fromStatus: 'FINANCE_APPROVED',
            toStatus: 'REIMBURSED',
            note: 'Settled with the trip',
            actorUserId: principal.userId,
          },
        });
      }
      const external = input.recovery === 'REPAID' || f.balance.isZero();
      await tx.travelRequest.update({
        where: { id },
        data: {
          status: 'SETTLED',
          settledAt: new Date(),
          settlementBalance: f.balance.toFixed(2),
          recoveryMethod: f.balance.isZero()
            ? null
            : input.recovery === 'REPAID'
              ? 'EXTERNAL'
              : 'PAYROLL',
          recoveryReference: f.balance.isZero() ? null : (input.reference ?? null),
          recoveredAt: external ? new Date() : null,
        },
      });
      await this.audit.record(tx, {
        action: 'travel.request.settled',
        entityType: 'travel_request',
        entityId: id,
        metadata: {
          balance: f.balance.toFixed(2),
          direction: f.direction,
          recovery: input.recovery ?? null,
        },
      });
      return this.detailsIn(tx, principal, id);
    });
  }
}
