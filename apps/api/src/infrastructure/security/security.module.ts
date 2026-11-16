import { Global, Module } from '@nestjs/common';
import { FieldEncryption } from './field-encryption.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { TokenService } from './token.service.js';
import { TotpService } from './totp.service.js';

@Global()
@Module({
  providers: [PasswordHasher, TokenService, FieldEncryption, TotpService],
  exports: [PasswordHasher, TokenService, FieldEncryption, TotpService],
})
export class SecurityModule {}
