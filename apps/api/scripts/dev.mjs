// Development runner: incremental `tsc --watch` + `node --watch` on the compiled output.
// tsc (not esbuild/tsx) is required because NestJS DI depends on emitted decorator metadata.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const tsc = ['exec', 'tsc', '-p', 'tsconfig.build.json'];
const shell = process.platform === 'win32';

const initial = spawnSync('pnpm', tsc, { cwd, stdio: 'inherit', shell });
if (initial.status !== 0) process.exit(initial.status ?? 1);

const children = [
  spawn('pnpm', [...tsc, '--watch', '--preserveWatchOutput'], { cwd, stdio: 'inherit', shell }),
  spawn(
    process.execPath,
    ['--enable-source-maps', '--env-file-if-exists=../../.env', '--watch', 'dist/src/main.js'],
    { cwd, stdio: 'inherit' },
  ),
];

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop());
