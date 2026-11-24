import { PERMISSIONS } from '@hrm/shared-types';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { usePermission } from '@/features/auth/auth-store';

/** Client contacts (portal access without staff self-service) land on the portal. */
export function HomePage({ overview }: { overview: ReactNode }) {
  const portal = usePermission(PERMISSIONS.PROJECTS_PORTAL_ACCESS);
  const staff = usePermission(PERMISSIONS.EMPLOYEES_SELF_ACCESS);
  if (portal && !staff) return <Navigate to="/portal" replace />;
  return overview;
}
