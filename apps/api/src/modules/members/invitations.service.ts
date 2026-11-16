import { Inject, Injectable } from '@nestjs/common';
import type { InvitationItem, InvitationPreview } from '@hrm/shared-types';
import { Prisma } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/http/app.exception.js';
import { uuidv7 } from '../../common/ids.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { generateOpaqueToken, sha256Hex } from '../../infrastructure/security/opaque-token.js';
import { PasswordHasher } from '../../infrastructure/security/password-hasher.service.js';
import { AccessService } from '../access/access.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { assertAcceptablePassword } from '../auth/password-policy.js';
import { SecurityEventsService } from '../auth/security-events.service.js';
import { type IssuedTokens, SessionsService } from '../auth/sessions.service.js';
import { MailService } from '../notifications/mail.service.js';
import { invitationEmail } from '../notifications/mail.templates.js';
import { assertCanGrantRoles, loadRoles } from './member-rules.js';

const INVALID_INVITATION = 'This invitation is invalid, already used or has expired';

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly mail: MailService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionsService,
    private readonly events: SecurityEventsService,
  ) {}

  private async toItems(
    tx: TenantTransaction,
    rows: {
      id: string;
      email: string;
      fullName: string | null;
      status: InvitationItem['status'];
      roleIds: string[];
      expiresAt: Date;
      createdAt: Date;
    }[],
  ): Promise<InvitationItem[]> {
    const roleIds = [...new Set(rows.flatMap((r) => r.roleIds))];
    const roles = roleIds.length
      ? await tx.role.findMany({
          where: { id: { in: roleIds } },
          select: { id: true, key: true, name: true },
        })
      : [];
    const byId = new Map(roles.map((r) => [r.id, r]));
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      status: r.status,
      roles: r.roleIds
        .map((id) => byId.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async create(
    principal: AuthPrincipal,
    input: { email: string; fullName?: string | undefined; roleIds: string[] },
  ): Promise<InvitationItem> {
    const token = generateOpaqueToken();
    const ttlDays = this.config.AUTH_INVITATION_TTL_DAYS;
    const { item, organizationName, inviterName } = await this.prisma.withTenant(async (tx) => {
      const roles = await loadRoles(tx, input.roleIds);
      await assertCanGrantRoles(tx, principal.membershipId ?? '', roles);
      const alreadyMember = await tx.membership.count({ where: { user: { email: input.email } } });
      if (alreadyMember > 0)
        throw AppException.conflict('This person is already a member of the organization');
      let invitation;
      try {
        invitation = await tx.invitation.create({
          data: {
            organizationId: principal.organizationId ?? '',
            email: input.email,
            fullName: input.fullName ?? null,
            roleIds: roles.map((r) => r.id),
            tokenHash: sha256Hex(token),
            invitedByUserId: principal.userId,
            expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw AppException.conflict('A pending invitation already exists for this e-mail');
        }
        throw err;
      }
      await this.audit.record(tx, {
        action: 'invitation.created',
        entityType: 'invitation',
        entityId: invitation.id,
        metadata: { email: input.email, roles: roles.map((r) => r.key) },
      });
      const org = await tx.organization.findFirstOrThrow({ select: { name: true } });
      const inviter = await tx.user.findUniqueOrThrow({
        where: { id: principal.userId },
        select: { fullName: true },
      });
      const [item] = await this.toItems(tx, [invitation]);
      if (!item) throw new Error('Invitation mapping failed');
      return { item, organizationName: org.name, inviterName: inviter.fullName };
    });

    const link = `${this.config.APP_WEB_URL}/accept-invitation?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: input.email,
      ...invitationEmail({ organizationName, inviterName, link, ttlDays }),
      ...(RequestContext.requestId() ? { requestId: RequestContext.requestId() } : {}),
    });
    return item;
  }

  listPending(): Promise<InvitationItem[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.invitation.findMany({
        where: { status: 'PENDING', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      return this.toItems(tx, rows);
    });
  }

  async revoke(invitationId: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: invitationId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      if (updated.count !== 1) throw AppException.notFound('Pending invitation');
      await this.audit.record(tx, {
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: invitationId,
      });
    });
  }

  /** Resolves only the tenant of a token (SECURITY DEFINER), so later access stays under RLS. */
  private async tenantOf(token: string): Promise<{ organizationId: string; tokenHash: string }> {
    const tokenHash = sha256Hex(token);
    const rows = await this.prisma.$queryRaw<
      { org: string | null }[]
    >`SELECT app.invitation_tenant(${tokenHash}) AS org`;
    const organizationId = rows[0]?.org;
    if (!organizationId) throw AppException.badRequest(INVALID_INVITATION, 'token');
    return { organizationId, tokenHash };
  }

  async preview(token: string): Promise<InvitationPreview> {
    const { organizationId, tokenHash } = await this.tenantOf(token);
    return this.prisma.withTenant(
      async (tx) => {
        const inv = await tx.invitation.findFirst({
          where: { tokenHash, status: 'PENDING', expiresAt: { gt: new Date() } },
        });
        if (!inv) throw AppException.badRequest(INVALID_INVITATION, 'token');
        const org = await tx.organization.findFirstOrThrow({ select: { name: true } });
        const accountExists = (await tx.user.count({ where: { email: inv.email } })) > 0;
        return {
          organizationName: org.name,
          email: inv.email,
          fullName: inv.fullName,
          accountExists,
          expiresAt: inv.expiresAt.toISOString(),
        };
      },
      { organizationId },
    );
  }

  /**
   * New people set their name and password here; existing accounts must be signed in as the
   * invited e-mail (prevents someone holding a forwarded link from joining as another user).
   */
  async accept(
    input: { token: string; fullName?: string | undefined; password?: string | undefined },
    principal: AuthPrincipal | undefined,
  ): Promise<{ tokens: IssuedTokens | null; organizationId: string }> {
    const { organizationId, tokenHash } = await this.tenantOf(input.token);
    const existing = await this.prisma.withTenant(
      async (tx) => {
        const inv = await tx.invitation.findFirst({
          where: { tokenHash, status: 'PENDING', expiresAt: { gt: new Date() } },
        });
        if (!inv) throw AppException.badRequest(INVALID_INVITATION, 'token');
        return { inv, user: await tx.user.findUnique({ where: { email: inv.email } }) };
      },
      { organizationId },
    );

    let userId: string;
    let passwordHash: string | null = null;
    if (existing.user) {
      if (principal?.userId !== existing.user.id) {
        throw AppException.unauthenticated(
          `Sign in as ${existing.inv.email} to accept this invitation`,
        );
      }
      userId = existing.user.id;
    } else {
      if (!input.fullName || !input.password) {
        throw AppException.badRequest('Enter your name and choose a password', 'password');
      }
      assertAcceptablePassword(input.password, {
        email: existing.inv.email,
        fullName: input.fullName,
      });
      passwordHash = await this.hasher.hash(input.password);
      userId = uuidv7();
    }

    await this.prisma.withTenant(
      async (tx) => {
        const consumed = await tx.invitation.updateMany({
          where: { id: existing.inv.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
        if (consumed.count !== 1) throw AppException.badRequest(INVALID_INVITATION, 'token');
        if (passwordHash) {
          // Following the e-mailed link proves control of the address.
          await tx.user.create({
            data: {
              id: userId,
              email: existing.inv.email,
              fullName: input.fullName ?? '',
              passwordHash,
              emailVerifiedAt: new Date(),
            },
          });
        }
        const roles = await tx.role.findMany({
          where: { id: { in: existing.inv.roleIds } },
          select: { id: true, key: true },
        });
        if (roles.length === 0)
          throw AppException.conflict('The roles in this invitation no longer exist');
        const membership = await tx.membership.create({
          data: { organizationId, userId },
          select: { id: true },
        });
        await tx.membershipRole.createMany({
          data: roles.map((r) => ({ organizationId, membershipId: membership.id, roleId: r.id })),
        });
        await this.audit.record(
          tx,
          {
            action: 'invitation.accepted',
            entityType: 'membership',
            entityId: membership.id,
            metadata: { invitationId: existing.inv.id, roles: roles.map((r) => r.key) },
          },
          { organizationId, actorId: userId },
        );
      },
      { organizationId, userId },
    );
    await this.access.invalidateOrganization(organizationId);

    if (passwordHash) {
      await this.events.record({
        type: 'REGISTERED',
        userId,
        metadata: { organizationId, via: 'invitation' },
      });
      const tokens = await this.sessions.create(userId, organizationId);
      await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
      return { tokens, organizationId };
    }
    return { tokens: null, organizationId };
  }
}
