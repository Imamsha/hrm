# Development roadmap

Each phase ends with the quality gate in `MASTER_PROJECT_INSTRUCTIONS.md` §13 and requires owner
approval before the next phase starts.

| Phase | Scope                                                                                                                                                                                                                                                     | Status                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 01    | Foundation & architecture: monorepo, web/mobile/API setup, shared packages, PostgreSQL, Prisma, Redis, BullMQ, Docker, logging, health, Swagger, testing foundation, design system, docs                                                                  | ✅ Done — approved 2026-11-16, CI green                     |
| 02    | Auth, RBAC & SaaS: registration, login/logout, refresh rotation, password recovery, MFA foundation, users, organizations, memberships, roles, permissions, tenant context from auth, full RLS + ABAC enforcement, subscription foundation, security audit | ✅ Done — approved, CI green                                |
| 03    | Organization management: companies, legal entities, branches, departments, teams, designations, job grades, locations, org chart, settings, working days, holiday calendars                                                                               | 🟡 Implemented & verified locally — awaiting owner approval |
| 04    | Employee management: directory, profile, personal/employment info, documents, skills, education, experience, history, transfer, promotion, probation, confirmation, lifecycle                                                                             | ⏳                                                          |
| 05    | Attendance, shifts & leave: clock-in/out, biometric, QR, shifts, rostering, overtime, leave policies/applications/balances, approvals, attendance analytics                                                                                               | ⏳                                                          |
| 06    | Recruitment & onboarding: requisitions, openings, career portal, candidates, resume parsing, interviews, assessments, offers, onboarding, joining docs, induction                                                                                         | ⏳                                                          |
| 07    | India payroll: structures, earnings, deductions, EPF, ESI, PT, TDS, regimes, runs, payslips, arrears, approvals, bank files, F&F                                                                                                                          | ⏳                                                          |
| 08    | Expenses, assets & travel: claims, reimbursements, OCR, asset allocation/return, travel requests/approvals/settlements                                                                                                                                    | ⏳                                                          |
| 09    | Performance & learning: cycles, OKRs, goals, KPIs, feedback, 360, training, learning paths, certifications, engagement                                                                                                                                    | ⏳                                                          |
| 10    | Documents, helpdesk & workflows: document management, templates, e-signature integration, ticketing, SLA, knowledge base, workflow engine, approval designer, escalation, delegation                                                                      | ⏳                                                          |
| 11    | Advanced AI platform: HR assistant, recruitment AI, document intelligence, OCR, embeddings, RAG, agents, workforce insights, automation, cost monitoring, AI security, evaluation                                                                         | ⏳                                                          |
| 12    | Analytics & reporting: dashboards, employee/payroll/attendance/recruitment/attrition/performance analytics, report builder, export, scheduled reports, AI summaries                                                                                       | ⏳                                                          |
| 13    | Complete React Native app: employee & manager apps, attendance, leave, payslips, expenses, documents, notifications, approvals, push, offline data, mobile security                                                                                       | ⏳                                                          |
| 14    | Integrations & production: email, SMS, WhatsApp, banking, biometric, calendar, accounting, e-signature, webhooks, production Docker, CI/CD, monitoring, logging, security audit, performance testing, backup & recovery, deployment                       | ⏳                                                          |

## Carried forward from Phase 01

- DataTable: filtering UI, global search wiring, column reordering, saved views, inline editing,
  export, context menus, virtualization — implemented with the first list-heavy module.
- Header: organization switcher, company selector, global search, notification center, profile
  menu — need authentication/memberships (Phase 02+).
- Forms system (React Hook Form + Zod, 1/2/3-column layouts) — delivered in Phase 02.

## Carried forward from Phase 03

- Reference pickers load one page of up to 200 records; add search-as-you-type pickers when
  organizations exceed that (Phase 04, with employee pickers).
- Org chart shows structure only; people, managers and headcount arrive with employee records
  (Phase 04).
- Mobile: no organization screens yet (holiday list for employees planned with Phase 05/13).
- Effective-dated structure history (e.g. department re-parenting over time) is not modelled;
  employee assignment history in Phase 04 records who belonged where and when.
- Dedicated worker process, Redis-backed rate limiting store, Nginx, monitoring — Phase 14.
