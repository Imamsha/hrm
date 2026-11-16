import { Injectable } from '@nestjs/common';
import type { OrganizationDetails, SubscriptionDetails } from '@hrm/shared-types';
import type { UpdateOrganizationInput } from '@hrm/validation';
import { AppException } from '../../common/http/app.exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { SessionsService } from '../auth/sessions.service.js';
import { OrganizationProvisioner } from './organization-provisioner.service.js';

type OrgRow = Awaited<ReturnType<PrismaService['organization']['findFirstOrThrow']>>;

function toDetails(o: OrgRow): OrganizationDetails {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    legalName: o.legalName,
    status: o.status,
    defaultTimezone: o.defaultTimezone,
    defaultCurrency: o.defaultCurrency,
    defaultLocale: o.defaultLocale,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioner: OrganizationProvisioner,
    private readonly sessions: SessionsService,
  ) {}

  getCurrent(): Promise<OrganizationDetails> {
    return this.prisma.withTenant(async (tx) =>
      toDetails(await tx.organization.findFirstOrThrow()),
    );
  }

  updateCurrent(input: UpdateOrganizationInput): Promise<OrganizationDetails> {
    return this.prisma.withTenant(async (tx) => {
      const before = await tx.organization.findFirstOrThrow();
      const data = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName ?? null } : {}),
        ...(input.defaultTimezone !== undefined ? { defaultTimezone: input.defaultTimezone } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.defaultLocale !== undefined ? { defaultLocale: input.defaultLocale } : {}),
      };
      const after = await tx.organization.update({ where: { id: before.id }, data });
      const changes = diffChanges(before, data);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          action: 'organization.updated',
          entityType: 'organization',
          entityId: before.id,
          changes,
        });
      }
      return toDetails(after);
    });
  }

  /** An authenticated user creates an additional organization and becomes its owner. */
  async create(principal: AuthPrincipal, input: { name: string; slug?: string | undefined }) {
    const result = await this.provisioner.provisionWithRetry(
      { name: input.name, slug: input.slug, ownerUserId: principal.userId },
      (organizationId, slug) =>
        this.prisma.withTenant(
          (tx) =>
            this.provisioner.provision(tx, organizationId, slug, {
              name: input.name,
              ownerUserId: principal.userId,
            }),
          { organizationId, userId: principal.userId },
        ),
    );
    await this.sessions.setActiveOrganization(principal.sessionId, result.organizationId);
    const tokens = await this.sessions.reissueAccessToken(
      principal.userId,
      principal.sessionId,
      result.organizationId,
    );
    const organization = await this.prisma.withTenant(
      async (tx) => toDetails(await tx.organization.findFirstOrThrow()),
      { organizationId: result.organizationId, userId: principal.userId },
    );
    return { organization, ...tokens };
  }

  getSubscription(): Promise<SubscriptionDetails> {
    return this.prisma.withTenant(async (tx) => {
      const sub = await tx.subscription.findFirst({ include: { plan: true } });
      if (!sub) throw AppException.notFound('Subscription');
      return {
        planKey: sub.plan.key,
        planName: sub.plan.name,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        currentPeriodStart: sub.currentPeriodStart.toISOString(),
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        limits: sub.plan.limits as Record<string, number | null>,
      };
    });
  }
}
