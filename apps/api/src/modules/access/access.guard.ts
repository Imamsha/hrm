import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@hrm/shared-types';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/http/app.exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TokenService } from '../../infrastructure/security/token.service.js';
import { AccessService } from './access.service.js';
import { type AuthenticatedRequest, IS_PUBLIC, REQUIRED_PERMISSIONS } from './decorators.js';
import { type AuthPrincipal, hasOrganizationWide } from './principal.js';

/**
 * Global guard. For every non-public route:
 *  1. verifies the Bearer access token (signature, issuer, audience, expiry);
 *  2. rejects revoked sessions (logout, password change, token reuse) and disabled users;
 *  3. re-validates the active membership in the token's organization against the database
 *     (cached ≤ 60 s, invalidated immediately on access changes) — the tenant context is derived
 *     only from this verified membership, never from client input;
 *  4. enforces @RequirePermissions at ORGANIZATION scope.
 * Public routes still get a principal when a valid token is present (OptionalPrincipal).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) ?? false;
    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets) ??
      [];
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) {
      if (isPublic) return true;
      throw AppException.unauthenticated();
    }

    let principal: AuthPrincipal;
    try {
      principal = await this.authenticate(token);
    } catch (err) {
      if (isPublic) return true; // invalid token on a public route: treat as anonymous
      throw err;
    }
    req.auth = principal;
    RequestContext.patch({
      userId: principal.userId,
      sessionId: principal.sessionId,
      ...(principal.organizationId ? { organizationId: principal.organizationId } : {}),
      ...(principal.membershipId ? { membershipId: principal.membershipId } : {}),
    });

    if (required.length > 0) {
      if (!principal.organizationId) throw AppException.tenantContextMissing();
      for (const permission of required) {
        if (!hasOrganizationWide(principal, permission)) throw AppException.forbidden();
      }
    }
    return true;
  }

  private async authenticate(token: string): Promise<AuthPrincipal> {
    const claims = await this.tokens.verifyAccessToken(token);
    if (await this.access.isSessionRevoked(claims.sid)) {
      throw AppException.unauthenticated('Session has ended');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { status: true },
    });
    if (user?.status !== 'ACTIVE') throw AppException.unauthenticated();

    if (!claims.org) {
      return {
        userId: claims.sub,
        sessionId: claims.sid,
        organizationId: null,
        membershipId: null,
        grants: new Map(),
      };
    }
    const resolved = await this.access.resolve(claims.org, claims.sub);
    if (!resolved) {
      throw AppException.forbidden('You are no longer a member of this organization');
    }
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      organizationId: claims.org,
      membershipId: resolved.membershipId,
      grants: new Map(resolved.grants),
    };
  }
}
