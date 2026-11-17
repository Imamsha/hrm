import { PERMISSIONS } from '@hrm/shared-types';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { SecurityPage } from '@/features/account/security-page';
import { AuditPage } from '@/features/audit/audit-page';
import { AcceptInvitationPage } from '@/features/auth/accept-invitation-page';
import { LoginPage } from '@/features/auth/login-page';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/password-recovery-pages';
import { RegisterPage } from '@/features/auth/register-page';
import { MembersPage } from '@/features/members/members-page';
import { OrganizationSettingsPage } from '@/features/organization/organization-settings-page';
import { OverviewPage } from '@/features/overview/overview-page';
import { RolesPage } from '@/features/roles/roles-page';
import { CalendarsPage } from '@/features/structure/calendars-page';
import { OrgChartPage } from '@/features/structure/org-chart-page';
import { JobCatalogPage, StructurePage } from '@/features/structure/structure-pages';
import { SystemStatusPage } from '@/features/system/system-status-page';
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
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <AppShell />,
            handle: crumb('Home'),
            children: [
              { index: true, element: <OverviewPage />, handle: crumb('Overview') },
              {
                path: 'system/status',
                element: <SystemStatusPage />,
                handle: crumb('System status'),
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
