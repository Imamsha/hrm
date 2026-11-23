/**
 * Assembles every input of one employee's monthly pay from the database and runs the pure engine
 * (`computeMonthlyPay`). Missing configuration becomes a problem on the result — never a default.
 */
import {
  arrearsFor,
  computeMonthlyPay,
  Decimal,
  type EpfConfig,
  type EsiConfig,
  esiCovered,
  type Gender,
  type IncomeTaxConfig,
  lossOfPayDays,
  type LopDay,
  type MonthlyPayResult,
  type PayLine,
  payableDays,
  type Problem,
  type PtConfig,
  prorateLines,
  STATUTORY_CODES,
  sumLines,
  toDecimal,
} from '@hrm/business-rules';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { addDays, isoDate, toDate } from '../employees/employee-scope.js';
import { employeeCalendar, evaluateRange, subjectOf } from '../time/time-context.js';
import type { settingsOf } from './payroll-config.service.js';
import {
  activeRuleSet,
  ageOn,
  esiPeriodStartMonth,
  financialYearOf,
  fyMonthsBefore,
  loadStructures,
  monthBounds,
  salariesUpTo,
  salaryBreakdown,
  salaryOn,
  type SalaryRow,
  type StructureDef,
} from './payroll-common.js';

export interface CalcContext {
  year: number;
  month: number;
  settings: Awaited<ReturnType<typeof settingsOf>>;
  adjustments: {
    id: string;
    code: string;
    name: string;
    category: 'EARNING' | 'DEDUCTION';
    amount: string;
    taxable: boolean;
    pfWage: boolean;
    esiWage: boolean;
    ptWage: boolean;
  }[];
  /** Calculation date (attendance after it is still pending). */
  now?: Date;
}

export interface EmployeeCalc {
  employeeId: string;
  payable: Decimal;
  denominator: Decimal;
  lop: Decimal;
  result: MonthlyPayResult | null;
  taxableGross: Decimal;
  esiCovered: boolean;
  problems: Problem[];
  snapshot: Record<string, unknown>;
  /** Arrears inputs in the order the engine emits their ARR_ lines (non-zero only). */
  arrears: { code: string; forYear: number; forMonth: number }[];
  componentOrder: Map<string, number>;
}

const GENDER: Record<string, Gender | null> = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  NON_BINARY: 'OTHER',
  OTHER: 'OTHER',
  UNDISCLOSED: null,
};

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export async function calculateEmployee(
  tx: TenantTransaction,
  employeeId: string,
  ctx: CalcContext,
): Promise<EmployeeCalc> {
  const problems: Problem[] = [];
  const { start, end, days: daysInMonth } = monthBounds(ctx.year, ctx.month);
  const e = await tx.employee.findFirst({
    where: { id: employeeId },
    select: {
      dateOfJoining: true,
      lastWorkingDate: true,
      dateOfBirth: true,
      gender: true,
      payrollProfile: true,
    },
  });
  if (!e) throw new Error(`Employee ${employeeId} not found`);
  const doj = isoDate(e.dateOfJoining);
  const lwd = e.lastWorkingDate ? isoDate(e.lastWorkingDate) : null;
  const employedFrom = doj > start ? doj : start;
  const employedTo = lwd && lwd < end ? lwd : end;
  const profile = e.payrollProfile;

  // ---------------------------------------------------------------- days and loss of pay
  const { days: calendar } = await employeeCalendar(tx, employeeId, start, end);
  const workUnit = (d: string) => {
    const k = calendar.get(d)?.kind ?? 'WORKING';
    return k === 'WEEKLY_OFF' || k === 'HOLIDAY' ? 0 : k === 'HALF_DAY' ? 0.5 : 1;
  };
  const s = ctx.settings;
  const denominator =
    s.payableDaysMethod === 'CALENDAR_DAYS'
      ? daysInMonth
      : s.payableDaysMethod === 'FIXED_DAYS'
        ? (s.fixedDays ?? daysInMonth)
        : daysBetween(start, end).reduce((n, d) => n + workUnit(d), 0);
  if (denominator <= 0)
    problems.push({
      code: 'NO_WORKING_DAYS',
      message: 'The month has no working days in the employee’s calendar',
    });
  const employedIn = (from: string, to: string): number => {
    if (from > to) return 0;
    const list = daysBetween(from, to);
    if (s.payableDaysMethod === 'WORKING_DAYS') return list.reduce((n, d) => n + workUnit(d), 0);
    if (s.payableDaysMethod === 'FIXED_DAYS' && from === start && to === end) return denominator;
    return list.length;
  };

  const subject = await subjectOf(tx, employeeId);
  const evaluated =
    subject && employedFrom <= employedTo
      ? ((await evaluateRange(tx, [subject], employedFrom, employedTo, ctx.now)).get(employeeId) ??
        [])
      : [];
  const lopDays: (LopDay & { date: string })[] = evaluated.map((d) => ({
    date: d.date,
    status: d.status,
    leaveSession: d.leave?.session ?? null,
    unpaidLeaveDays: d.unpaidLeaveDays ?? 0,
    halfWorkingDay: d.halfWorkingDay ?? false,
  }));

  // ---------------------------------------------------------------- salary segments
  const salaries = (await salariesUpTo(tx, [employeeId], employedTo)).get(employeeId) ?? [];
  const structures = await loadStructures(
    tx,
    salaries.map((x) => x.structureId),
  );
  const epfRule = profile?.pfApplicable
    ? await activeRuleSet<EpfConfig & { epsMaxAgeYears?: number | null }>(tx, 'EPF', end)
    : null;
  const esiRule = profile?.esiApplicable ? await activeRuleSet<EsiConfig>(tx, 'ESI', end) : null;
  const age = ageOn(e.dateOfBirth, end);
  const epsEligible =
    (profile?.epsEligible ?? false) &&
    !(epfRule?.config.epsMaxAgeYears && age !== null && age >= epfRule.config.epsMaxAgeYears);
  const employer = {
    epf: epfRule ? { config: epfRule.config, epsEligible } : null,
    esi: esiRule ? { config: esiRule.config } : null,
  };
  const breakdownOf = (row: SalaryRow, structure: StructureDef) => {
    const b = salaryBreakdown(row, structure, employer);
    for (const p of b.problems) problems.push(p);
    return b.lines;
  };

  const first = salaryOn(salaries, employedFrom);
  const changes = salaries.filter(
    (x) => x.effectiveFrom > employedFrom && x.effectiveFrom <= employedTo,
  );
  const segments: { salary: SalaryRow; from: string; to: string }[] = [];
  const starts = [
    ...(first ? [{ salary: first, from: employedFrom }] : []),
    ...changes.map((c) => ({ salary: c, from: c.effectiveFrom })),
  ];
  starts.forEach((seg, i) => {
    const next = starts[i + 1];
    segments.push({
      salary: seg.salary,
      from: seg.from,
      to: next ? addDays(next.from, -1) : employedTo,
    });
  });
  if (!segments.length)
    problems.push({ code: 'NO_SALARY', message: 'No salary is set for this period' });

  const combined = new Map<string, PayLine>();
  let recurring: PayLine[] = [];
  let payableTotal = new Decimal(0);
  let lopTotal = new Decimal(0);
  const segmentSnapshot: Record<string, unknown>[] = [];
  segments.forEach((seg, i) => {
    const structure = structures.get(seg.salary.structureId);
    if (!structure) return;
    const full = breakdownOf(seg.salary, structure);
    const lop = lossOfPayDays(
      lopDays.filter((d) => d.date >= seg.from && d.date <= seg.to),
      s.absentIsLossOfPay,
    );
    const employed = employedIn(seg.from, seg.to);
    const payable =
      denominator > 0
        ? payableDays({ denominator, employedDays: employed, lossOfPayDays: lop })
        : new Decimal(0);
    const last = i === segments.length - 1;
    const prorated =
      denominator > 0
        ? prorateLines(full, payable, denominator)
        : full.map((l) => ({ ...l, amount: new Decimal(0) }));
    for (const l of prorated) {
      // Components that are not prorated are paid once, at the latest segment's amount.
      if (!l.prorate && !last) continue;
      const cur = combined.get(l.code);
      combined.set(l.code, cur ? { ...cur, amount: cur.amount.plus(l.amount) } : l);
    }
    if (last) recurring = full;
    payableTotal = payableTotal.plus(payable);
    lopTotal = lopTotal.plus(lop);
    segmentSnapshot.push({
      salaryId: seg.salary.id,
      from: seg.from,
      to: seg.to,
      employedDays: employed,
      lossOfPayDays: lop.toString(),
      payableDays: payable.toString(),
    });
  });
  payableTotal = Decimal.min(payableTotal, Math.max(denominator, 0));

  // ---------------------------------------------------------------- arrears for past months
  const componentFlags = new Map(
    (
      await tx.salaryComponent.findMany({
        select: {
          code: true,
          name: true,
          taxable: true,
          pfWage: true,
          esiWage: true,
          ptWage: true,
          payslipOrder: true,
        },
      })
    ).map((c) => [c.code, c]),
  );
  const arrears: {
    code: string;
    name: string;
    amount: string;
    taxable: boolean;
    pfWage: boolean;
    esiWage: boolean;
    ptWage: boolean;
    forYear: number;
    forMonth: number;
  }[] = [];
  const past = await tx.payrollResult.findMany({
    where: {
      employeeId,
      run: {
        status: 'FINALIZED',
        OR: [{ year: { lt: ctx.year } }, { year: ctx.year, month: { lt: ctx.month } }],
        periodStart: {
          gte: toDate(`${String(ctx.year - 1)}-${String(ctx.month).padStart(2, '0')}-01`),
        },
      },
    },
    select: {
      payableDays: true,
      periodDays: true,
      snapshot: true,
      run: { select: { year: true, month: true, periodEnd: true } },
      lines: { where: { source: 'STRUCTURE' }, select: { code: true, name: true, amount: true } },
    },
  });
  if (past.length) {
    const laterArrears = await tx.payrollResultLine.findMany({
      where: { source: 'ARREARS', result: { employeeId, run: { status: 'FINALIZED' } } },
      select: { code: true, name: true, amount: true, forYear: true, forMonth: true },
    });
    const allSalaries = (await salariesUpTo(tx, [employeeId], end)).get(employeeId) ?? [];
    const moreStructures = await loadStructures(
      tx,
      allSalaries.map((x) => x.structureId),
    );
    for (const p of past) {
      const snap = p.snapshot as { lastSalaryId?: string };
      const monthEnd = isoDate(p.run.periodEnd);
      const dueSalary = salaryOn(allSalaries, monthEnd);
      if (!dueSalary || dueSalary.id === snap.lastSalaryId) continue;
      const structure = moreStructures.get(dueSalary.structureId);
      if (!structure) continue;
      const due = prorateLines(
        salaryBreakdown(dueSalary, structure, employer).lines,
        String(p.payableDays),
        String(p.periodDays),
      ).filter((l) => l.kind === 'EARNING');
      const paid = [
        ...p.lines.map((l) => ({ code: l.code, name: l.name, amount: String(l.amount) })),
        ...laterArrears
          .filter((a) => a.forYear === p.run.year && a.forMonth === p.run.month)
          .map((a) => ({
            code: a.code.replace(/^ARR_/, ''),
            name: a.name,
            amount: String(a.amount),
          })),
      ];
      const earningCodes = new Set(due.map((l) => l.code));
      for (const diff of arrearsFor(
        paid.filter((l) => earningCodes.has(l.code) || componentFlags.has(l.code)),
        due.map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
      )) {
        const flags = componentFlags.get(diff.code);
        arrears.push({
          code: diff.code,
          name: flags?.name ?? diff.name,
          amount: diff.amount.toString(),
          taxable: flags?.taxable ?? true,
          pfWage: flags?.pfWage ?? false,
          esiWage: flags?.esiWage ?? false,
          ptWage: flags?.ptWage ?? false,
          forYear: p.run.year,
          forMonth: p.run.month,
        });
      }
    }
  }
  // ---------------------------------------------------------------- statutory scopes
  let esiCoveredNow = false;
  let esiInput: { config: EsiConfig | null; covered: boolean } | null = null;
  if (profile?.esiApplicable) {
    if (!esiRule) esiInput = { config: null, covered: true };
    else {
      const startMonth = esiPeriodStartMonth(ctx.month, esiRule.config) ?? ctx.month;
      const startYear = startMonth > ctx.month ? ctx.year - 1 : ctx.year;
      const periodStart = monthBounds(startYear, startMonth).start;
      const anchor = periodStart > doj ? periodStart : doj;
      const salaryAtStart = salaryOn(salaries, anchor) ?? salaries[0] ?? null;
      const structure = salaryAtStart ? structures.get(salaryAtStart.structureId) : undefined;
      const wages =
        salaryAtStart && structure
          ? sumLines(
              salaryBreakdown(salaryAtStart, structure, employer).lines,
              (l) => l.kind === 'EARNING' && l.esiWage,
            )
          : new Decimal(0);
      esiCoveredNow = esiCovered(wages, esiRule.config);
      esiInput = { config: esiRule.config, covered: esiCoveredNow };
    }
  }
  const ptRule = profile?.ptStateCode
    ? await activeRuleSet<PtConfig>(tx, 'PT', end, { stateCode: profile.ptStateCode })
    : null;

  const fy = financialYearOf(ctx.year, ctx.month);
  let taxInput: Parameters<typeof computeMonthlyPay>[0]['tax'] = null;
  let regime: 'OLD' | 'NEW' | null = null;
  let taxRuleId: string | null = null;
  let declarationAt: string | null = null;
  if (profile?.taxApplicable ?? true) {
    const declaration = await tx.taxDeclaration.findFirst({
      where: { employeeId, financialYear: fy },
      select: { regime: true, rentPaidAnnual: true, deductions: true, updatedAt: true },
    });
    regime = declaration?.regime ?? s.defaultTaxRegime;
    declarationAt = declaration?.updatedAt.toISOString() ?? null;
    if (!regime)
      problems.push({
        code: 'TAX_REGIME_MISSING',
        message: `No tax regime chosen for ${fy} and no organization default is set`,
      });
    else {
      const taxRule = await activeRuleSet<IncomeTaxConfig>(tx, 'INCOME_TAX', end, { regime });
      taxRuleId = taxRule?.id ?? null;
      const months = fyMonthsBefore(ctx.year, ctx.month);
      const ytdRows = months.length
        ? await tx.payrollResult.findMany({
            where: {
              employeeId,
              run: { status: 'FINALIZED', OR: months.map(([y, m]) => ({ year: y, month: m })) },
            },
            select: {
              taxableGross: true,
              lines: { select: { code: true, source: true, amount: true } },
            },
          })
        : [];
      const lineSum = (code: string) =>
        ytdRows.reduce(
          (acc, r) =>
            r.lines.filter((l) => l.code === code).reduce((a, l) => a.plus(String(l.amount)), acc),
          new Decimal(0),
        );
      const byComponent: Record<string, string> = {};
      for (const r of ytdRows)
        for (const l of r.lines)
          if (l.source === 'STRUCTURE' || l.source === 'ARREARS') {
            const code = l.code.replace(/^ARR_/, '');
            byComponent[code] = toDecimal(byComponent[code] ?? 0)
              .plus(String(l.amount))
              .toString();
          }
      const fyStartYear = Number(fy.slice(0, 4));
      taxInput = {
        config: taxRule?.config ?? null,
        month: ctx.month,
        ageYears: ageOn(e.dateOfBirth, `${String(fyStartYear + 1)}-03-31`),
        declarations: (declaration?.deductions ?? {}) as Record<string, string>,
        rentPaidAnnual: declaration ? String(declaration.rentPaidAnnual) : '0',
        metro: profile?.metroCity ?? false,
        hraComponentCode: s.hraComponentCode,
        basicComponentCodes: s.basicComponentCodes,
        ytdTaxableGross: ytdRows.reduce((a, r) => a.plus(String(r.taxableGross)), new Decimal(0)),
        ytdTds: lineSum(STATUTORY_CODES.TDS),
        ytdEmployeePf: lineSum(STATUTORY_CODES.EPF_EMPLOYEE),
        ytdProfessionalTax: lineSum(STATUTORY_CODES.PROFESSIONAL_TAX),
        ytdByComponent: byComponent,
      };
    }
  }

  // ---------------------------------------------------------------- engine
  const structureLines = [...combined.values()];
  const result = segments.length
    ? computeMonthlyPay({
        month: ctx.month,
        structure: structureLines,
        recurringStructure: recurring,
        payableDays: 1,
        denominator: 1,
        adjustments: ctx.adjustments.filter((a) => a.amount),
        arrears,
        epf: profile?.pfApplicable
          ? {
              config: epfRule?.config ?? null,
              epsEligible,
              voluntaryFullWages: profile.voluntaryPfFullWages,
            }
          : null,
        esi: esiInput,
        pt: profile?.ptStateCode
          ? { config: ptRule?.config ?? null, gender: e.gender ? (GENDER[e.gender] ?? null) : null }
          : null,
        tax: taxInput,
      })
    : null;
  if (result) for (const p of result.problems) problems.push(p);
  const taxableGross = result
    ? result.lines
        .filter((l) => l.category === 'EARNING' && l.taxable)
        .reduce((a, l) => a.plus(l.amount), new Decimal(0))
    : new Decimal(0);

  return {
    employeeId,
    payable: payableTotal,
    denominator: new Decimal(Math.max(denominator, 0)),
    lop: lopTotal,
    result,
    taxableGross,
    esiCovered: esiCoveredNow,
    problems,
    arrears: arrears.map((a) => ({ code: a.code, forYear: a.forYear, forMonth: a.forMonth })),
    componentOrder: new Map([...componentFlags.values()].map((c) => [c.code, c.payslipOrder])),
    snapshot: {
      period: { year: ctx.year, month: ctx.month, start, end },
      employment: { dateOfJoining: doj, lastWorkingDate: lwd, employedFrom, employedTo },
      settings: s,
      denominator,
      segments: segmentSnapshot,
      salaryIds: segments.map((x) => x.salary.id),
      lastSalaryId: segments.at(-1)?.salary.id ?? null,
      profile,
      ruleSets: {
        epf: epfRule?.id ?? null,
        esi: esiRule?.id ?? null,
        pt: ptRule?.id ?? null,
        incomeTax: taxRuleId,
      },
      tax: { financialYear: fy, regime, declarationUpdatedAt: declarationAt },
      arrears: arrears.map((a) => ({
        code: a.code,
        amount: a.amount,
        forYear: a.forYear,
        forMonth: a.forMonth,
      })),
      adjustmentIds: ctx.adjustments.map((a) => a.id),
      calculatedAt: (ctx.now ?? new Date()).toISOString(),
    },
  };
}
