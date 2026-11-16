import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUIDv7 (48-bit unix ms timestamp + random). Used when an id must be known before the
 * insert, e.g. a new organization whose id becomes the transaction's tenant context.
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** URL-safe organization handle derived from a display name. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : `org-${base || 'new'}`.slice(0, 48);
}

export function randomSlugSuffix(): string {
  return randomBytes(3).toString('hex');
}
