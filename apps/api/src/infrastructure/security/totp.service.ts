import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import { REDIS_CLIENT } from '../redis/redis.module.js';

const ISSUER = 'HRM Platform';
const PERIOD = 30;

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — the profile every authenticator app supports. */
@Injectable()
export class TotpService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  generateSecret(): string {
    return new Secret({ size: 20 }).base32;
  }

  otpauthUri(secret: string, accountName: string): string {
    return this.totp(secret, accountName).toString();
  }

  /**
   * Accepts the current step ±1 (clock skew) and rejects re-use of an accepted code within its
   * validity window (replay protection, per user).
   */
  async verify(secret: string, code: string, userId: string): Promise<boolean> {
    const delta = this.totp(secret, userId).validate({ token: code, window: 1 });
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / PERIOD) + delta;
    const fresh = await this.redis.set(
      `mfa:totp:used:${userId}:${String(step)}`,
      '1',
      'EX',
      PERIOD * 3,
      'NX',
    );
    return fresh === 'OK';
  }

  private totp(secret: string, label: string): TOTP {
    return new TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD,
      secret: Secret.fromBase32(secret),
    });
  }
}
