# ADR-014: India payroll

- Status: Accepted (2026-11-23, Phase 07)
- Builds on: [ADR-011](ADR-011-employee-management.md) (employees, job history, bank and
  statutory ids), [ADR-012](ADR-012-time-attendance-leave.md) (attendance days, leave)

## Context

Phase 07 adds India payroll: salary structures, earnings and deductions, EPF, ESI, Professional
Tax (PT) and TDS under the old and new regimes, payroll runs with approval, payslips, arrears,
bank payment files and full & final (F&F) settlement.

The master rules say statutory rates and thresholds are **never hard-coded**. They must be
effective-dated configuration from verified official sources, calculations must be reproducible
and decimal-safe, and results must be validated by qualified payroll professionals before
production use.

**Owner decision (2026-11-23):** statutory rules are **configured by the organization; none are
seeded.** This follows the Phase 05 approach for leave types.

## Decisions

### Statutory rules are effective-dated, sourced configuration

- Statutory rules are stored in `statutory_rule_sets`. Each rule set has:
  - a type: EPF, ESI, PT, INCOME_TAX or GRATUITY;
  - a scope: the whole organization, a state for PT, or a financial year and regime for income
    tax;
  - an effective period;
  - a status: DRAFT → ACTIVE → RETIRED;
  - a **required source reference**, for example the notification, circular or Finance Act
    section;
  - a `config` document whose shape `@hrm/validation` checks against the rule type.
- Only ACTIVE rule sets are used. Active rule sets of the same type and scope cannot overlap
  (exclusion constraint).
- A rule set's config cannot change once it is ACTIVE. To change a value, create a new version
  with a new effective date.
- **The code contains formulas, not numbers.** Examples are "employee EPF = rate × min(PF wages,
  ceiling)" and "rebate with marginal relief". Every rate, ceiling, slab, limit and rounding rule
  comes from the active rule set. When a run needs a rule that is not configured, it **fails
  with a clear problem for that employee** rather than guessing.

### Salary model

- **Salary components** are the organization's earnings, deductions and employer contributions,
  with flags for taxability, PF wages, ESI wages and PT wages, and for proration by payable days.
- **Salary structures** give each component a calculation: a fixed amount, a percentage of CTC,
  of gross or of another component, or the **balancing** amount, i.e. CTC minus everything else,
  such as a special allowance.
- **Employee salaries** are effective-dated, with annual CTC, a structure, and a reason (joining,
  revision, promotion). A revision dated in the past produces **arrears** in the next run.
- Each employee has a payroll profile:
  - whether PF and ESI apply;
  - the PT state (ISO 3166-2:IN);
  - the tax regime for each financial year;
  - investment declarations for the old regime.

### Pure calculation engine

`@hrm/business-rules/payroll` is pure and deterministic and uses Decimal only. It covers:

- the component breakdown from CTC;
- proration by payable days, where loss-of-pay days come from Phase 05 attendance and unpaid
  leave;
- EPF, ESI and PT;
- annual tax under each regime: slabs, standard deduction, rebate and marginal relief,
  surcharge and its marginal relief, and cess;
- monthly TDS spread over the remaining months, net of tax already deducted;
- the HRA exemption, arrears, leave encashment and gratuity.

Every result includes an explanation trace, so a figure can be explained and reproduced.

### Runs are transactional, approved and immutable once finalized

- A run covers one company and one month. Its status moves DRAFT → CALCULATED → APPROVED →
  FINALIZED, or it is CANCELLED. Approval is by someone other than the person who calculated
  it.
- Calculation is idempotent and can be repeated until approval.
- Each employee's result stores a **snapshot of its inputs**: salary, rule-set ids and versions,
  attendance and leave days, adjustments. With the result lines, it can be reproduced exactly.
- Finalized runs, results and lines are **append-only**, enforced by triggers and revoked
  privileges. A correction is made in a later run as an adjustment or arrears.
- Payslips come from finalized results; employees see them under **My payslips**.
- Bank files are a generic CSV of net pay per employee (account number decrypted only for the
  export, and the export is audited). Bank-specific formats are external contracts and are
  Phase 14 integrations.

### Full & final settlement

- F&F settles the last month's salary.
- **Leave encashment** uses the leave balance with a configured basis and divisor.
- **Notice pay** is a payout or a recovery.
- **Gratuity** uses the GRATUITY rule set: formula factors, eligibility years and cap, all
  configured.
- Settlement also covers pending adjustments.
- It needs approval and becomes immutable once finalized.

### As built

- **Schema:** `20261123000000_india_payroll` adds 13 tenant tables with RLS. Database rules:
  - an exclusion constraint against overlapping ACTIVE rule sets;
  - triggers that freeze ACTIVE rule configs, make structure lines immutable and lock run
    children once a run is approved or finalized;
  - finalized and cancelled runs and settlements never change;
  - the approver must differ from the calculator (CHECK).
- **Engine (`@hrm/business-rules`):**
  - `payroll-salary.ts`: breakdown from CTC, payable days, proration, loss of pay;
  - `payroll-statutory.ts`: EPF, ESI coverage periods, PT slabs;
  - `income-tax.ts`: slabs, rebate with marginal relief, surcharge with marginal relief, cess,
    section caps, HRA exemption, projection, TDS;
  - `settlement.ts`: service years, gratuity, encashment, notice pay, arrears;
  - `payroll-run.ts`: assembles one month and reports problems.
- **API (`modules/payroll`):** `payroll-calc.ts` assembles one employee's inputs from:
  - Phase 05 attendance (loss of pay = unpaid leave, plus absences when the setting is on);
  - salary segments for a mid-month revision;
  - arrears for finalized months whose salary changed;
  - year-to-date figures from finalized runs (TDS);
  - ESI coverage decided from the salary at the start of the contribution period.
- **Run membership:** employees employed in the month whose job record on their last day in it is
  with the run's company. Employees with a non-cancelled settlement whose last day falls in the
  period are paid by the settlement, not the run.
- **Finalize order:** months are finalized in order per company, so year-to-date figures and
  arrears stay consistent.
- **Organization decisions, not rules:** the default tax regime is a setting that may be empty.
  Gratuity and leave-encashment taxability are chosen when preparing a settlement, because
  exemption limits are statutory values not computed here.
- **Phase 05 change:** attendance day items now carry `unpaidLeaveDays` and `halfWorkingDay`,
  so payroll can count loss of pay exactly.

## Assumptions (the owner may override)

1. No statutory values are seeded. Payroll cannot run until the needed rule sets are configured
   and activated.
2. Payroll runs monthly, per company. There are no off-cycle runs except F&F.
3. Bank payment files are generic CSV; bank-specific formats come later.
4. Statutory returns and challans (ECR, ESI returns, Form 24Q/16) are not generated in this phase.
5. LWF (Labour Welfare Fund) is not included unless the owner asks for it.
6. Age for age-specific tax bands is taken on the last day of the financial year (31 March).
7. An employee who moves company mid-month is paid by the company on their last day in the month.
8. Arrears are computed against the salary in force at the end of each past month, using that
   month's stored payable days. A revision that also starts mid-way through a past month is
   approximated this way.
9. Payslips are printable pages (browser print or PDF); generated PDF documents are Phase 10.
