import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Rotating QR clock-in tokens. A kiosk screen shows a QR code for its branch that changes every
 * `rotationSeconds`; scanning it proves presence near the kiosk at that moment. Tokens are
 * HMAC-signed (key derived from the server secret, never shared with clients) and accepted for
 * the current and the previous window only, so a photographed code expires within two rotations.
 */
export interface KioskClaims {
  organizationId: string;
  branchId: string;
  window: number;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export class KioskTokens {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`hrm:attendance-kiosk:v1:${secret}`).digest();
  }

  static windowOf(now: number, rotationSeconds: number): number {
    return Math.floor(now / 1000 / rotationSeconds);
  }

  sign(claims: KioskClaims): string {
    const payload = b64(
      JSON.stringify({ o: claims.organizationId, b: claims.branchId, w: claims.window }),
    );
    return `${payload}.${this.mac(payload)}`;
  }

  /** Returns the claims when the signature is valid and the window is current or previous. */
  verify(token: string, rotationSeconds: number, now = Date.now()): KioskClaims | null {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    let parsed: { o?: unknown; b?: unknown; w?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof parsed;
    } catch {
      return null;
    }
    if (
      typeof parsed.o !== 'string' ||
      typeof parsed.b !== 'string' ||
      typeof parsed.w !== 'number'
    )
      return null;
    const current = KioskTokens.windowOf(now, rotationSeconds);
    if (parsed.w !== current && parsed.w !== current - 1) return null;
    return { organizationId: parsed.o, branchId: parsed.b, window: parsed.w };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
