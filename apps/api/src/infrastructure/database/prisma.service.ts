import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { uuidSchema } from '@hrm/validation';
import { type Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { RequestContext } from '../../common/context/request-context.js';
import { AppException } from '../../common/http/app.exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

export type TenantTransaction = Prisma.TransactionClient;

export interface TenantTransactionOptions {
  /** Explicit tenant (background jobs). Defaults to the authenticated request's organization. */
  organizationId?: string;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

/**
 * Database access for the API, connected as the least-privileged `hrm_app` role.
 *
 * Tenant isolation contract:
 *  - Tenant data must be accessed only through `withTenant()`.
 *  - `withTenant()` opens a transaction and sets `app.organization_id` with `set_config(..., true)`
 *    (transaction-local), so the setting can never leak to another request through the pool.
 *  - PostgreSQL RLS policies read that setting; without it, tenant tables return zero rows.
 *  - The organization ID comes from trusted server-side context, never from client input.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        max: config.DATABASE_POOL_MAX,
        application_name: 'hrm-api',
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      }),
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    this.$on('warn' as never, (e: Prisma.LogEvent) => {
      this.logger.warn(e.message);
    });
    this.$on('error' as never, (e: Prisma.LogEvent) => {
      this.logger.error(e.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Runs `fn` inside a transaction bound to exactly one tenant. */
  async withTenant<T>(
    fn: (tx: TenantTransaction) => Promise<T>,
    options: TenantTransactionOptions = {},
  ): Promise<T> {
    const organizationId = options.organizationId ?? RequestContext.get()?.organizationId;
    if (!organizationId) throw AppException.tenantContextMissing();
    if (!uuidSchema.safeParse(organizationId).success) {
      throw new Error('Tenant context contains an invalid organization id');
    }

    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
        return fn(tx);
      },
      {
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
        timeout: options.timeoutMs ?? 15_000,
      },
    );
  }

  /** Lightweight connectivity probe used by health checks. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
