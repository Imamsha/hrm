import globals from 'globals';
import { base } from '@hrm/eslint-config/base';

export default [
  ...base,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
];
