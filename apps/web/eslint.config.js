import { react } from '@hrm/eslint-config/react';

export default [
  { ignores: ['dist/**', 'playwright-report/**', 'test-results/**'] },
  ...react,
  {
    files: ['**/*.test.tsx', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
