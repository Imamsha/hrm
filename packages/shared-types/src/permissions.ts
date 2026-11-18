/**
 * Permission catalog: `<module>.<resource>.<action>`.
 * Must mirror the `permissions` table seed (verified by an integration test).
 * New permissions are added here AND in a migration in the same change.
 */
export const PERMISSIONS = {
  ORGANIZATION_SETTINGS_READ: 'organization.settings.read',
  ORGANIZATION_SETTINGS_UPDATE: 'organization.settings.update',
  ORGANIZATION_STRUCTURE_READ: 'organization.structure.read',
  ORGANIZATION_STRUCTURE_MANAGE: 'organization.structure.manage',
  ORGANIZATION_JOB_CATALOG_READ: 'organization.job_catalog.read',
  ORGANIZATION_JOB_CATALOG_MANAGE: 'organization.job_catalog.manage',
  ORGANIZATION_CALENDAR_READ: 'organization.calendar.read',
  ORGANIZATION_CALENDAR_MANAGE: 'organization.calendar.manage',
  EMPLOYEES_EMPLOYEE_READ: 'employees.employee.read',
  EMPLOYEES_EMPLOYEE_CREATE: 'employees.employee.create',
  EMPLOYEES_EMPLOYEE_UPDATE: 'employees.employee.update',
  EMPLOYEES_LIFECYCLE_MANAGE: 'employees.lifecycle.manage',
  EMPLOYEES_PERSONAL_READ: 'employees.personal.read',
  EMPLOYEES_SENSITIVE_READ: 'employees.sensitive.read',
  EMPLOYEES_SENSITIVE_MANAGE: 'employees.sensitive.manage',
  EMPLOYEES_DOCUMENT_READ: 'employees.document.read',
  EMPLOYEES_DOCUMENT_MANAGE: 'employees.document.manage',
  EMPLOYEES_SETTINGS_MANAGE: 'employees.settings.manage',
  EMPLOYEES_SELF_ACCESS: 'employees.self.access',
  USERS_MEMBER_READ: 'users.member.read',
  USERS_MEMBER_INVITE: 'users.member.invite',
  USERS_MEMBER_UPDATE: 'users.member.update',
  USERS_MEMBER_REMOVE: 'users.member.remove',
  ROLES_ROLE_READ: 'roles.role.read',
  ROLES_ROLE_MANAGE: 'roles.role.manage',
  AUDIT_LOG_READ: 'audit.log.read',
  SUBSCRIPTION_PLAN_READ: 'subscription.plan.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: readonly Permission[];
}

const P = PERMISSIONS;

/**
 * Roles created for every new organization. `owner` always holds every permission and cannot be
 * edited or removed; an organization must keep at least one active owner.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Full control of the organization, including billing and ownership.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'admin',
    name: 'Organization admin',
    description: 'Administers organization settings, members and roles.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'hr_admin',
    name: 'HR admin',
    description: 'Manages people and their access.',
    permissions: [
      P.ORGANIZATION_SETTINGS_READ,
      P.ORGANIZATION_STRUCTURE_READ,
      P.ORGANIZATION_STRUCTURE_MANAGE,
      P.ORGANIZATION_JOB_CATALOG_READ,
      P.ORGANIZATION_JOB_CATALOG_MANAGE,
      P.ORGANIZATION_CALENDAR_READ,
      P.ORGANIZATION_CALENDAR_MANAGE,
      P.EMPLOYEES_EMPLOYEE_READ,
      P.EMPLOYEES_EMPLOYEE_CREATE,
      P.EMPLOYEES_EMPLOYEE_UPDATE,
      P.EMPLOYEES_LIFECYCLE_MANAGE,
      P.EMPLOYEES_PERSONAL_READ,
      P.EMPLOYEES_SENSITIVE_READ,
      P.EMPLOYEES_SENSITIVE_MANAGE,
      P.EMPLOYEES_DOCUMENT_READ,
      P.EMPLOYEES_DOCUMENT_MANAGE,
      P.EMPLOYEES_SETTINGS_MANAGE,
      P.EMPLOYEES_SELF_ACCESS,
      P.USERS_MEMBER_READ,
      P.USERS_MEMBER_INVITE,
      P.USERS_MEMBER_UPDATE,
      P.ROLES_ROLE_READ,
      P.AUDIT_LOG_READ,
    ],
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Finance and payroll users.',
    permissions: [
      P.ORGANIZATION_SETTINGS_READ,
      P.ORGANIZATION_STRUCTURE_READ,
      P.ORGANIZATION_JOB_CATALOG_READ,
      P.ORGANIZATION_CALENDAR_READ,
      P.EMPLOYEES_EMPLOYEE_READ,
      P.EMPLOYEES_SENSITIVE_READ,
      P.EMPLOYEES_SELF_ACCESS,
      P.SUBSCRIPTION_PLAN_READ,
    ],
  },
  {
    key: 'manager',
    name: 'Manager',
    description: 'People managers.',
    permissions: [
      P.ORGANIZATION_SETTINGS_READ,
      P.ORGANIZATION_STRUCTURE_READ,
      P.ORGANIZATION_JOB_CATALOG_READ,
      P.ORGANIZATION_CALENDAR_READ,
      P.EMPLOYEES_EMPLOYEE_READ,
      P.EMPLOYEES_SELF_ACCESS,
      P.USERS_MEMBER_READ,
    ],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Self-service access.',
    permissions: [
      P.ORGANIZATION_SETTINGS_READ,
      P.ORGANIZATION_STRUCTURE_READ,
      P.ORGANIZATION_CALENDAR_READ,
      P.EMPLOYEES_SELF_ACCESS,
    ],
  },
];

export const OWNER_ROLE_KEY = 'owner';
export const DEFAULT_MEMBER_ROLE_KEY = 'employee';
