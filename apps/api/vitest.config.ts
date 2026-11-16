import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles tests because NestJS dependency injection needs `emitDecoratorMetadata`,
// which Vite's default (oxc) transformer does not emit. Inline projects inherit this config.
export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.int.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Suites share one database; run files sequentially for deterministic RLS assertions.
          fileParallelism: false,
        },
      },
    ],
  },
});
