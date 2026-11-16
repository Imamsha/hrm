# Master Project Instructions — Enterprise HRM SaaS Platform

> Canonical product brief supplied by the project owner (2026-11-16). This file condenses the
> original master prompt without dropping requirements. When in doubt, the owner's latest
> instruction in conversation wins; record any change here.

## 1. Role and objective

Act as principal architect, full-stack engineer, database architect, UI/UX designer, AI engineer,
DevOps, security and QA engineer. Build a **commercial, enterprise-grade, AI-powered, multi-tenant
HRM SaaS** — not a CRUD demo — for small, medium and large organizations, with:

React web app · React Native (Expo) mobile app · NestJS backend · PostgreSQL + Prisma · Redis +
BullMQ · advanced AI platform · multi-tenant SaaS · India-focused payroll engine · enterprise UI/UX ·
reporting & analytics · workflow automation · enterprise security · production infrastructure.
Web, mobile, backend, database and AI operate as one platform.

## 2. Technology stack

- **Web:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix UI, TanStack Query, TanStack
  Table, Zustand, React Hook Form, Zod, React Router, Recharts or ECharts, Lucide, Framer Motion.
- **Mobile:** React Native, Expo, TypeScript, Expo Router, NativeWind _or_ reusable native
  components, TanStack Query, Zustand, React Hook Form, Zod, secure token storage, push
  notifications, camera/QR, offline-friendly cache. Do not reuse web-only shadcn components on
  mobile; share design tokens, build platform-specific components.
- **Backend:** Node.js, NestJS, TypeScript, REST, Swagger/OpenAPI, Prisma, PostgreSQL, Redis, BullMQ,
  WebSockets, JWT, RBAC + ABAC, domain events.
- **AI:** configurable LLM providers (OpenAI-compatible), embeddings, pgvector, RAG, controlled-tool
  agents, OCR, document intelligence, NL analytics, workflow assistance, usage & cost tracking.
- **Infrastructure:** pnpm, Turborepo, Docker, Docker Compose, Nginx, S3-compatible storage, GitHub
  Actions CI/CD, monitoring, centralized logging, automated testing.
- Use stable, mutually compatible versions; check compatibility before installing/upgrading.

## 3. Monorepo layout

`apps/{web,mobile,api}`, `packages/{shared-types,api-client,validation,design-tokens,business-rules,
ui-web,eslint-config,typescript-config}`, `infrastructure/{docker,nginx,postgres,redis,monitoring,
ci-cd}`, `docs/{architecture,database,api,security,modules,deployment}`, `scripts/`, root
`docker-compose.yml`, `pnpm-workspace.yaml`, `turbo.json`, `package.json`, `tsconfig.base.json`,
`README.md`.

Backend modules (`apps/api/src/modules/`): auth, users, sessions, organizations, memberships,
subscriptions, companies, branches, departments, designations, employees, recruitment, onboarding,
attendance, shifts, leave, payroll, expenses, assets, travel, performance, learning, engagement,
documents, helpdesk, workflows, notifications, analytics, reports, ai, integrations, audit.
Each: module, controller, service, repository where appropriate, DTOs, validation, authorization
policies, domain events, tests. **No business logic in controllers. No circular dependencies.**

## 4. Multi-tenancy

Hierarchy: Platform → Organization → Company → Legal entity / Branch → Department → Team → Employee.
Support many organizations, companies, branches, departments, teams, users, multiple org
memberships per user, subscription plans, currencies, languages, time zones, org- and company-level
configuration and custom HR policies.

Shared database + shared schema. Every tenant-owned table has `organization_id`. Use tenant-aware
repositories, tenant context middleware, membership validation, **PostgreSQL RLS**,
transaction-local tenant context, tenant-aware jobs, storage, AI retrieval and audit logs, and
composite foreign keys against cross-tenant relationships. **Never trust a frontend-supplied
organization_id. Never permit cross-tenant access.** Platform admins, org admins, HR admins,
managers, employees and finance users have separate access scopes.

## 5. Business modules (each with tables, APIs, validation, permissions, logic, workflows, UI,

mobile where appropriate, tests)

1. **Organization:** registration, profile, companies, legal entities, business units, branches,
   locations, departments, sub-departments, teams, designations, job grades/levels, cost centers,
   reporting hierarchy, org chart, holiday calendars, working days, shift policies, branding, settings.
2. **Users & access:** registration, invitations, directory, profiles, memberships, roles,
   permissions, custom roles, RBAC, ABAC, delegated access, sessions, MFA, login history, security
   audit, password policies.
3. **Employees:** directory, profile, ID generation, personal/contact/emergency/family/address,
   education, certifications, skills, experience, bank, tax, employment info, contracts, job &
   department history, reporting manager, documents, probation, confirmation, promotion, transfer,
   salary revision history, status, rejoining, resignation, termination, self-service.
4. **Recruitment/ATS:** requisitions, openings, JDs, career portal, candidate registration, resume
   upload/parsing, profiles, database, screening, interview scheduling/panels/feedback, assessments,
   offers & letters, communications, pipeline, analytics, AI skill extraction, candidate summaries,
   JD assistance. **AI never auto-rejects or makes employment decisions.**
5. **Onboarding:** pre-joining, joining forms, document collection/verification, offer acceptance,
   agreements, asset allocation, account creation, department assignment, induction, training,
   manager approvals, checklists, probation tracking.
6. **Attendance:** daily, clock-in/out, mobile/web/QR, biometric integration, geofencing with privacy
   controls, shift attendance, flexible schedules, WFH, overtime, late/early, missing punches,
   correction, regularization, approval, monthly reports, calendar.
7. **Leave:** annual, casual, sick, maternity, paternity, unpaid, comp-off, optional holidays, policy
   configuration, accrual, carry-forward, encashment, balances, applications, multi-level approvals,
   team calendar, holiday calendar, conflict detection, analytics.
8. **Shifts & workforce:** shifts, templates, assignment, rotation, night/flexible shifts, swaps,
   rostering, allocation, overtime policies, capacity planning, analytics.
9. **India payroll:** salary structures, basic, HRA, allowances, earnings, deductions, bonuses,
   incentives, overtime, reimbursements, revisions, payroll calendars, runs, approvals, payslips,
   EPF, ESI, professional tax, TDS, old/new tax regimes, deductions & exemptions, arrears,
   adjustments, bank payment files, reconciliation, full & final settlement, audit history.
   Configurable country rules for global expansion. **Never hard-code statutory rates/thresholds;
   use effective-dated rules, verified official sources, reproducible calculation snapshots,
   decimal-safe math. Validate with qualified payroll professionals before production.**
10. **Expenses:** categories, policies, travel/food/transport/medical, bill upload, OCR, submission,
    approval, finance verification, reimbursement, reports.
11. **Assets:** registration, categories, inventory, laptop/mobile/equipment allocation, software
    licenses, handover, return, maintenance, audits, history.
12. **Travel:** requests, trips, approvals, bookings, accommodation, allowances, expenses,
    settlements, analytics.
13. **Performance:** cycles, goals, OKRs, KPIs, self/manager/peer/360 feedback, competencies, ratings,
    review workflows, PIPs, promotion recommendations, history.
14. **Learning:** courses, categories, learning paths, assignments, enrollment, assessments, quizzes,
    certifications, skill matrix, completion, feedback, analytics.
15. **Engagement:** surveys, pulse surveys, recognition, rewards, announcements, news, events,
    suggestions, satisfaction analytics.
16. **Documents:** employee/company documents, contracts, offer/appointment/experience/relieving
    letters, certificates, templates, versioning, expiry reminders, digital signatures, secure
    storage, permissions, OCR & extraction.
17. **Helpdesk:** HR/payroll/IT/general tickets, assignment, priorities, SLA, escalation, internal
    comments, attachments, history, knowledge base.
18. **Separation:** resignation, approval, notice period, exit interviews, knowledge transfer, asset
    return, account revocation, clearance, F&F, experience/relieving letters, exit analytics.
19. **Compliance:** policies, acknowledgments, versioning, compliance calendar & tasks, audit history,
    document/contract expiry, regulatory reporting, dashboards.
20. **Workflow engine:** creation, templates, configurable steps, conditional routing, multi-level and
    parallel approvals, delegation, escalation, deadlines, rejection reasons, history,
    notifications, event-driven execution (leave, expense, payroll, onboarding, salary revision,
    resignation, …).
21. **Reports & analytics:** headcount, department, attendance, leave, payroll, recruitment,
    attrition, performance, learning, employee cost, workforce planning, custom report builder,
    Excel/CSV/PDF export, scheduled reports, interactive dashboards, drill-down.
22. **Notifications & integrations:** in-app, email, push, SMS, WhatsApp (approved providers);
    biometric devices, banking, accounting, Microsoft 365, Google Workspace, calendars,
    e-signature, job portals, learning platforms, webhooks.
23. **AI platform:** employee/manager/HR/finance assistants, policy Q&A, authorized information
    retrieval, NL queries, task assistance; recruitment AI (parsing, JD generation, skill extraction,
    summaries, interview questions, matching); document intelligence (OCR, extraction,
    classification, contract summaries, missing-document & expiry detection); workforce analytics
    (headcount, attendance anomalies, leave patterns, forecasting, payroll variance explanations,
    attrition, capacity); automation (workflow suggestions, ticket classification, reminders,
    document processing, report summaries, NL workflow creation).
    Technical: provider abstraction, prompt versioning, embeddings, pgvector, RAG, tenant- and
    permission-aware retrieval, token & cost tracking, rate limiting, AI audit logs, PII filtering,
    prompt-injection protection, human approval for sensitive actions. **Never give an LLM
    unrestricted SQL. Never let AI bypass authorization. Never use AI as the sole decision-maker for
    hiring, firing, promotion, compensation or discipline.**

## 6. UI/UX

Premium, compact, information-dense (references: Linear, Notion, Vercel, Microsoft 365). Global
layout: collapsible sidebar, fixed header, organization switcher, company selector, global search,
breadcrumbs, notification center, profile menu, theme switcher. Design system: light/dark/system,
compact & comfortable density, consistent typography/spacing, accessible contrast, reusable
components, responsive. **Enterprise data table:** server-side pagination, sorting, filtering,
global search, column resizing/reordering/visibility, sticky headers, row selection, bulk actions,
inline editing, export, saved views, context menus, keyboard navigation, skeletons, empty and
error states. **Forms:** responsive 1/2/3 columns, required indicators, validate on submit, inline
errors, proper select placeholders, no unexpected default selections or automatic dates,
consistent create/edit/view. All modules follow the same design system.

## 7. Database

Domains: platform (plans, subscriptions, invoices); identity (users, sessions, memberships, roles,
permissions, user_roles, role_permissions); organization (organizations, companies, legal_entities,
branches, locations, departments, teams, designations, job_grades); employees (employees,
employment_records, contacts, documents, skills, history); workforce (attendance_records, shifts,
shift_assignments, leave_types, leave_policies, leave_balances, leave_requests); recruitment (jobs,
candidates, applications, interviews, offers); payroll (salary_structures, salary_components,
employee_salary_assignments, payroll_runs, payroll_run_employees, payslips, tax_regimes, tax_slabs,
tax_declarations, epf_configurations, esi_configurations, professional_tax_rules,
tds_calculations, statutory_contributions); other (expenses, assets, travel_requests,
performance_cycles, goals, performance_reviews, training_courses, documents, helpdesk_tickets,
workflows, workflow_instances, approval_tasks, notifications, audit_logs, ai_conversations,
knowledge_documents, ai_usage_logs).

Rules: UUID PKs, FKs, tenant-aware composite relationships, unique/check constraints, proper
indexes, created/updated timestamps, soft delete where appropriate, effective dating, immutable
finalized financial snapshots, transactional & idempotent payroll/financial operations, secure
sensitive data, `timestamptz`, `numeric` for money, no unnecessary duplication of employee data,
migrations for every schema change.

## 8. API

REST, versioned at `/api/v1` (`/auth`, `/users`, `/organizations`, `/companies`, `/branches`,
`/departments`, `/designations`, `/employees`, `/attendance`, `/leaves`, `/shifts`, `/recruitment`,
`/onboarding`, `/payroll`, `/expenses`, `/assets`, `/travel`, `/performance`, `/learning`,
`/documents`, `/helpdesk`, `/workflows`, `/notifications`, `/analytics`, `/reports`, `/ai`). DTO
validation, consistent responses, central exception handling, pagination/sorting/filtering,
authorization, Swagger, request IDs, structured logging. No business logic in controllers.

## 9. Security & compliance

Secure auth, password hashing, refresh-token rotation, MFA, RBAC, ABAC, tenant isolation, API
authorization, input validation, rate limiting, secure file storage, encryption, audit trails,
session management, backup & recovery, data retention, privacy controls; apply relevant Indian
and international privacy/employment regulations per deployment.

## 10. Testing

Jest, Supertest, React Testing Library, Playwright, Maestro, k6. Cover authentication,
authorization, tenant isolation, employee ops, attendance/leave/payroll calculations, approval
workflows, AI permission filtering, API integration, mobile flows, performance, security.
**Cross-tenant access must always be denied.**

## 11. Phases (implement one at a time, never all at once)

01 Foundation & architecture · 02 Auth, RBAC & SaaS · 03 Organization management · 04 Employee
management · 05 Attendance, shifts & leave · 06 Recruitment & onboarding · 07 India payroll ·
08 Expenses, assets & travel · 09 Performance & learning (+ engagement) · 10 Documents, helpdesk &
workflows · 11 Advanced AI platform · 12 Analytics & reporting · 13 Complete React Native app ·
14 Integrations & production. Detailed scope per phase: `docs/DEVELOPMENT_ROADMAP.md`.

## 12. Strict phase execution rules

1. Read this file before implementation. 2. Inspect the repository before changing files.
2. Identify existing functionality. 4. Respect existing architecture and completed phases.
3. Implement only the current requested phase. 6. Break it into small tasks. 7. Implement
   incrementally. 8. Verify each implementation. 9. Maintain migrations. 10. Maintain API
   compatibility. 11. Maintain UI consistency. 12. Write automated tests. 13. Never use mock data as a
   substitute for real functionality. 14. Never silently skip failing tests. 15. Never claim
   incomplete work is complete. 16. Avoid unnecessary dependencies. 17. Avoid duplicate code.
4. Keep documentation updated. 19. Preserve working features. 20. **Never proceed to the next
   phase without user approval.** Document assumptions; ask only when a decision is necessary. Do not
   invent legal payroll rules, external API contracts or unsupported requirements.

## 13. Phase quality gate (report at the end of every phase)

A. Implementation report (completed, incomplete, files created/modified, architecture changes) ·
B. Database report (tables, relationships, indexes, constraints, migrations) · C. API report
(endpoints, DTOs, response formats, permissions) · D. UI report (screens, components, responsive,
mobile) · E. Test report (unit, integration, E2E, TypeScript, lint, build, migration verification,
security checks) · F. Documentation: README, MASTER_PROJECT_INSTRUCTIONS, ARCHITECTURE,
DATABASE_SCHEMA, API_DOCUMENTATION, RBAC_MATRIX, MODULE_STATUS, DEVELOPMENT_ROADMAP, TESTING_GUIDE,
DEPLOYMENT_GUIDE, PROJECT_STATUS — updated every phase. A phase is complete only when its
acceptance criteria are met **and verified**; otherwise fix or report the blocker.

## 14. Project status management

`PROJECT_STATUS.md` holds: current phase, current task, completed / in-progress / pending features,
known issues, technical decisions, migration status, test results, next recommended task. New
sessions read project status, architecture and module docs first and never assume earlier work is
complete because a previous conversation said so.

## 15. Final acceptance

Fully functional web and mobile apps, NestJS backend, PostgreSQL, secure multi-tenant SaaS, complete
HRM modules, India payroll, AI assistant, AI document processing, AI recruitment assistance, AI
analytics, dynamic workflows, advanced tables, responsive UI, role-based access, audit history,
real integrations, automated testing, production deployment — scalable, secure, maintainable,
accessible and commercially deployable.

## 16. Owner decisions recorded

| Date       | Decision                                                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-16 | Phase 01 approved. Docker Compose infra (PostgreSQL 17 + pgvector, Redis 7, S3 storage, Mailpit); native PostgreSQL 18 / Redis 5 not used. Repo root `D:\HRMS`. Package scope `@hrm/*`. Tenant-aware DB foundation in Phase 01; full RLS/RBAC/ABAC enforcement in Phase 02. |
