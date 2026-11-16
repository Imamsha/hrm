import globals from 'globals';
import { react } from '@hrm/eslint-config/react';

export default [
  { ignores: ['dist/**', '.expo/**', 'expo-env.d.ts', '*.config.js'] },
  ...react,
  {
    files: ['**/*.test.tsx', '**/*.test.ts'],
    languageOptions: { globals: { ...globals.jest } },
  },
];
