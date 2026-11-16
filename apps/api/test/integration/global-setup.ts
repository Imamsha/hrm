import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnv } from './env.js';

/**
 * Applies all migrations to the isolated test database before any suite runs.
 * This doubles as the "migrations apply cleanly" verification in CI.
 */
export default function setup(): void {
  const cwd = fileURLToPath(new URL('../..', import.meta.url));
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, MIGRATION_DATABASE_URL: testEnv.migrationDatabaseUrl },
  });
}
