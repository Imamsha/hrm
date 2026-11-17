import { PERMISSIONS, type Permission } from '@hrm/shared-types';
import {
  Activity,
  Building2,
  CalendarDays,
  Briefcase,
  Network,
  Workflow,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  ScrollText,
  ShieldCheck,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Hidden unless the active organization grants this permission. */
  permission?: Permission;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar navigation. Only routes that are actually implemented are listed;
 * business modules are added here as each phase delivers them.
 */
export const navigation: NavSection[] = [
  {
    label: 'Platform',
    items: [
      { label: 'Overview', to: '/', icon: LayoutDashboard },
      { label: 'System status', to: '/system/status', icon: Activity },
    ],
  },
  {
    label: 'Organization',
    items: [
      {
        label: 'Structure',
        to: '/organization/structure',
        icon: Workflow,
        permission: PERMISSIONS.ORGANIZATION_STRUCTURE_READ,
      },
      {
        label: 'Org chart',
        to: '/organization/org-chart',
        icon: Network,
        permission: PERMISSIONS.ORGANIZATION_STRUCTURE_READ,
      },
      {
        label: 'Job catalog',
        to: '/organization/job-catalog',
        icon: Briefcase,
        permission: PERMISSIONS.ORGANIZATION_JOB_CATALOG_READ,
      },
      {
        label: 'Working days & holidays',
        to: '/organization/calendars',
        icon: CalendarDays,
        permission: PERMISSIONS.ORGANIZATION_CALENDAR_READ,
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Members',
        to: '/admin/members',
        icon: Users,
        permission: PERMISSIONS.USERS_MEMBER_READ,
      },
      {
        label: 'Roles & permissions',
        to: '/admin/roles',
        icon: KeyRound,
        permission: PERMISSIONS.ROLES_ROLE_READ,
      },
      {
        label: 'Organization',
        to: '/admin/organization',
        icon: Building2,
        permission: PERMISSIONS.ORGANIZATION_SETTINGS_READ,
      },
      {
        label: 'Audit log',
        to: '/admin/audit',
        icon: ScrollText,
        permission: PERMISSIONS.AUDIT_LOG_READ,
      },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Security', to: '/account/security', icon: ShieldCheck }],
  },
];
