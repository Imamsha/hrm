import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // jsdom + user-event interactions are slow when turbo runs every package in parallel.
    testTimeout: 20_000,
  },
});
