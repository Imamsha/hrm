import { randomUUID } from 'node:crypto';
import { uuidSchema } from '@hrm/validation';
import { RequestContext } from '../../common/context/request-context.js';

/**
 * Every tenant-scoped job carries its tenant explicitly. The worker restores the request
 * context from it so `PrismaService.withTenant()` and auditing behave exactly as in HTTP requests.
 */
export interface TenantJobData {
  organizationId: string;
  /** Correlates job logs with the originating HTTP request. */
  requestId?: string;
  /** User who triggered the job, for audit attribution. */
  initiatedBy?: string;
}

/** Captures the current request's tenant for enqueueing. Throws if there is no tenant context. */
export function tenantJobContext(): TenantJobData {
  const ctx = RequestContext.get();
  if (!ctx?.organizationId) throw new Error('Cannot enqueue a tenant job without a tenant context');
  return {
    organizationId: ctx.organizationId,
    requestId: ctx.requestId,
    ...(ctx.userId ? { initiatedBy: ctx.userId } : {}),
  };
}

/** Runs a job handler inside a request context bound to the job's tenant. */
export function runInTenantJobContext<T>(data: TenantJobData, fn: () => Promise<T>): Promise<T> {
  if (!uuidSchema.safeParse(data.organizationId).success) {
    return Promise.reject(new Error('Tenant job is missing a valid organizationId'));
  }
  return RequestContext.run(
    {
      requestId: data.requestId ?? `job-${randomUUID()}`,
      organizationId: data.organizationId,
      ...(data.initiatedBy ? { userId: data.initiatedBy } : {}),
    },
    fn,
  );
}
