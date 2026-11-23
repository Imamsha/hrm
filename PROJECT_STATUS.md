# Project status

_Last updated: 2026-11-23_

## Current phase

**Phase 07 — India payroll: implemented and verified locally. Awaiting owner approval.**
Phase 08 has **not** been started. Phase 07 changes are **not committed yet**.

- Phases 01–05: approved and pushed. Phase 06: verified and pushed (`70f9e5c`); its CI result was
  not checked from this machine (no `gh` CLI).
- Owner decision (2026-11-23): statutory rules are configured by the organization, with a source
  reference; **none are seeded** ([ADR-014](docs/architecture/ADR-014-india-payroll.md)).

**Current task:** none. Waiting for the owner to review Phase 07 and to say whether to commit and
push.

## Phase 07 verification (2026-11-23)

| Check                                                    | Result                                                                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run typecheck lint test build` (11 packages) | ✅ 37/37 tasks (`--force --concurrency=2`)                                                                                                                                                 |
| `pnpm format:check`                                      | ✅ clean                                                                                                                                                                                   |
| Unit/component tests                                     | ✅ API 81 · shared-types 3 · validation 68 · api-client 12 · design-tokens 38 · business-rules 73 · ui-web 12 · web 49 · mobile 8 (jest)                                                   |
| Integration tests (real Postgres/Redis/S3/Mailpit)       | ✅ 107 passed (97 earlier phases + 10 Phase 07)                                                                                                                                            |
| Migrations                                               | ✅ 9 applied to dev and test; drift check reports no difference                                                                                                                            |
| Playwright E2E (production build + live API)             | ✅ 11 passed, 9 skipped by design. New: components → structure → sourced EPF rule → salary and profile → run calculated → approved by an invited finance user → finalized with a bank file |
| GitHub Actions                                           | ⏳ runs when Phase 07 is pushed                                                                                                                                                            |

## Phase 07 delivered

- **Statutory rules as sourced configuration:**
  - EPF, ESI, Professional Tax (per state), income tax (per regime and year) and gratuity rule
    sets, each with an official source, effective dates and DRAFT → ACTIVE → RETIRED status;
  - active rule sets are frozen (new versions instead) and may not overlap (database exclusion
    constraint);
  - type-specific forms in **Payroll → Statutory rules** with empty fields.
- **Salary model:**
  - components with tax / PF / ESI / PT-wage / proration flags;
  - immutable structures: fixed amount, % of CTC, % of another component, or the balance, with
    employer EPF/ESI optionally inside CTC;
  - effective-dated salaries with breakdowns;
  - per-employee payroll profiles: PF, voluntary full-wage PF, pension membership, ESI, PT state,
    metro, TDS.
- **Calculation engine** (`@hrm/business-rules`, Decimal only):
  - proration by calendar, fixed or working days;
  - loss of pay from attendance (unpaid leave, optionally absences);
  - mid-month revisions split into salary segments;
  - EPF with ceilings, ESI with contribution-period coverage, PT slabs by gender and month;
  - income tax: slabs, age bands, rebate with marginal relief, surcharge with marginal relief,
    cess, section caps, HRA exemption, PF and PT deductions;
  - year-to-date projection and monthly TDS;
  - arrears for back-dated revisions, by month;
  - an explanation trace for tax.
- **Runs:**
  - per company and month;
  - calculation stores each employee's input snapshot and any problems; missing rules or
    salaries block approval;
  - one-time adjustments;
  - approval by someone other than the calculator;
  - finalize in month order, after which the data is immutable at the database level;
  - an audited generic bank CSV.
- **Payslips:** **My payslips** with a printable payslip (tax projection and trace); HR can view
  any finalized payslip.
- **Self-service:** **My salary & tax** shows the salary breakdown, the regime choice and the
  declarations per financial year.
- **Full & final settlement:**
  - final month's salary, unless a finalized run already paid it;
  - leave encashment on chosen components;
  - notice pay or recovery;
  - gratuity from the gratuity rule (eligibility, part-year rounding, cap);
  - extra adjustments;
  - approved by a second person, then finalized;
  - such employees are excluded from later runs.

## Assumptions (recorded in ADR-014; the owner may override)

1. No statutory values are seeded; payroll needs the applicable rule sets configured and
   activated.
2. Monthly runs per company; no off-cycle runs except F&F.
3. Generic bank CSV; bank-specific formats are later integrations.
4. No statutory returns or challans (ECR, ESI returns, 24Q, Form 16) and no LWF in this phase.
5. The default tax regime is an organization setting (may be empty → a problem on the result).
6. Age bands use age on 31 March of the financial year.
7. Gratuity and leave-encashment taxability are chosen when preparing a settlement; exemption
   limits are not computed.
8. A mid-month company transfer is paid by the company of the last day in the month.
9. Payslips are printable pages; generated PDFs come with Phase 10 documents.

## Issues found and fixed during Phase 07

1. The rule-set exclusion constraint used `regime::text`, which is not immutable, so the migration
   failed on apply and was rolled back cleanly. It now uses `COALESCE(regime, 'OLD')`; this is
   safe because the regime is null only for non-tax types.
2. The default-tax-regime setting was added to the uncommitted migration. The dev database was
   altered to match and its checksum updated, so there is still one migration for the phase and
   no drift.
3. Arrears were first merged per component across months; now each (component, month)
   difference is its own line with `for_year`/`for_month`.
4. The bank file and payslip initially used the company's first legal entity. The payslip now
   uses the legal entity of the employee's job record at the end of the period.
5. Stopping a background `pnpm start` / `pnpm preview` left the node process on :3100 / :4173, so
   E2E first ran against the old build. The processes were stopped by port, and the fix is noted
   in `docs/TESTING_GUIDE.md`.

## Known issues and risks

1. **Payroll calculations must be validated by a qualified payroll professional before production
   use** (master rules). The engine is tested with fictional values only.
2. Runs are calculated synchronously in one transaction (5-minute limit). Very large
   organizations will need batched background calculation (BullMQ).
3. Arrears for a past month whose revision also started mid-month are approximated (salary at
   month end × stored payable days).
4. Local Node is 22.13.1 (22.22+ or 24 LTS recommended); MinIO was replaced by RustFS.
5. Self-registered owners have no e-mail verification; there are no passkeys.
6. Reference pickers load at most 200 options.
7. Uploaded documents are not malware-scanned yet (Phase 10/14).
8. Mobile has no payroll, recruitment or onboarding screens yet (Phase 13).
9. **Local machine:** with little free memory, the gate needs `--concurrency=2` and E2E needs
   `--workers=1` with a pre-started preview. See `docs/TESTING_GUIDE.md`.

## Database migration status

| Migration                                         | dev | test |
| ------------------------------------------------- | --- | ---- |
| 20261116000000_platform_foundation                | ✅  | ✅   |
| 20261116000100_organizations_and_audit            | ✅  | ✅   |
| 20261116010000_identity_access_subscriptions      | ✅  | ✅   |
| 20261116020000_user_scope_policies_without_tenant | ✅  | ✅   |
| 20261117000000_organization_structure             | ✅  | ✅   |
| 20261118000000_employee_management                | ✅  | ✅   |
| 20261119000000_time_attendance_leave              | ✅  | ✅   |
| 20261120000000_recruitment_onboarding             | ✅  | ✅   |
| 20261123000000_india_payroll                      | ✅  | ✅   |

## Next recommended task

1. Owner reviews Phase 07 (run `pnpm dev`):
   - **Payroll → Salary setup**: add components and a structure;
   - **Statutory rules**: enter and activate the rule sets that apply, from their official
     sources;
   - **Employee payroll**: set a salary and profile;
   - **Payroll runs**: create, calculate, approve with a second user, finalize;
   - check **My payslips** and **Full & final**.
2. Confirm or override the assumptions above.
3. On approval: commit and push Phase 07, then confirm CI is green.
4. Then Phase 08: expenses, assets and travel.
