import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { AppException } from '../../common/http/app.exception.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Session id (checked for revocation on every request). */
  sid: string;
  /** Active organization id, if any. Membership is re-validated per request. */
  org?: string;
}

export interface MfaTokenClaims {
  sub: string;
}

const ACCESS_AUDIENCE = 'hrm-api';
const MFA_AUDIENCE = 'hrm-mfa';

/** Issues and verifies signed JWTs (HS256). Refresh tokens are opaque and not JWTs. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.AUTH_JWT_SECRET);
  }

  get accessTokenTtlSeconds(): number {
    return this.config.AUTH_ACCESS_TOKEN_TTL_SECONDS;
  }

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const payload: Record<string, string> = { sid: claims.sid };
    if (claims.org) payload.org = claims.org;
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.config.AUTH_JWT_ISSUER)
      .setAudience(ACCESS_AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${String(this.config.AUTH_ACCESS_TOKEN_TTL_SECONDS)}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.verify(token, ACCESS_AUDIENCE);
    if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') {
      throw AppException.unauthenticated();
    }
    return {
      sub: payload.sub,
      sid: payload.sid,
      ...(typeof payload.org === 'string' ? { org: payload.org } : {}),
    };
  }

  signMfaToken(claims: MfaTokenClaims): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.config.AUTH_JWT_ISSUER)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(`${String(this.config.AUTH_MFA_TOKEN_TTL_SECONDS)}s`)
      .sign(this.key);
  }

  async verifyMfaToken(token: string): Promise<MfaTokenClaims & { jti: string }> {
    const payload = await this.verify(token, MFA_AUDIENCE);
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw AppException.unauthenticated();
    }
    return { sub: payload.sub, jti: payload.jti };
  }

  private async verify(token: string, audience: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.AUTH_JWT_ISSUER,
        audience,
        algorithms: ['HS256'],
      });
      return payload;
    } catch (err) {
      if (err instanceof errors.JWTExpired) throw AppException.unauthenticated('Token expired');
      throw AppException.unauthenticated();
    }
  }
}
