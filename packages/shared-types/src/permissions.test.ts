import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, OWNER_ROLE_KEY, SYSTEM_ROLES } from './permissions.js';

describe('permission catalog', () => {
  it('uses <module>.<resource>.<action> keys without duplicates', () => {
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/);
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('system roles reference only catalog permissions and have unique keys', () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('the owner role holds every permission', () => {
    const owner = SYSTEM_ROLES.find((r) => r.key === OWNER_ROLE_KEY);
    expect([...(owner?.permissions ?? [])].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});
