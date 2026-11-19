import { describe, expect, it } from 'vitest';
import { KioskTokens } from './kiosk-token.js';

const tokens = new KioskTokens('test-secret-0123456789abcdef0123456789');
const claims = { organizationId: 'org-1', branchId: 'branch-1' };

describe('KioskTokens', () => {
  it('accepts the current and previous window only', () => {
    const now = 1_000_000_000_000;
    const w = KioskTokens.windowOf(now, 30);
    const token = tokens.sign({ ...claims, window: w });
    expect(tokens.verify(token, 30, now)).toEqual({ ...claims, window: w });
    expect(tokens.verify(token, 30, now + 30_000)).not.toBeNull();
    expect(tokens.verify(token, 30, now + 60_000)).toBeNull();
  });

  it('rejects tampered, foreign and malformed tokens', () => {
    const now = Date.now();
    const token = tokens.sign({ ...claims, window: KioskTokens.windowOf(now, 30) });
    const [payload, mac] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ o: 'org-2', b: 'branch-1', w: KioskTokens.windowOf(now, 30) }),
    ).toString('base64url');
    expect(tokens.verify(`${forged}.${mac}`, 30, now)).toBeNull();
    expect(new KioskTokens('another-secret-0123456789abcdef').verify(token, 30, now)).toBeNull();
    expect(tokens.verify(payload, 30, now)).toBeNull();
    expect(tokens.verify('x.y', 30, now)).toBeNull();
  });
});
