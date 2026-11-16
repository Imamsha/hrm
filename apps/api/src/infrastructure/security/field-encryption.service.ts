import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

const VERSION = 'v1';

/**
 * AES-256-GCM encryption for individual sensitive fields (MFA secrets now; bank/tax data later).
 * Format: `v1:<iv>:<authTag>:<ciphertext>` (base64url). The version prefix allows key rotation.
 * `context` is bound as additional authenticated data so a value cannot be moved between
 * rows/columns (e.g. pass `users.mfa_secret:<userId>`).
 */
@Injectable()
export class FieldEncryption {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string, context: string): string {
    const [version, iv, tag, ciphertext] = payload.split(':');
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
      throw new Error('Unsupported encrypted payload');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
