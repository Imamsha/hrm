import { Injectable } from '@nestjs/common';
import {
  countWorkingDays,
  type HolidayEntry,
  resolveDays,
  type WorkWeekRule,
} from '@hrm/business-rules';
import type {
  HolidayCalendarItem,
  HolidayItem,
  ResolvedCalendar,
  WorkWeekItem,
} from '@hrm/shared-types';
import type { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { auditedCreate, auditedDelete, auditedUpdate } from './audited-writes.js';
import { notFound } from './structure-base.js';
import { definedOnly, mapWriteError, sqlState } from './structure.util.js';

const WORK_WEEK = { label: 'work week', type: 'work_week', uniqueField: 'name' };
const CALENDAR = { label: 'holiday calendar', type: 'holiday_calendar', uniqueField: 'name' };

const weekInclude = {
  rules: { orderBy: [{ weekday: 'asc' }, { occurrence: 'asc' }] },
  _count: { select: { branches: true } },
} satisfies Prisma.WorkWeekInclude;
type WeekRow = Prisma.WorkWeekGetPayload<{ include: typeof weekInclude }>;

function weekItem(r: WeekRow): WorkWeekItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isDefault: r.isDefault,
    rules: r.rules.map((x) => ({
      weekday: x.weekday,
      occurrence: x.occurrence,
      dayType: x.dayType,
    })),
    branchCount: r._count.branches,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const calendarInclude = {
  _count: { select: { holidays: true, branches: true } },
} satisfies Prisma.HolidayCalendarInclude;
type CalendarRow = Prisma.HolidayCalendarGetPayload<{ include: typeof calendarInclude }>;

function calendarItem(r: CalendarRow): HolidayCalendarItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isDefault: r.isDefault,
    holidayCount: r._count.holidays,
    branchCount: r._count.branches,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
const fromIsoDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

function holidayItem(h: {
  id: string;
  date: Date;
  name: string;
  kind: 'PUBLIC' | 'OPTIONAL';
}): HolidayItem {
  return { id: h.id, date: toIsoDate(h.date), name: h.name, kind: h.kind };
}

type Rule = { weekday: number; occurrence: number; dayType: 'FULL' | 'HALF' | 'OFF' };

@Injectable()
export class CalendarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ work weeks

  listWorkWeeks(): Promise<WorkWeekItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.workWeek.findMany({
          include: weekInclude,
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        })
      ).map(weekItem),
    );
  }

  /** Clearing the previous default first keeps "one default per organization" atomic. */
  private async clearDefaultWorkWeek(tx: TenantTransaction, exceptId?: string) {
    await tx.workWeek.updateMany({
      where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }

  createWorkWeek(
    principal: AuthPrincipal,
    input: {
      name: string;
      description?: string | null | undefined;
      isDefault: boolean;
      rules: Rule[];
    },
  ): Promise<WorkWeekItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      if (input.isDefault) await this.clearDefaultWorkWeek(tx);
      const row = await auditedCreate(
        tx,
        this.audit,
        WORK_WEEK,
        () =>
          tx.workWeek.create({
            data: {
              organizationId,
              name: input.name,
              description: input.description ?? null,
              isDefault: input.isDefault,
              rules: { create: input.rules },
            },
            include: weekInclude,
          }),
        (r) => ({ name: r.name, isDefault: r.isDefault, rules: input.rules }),
      );
      return weekItem(row);
    });
  }

  updateWorkWeek(
    principal: AuthPrincipal,
    id: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      isDefault?: boolean | undefined;
      rules?: Rule[] | undefined;
    },
  ): Promise<WorkWeekItem> {
    const organizationId = principal.organizationId ?? '';
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.workWeek.findFirst({ where: { id }, include: weekInclude });
      if (before && input.isDefault) await this.clearDefaultWorkWeek(tx, id);
      const { rules, ...fields } = input;
      const data = definedOnly(fields);
      const row = await auditedUpdate(
        tx,
        this.audit,
        { ...WORK_WEEK, id },
        before ? { ...before, rules: weekItem(before).rules } : null,
        { ...data, ...(rules ? { rules } : {}) },
        async () => {
          if (rules) {
            await tx.workWeekRule.deleteMany({ where: { workWeekId: id } });
            await tx.workWeekRule.createMany({
              data: rules.map((r) => ({ organizationId, workWeekId: id, ...r })),
            });
          }
          return tx.workWeek.update({ where: { id }, data, include: weekInclude });
        },
      );
      return weekItem(row);
    });
  }

  removeWorkWeek(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.workWeek.findFirst({ where: { id }, select: { name: true } });
      await auditedDelete(tx, this.audit, { ...WORK_WEEK, id }, existing, () =>
        tx.workWeek.delete({ where: { id } }),
      );
    });
  }

  // ------------------------------------------------------------------ holiday calendars

  listCalendars(): Promise<HolidayCalendarItem[]> {
    return this.prisma.withTenant(async (tx) =>
      (
        await tx.holidayCalendar.findMany({
          include: calendarInclude,
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        })
      ).map(calendarItem),
    );
  }

  private async clearDefaultCalendar(tx: TenantTransaction, exceptId?: string) {
    await tx.holidayCalendar.updateMany({
      where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { isDefault: false },
    });
  }

  createCalendar(
    principal: AuthPrincipal,
    input: { name: string; description?: string | null | undefined; isDefault: boolean },
  ): Promise<HolidayCalendarItem> {
    return this.prisma.withTenant(async (tx) => {
      if (input.isDefault) await this.clearDefaultCalendar(tx);
      const row = await auditedCreate(
        tx,
        this.audit,
        CALENDAR,
        () =>
          tx.holidayCalendar.create({
            data: {
              organizationId: principal.organizationId ?? '',
              name: input.name,
              description: input.description ?? null,
              isDefault: input.isDefault,
            },
            include: calendarInclude,
          }),
        (r) => ({ name: r.name, isDefault: r.isDefault }),
      );
      return calendarItem(row);
    });
  }

  updateCalendar(
    id: string,
    input: {
      name?: string | undefined;
      description?: string | null | undefined;
      isDefault?: boolean | undefined;
    },
  ): Promise<HolidayCalendarItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.holidayCalendar.findFirst({ where: { id } });
      if (before && input.isDefault) await this.clearDefaultCalendar(tx, id);
      const data = definedOnly(input);
      const row = await auditedUpdate(tx, this.audit, { ...CALENDAR, id }, before, data, () =>
        tx.holidayCalendar.update({ where: { id }, data, include: calendarInclude }),
      );
      return calendarItem(row);
    });
  }

  removeCalendar(id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.holidayCalendar.findFirst({
        where: { id },
        select: { name: true },
      });
      await auditedDelete(tx, this.audit, { ...CALENDAR, id }, existing, () =>
        tx.holidayCalendar.delete({ where: { id } }),
      );
    });
  }

  // ------------------------------------------------------------------ holidays

  listHolidays(calendarId: string, year?: number): Promise<HolidayItem[]> {
    return this.prisma.withTenant(async (tx) => {
      if (
        !(await tx.holidayCalendar.findFirst({ where: { id: calendarId }, select: { id: true } }))
      ) {
        notFound('Holiday calendar');
      }
      const rows = await tx.holiday.findMany({
        where: {
          calendarId,
          ...(year
            ? {
                date: {
                  gte: fromIsoDate(`${String(year)}-01-01`),
                  lte: fromIsoDate(`${String(year)}-12-31`),
                },
              }
            : {}),
        },
        orderBy: { date: 'asc' },
      });
      return rows.map(holidayItem);
    });
  }

  /** Adds holidays in one transaction; a date already present fails the whole batch (409). */
  addHolidays(
    principal: AuthPrincipal,
    calendarId: string,
    holidays: { date: string; name: string; kind: 'PUBLIC' | 'OPTIONAL' }[],
  ): Promise<HolidayItem[]> {
    return this.prisma.withTenant(async (tx) => {
      if (
        !(await tx.holidayCalendar.findFirst({ where: { id: calendarId }, select: { id: true } }))
      ) {
        notFound('Holiday calendar');
      }
      const created = [];
      for (const h of holidays) {
        const row = await tx.holiday
          .create({
            data: {
              organizationId: principal.organizationId ?? '',
              calendarId,
              date: fromIsoDate(h.date),
              name: h.name,
              kind: h.kind,
            },
          })
          .catch((err: unknown) => {
            if (sqlState(err) === '23505') {
              throw AppException.conflictOn(`A holiday already exists on ${h.date}`, 'date');
            }
            return mapWriteError(err, { entity: 'holiday' });
          });
        created.push(row);
      }
      await this.audit.record(tx, {
        action: 'holiday_calendar.holidays_added',
        entityType: 'holiday_calendar',
        entityId: calendarId,
        metadata: { holidays },
      });
      return created.map(holidayItem);
    });
  }

  updateHoliday(
    calendarId: string,
    holidayId: string,
    input: {
      date?: string | undefined;
      name?: string | undefined;
      kind?: 'PUBLIC' | 'OPTIONAL' | undefined;
    },
  ): Promise<HolidayItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.holiday.findFirst({ where: { id: holidayId, calendarId } });
      const data = definedOnly({
        ...input,
        date: input.date ? fromIsoDate(input.date) : undefined,
      });
      const row = await auditedUpdate(
        tx,
        this.audit,
        { label: 'holiday', type: 'holiday', uniqueField: 'date', id: holidayId },
        before,
        data,
        () => tx.holiday.update({ where: { id: holidayId }, data }),
      );
      return holidayItem(row);
    });
  }

  removeHoliday(calendarId: string, holidayId: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      const existing = await tx.holiday.findFirst({ where: { id: holidayId, calendarId } });
      await auditedDelete(
        tx,
        this.audit,
        { label: 'holiday', type: 'holiday', id: holidayId },
        existing ? { date: toIsoDate(existing.date), name: existing.name } : null,
        () => tx.holiday.delete({ where: { id: holidayId } }),
      );
    });
  }

  // ------------------------------------------------------------------ resolution

  /**
   * Resolves working days for a branch (its own work week / calendar, falling back to the
   * organization defaults) or, without a branch, for the organization defaults.
   */
  resolve(query: {
    branchId?: string | undefined;
    from: string;
    to: string;
  }): Promise<ResolvedCalendar> {
    return this.prisma.withTenant(async (tx) => {
      const branch = query.branchId
        ? await tx.branch.findFirst({
            where: { id: query.branchId },
            select: { id: true, code: true, name: true, workWeekId: true, holidayCalendarId: true },
          })
        : null;
      if (query.branchId && !branch) throw AppException.badRequest('Branch not found', 'branchId');

      const workWeek = await tx.workWeek.findFirst({
        where: branch?.workWeekId ? { id: branch.workWeekId } : { isDefault: true },
        include: { rules: true },
      });
      const calendar = await tx.holidayCalendar.findFirst({
        where: branch?.holidayCalendarId ? { id: branch.holidayCalendarId } : { isDefault: true },
        select: { id: true, name: true },
      });
      const holidays: HolidayEntry[] = calendar
        ? (
            await tx.holiday.findMany({
              where: {
                calendarId: calendar.id,
                date: { gte: fromIsoDate(query.from), lte: fromIsoDate(query.to) },
              },
            })
          ).map((h) => ({ date: toIsoDate(h.date), name: h.name, kind: h.kind }))
        : [];
      if (!workWeek) {
        throw AppException.badRequest(
          'No work week applies: assign one to the branch or mark one as the organization default',
          'branchId',
        );
      }
      let days;
      try {
        days = resolveDays(
          query.from,
          query.to,
          workWeek.rules as unknown as WorkWeekRule[],
          holidays,
        );
      } catch (err) {
        throw AppException.badRequest(err instanceof Error ? err.message : 'Invalid range', 'to');
      }
      return {
        branch: branch ? { id: branch.id, code: branch.code, name: branch.name } : null,
        workWeek: { id: workWeek.id, name: workWeek.name },
        holidayCalendar: calendar,
        from: query.from,
        to: query.to,
        workingDays: countWorkingDays(days),
        days,
      };
    });
  }
}
