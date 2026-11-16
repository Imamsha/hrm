import globals from 'globals';
import tseslint from 'typescript-eslint';
import { base } from './base.js';

/** Node / NestJS services. */
export const node = tseslint.config(...base, {
  languageOptions: {
    globals: { ...globals.node },
  },
  rules: {
    // NestJS relies on classes with only decorated members (modules, DTOs).
    '@typescript-eslint/no-extraneous-class': 'off',
  },
});

export default node;
