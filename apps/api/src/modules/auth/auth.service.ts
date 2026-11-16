import { Inject, Injectable } from '@nestjs/common';
import type { MembershipSummary, SessionInfo } from '@hrm/shared-types';
import type { Redis } from 'ioredis';
import { Prisma } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/http/app.exception.js';
import { uuidv7 } from '../../common/ids.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { FieldEncryption } from '../../infrastructure/security/field-encryption.service.js';
import { generateOpaqueToken, sha256Hex } from '../../infrastructure/security/opaque-token.js';
import { PasswordHasher } from '../../infrastructure/security/password-hasher.service.js';
import { TokenService } from '../../infrastructure/security/token.service.js';
import { TotpService } from '../../infrastructure/security/totp.service.js';
import { type AuthPrincipal, permissionList } from '../access/principal.js';
import { MailService } from '../notifications/mail.service.js';
import { passwordResetEmail } from '../notifications/mail.templates.js';
import { OrganizationProvisioner } from '../organizations/organization-provisioner.service.js';
import { assertAcceptablePassword } from './password-policy.js';
import { SecurityEventsService } from './security-events.service.js';
import { type IssuedTokens, SessionsService } from './sessions.service.js';

const INVALID_CREDENTIALS = 'Invalid email or password';
const MFA_MAX_ATTEMPTS = 5;

export type LoginOutcome =
  { kind: 'tokens'; tokens: IssuedTokens } | { kind: 'mfa'; mfaToken: string };

export const mfaSecretContext = (userId: string) => `users.mfa_secret:${userId}`;

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly encryption: FieldEncryption,
    private readonly sessions: SessionsService,
    private readonly events: SecurityEventsService,
    private readonly mail: MailService,
    private readonly provisioner: OrganizationProvisioner,
  ) {}

  // ------------------------------------------------------------------ registration

  async register(input: {
    organizationName: string;
    organizationSlug?: string | undefined;
    fullName: string;
    email: string;
    password: string;
  }): Promise<IssuedTokens> {
    assertAcceptablePassword(input.password, { email: input.email, fullName: input.fullName });
    if (
      await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
    ) {
      throw AppException.conflict(
        'An account with this email already exists. Sign in to create another organization.',
      );
    }
    const passwordHash = await this.hasher.hash(input.password);

    const { userId, organizationId } = await this.provisioner.provisionWithRetry(
      { name: input.organizationName, slug: input.organizationSlug, ownerUserId: '' },
      async (orgId, slug) => {
        const newUserId = uuidv7();
        return this.prisma.withTenant(
          async (tx) => {
            try {
              await tx.user.create({
                data: { id: newUserId, email: input.email, fullName: input.fullName, passwordHash },
              });
            } catch (err) {
              if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw AppException.conflict('An account with this email already exists');
              }
              throw err;
            }
            await this.provisioner.provision(tx, orgId, slug, {
              name: input.organizationName,
              ownerUserId: newUserId,
            });
            return { userId: newUserId, organizationId: orgId };
          },
          { organizationId: orgId, userId: newUserId },
        );
      },
    );

    await this.events.record({ type: 'REGISTERED', userId, metadata: { organizationId } });
    const tokens = await this.sessions.create(userId, organizationId);
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return tokens;
  }

  // ------------------------------------------------------------------ login

  async login(input: {
    email: string;
    password: string;
    organizationId?: string | undefined;
  }): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await this.hasher.verifyDummy(input.password);
      await this.events.record({
        type: 'LOGIN_FAILED',
        email: input.email,
        metadata: { reason: 'unknown_email' },
      });
      throw AppException.unauthenticated(INVALID_CREDENTIALS);
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      // Same response as a wrong password: lockout state is not disclosed to the caller.
      await this.hasher.verifyDummy(input.password);
      await this.events.record({
        type: 'LOGIN_FAILED',
        userId: user.id,
        metadata: { reason: 'locked' },
      });
      throw AppException.unauthenticated(INVALID_CREDENTIALS);
    }

    const valid = await this.hasher.verify(user.passwordHash, input.password);
    if (!valid || user.status !== 'ACTIVE') {
      if (!valid) await this.registerFailedAttempt(user.id, user.failedLoginCount);
      await this.events.record({
        type: 'LOGIN_FAILED',
        userId: user.id,
        metadata: { reason: valid ? 'disabled' : 'bad_password' },
      });
      throw AppException.unauthenticated(INVALID_CREDENTIALS);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    if (user.mfaEnabled) {
      const mfaToken = await this.tokens.signMfaToken({ sub: user.id });
      if (input.organizationId) {
        await this.redis.set(
          `mfa:pref-org:${sha256Hex(mfaToken)}`,
          input.organizationId,
          'EX',
          900,
        );
      }
      return { kind: 'mfa', mfaToken };
    }
    return { kind: 'tokens', tokens: await this.completeLogin(user.id, input.organizationId) };
  }

  private async registerFailedAttempt(userId: string, previousFailures: number): Promise<void> {
    const failures = previousFailures + 1;
    if (failures >= this.config.AUTH_LOCKOUT_THRESHOLD) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: 0,
          lockedUntil: new Date(Date.now() + this.config.AUTH_LOCKOUT_MINUTES * 60_000),
        },
      });
      await this.events.record({
        type: 'LOGIN_LOCKED',
        userId,
        metadata: { minutes: this.config.AUTH_LOCKOUT_MINUTES },
      });
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: failures },
      });
    }
  }

  private async completeLogin(
    userId: string,
    preferredOrganizationId?: string | null,
  ): Promise<IssuedTokens> {
    const organizationId = await this.sessions.resolveActiveOrganization(
      userId,
      preferredOrganizationId,
    );
    const tokens = await this.sessions.create(userId, organizationId);
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.events.record({ type: 'LOGIN_SUCCEEDED', userId, sessionId: tokens.sessionId });
    return tokens;
  }

  async verifyMfa(input: {
    mfaToken: string;
    code?: string | undefined;
    recoveryCode?: string | undefined;
  }): Promise<IssuedTokens> {
    const claims = await this.tokens.verifyMfaToken(input.mfaToken);
    const attemptsKey = `mfa:attempts:${claims.jti}`;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1)
      await this.redis.expire(attemptsKey, this.config.AUTH_MFA_TOKEN_TTL_SECONDS);
    if (attempts > MFA_MAX_ATTEMPTS)
      throw AppException.unauthenticated('Too many attempts. Sign in again.');

    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'ACTIVE' || !user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw AppException.unauthenticated();
    }

    let ok = false;
    if (input.code) {
      const secret = this.encryption.decrypt(user.mfaSecretEncrypted, mfaSecretContext(user.id));
      ok = await this.totp.verify(secret, input.code, user.id);
    } else if (input.recoveryCode) {
      const hash = sha256Hex(input.recoveryCode);
      if (user.mfaRecoveryCodeHashes.includes(hash)) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { mfaRecoveryCodeHashes: user.mfaRecoveryCodeHashes.filter((h) => h !== hash) },
        });
        await this.events.record({
          type: 'MFA_RECOVERY_CODE_USED',
          userId: user.id,
          metadata: { remaining: user.mfaRecoveryCodeHashes.length - 1 },
        });
        ok = true;
      }
    }
    if (!ok) {
      await this.events.record({ type: 'MFA_CHALLENGE_FAILED', userId: user.id });
      throw AppException.unauthenticated('Invalid verification code');
    }

    // One successful use per MFA token.
    const fresh = await this.redis.set(
      `mfa:used:${claims.jti}`,
      '1',
      'EX',
      this.config.AUTH_MFA_TOKEN_TTL_SECONDS,
      'NX',
    );
    if (fresh !== 'OK') throw AppException.unauthenticated('Sign in again');
    const prefKey = `mfa:pref-org:${sha256Hex(input.mfaToken)}`;
    const preferred = await this.redis.get(prefKey);
    await this.redis.del(prefKey, attemptsKey);
    return this.completeLogin(user.id, preferred);
  }

  // ------------------------------------------------------------------ session-level

  async logout(principal: AuthPrincipal): Promise<void> {
    await this.sessions.revoke([principal.sessionId], 'logout');
    await this.events.record({
      type: 'LOGOUT',
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }

  async logoutAll(principal: AuthPrincipal): Promise<void> {
    await this.sessions.revokeAllForUser(principal.userId, 'logout_all');
    await this.events.record({
      type: 'LOGOUT_ALL',
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }

  async switchOrganization(principal: AuthPrincipal, organizationId: string) {
    const resolved = await this.sessions.resolveActiveOrganization(
      principal.userId,
      organizationId,
    );
    if (resolved !== organizationId)
      throw AppException.forbidden('You are not a member of that organization');
    await this.sessions.setActiveOrganization(principal.sessionId, organizationId);
    await this.events.record({
      type: 'ORGANIZATION_SWITCHED',
      userId: principal.userId,
      sessionId: principal.sessionId,
      metadata: { organizationId },
    });
    return this.sessions.reissueAccessToken(principal.userId, principal.sessionId, organizationId);
  }

  async me(principal: AuthPrincipal): Promise<SessionInfo> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    const memberships = await this.prisma.withUser(principal.userId, (tx) =>
      tx.membership.findMany({
        where: { userId: principal.userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
        orderBy: { joinedAt: 'asc' },
        select: { id: true, organization: { select: { id: true, name: true, slug: true } } },
      }),
    );
    // Role names are tenant data: read them under the active organization's context only.
    const activeRoles = principal.organizationId
      ? await this.prisma.withTenant((tx) =>
          tx.membershipRole.findMany({
            where: { membership: { userId: principal.userId } },
            select: { role: { select: { id: true, key: true, name: true } } },
          }),
        )
      : [];
    const summaries: MembershipSummary[] = memberships.map((m) => ({
      membershipId: m.id,
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      roles: m.organization.id === principal.organizationId ? activeRoles.map((r) => r.role) : [],
    }));
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        mfaEnabled: user.mfaEnabled,
        emailVerified: user.emailVerifiedAt !== null,
      },
      sessionId: principal.sessionId,
      activeOrganization:
        summaries.find((s) => s.organizationId === principal.organizationId) ?? null,
      memberships: summaries,
      permissions: permissionList(principal),
    };
  }

  // ------------------------------------------------------------------ passwords

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') {
      await this.events.record({
        type: 'PASSWORD_RESET_REQUESTED',
        email,
        metadata: { delivered: false },
      });
      return; // identical response for unknown accounts
    }
    const token = generateOpaqueToken();
    const ttl = this.config.AUTH_PASSWORD_RESET_TTL_MINUTES;
    await this.prisma.$transaction([
      // Only the newest link is valid.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + ttl * 60_000),
        },
      }),
    ]);
    const link = `${this.config.APP_WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: user.email,
      ...passwordResetEmail({ fullName: user.fullName, link, ttlMinutes: ttl }),
      ...(RequestContext.requestId() ? { requestId: RequestContext.requestId() } : {}),
    });
    await this.events.record({
      type: 'PASSWORD_RESET_REQUESTED',
      userId: user.id,
      metadata: { delivered: true },
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt <= new Date() ||
      record.user.status !== 'ACTIVE'
    ) {
      throw AppException.badRequest('This reset link is invalid or has expired', 'token');
    }
    assertAcceptablePassword(password, {
      email: record.user.email,
      fullName: record.user.fullName,
    });
    const passwordHash = await this.hasher.hash(password);
    const consumed = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw AppException.badRequest('This reset link is invalid or has expired', 'token');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await this.sessions.revokeAllForUser(record.userId, 'password_reset');
    await this.events.record({ type: 'PASSWORD_RESET_COMPLETED', userId: record.userId });
  }

  async changePassword(
    principal: AuthPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
      throw AppException.badRequest('Current password is incorrect', 'currentPassword');
    }
    assertAcceptablePassword(newPassword, { email: user.email, fullName: user.fullName });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.hasher.hash(newPassword), passwordChangedAt: new Date() },
    });
    // Other devices must sign in again; the current session continues.
    await this.sessions.revokeAllForUser(user.id, 'password_changed', principal.sessionId);
    await this.events.record({
      type: 'PASSWORD_CHANGED',
      userId: user.id,
      sessionId: principal.sessionId,
    });
  }
}
