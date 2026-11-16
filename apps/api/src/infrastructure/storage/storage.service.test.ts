import { describe, expect, it } from 'vitest';
import { StorageService } from './storage.service.js';

const org = '0195f1d2-7c3a-7b8e-9a41-1c2d3e4f5a6b';

describe('StorageService.tenantKey', () => {
  it('prefixes keys with the organization', () => {
    expect(StorageService.tenantKey(org, 'employees', 'abc.pdf')).toBe(
      `org/${org}/employees/abc.pdf`,
    );
  });

  it.each(['..', '.', '', 'a/b', 'a\\b', 'x\u0000y'])('rejects unsafe segment %j', (seg) => {
    expect(() => StorageService.tenantKey(org, seg)).toThrow(/Invalid storage key segment/);
  });

  it('rejects a non-UUID organization', () => {
    expect(() => StorageService.tenantKey('../other-org', 'f')).toThrow(/Invalid organization id/);
  });

  it('requires at least one segment', () => {
    expect(() => StorageService.tenantKey(org)).toThrow(/At least one/);
  });
});
