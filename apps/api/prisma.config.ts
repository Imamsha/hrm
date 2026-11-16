import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Load the monorepo root .env (if present) without adding a dotenv dependency.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Prisma CLI always connects as the schema-owning migration role.
 * The running API uses DATABASE_URL (least-privileged, RLS-enforced) via the driver adapter.
 * `generate` needs no database, so the URL is optional here.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});
