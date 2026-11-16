import type { Permission } from './permissions.js';

/** How the refresh token is returned: httpOnly cookie (browsers) or response body (mobile). */
export type TokenTransport = 'cookie' | 'body';

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Present only for `tokenTransport: "body"`. */
  refreshToken?: string;
}

export interface MfaChallenge {
  mfaRequired: true;
  /** Short-lived token proving the password step succeeded. */
  mfaToken: string;
}

export type LoginResult = (AuthTokens & { mfaRequired?: false }) | MfaChallenge;

export interface MembershipSummary {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roles: { id: string; key: string; name: string }[];
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  mfaEnabled: boolean;
  emailVerified: boolean;
}

/** `GET /auth/me` */
export interface SessionInfo {
  user: CurrentUser;
  sessionId: string;
  activeOrganization: MembershipSummary | null;
  memberships: MembershipSummary[];
  /** Effective permissions in the active organization. */
  permissions: Permission[];
}

export interface MfaSetup {
  /** Base32 secret for manual entry. */
  secret: string;
  /** `otpauth://` URI for QR codes. */
  otpauthUri: string;
}

export interface MfaEnabledResult {
  /** Shown once. Each code can be used once instead of an authenticator code. */
  recoveryCodes: string[];
}

export interface SessionListItem {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AuthEventItem {
  id: string;
  type: string;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: string;
}
