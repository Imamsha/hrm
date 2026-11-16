import { react } from '@hrm/eslint-config/react';

export default [
  ...react,
  {
    // Library package: components intentionally co-export their variant helpers (shadcn pattern).
    // Fast Refresh boundaries only matter in application code.
    rules: { 'react-refresh/only-export-components': 'off' },
  },
];
