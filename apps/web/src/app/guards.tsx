import type { Permission } from '@hrm/shared-types';
import { EmptyState, Spinner } from '@hrm/ui-web';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth, usePermission } from '@/features/auth/auth-store';
import { Page } from './layout/page';

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="size-5" label="Loading your session" />
    </div>
  );
}

/** Protected area: waits for session bootstrap, redirects anonymous users to sign in. */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/** Sign-in/registration pages: signed-in users go to the app. */
export function GuestOnly() {
  const status = useAuth((s) => s.status);
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

/**
 * UI-level gate. The API enforces every permission independently; this only avoids showing
 * screens and actions the user cannot use.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = usePermission(permission);
  if (!allowed) {
    return (
      <Page>
        <EmptyState
          icon={<ShieldAlert />}
          title="You don’t have access to this page"
          description="Ask an administrator of your organization to grant you the required role."
        />
      </Page>
    );
  }
  return children;
}

export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  return usePermission(permission) ? children : null;
}
