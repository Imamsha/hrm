import { describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context.js';
import { bullConnectionFromUrl } from './redis-connection.js';
import { runInTenantJobContext, tenantJobContext } from './tenant-job.js';

const org = '0195f1d2-7c3a-7b8e-9a41-1c2d3e4f5a6b';

describe('bullConnectionFromUrl', () => {
  it('parses credentials, port and db', () => {
    expect(bullConnectionFromUrl('redis://:p%40ss@cache.local:6380/2')).toMatchObject({
      host: 'cache.local',
      port: 6380,
      password: 'p@ss',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });

  it('enables TLS for rediss://', () => {
    expect(bullConnectionFromUrl('rediss://h:6379').tls).toEqual({});
  });
});

describe('tenant job context', () => {
  it('captures the tenant from the current request', () => {
    const data = RequestContext.run(
      { requestId: 'req-12345678', organizationId: org, userId: 'u1' },
      () => tenantJobContext(),
    );
    expect(data).toEqual({ organizationId: org, requestId: 'req-12345678', initiatedBy: 'u1' });
  });

  it('refuses to enqueue without a tenant', () => {
    expect(() =>
      RequestContext.run({ requestId: 'req-12345678' }, () => tenantJobContext()),
    ).toThrow();
  });

  it('restores the tenant inside the worker', async () => {
    const seen = await runInTenantJobContext({ organizationId: org }, () =>
      Promise.resolve(RequestContext.get()?.organizationId),
    );
    expect(seen).toBe(org);
  });

  it('rejects jobs with an invalid tenant id', async () => {
    await expect(
      runInTenantJobContext({ organizationId: 'nope' }, () => Promise.resolve(1)),
    ).rejects.toThrow(/organizationId/);
  });
});
