import type { Permission } from './permissions.js';

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED';
export type AccessScopeType =
  'ORGANIZATION' | 'COMPANY' | 'BRANCH' | 'DEPARTMENT' | 'TEAM' | 'SELF';

export interface OrganizationDetails {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocale: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRef {
  id: string;
  key: string;
  name: string;
}

export interface MemberListItem {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  status: MembershipStatus;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  joinedAt: string;
  roles: RoleRef[];
}

export interface RoleDetails {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionCatalogItem {
  key: Permission;
  module: string;
  description: string;
}

export interface InvitationItem {
  id: string;
  email: string;
  fullName: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  roles: RoleRef[];
  expiresAt: string;
  createdAt: string;
}

/** Public preview shown on the accept-invitation page. */
export interface InvitationPreview {
  organizationName: string;
  email: string;
  fullName: string | null;
  /** True when an account with this e-mail exists (sign in instead of setting a password). */
  accountExists: boolean;
  expiresAt: string;
}

export interface AuditLogItem {
  id: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  ipAddress: string | null;
  occurredAt: string;
}

export interface SubscriptionDetails {
  planKey: string;
  planName: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  limits: Record<string, number | null>;
}
