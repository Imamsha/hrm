import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@hrm/shared-types';
import type { Request } from 'express';
import type { AuthPrincipal } from './principal.js';

export const IS_PUBLIC = 'hrm:isPublic';
export const REQUIRED_PERMISSIONS = 'hrm:requiredPermissions';
export const AUTH_RATE_LIMITED = 'hrm:authRateLimited';
export const SCOPED_PERMISSIONS = 'hrm:scopedPermissions';

/** Route is reachable without authentication (health, login, register, password reset, ...). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Every listed permission must be granted at ORGANIZATION scope in the active organization.
 * Implies an active organization (otherwise TENANT_CONTEXT_MISSING).
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Every listed permission must be granted at **some** scope (organization-wide or scoped to a
 * company/branch/department/team/self). The service then restricts the data to the scopes held
 * (`can()` / scope filters). Use only where the service applies that restriction.
 */
export const RequireScopedPermissions = (...permissions: Permission[]) =>
  SetMetadata(SCOPED_PERMISSIONS, permissions);

/** Applies the stricter credential-endpoint rate limit (AUTH_RATE_LIMIT_MAX per minute per IP). */
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);

export type AuthenticatedRequest = Request & { auth?: AuthPrincipal };

/** Injects the authenticated principal. Throws if used on a public route without a principal. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.auth) throw new Error('CurrentPrincipal used on a route without authentication');
    return req.auth;
  },
);

/** Principal if the caller sent a valid token on a public route; otherwise undefined. */
export const OptionalPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);
