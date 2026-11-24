import { PERMISSIONS, type Permission } from '@hrm/shared-types';
import {
  Activity,
  FileSpreadsheet,
  FolderKanban,
  Handshake,
  ListTodo,
  Clock3,
  ClipboardClock,
  Globe,
  Award,
  BookOpen,
  Gauge,
  GraduationCap,
  Lightbulb,
  LifeBuoy,
  PartyPopper,
  RefreshCcw,
  Star,
  Target,
  Vote,
  BadgeCheck,
  Boxes,
  KeySquare,
  Laptop,
  Plane,
  PlaneTakeoff,
  Receipt,
  SlidersHorizontal,
  Banknote,
  Calculator,
  FileText,
  Landmark,
  LogOut,
  IndianRupee,
  Wallet,
  ClipboardCheck,
  ClipboardList,
  FileUser,
  Inbox,
  Megaphone,
  MessagesSquare,
  Rocket,
  Building2,
  CalendarCheck,
  CalendarClock,
  CheckSquare,
  Clock,
  ListChecks,
  QrCode,
  Settings2,
  Timer,
  IdCard,
  UserRound,
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
  /** Hidden when this permission is granted (e.g. the client portal for staff). */
  hideWith?: Permission;
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
    label: 'People',
    items: [
      {
        label: 'Employees',
        to: '/people/employees',
        icon: IdCard,
        permission: PERMISSIONS.EMPLOYEES_EMPLOYEE_READ,
      },
      {
        label: 'My profile',
        to: '/me/profile',
        icon: UserRound,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
    ],
  },
  {
    label: 'Time',
    items: [
      {
        label: 'My attendance',
        to: '/me/attendance',
        icon: Clock,
        permission: PERMISSIONS.ATTENDANCE_SELF_USE,
      },
      {
        label: 'My leave',
        to: '/me/leave',
        icon: CalendarCheck,
        permission: PERMISSIONS.LEAVE_SELF_USE,
      },
      {
        label: 'Approvals',
        to: '/me/approvals',
        icon: CheckSquare,
        permission: PERMISSIONS.LEAVE_SELF_USE,
      },
      {
        label: 'Team attendance',
        to: '/time/attendance',
        icon: Timer,
        permission: PERMISSIONS.ATTENDANCE_RECORD_READ,
      },
      {
        label: 'Leave requests',
        to: '/time/leave',
        icon: ListChecks,
        permission: PERMISSIONS.LEAVE_REQUEST_READ,
      },
      {
        label: 'Shifts',
        to: '/time/shifts',
        icon: CalendarClock,
        permission: PERMISSIONS.SHIFTS_SHIFT_READ,
      },
      {
        label: 'Leave & attendance policies',
        to: '/time/policies',
        icon: Settings2,
        permission: PERMISSIONS.LEAVE_TYPE_MANAGE,
      },
      {
        label: 'Kiosk',
        to: '/time/kiosk',
        icon: QrCode,
        permission: PERMISSIONS.ATTENDANCE_KIOSK_OPERATE,
      },
    ],
  },
  {
    label: 'Recruitment',
    items: [
      {
        label: 'Requisitions',
        to: '/recruitment/requisitions',
        icon: ClipboardList,
        permission: PERMISSIONS.RECRUITMENT_REQUISITION_READ,
      },
      {
        label: 'Openings',
        to: '/recruitment/openings',
        icon: Megaphone,
        permission: PERMISSIONS.RECRUITMENT_CANDIDATE_READ,
      },
      {
        label: 'Candidates',
        to: '/recruitment/candidates',
        icon: FileUser,
        permission: PERMISSIONS.RECRUITMENT_CANDIDATE_READ,
      },
      {
        label: 'Applications',
        to: '/recruitment/applications',
        icon: Inbox,
        permission: PERMISSIONS.RECRUITMENT_CANDIDATE_READ,
      },
      {
        label: 'My interviews',
        to: '/me/interviews',
        icon: MessagesSquare,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Onboarding',
        to: '/recruitment/onboarding',
        icon: ClipboardCheck,
        permission: PERMISSIONS.ONBOARDING_PLAN_READ,
      },
      {
        label: 'My onboarding',
        to: '/me/onboarding',
        icon: Rocket,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
    ],
  },
  {
    label: 'Payroll',
    items: [
      {
        label: 'Payroll runs',
        to: '/payroll/runs',
        icon: Calculator,
        permission: PERMISSIONS.PAYROLL_RUN_READ,
      },
      {
        label: 'Employee payroll',
        to: '/payroll/employees',
        icon: Wallet,
        permission: PERMISSIONS.PAYROLL_SALARY_READ,
      },
      {
        label: 'Full & final',
        to: '/payroll/settlements',
        icon: LogOut,
        permission: PERMISSIONS.PAYROLL_SETTLEMENT_MANAGE,
      },
      {
        label: 'Salary setup',
        to: '/payroll/setup',
        icon: Banknote,
        permission: PERMISSIONS.PAYROLL_SALARY_READ,
      },
      {
        label: 'Statutory rules',
        to: '/payroll/statutory',
        icon: Landmark,
        permission: PERMISSIONS.PAYROLL_RUN_READ,
      },
      {
        label: 'My payslips',
        to: '/me/payslips',
        icon: IndianRupee,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'My salary & tax',
        to: '/me/salary',
        icon: FileText,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
    ],
  },
  {
    label: 'Expenses & assets',
    items: [
      {
        label: 'My expenses',
        to: '/me/expenses',
        icon: Receipt,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'My travel',
        to: '/me/trips',
        icon: PlaneTakeoff,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'My assets',
        to: '/me/assets',
        icon: Laptop,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Expense approvals',
        to: '/expenses/approvals',
        icon: BadgeCheck,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Travel requests',
        to: '/travel/requests',
        icon: Plane,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Expense setup',
        to: '/expenses/setup',
        icon: SlidersHorizontal,
        permission: PERMISSIONS.EXPENSES_CATEGORY_MANAGE,
      },
      { label: 'Assets', to: '/assets', icon: Boxes, permission: PERMISSIONS.ASSETS_ASSET_READ },
      {
        label: 'Software licences',
        to: '/assets/licenses',
        icon: KeySquare,
        permission: PERMISSIONS.ASSETS_ASSET_READ,
      },
    ],
  },
  {
    label: 'Projects',
    items: [
      {
        label: 'My work',
        to: '/me/work',
        icon: ListTodo,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'My timesheet',
        to: '/me/timesheet',
        icon: Clock3,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Projects',
        to: '/projects',
        icon: FolderKanban,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Timesheets',
        to: '/timesheets',
        icon: ClipboardClock,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Clients',
        to: '/clients',
        icon: Handshake,
        permission: PERMISSIONS.PROJECTS_PROJECT_READ,
      },
      {
        label: 'Billing',
        to: '/billing',
        icon: FileSpreadsheet,
        permission: PERMISSIONS.PROJECTS_BILLING_MANAGE,
      },
    ],
  },
  {
    label: 'Client portal',
    items: [
      {
        label: 'Portal',
        to: '/portal',
        icon: Globe,
        permission: PERMISSIONS.PROJECTS_PORTAL_ACCESS,
        hideWith: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
    ],
  },
  {
    label: 'Performance',
    items: [
      {
        label: 'Goals & OKRs',
        to: '/me/goals',
        icon: Target,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Reviews',
        to: '/me/reviews',
        icon: Star,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Improvement plans',
        to: '/performance/pips',
        icon: LifeBuoy,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Review cycles',
        to: '/performance/cycles',
        icon: RefreshCcw,
        permission: PERMISSIONS.PERFORMANCE_CYCLE_MANAGE,
      },
      {
        label: 'Performance setup',
        to: '/performance/setup',
        icon: Gauge,
        permission: PERMISSIONS.PERFORMANCE_CONFIG_MANAGE,
      },
    ],
  },
  {
    label: 'Learning',
    items: [
      {
        label: 'My learning',
        to: '/me/learning',
        icon: BookOpen,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Training & skills',
        to: '/learning',
        icon: GraduationCap,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
    ],
  },
  {
    label: 'Engagement',
    items: [
      {
        label: 'Company',
        to: '/engagement',
        icon: PartyPopper,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Surveys',
        to: '/engagement/surveys',
        icon: Vote,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Suggestions',
        to: '/engagement/suggestions',
        icon: Lightbulb,
        permission: PERMISSIONS.EMPLOYEES_SELF_ACCESS,
      },
      {
        label: 'Engagement admin',
        to: '/engagement/admin',
        icon: Award,
        permission: PERMISSIONS.ENGAGEMENT_CONTENT_MANAGE,
      },
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
