import { Inject, Injectable } from '@nestjs/common';
import { OWNER_ROLE_KEY, SYSTEM_ROLES } from '@hrm/shared-types';
import { Prisma } from '../../../generated/prisma/client.js';
import { AppException } from '../../common/http/app.exception.js';
import { randomSlugSuffix, slugify, uuidv7 } from '../../common/ids.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import type { TenantTransaction } from '../../infrastructure/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface ProvisionOrganizationInput {
  name: string;
  /** Explicit slug: conflicts are reported. Omitted: derived from the name, made unique. */
  slug?: string | undefined;
  ownerUserId: string;
}

/** Thrown inside the transaction so the caller can retry with another generated slug. */
class SlugTakenError extends Error {}

/**
 * Creates a tenant: organization, system roles with their permissions, the owner membership and
 * the default subscription — atomically, inside a transaction whose tenant context is the new
 * organization's pre-generated id (so every insert passes the RLS WITH CHECK policies).
 */
@Injectable()
export class OrganizationProvisioner {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /** Runs `provision` with retries for generated slugs. `run` must open a fresh tenant transaction. */
  async provisionWithRetry<T>(
    input: ProvisionOrganizationInput,
    run: (organizationId: string, slug: string) => Promise<T>,
  ): Promise<T> {
    const base = input.slug ?? slugify(input.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug =
        input.slug || attempt === 0 ? base : `${base.slice(0, 41)}-${randomSlugSuffix()}`;
      try {
        return await run(uuidv7(), slug);
      } catch (err) {
        const isSlugConflict =
          err instanceof SlugTakenError ||
          (err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002' &&
            JSON.stringify(err.meta ?? {}).includes('slug'));
        if (!isSlugConflict) throw err;
        if (input.slug) throw AppException.conflict('That organization URL is already taken');
      }
    }
    throw AppException.conflict('Could not allocate an organization URL; try a different name');
  }

  /** Must be called inside `prisma.withTenant(..., { organizationId, userId: ownerUserId })`. */
  async provision(
    tx: TenantTransaction,
    organizationId: string,
    slug: string,
    input: ProvisionOrganizationInput,
  ): Promise<{ organizationId: string; membershipId: string }> {
    // Slug uniqueness spans tenants and is not visible under RLS; rely on the unique constraint.
    // A conflict aborts this transaction; provisionWithRetry() starts a new one.
    try {
      await tx.organization.create({ data: { id: organizationId, slug, name: input.name } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new SlugTakenError();
      throw err;
    }

    const roleIds = new Map<string, string>();
    for (const def of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          organizationId,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
        },
        select: { id: true },
      });
      roleIds.set(def.key, role.id);
      if (def.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: def.permissions.map((permissionKey) => ({
            organizationId,
            roleId: role.id,
            permissionKey,
          })),
        });
      }
    }

    const membership = await tx.membership.create({
      data: { organizationId, userId: input.ownerUserId },
      select: { id: true },
    });
    const ownerRoleId = roleIds.get(OWNER_ROLE_KEY);
    if (!ownerRoleId) throw new Error('Owner role missing from SYSTEM_ROLES');
    await tx.membershipRole.create({
      data: { organizationId, membershipId: membership.id, roleId: ownerRoleId },
    });

    const plan = await tx.subscriptionPlan.findUnique({
      where: { key: this.config.SUBSCRIPTION_DEFAULT_PLAN_KEY },
    });
    if (!plan)
      throw new Error(
        `Subscription plan "${this.config.SUBSCRIPTION_DEFAULT_PLAN_KEY}" is not seeded`,
      );
    const now = new Date();
    const trialDays = this.config.SUBSCRIPTION_TRIAL_DAYS;
    await tx.subscription.create({
      data: {
        organizationId,
        planId: plan.id,
        status: trialDays > 0 ? 'TRIALING' : 'ACTIVE',
        trialEndsAt: trialDays > 0 ? new Date(now.getTime() + trialDays * 86_400_000) : null,
        currentPeriodStart: now,
      },
    });

    await this.audit.record(
      tx,
      {
        action: 'organization.created',
        entityType: 'organization',
        entityId: organizationId,
        metadata: { slug, name: input.name, plan: plan.key },
      },
      { organizationId, actorId: input.ownerUserId },
    );
    return { organizationId, membershipId: membership.id };
  }
}
