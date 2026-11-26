# Development roadmap

Each phase ends with the quality gate in `MASTER_PROJECT_INSTRUCTIONS.md` §13 and requires owner
approval before the next phase starts.

> **Renumbered 2026-11-24:** Clients & projects was added as Phase 10. Notes and ADRs written before
> that date that mention Phases 10–14 mean the phases now numbered 11–15 (the carry-forward lists
> below are already renumbered).

| Phase | Scope                                                                                                                                                                                                                                                     | Status                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 01    | Foundation & architecture: monorepo, web/mobile/API setup, shared packages, PostgreSQL, Prisma, Redis, BullMQ, Docker, logging, health, Swagger, testing foundation, design system, docs                                                                  | ✅ Done — approved 2026-11-16, CI green                     |
| 02    | Auth, RBAC & SaaS: registration, login/logout, refresh rotation, password recovery, MFA foundation, users, organizations, memberships, roles, permissions, tenant context from auth, full RLS + ABAC enforcement, subscription foundation, security audit | ✅ Done — approved, CI green                                |
| 03    | Organization management: companies, legal entities, branches, departments, teams, designations, job grades, locations, org chart, settings, working days, holiday calendars                                                                               | ✅ Done — approved 2026-11-18, CI green                     |
| 04    | Employee management: directory, profile, personal/employment info, documents, skills, education, experience, history, transfer, promotion, probation, confirmation, lifecycle                                                                             | ✅ Done — approved 2026-11-19, CI green                     |
| 05    | Attendance, shifts & leave: clock-in/out, biometric, QR, shifts, rostering, overtime, leave policies/applications/balances, approvals, attendance analytics                                                                                               | 🟡 Implemented & verified locally — awaiting owner approval |
| 06    | Recruitment & onboarding: requisitions, openings, career portal, candidates, resume parsing, interviews, assessments, offers, onboarding, joining docs, induction                                                                                         | ✅ pushed `70f9e5c`                                         |
| 07    | India payroll: structures, earnings, deductions, EPF, ESI, PT, TDS, regimes, runs, payslips, arrears, approvals, bank files, F&F                                                                                                                          | ✅ pushed `d454f0e`                                         |
| 08    | Expenses, assets & travel: claims, reimbursements, OCR, asset allocation/return, travel requests/approvals/settlements                                                                                                                                    | 🟡 verified locally                                         |
| 09    | Performance & learning: cycles, OKRs, goals, KPIs, feedback, 360, training, learning paths, certifications, engagement                                                                                                                                    | ✅ pushed (`f169c98`)                                       |
| 10    | Clients & projects: clients, projects, features/epics, stories, tasks, bugs, assignments, sprints & boards, timesheets, client billing, client portal (owner request 2026-11-24)                                                                          | ✅ pushed (`ef2ef1e`)                                       |
| 11a   | Workflows & documents: workflow engine, approval designer, escalation, delegation, document templates, generated PDFs, policy library, e-acceptance                                                                                                       | ✅ pushed (`ebe5bd4`)                                       |
| 11b   | Helpdesk, separation & compliance: ticketing, SLA, knowledge base, resignation & exit, compliance registers                                                                                                                                               | 🟡 verified locally, awaiting approval                      |
| 12    | Advanced AI platform: HR assistant, recruitment AI, document intelligence, OCR, embeddings, RAG, agents, workforce insights, automation, cost monitoring, AI security, evaluation                                                                         | ⏳                                                          |
| 13    | Analytics & reporting: dashboards, employee/payroll/attendance/recruitment/attrition/performance analytics, report builder, export, scheduled reports, AI summaries                                                                                       | ⏳                                                          |
| 14    | Complete React Native app: employee & manager apps, attendance, leave, payslips, expenses, documents, notifications, approvals, push, offline data, mobile security                                                                                       | ⏳                                                          |
| 15    | Integrations & production: email, SMS, WhatsApp, banking, biometric, calendar, accounting, e-signature, webhooks, production Docker, CI/CD, monitoring, logging, security audit, performance testing, backup & recovery, deployment                       | ⏳                                                          |

## Carried forward from Phase 01

- DataTable: filtering UI, global search wiring, column reordering, saved views, inline editing,
  export, context menus, virtualization — implemented with the first list-heavy module.
- Header: organization switcher, company selector, global search, notification center, profile
  menu — need authentication/memberships (Phase 02+).
- Forms system (React Hook Form + Zod, 1/2/3-column layouts) — delivered in Phase 02.

## Carried forward from Phase 03

- Reference pickers load one page of up to 200 records; add search-as-you-type pickers when
  organizations exceed that (still open after Phase 04 — manager picker included).
- Org chart shows structure only; reporting lines are available per employee (direct reports,
  manager) since Phase 04 — a people org chart view is still open.
- Mobile: no organization screens yet (holiday list for employees planned with Phase 05/13).
- Effective-dated structure history (e.g. department re-parenting over time) is not modelled;
  employee assignment history in Phase 04 records who belonged where and when.
- Dedicated worker process, Redis-backed rate limiting store, Nginx, monitoring — Phase 15.

## Carried forward from Phase 04

- Salary structures and salary-revision history — Phase 07 (payroll).
- Approval workflow for employee self-service changes — Phase 11 (workflow engine); Phase 04
  applies self-edits directly for contact and background data only.
- Document malware scanning and retention policies — Phase 11 / 15.
- Statutory registrations beyond PAN/UAN (ESIC, PT, LWF) — Phase 07; Aadhaar deliberately not
  collected (ADR-011).
- Bulk employee import (CSV) and directory export — with the DataTable export work.
- Mobile: read-only "My profile" only; editing and documents on mobile — Phase 14.

## Carried forward from Phase 05

- Overtime approval and compensatory off; leave encashment and final settlement — Phase 07.
- Multi-level approval chains, delegation, escalation — Phase 11 (workflow engine).
- Biometric device push integrations, branch geofencing — Phase 15; mobile location capture
  and QR scanning in the app — Phase 14.
- Roster planning UI (the API supports day overrides), attendance analytics dashboards — Phase 13.
- Leave types: UI for employment-type applicability (API supports it).

## Carried forward from Phase 06

- AI resume parsing, skill extraction, candidate summaries and JD assistance (Phase 12; never
  auto-reject).
- Offer letters as generated documents, e-signature and candidate e-mails (Phase 11).
- Department-scoped recruitment permissions (Phase 03 scope model).
- Candidate data retention/erasure automation (DPDP) built on recorded consent.
- Recruitment analytics (Phase 13); mobile recruitment/onboarding screens (Phase 14).

## Carried forward from Phase 07

- Statutory returns and challans (EPF ECR, ESI returns, Form 24Q, Form 16) and LWF.
- Bank-specific payment file formats and payment status reconciliation (Phase 15 integrations).
- Generated PDF payslips and settlement letters (Phase 11 documents).
- Investment proof verification workflow and declaration lock dates (Phase 11 workflows).
- Off-cycle runs (bonus, correction) and payroll variance analytics (Phase 13).
- Batched/background calculation for very large runs (BullMQ), and mobile payslips (Phase 14).

## Carried forward from Phase 11b

- Business-hours SLA calendars and pausing while waiting on the requester; e-mail-to-ticket and
  notifications (Phase 15).
- Per-grade or per-contract notice periods; buy-out of notice through payroll; rehire
  eligibility.
- Expiry dates on employee documents and review dates on library documents.
- Statutory registers and returns from sourced templates; compliance reports (Phase 13).
- AI ticket classification and suggested replies (Phase 12, with guardrails).

## Carried forward from Phase 11a

- Workflows for recruitment requisitions, profile changes and attendance regularization;
  parallel ("all must approve") role steps; conditions on fields other than the measure.
- Notifications for new, due and escalated steps (Phase 15 notifications).
- Provider e-signatures (Aadhaar eSign, DocuSign) and document retention/malware scanning (Phase 15).
- Indic-script PDFs (bundled fonts) and rich-text templates; bulk letter generation.
- Settlement letters and Form 16 PDFs (with Phase 11b separation and statutory reports).

## Carried forward from Phase 10

- PDF invoices and statements (Phase 11 documents); e-mailing invoices to clients (Phase 15).
- E-invoicing (IRN), GST/TDS treatment, accounting exports and payment gateways (Phase 15 integrations).
- Configurable timesheet approval chains and project-manager approval (Phase 11 workflow engine).
- Gantt/timeline views, dependencies, burndown charts and project profitability (Phase 13 analytics).
- Drag-and-drop board ordering and workflow transition rules between columns.
- Mobile timesheets and board (Phase 14); notifications on assignment and client replies (Phase 15).

## Carried forward from Phase 09

- 9-box talent grid, succession plans and career paths (Phase 13 analytics with the review data).
- Continuous 1:1 notes, review reminders and nudges (Phase 11 workflows, Phase 15 notifications).
- SCORM/xAPI packages, video hosting and external course catalogues (Phase 15 integrations).
- AI review summaries, goal suggestions and survey comment themes (Phase 12, with guardrails).
- Linking review outcomes to salary revisions — today promotion is a recorded recommendation only.
- Mobile goals, recognition and survey answering (Phase 14).

## Carried forward from Phase 08

- OCR and data extraction from receipts and bills (Phase 12 document intelligence).
- Configurable multi-level approval chains and delegation (Phase 11 workflow engine).
- Exchange-rate feeds, corporate cards, booking engines and accounting exports (Phase 15).
- Expense, travel and asset analytics (Phase 13); mobile claim capture with camera (Phase 14).
- Asset audits / physical verification cycles and QR asset labels.
