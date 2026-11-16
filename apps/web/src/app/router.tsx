import { createBrowserRouter, type RouteObject } from 'react-router';
import { OverviewPage } from '@/features/overview/overview-page';
import { SystemStatusPage } from '@/features/system/system-status-page';
import { NotFoundPage, RouteErrorPage } from './error-pages';
import { AppShell } from './layout/app-shell';
import type { RouteHandle } from './layout/header';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    handle: { crumb: 'Home' } satisfies RouteHandle,
    children: [
      {
        index: true,
        element: <OverviewPage />,
        handle: { crumb: 'Overview' } satisfies RouteHandle,
      },
      {
        path: 'system/status',
        element: <SystemStatusPage />,
        handle: { crumb: 'System status' } satisfies RouteHandle,
      },
      {
        path: '*',
        element: <NotFoundPage />,
        handle: { crumb: 'Not found' } satisfies RouteHandle,
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
