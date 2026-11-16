// Verifies every docker-compose service actually published its host port.
// Docker Desktop can start a container WITHOUT its port mapping when another container already
// holds that host port; clients then silently talk to the other project's service.
import { execFileSync } from 'node:child_process';

const expected = [
  ['postgres', 5432],
  ['redis', 6379],
  ['storage', 9000],
  ['mailpit', 1025],
];

let failed = false;
for (const [service, containerPort] of expected) {
  let mapping = '';
  try {
    mapping = execFileSync('docker', ['compose', 'port', service, String(containerPort)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    mapping = '';
  }
  const port = Number(mapping.split(':').pop());
  if (!port) {
    failed = true;
    console.error(
      `✗ ${service}: container port ${String(containerPort)} is not published. Another process or ` +
        `container probably holds the host port — change it in .env (see .env.example) and rerun.`,
    );
  } else {
    console.log(`✓ ${service}: localhost:${String(port)}`);
  }
}
process.exit(failed ? 1 : 0);
