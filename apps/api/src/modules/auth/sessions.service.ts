import { Inject, Injectable } from '@nestjs/common';
import type { AuthTokens, SessionListItem } from '@hrm/shared-types';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/http/app.exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { generateOpaqueToken, sha256Hex } from '../../infrastructure/security/opaque-token.js';
import { TokenService } from '../../infrastructure/security/token.service.js';
import { AccessService } from '../access/access.service.js';
import { SecurityEventsService } from './security-events.service.js';

/** Tokens plus the plaintext refresh token (only ever returned to the caller, never stored). */
export interface IssuedTokens extends AuthTokens {
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

/**
 * Session lifecycle: creation, refresh-token rotation with reuse detection, revocation.
 * A session is one sign-in on one device; each refresh replaces the refresh token. Presenting an
 * already-used refresh token revokes the whole session (token theft signal, RFC 6819 §5.2.2.3).
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly events: SecurityEventsService,
  ) {}

  /** Picks the organization to activate: requested (if a member), else the earliest active membership. */
  async resolveActiveOrganization(
    userId: string,
    preferred?: string | null,
  ): Promise<string | null> {
    return this.prisma.withUser(userId, async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
        orderBy: { joinedAt: 'asc' },
        select: { organizationId: true },
      });
      if (preferred && memberships.some((m) => m.organizationId === preferred)) return preferred;
      return memberships[0]?.organizationId ?? null;
    });
  }

  async create(userId: string, activeOrganizationId: string | null): Promise<IssuedTokens> {
    const ctx = RequestContext.get();
    const expiresAt = new Date(Date.now() + this.config.AUTH_SESSION_TTL_DAYS * 86_400_000);
    const refreshToken = generateOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        activeOrganizationId,
        userAgent: ctx?.userAgent ?? null,
        ipAddress: ctx?.ipAddress ?? null,
        expiresAt,
        refreshTokens: { create: { tokenHash: sha256Hex(refreshToken), expiresAt } },
      },
      select: { id: true },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      sid: session.id,
      ...(activeOrganizationId ? { org: activeOrganizationId } : {}),
    });
    return {
      accessToken,
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken,
      refreshExpiresAt: expiresAt,
      sessionId: session.id,
    };
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const now = new Date();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
      include: { session: { include: { user: { select: { status: true } } } } },
    });
    if (!record) throw AppException.unauthenticated('Invalid refresh token');
    const { session } = record;

    if (record.usedAt) {
      await this.revoke([session.id], 'token_reuse');
      await this.events.record({
        type: 'TOKEN_REUSE_DETECTED',
        userId: session.userId,
        sessionId: session.id,
      });
      throw AppException.unauthenticated('Invalid refresh token');
    }
    if (
      session.revokedAt ||
      session.expiresAt <= now ||
      record.expiresAt <= now ||
      session.user.status !== 'ACTIVE'
    ) {
      throw AppException.unauthenticated('Session has ended');
    }

    // Atomically consume the token; a concurrent second use loses the race and counts as reuse.
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) {
      await this.revoke([session.id], 'token_reuse');
      await this.events.record({
        type: 'TOKEN_REUSE_DETECTED',
        userId: session.userId,
        sessionId: session.id,
      });
      throw AppException.unauthenticated('Invalid refresh token');
    }

    // The active organization is re-checked: membership may have been removed since sign-in.
    const activeOrganizationId = await this.resolveActiveOrganization(
      session.userId,
      session.activeOrganizationId,
    );
    const next = generateOpaqueToken();
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        lastUsedAt: now,
        activeOrganizationId,
        refreshTokens: { create: { tokenHash: sha256Hex(next), expiresAt: session.expiresAt } },
      },
    });
    const accessToken = await this.tokens.signAccessToken({
      sub: session.userId,
      sid: session.id,
      ...(activeOrganizationId ? { org: activeOrganizationId } : {}),
    });
    return {
      accessToken,
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken: next,
      refreshExpiresAt: session.expiresAt,
      sessionId: session.id,
    };
  }

  /** Re-issues an access token for an existing session (e.g. after switching organization). */
  async reissueAccessToken(
    userId: string,
    sessionId: string,
    organizationId: string | null,
  ): Promise<AuthTokens> {
    const accessToken = await this.tokens.signAccessToken({
      sub: userId,
      sid: sessionId,
      ...(organizationId ? { org: organizationId } : {}),
    });
    return { accessToken, expiresIn: this.tokens.accessTokenTtlSeconds };
  }

  async setActiveOrganization(sessionId: string, organizationId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { activeOrganizationId: organizationId },
    });
  }

  async revoke(sessionIds: string[], reason: string): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.prisma.session.updateMany({
      where: { id: { in: sessionIds }, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    await this.access.markSessionsRevoked(sessionIds, this.tokens.accessTokenTtlSeconds);
  }

  /** Revokes every active session of a user, optionally keeping one (e.g. the current device). */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true },
    });
    await this.revoke(
      sessions.map((s) => s.id),
      reason,
    );
  }

  async listForUser(userId: string, currentSessionId: string): Promise<SessionListItem[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, revokedAt: null },
    });
    if (!session) throw AppException.notFound('Session');
    await this.revoke([session.id], 'user_revoked');
    await this.events.record({ type: 'SESSION_REVOKED', userId, sessionId });
  }
}
