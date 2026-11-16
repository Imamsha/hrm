import 'reflect-metadata';
import { createApp, DOCS_PATH } from './bootstrap.js';
import { loadConfig } from './config/env.schema.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.API_PORT);
  const url = config.API_PUBLIC_URL;
  process.stdout.write(
    `HRM API listening on port ${config.API_PORT} (${url}/api/v1)${config.SWAGGER_ENABLED ? ` - docs ${url}/${DOCS_PATH}` : ''}\n`,
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: failed to start HRM API\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
