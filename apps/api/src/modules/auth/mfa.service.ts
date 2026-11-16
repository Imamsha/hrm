import { Injectable } from '@nestjs/common';
import type { MfaEnabledResult, MfaSetup } from '@hrm/shared-types';
import { AppException } from '../../common/http/app.exception.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { FieldEncryption } from '../../infrastructure/security/field-encryption.service.js';
import { generateRecoveryCodes, sha256Hex } from '../../infrastructure/security/opaque-token.js';
import { PasswordHasher } from '../../infrastructure/security/password-hasher.service.js';
import { TotpService } from '../../infrastructure/security/totp.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { mfaSecretContext } from './auth.service.js';
import { SecurityEventsService } from './security-events.service.js';

/** TOTP enrolment: setup (pending secret) → enable (prove possession) → recovery codes. */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly encryption: FieldEncryption,
    private readonly hasher: PasswordHasher,
    private readonly events: SecurityEventsService,
  ) {}

  async setup(principal: AuthPrincipal): Promise<MfaSetup> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.mfaEnabled)
      throw AppException.conflict('Two-factor authentication is already enabled');
    const secret = this.totp.generateSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEncrypted: this.encryption.encrypt(secret, mfaSecretContext(user.id)) },
    });
    return { secret, otpauthUri: this.totp.otpauthUri(secret, user.email) };
  }

  async enable(principal: AuthPrincipal, code: string): Promise<MfaEnabledResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (user.mfaEnabled)
      throw AppException.conflict('Two-factor authentication is already enabled');
    if (!user.mfaSecretEncrypted) throw AppException.badRequest('Start the setup first', 'code');
    const secret = this.encryption.decrypt(user.mfaSecretEncrypted, mfaSecretContext(user.id));
    if (!(await this.totp.verify(secret, code, user.id))) {
      throw AppException.badRequest('Invalid verification code', 'code');
    }
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaRecoveryCodeHashes: recoveryCodes.map(sha256Hex) },
    });
    await this.events.record({
      type: 'MFA_ENABLED',
      userId: user.id,
      sessionId: principal.sessionId,
    });
    return { recoveryCodes };
  }

  async disable(principal: AuthPrincipal, password: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!user.mfaEnabled || !user.mfaSecretEncrypted) {
      throw AppException.conflict('Two-factor authentication is not enabled');
    }
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw AppException.badRequest('Password is incorrect', 'password');
    }
    const secret = this.encryption.decrypt(user.mfaSecretEncrypted, mfaSecretContext(user.id));
    if (!(await this.totp.verify(secret, code, user.id))) {
      throw AppException.badRequest('Invalid verification code', 'code');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaRecoveryCodeHashes: [] },
    });
    await this.events.record({
      type: 'MFA_DISABLED',
      userId: user.id,
      sessionId: principal.sessionId,
    });
  }
}
