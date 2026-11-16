import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../src/common/context/request-context.js';
import { PrismaService } from '../../src/infrastructure/database/prisma.service.js';
import { integrationConfig, testEnv } from './env.js';

/**
 * Proves the Phase 01 tenant-isolation foundation at the database layer:
 * RLS policies + transaction-local tenant context + least-privileged runtime role.
 */
describe('Tenant isolation (PostgreSQL RLS)', () => {
  // Owner connection used only to arrange fixtures (table owner is not subject to RLS).
  const owner = new pg.Pool({ connectionString: testEnv.migrationDatabaseUrl, max: 2 });
  // Pool of exactly ONE connection: proves tenant settings never leak between transactions.
  const prisma = new PrismaService({ ...integrationConfig(), DATABASE_POOL_MAX: 1 });
  const suffix = randomUUID().slice(0, 8);
  const orgA = { id: randomUUID(), slug: `tenant-a-${suffix}` };
  const orgB = { id: randomUUID(), slug: `tenant-b-${suffix}` };

  beforeAll(async () => {
    for (const org of [orgA, orgB]) {
      await owner.query(
        `INSERT INTO organizations (id, slug, name, updated_at) VALUES ($1, $2, $3, now())`,
        [org.id, org.slug, `Org ${org.slug}`],
      );
      await owner.query(
        `INSERT INTO audit_logs (id, organization_id, actor_type, action, entity_type)
         VALUES ($1, $2, 'SYSTEM', 'organization.created', 'organization')`,
        [randomUUID(), org.id],
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await owner.end();
  });

  it('the runtime role is not privileged and cannot bypass RLS', async () => {
    const rows = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('returns no tenant rows when no tenant context is set', async () => {
    const orgs = await prisma.organization.findMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    expect(orgs).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('withTenant exposes only the bound tenant', async () => {
    const result = await prisma.withTenant(
      async (tx) => ({
        orgs: await tx.organization.findMany({ where: { id: { in: [orgA.id, orgB.id] } } }),
        logs: await tx.auditLog.findMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } }),
      }),
      { organizationId: orgA.id },
    );
    expect(result.orgs.map((o) => o.id)).toEqual([orgA.id]);
    expect(result.logs.every((l) => l.organizationId === orgA.id)).toBe(true);
    expect(result.logs.length).toBeGreaterThan(0);
  });

  it('reads the tenant from the request context by default', async () => {
    const ids = await RequestContext.run(
      { requestId: 'it-request-0001', organizationId: orgB.id },
      () =>
        prisma.withTenant((tx) =>
          tx.organization.findMany({
            select: { id: true },
            where: { id: { in: [orgA.id, orgB.id] } },
          }),
        ),
    );
    expect(ids).toEqual([{ id: orgB.id }]);
  });

  it('refuses to run tenant work without a tenant', async () => {
    await expect(prisma.withTenant((tx) => tx.organization.findMany())).rejects.toMatchObject({
      code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('does not leak tenant context to the next transaction on a reused connection', async () => {
    await prisma.withTenant((tx) => tx.organization.count(), { organizationId: orgA.id });
    const setting = await prisma.$queryRaw<{ v: string | null }[]>`
      SELECT NULLIF(current_setting('app.organization_id', true), '') AS v`;
    expect(setting[0]?.v).toBeNull();
    expect(await prisma.organization.count({ where: { id: orgA.id } })).toBe(0);
  });

  it('blocks writing rows for another tenant (WITH CHECK)', async () => {
    await expect(
      prisma.withTenant(
        (tx) =>
          tx.auditLog.create({
            data: {
              organizationId: orgB.id,
              actorType: 'SYSTEM',
              action: 'test.cross_tenant',
              entityType: 'test',
            },
          }),
        { organizationId: orgA.id },
      ),
    ).rejects.toThrow();
  });

  it('allows writing rows for the bound tenant', async () => {
    const log = await prisma.withTenant(
      (tx) =>
        tx.auditLog.create({
          data: {
            organizationId: orgA.id,
            actorType: 'SYSTEM',
            action: 'test.same_tenant',
            entityType: 'test',
          },
        }),
      { organizationId: orgA.id },
    );
    expect(log.organizationId).toBe(orgA.id);
  });

  it('cannot update another tenant even by primary key', async () => {
    const updated = await prisma.withTenant(
      (tx) => tx.organization.updateMany({ where: { id: orgB.id }, data: { name: 'hijacked' } }),
      { organizationId: orgA.id },
    );
    expect(updated.count).toBe(0);
  });

  it('keeps concurrent tenants separate', async () => {
    const parallel = new PrismaService({ ...integrationConfig(), DATABASE_POOL_MAX: 4 });
    try {
      const run = (id: string) =>
        parallel.withTenant(
          (tx) =>
            tx.organization.findMany({
              select: { id: true },
              where: { id: { in: [orgA.id, orgB.id] } },
            }),
          { organizationId: id },
        );
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => run(i % 2 ? orgA.id : orgB.id)),
      );
      results.forEach((rows, i) => {
        expect(rows).toEqual([{ id: i % 2 ? orgA.id : orgB.id }]);
      });
    } finally {
      await parallel.$disconnect();
    }
  });

  it('audit logs are append-only even for the bound tenant', async () => {
    await expect(
      prisma.withTenant((tx) => tx.auditLog.deleteMany({ where: { organizationId: orgA.id } }), {
        organizationId: orgA.id,
      }),
    ).rejects.toThrow();
    await expect(
      owner.query(`UPDATE audit_logs SET action = 'x.y' WHERE organization_id = $1`, [orgA.id]),
    ).rejects.toThrow(/append-only/);
  });

  it('the runtime role cannot create organizations directly', async () => {
    await expect(
      prisma.withTenant(
        (tx) => tx.organization.create({ data: { slug: `rogue-${suffix}`, name: 'Rogue' } }),
        {
          organizationId: orgA.id,
        },
      ),
    ).rejects.toThrow();
  });

  it('the runtime role cannot read migration bookkeeping', async () => {
    await expect(prisma.$queryRaw`SELECT count(*) FROM _prisma_migrations`).rejects.toThrow();
  });

  it('enforces check constraints', async () => {
    await expect(
      owner.query(
        `INSERT INTO organizations (id, slug, name, updated_at) VALUES ($1, 'Bad Slug!', 'x', now())`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/organizations_slug_format_chk/);
  });
});

describe('pgvector availability', () => {
  const prisma = new PrismaService(integrationConfig());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('computes cosine distance as the runtime role', async () => {
    const rows = await prisma.$queryRaw<{ d: number }[]>`
      SELECT ('[1,0,0]'::vector <=> '[0,1,0]'::vector)::float8 AS d`;
    expect(rows[0]?.d).toBeCloseTo(1, 6);
  });
});
