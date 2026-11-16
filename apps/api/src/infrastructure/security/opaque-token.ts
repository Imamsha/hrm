import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit URL-safe random token (refresh tokens, reset links, invitations). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hex digests; high-entropy tokens need no salt. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** One-time MFA recovery codes formatted `xxxxx-xxxxx` (unambiguous characters only). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join(
      '',
    );
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}
