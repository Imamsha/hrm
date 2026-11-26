import { PERMISSIONS } from '@hrm/shared-types';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { SecurityPage } from '@/features/account/security-page';
import { AuditPage } from '@/features/audit/audit-page';
import { AcceptInvitationPage } from '@/features/auth/accept-invitation-page';
import { LoginPage } from '@/features/auth/login-page';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/password-recovery-pages';
import { RegisterPage } from '@/features/auth/register-page';
import { EmployeesPage } from '@/features/employees/employees-page';
import { EmployeeProfilePage, MyProfilePage } from '@/features/employees/profile-pages';
import { MembersPage } from '@/features/members/members-page';
import { OrganizationSettingsPage } from '@/features/organization/organization-settings-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { ApprovalInboxPage, WorkflowsPage } from '@/features/workflows/approval-pages';
import {
  DocumentsPage,
  LibraryPage,
  PublicAcceptancePage,
  TemplatesPage,
} from '@/features/workflows/documents-pages';
import { BillingPage, ClientsPage, InvoicePage } from '@/features/projects/billing-pages';
import {
  PortalHomePage,
  PortalInvoicePage,
  PortalItemPage,
  PortalProjectPage,
} from '@/features/projects/portal-pages';
import {
  MyWorkPage,
  ProjectPage,
  ProjectsPage,
  WorkItemPage,
} from '@/features/projects/project-pages';
import { MyTimesheetPage, TimesheetsPage } from '@/features/projects/time-pages';
import { HomePage } from '@/features/projects/home';
import { AssetPage, AssetsPage, LicensesPage, MyAssetsPage } from '@/features/expenses/asset-pages';
import {
  ClaimPage,
  ExpenseApprovalsPage,
  ExpenseSetupPage,
  MyExpensesPage,
} from '@/features/expenses/claim-pages';
import { MyTripsPage, TravelRequestsPage, TripPage } from '@/features/expenses/travel-pages';
import {
  EngagementAdminPage,
  EngagementHomePage,
  SuggestionsPage,
  SurveysPage,
} from '@/features/talent/engagement-pages';
import { CoursePage, LearningAdminPage, MyLearningPage } from '@/features/talent/learning-pages';
import {
  GoalsPage,
  MyReviewsPage,
  PerformanceSetupPage,
  PipsPage,
  ReviewCyclesPage,
  ReviewPage,
} from '@/features/talent/performance-pages';
import {
  EmployeePayrollPage,
  MyPayslipsPage,
  MySalaryPage,
  PayslipPage,
  SettlementsPage,
} from '@/features/payroll/payroll-people-pages';
import { PayrollRunPage, PayrollRunsPage } from '@/features/payroll/payroll-runs-pages';
import { SalarySetupPage, StatutoryRulesPage } from '@/features/payroll/payroll-setup-pages';
import { ApplicationPage } from '@/features/recruitment/application-page';
import { CareerJobPage, CareersPage } from '@/features/recruitment/careers-pages';
import {
  ApplicationsListPage,
  CandidatesPage,
  OpeningPipelinePage,
  OpeningsPage,
  RequisitionsPage,
} from '@/features/recruitment/hiring-pages';
import {
  MyInterviewsPage,
  MyOnboardingPage,
  OnboardingPage,
} from '@/features/recruitment/people-pages';
import { RolesPage } from '@/features/roles/roles-page';
import { CalendarsPage } from '@/features/structure/calendars-page';
import { OrgChartPage } from '@/features/structure/org-chart-page';
import { JobCatalogPage, StructurePage } from '@/features/structure/structure-pages';
import { SystemStatusPage } from '@/features/system/system-status-page';
import { KioskPage, QrClockInPage } from '@/features/time/kiosk-pages';
import {
  ApprovalsPage,
  LeavePoliciesPage,
  LeaveRequestsPage,
  MyLeavePage,
} from '@/features/time/leave-pages';
import { MyAttendancePage } from '@/features/time/my-attendance-page';
import { ShiftsPage, TeamAttendancePage } from '@/features/time/team-pages';
import { NotFoundPage, RouteErrorPage } from './error-pages';
import { GuestOnly, RequireAuth, RequirePermission } from './guards';
import { AppShell } from './layout/app-shell';
import type { RouteHandle } from './layout/header';

const crumb = (label: string): RouteHandle => ({ crumb: label });

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Reachable whether or not signed in.
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/accept-invitation', element: <AcceptInvitationPage /> },
      { path: '/accept-document', element: <PublicAcceptancePage /> },
      // Public career site (no sign-in).
      { path: '/careers/:org', element: <CareersPage /> },
      { path: '/careers/:org/:slug', element: <CareerJobPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <AppShell />,
            handle: crumb('Home'),
            children: [
              {
                index: true,
                element: <HomePage overview={<OverviewPage />} />,
                handle: crumb('Overview'),
              },
              {
                path: 'system/status',
                element: <SystemStatusPage />,
                handle: crumb('System status'),
              },
              {
                path: 'people/employees',
                handle: crumb('Employees'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_EMPLOYEE_READ}>
                    <EmployeesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'people/employees/:id',
                handle: crumb('Employee profile'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_EMPLOYEE_READ}>
                    <EmployeeProfilePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/profile',
                handle: crumb('My profile'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyProfilePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/attendance',
                handle: crumb('My attendance'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ATTENDANCE_SELF_USE}>
                    <MyAttendancePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'attendance/qr',
                handle: crumb('QR clock-in'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ATTENDANCE_SELF_USE}>
                    <QrClockInPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/leave',
                handle: crumb('My leave'),
                element: (
                  <RequirePermission permission={PERMISSIONS.LEAVE_SELF_USE}>
                    <MyLeavePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/approvals',
                handle: crumb('Approvals'),
                element: (
                  <RequirePermission permission={PERMISSIONS.LEAVE_SELF_USE}>
                    <ApprovalsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'time/attendance',
                handle: crumb('Team attendance'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ATTENDANCE_RECORD_READ}>
                    <TeamAttendancePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'time/leave',
                handle: crumb('Leave requests'),
                element: (
                  <RequirePermission permission={PERMISSIONS.LEAVE_REQUEST_READ}>
                    <LeaveRequestsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'time/shifts',
                handle: crumb('Shifts'),
                element: (
                  <RequirePermission permission={PERMISSIONS.SHIFTS_SHIFT_READ}>
                    <ShiftsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'time/policies',
                handle: crumb('Leave & attendance policies'),
                element: (
                  <RequirePermission permission={PERMISSIONS.LEAVE_TYPE_MANAGE}>
                    <LeavePoliciesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'time/kiosk',
                handle: crumb('Kiosk'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ATTENDANCE_KIOSK_OPERATE}>
                    <KioskPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/requisitions',
                handle: crumb('Requisitions'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_REQUISITION_READ}>
                    <RequisitionsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/openings',
                handle: crumb('Openings'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_CANDIDATE_READ}>
                    <OpeningsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/openings/:id',
                handle: crumb('Pipeline'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_CANDIDATE_READ}>
                    <OpeningPipelinePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/candidates',
                handle: crumb('Candidates'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_CANDIDATE_READ}>
                    <CandidatesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/applications',
                handle: crumb('Applications'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_CANDIDATE_READ}>
                    <ApplicationsListPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/applications/:id',
                handle: crumb('Application'),
                element: (
                  <RequirePermission permission={PERMISSIONS.RECRUITMENT_CANDIDATE_READ}>
                    <ApplicationPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'recruitment/onboarding',
                handle: crumb('Onboarding'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ONBOARDING_PLAN_READ}>
                    <OnboardingPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/interviews',
                handle: crumb('My interviews'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyInterviewsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/onboarding',
                handle: crumb('My onboarding'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyOnboardingPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/runs',
                handle: crumb('Payroll runs'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_RUN_READ}>
                    <PayrollRunsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/runs/:id',
                handle: crumb('Payroll run'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_RUN_READ}>
                    <PayrollRunPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/payslips/:id',
                handle: crumb('Payslip'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_RUN_READ}>
                    <PayslipPage self={false} />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/employees',
                handle: crumb('Employee payroll'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_SALARY_READ}>
                    <EmployeePayrollPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/employees/:id',
                handle: crumb('Employee payroll'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_SALARY_READ}>
                    <EmployeePayrollPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/setup',
                handle: crumb('Salary setup'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_SALARY_READ}>
                    <SalarySetupPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/statutory',
                handle: crumb('Statutory rules'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_RUN_READ}>
                    <StatutoryRulesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'payroll/settlements',
                handle: crumb('Full & final'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PAYROLL_SETTLEMENT_MANAGE}>
                    <SettlementsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/payslips',
                handle: crumb('My payslips'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyPayslipsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/payslips/:id',
                handle: crumb('Payslip'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <PayslipPage self />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/salary',
                handle: crumb('My salary & tax'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MySalaryPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/expenses',
                handle: crumb('My expenses'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyExpensesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'expenses/claims/:id',
                handle: crumb('Expense claim'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ClaimPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'expenses/approvals',
                handle: crumb('Expense approvals'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ExpenseApprovalsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'expenses/setup',
                handle: crumb('Expense setup'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EXPENSES_CATEGORY_MANAGE}>
                    <ExpenseSetupPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/approval-tasks',
                handle: crumb('Approval inbox'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ApprovalInboxPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/workflows',
                handle: crumb('Approval workflows'),
                element: (
                  <RequirePermission permission={PERMISSIONS.WORKFLOWS_DEFINITION_MANAGE}>
                    <WorkflowsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'documents',
                handle: crumb('Documents'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <DocumentsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'documents/templates',
                handle: crumb('Document templates'),
                element: (
                  <RequirePermission permission={PERMISSIONS.DOCUMENTS_TEMPLATE_MANAGE}>
                    <TemplatesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'library',
                handle: crumb('Company documents'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <LibraryPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'projects',
                handle: crumb('Projects'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ProjectsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'projects/:id',
                handle: crumb('Project'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ProjectPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'projects/:id/items/:itemId',
                handle: crumb('Work item'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <WorkItemPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/work',
                handle: crumb('My work'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyWorkPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/timesheet',
                handle: crumb('My timesheet'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyTimesheetPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'timesheets',
                handle: crumb('Timesheets'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <TimesheetsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'clients',
                handle: crumb('Clients'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ClientsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'billing',
                handle: crumb('Billing'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_BILLING_MANAGE}>
                    <BillingPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'billing/invoices/:id',
                handle: crumb('Invoice'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_BILLING_MANAGE}>
                    <InvoicePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'portal',
                handle: crumb('Client portal'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_PORTAL_ACCESS}>
                    <PortalHomePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'portal/projects/:id',
                handle: crumb('Project'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_PORTAL_ACCESS}>
                    <PortalProjectPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'portal/items/:id',
                handle: crumb('Item'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_PORTAL_ACCESS}>
                    <PortalItemPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'portal/invoices/:id',
                handle: crumb('Invoice'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PROJECTS_PORTAL_ACCESS}>
                    <PortalInvoicePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/goals',
                handle: crumb('Goals'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <GoalsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/reviews',
                handle: crumb('Reviews'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyReviewsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'performance/reviews/:id',
                handle: crumb('Review'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <ReviewPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'performance/cycles',
                handle: crumb('Review cycles'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PERFORMANCE_CYCLE_MANAGE}>
                    <ReviewCyclesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'performance/setup',
                handle: crumb('Performance setup'),
                element: (
                  <RequirePermission permission={PERMISSIONS.PERFORMANCE_CONFIG_MANAGE}>
                    <PerformanceSetupPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'performance/pips',
                handle: crumb('Improvement plans'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <PipsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/learning',
                handle: crumb('My learning'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyLearningPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'learning/courses/:id',
                handle: crumb('Course'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <CoursePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'learning',
                handle: crumb('Learning'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <LearningAdminPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'engagement',
                handle: crumb('Company'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <EngagementHomePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'engagement/surveys',
                handle: crumb('Surveys'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <SurveysPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'engagement/suggestions',
                handle: crumb('Suggestions'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <SuggestionsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'engagement/admin',
                handle: crumb('Engagement admin'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ENGAGEMENT_CONTENT_MANAGE}>
                    <EngagementAdminPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/trips',
                handle: crumb('My travel'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyTripsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'travel/trips/:id',
                handle: crumb('Trip'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <TripPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'travel/requests',
                handle: crumb('Travel requests'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <TravelRequestsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'assets',
                handle: crumb('Assets'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ASSETS_ASSET_READ}>
                    <AssetsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'assets/licenses',
                handle: crumb('Software licences'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ASSETS_ASSET_READ}>
                    <LicensesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'assets/:id',
                handle: crumb('Asset'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ASSETS_ASSET_READ}>
                    <AssetPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'me/assets',
                handle: crumb('My assets'),
                element: (
                  <RequirePermission permission={PERMISSIONS.EMPLOYEES_SELF_ACCESS}>
                    <MyAssetsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'organization/structure',
                handle: crumb('Organization structure'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ORGANIZATION_STRUCTURE_READ}>
                    <StructurePage />
                  </RequirePermission>
                ),
              },
              {
                path: 'organization/org-chart',
                handle: crumb('Org chart'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ORGANIZATION_STRUCTURE_READ}>
                    <OrgChartPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'organization/job-catalog',
                handle: crumb('Job catalog'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ORGANIZATION_JOB_CATALOG_READ}>
                    <JobCatalogPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'organization/calendars',
                handle: crumb('Working days & holidays'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ORGANIZATION_CALENDAR_READ}>
                    <CalendarsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/members',
                handle: crumb('Members'),
                element: (
                  <RequirePermission permission={PERMISSIONS.USERS_MEMBER_READ}>
                    <MembersPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/roles',
                handle: crumb('Roles & permissions'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ROLES_ROLE_READ}>
                    <RolesPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/organization',
                handle: crumb('Organization'),
                element: (
                  <RequirePermission permission={PERMISSIONS.ORGANIZATION_SETTINGS_READ}>
                    <OrganizationSettingsPage />
                  </RequirePermission>
                ),
              },
              {
                path: 'admin/audit',
                handle: crumb('Audit log'),
                element: (
                  <RequirePermission permission={PERMISSIONS.AUDIT_LOG_READ}>
                    <AuditPage />
                  </RequirePermission>
                ),
              },
              { path: 'account/security', element: <SecurityPage />, handle: crumb('Security') },
              { path: '*', element: <NotFoundPage />, handle: crumb('Not found') },
            ],
          },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
