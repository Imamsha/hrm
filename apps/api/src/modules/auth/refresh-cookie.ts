import type { CookieOptions, Request, Response } from 'express';
import type { AuthTokens, TokenTransport } from '@hrm/shared-types';
import type { IssuedTokens } from './sessions.service.js';

export const REFRESH_COOKIE = 'hrm_rt';
/** The cookie is only ever sent to the auth endpoints. */
const COOKIE_PATH = '/api/v1/auth';

function options(secure: boolean, expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    ...(expires ? { expires } : {}),
  };
}

/**
 * Browsers receive the refresh token only as an httpOnly, SameSite=Strict cookie (not readable
 * by scripts, not sent cross-site). Mobile clients ask for it in the body and keep it in the
 * OS keystore.
 */
export function deliverTokens(
  res: Response,
  tokens: IssuedTokens,
  transport: TokenTransport,
  secure: boolean,
): AuthTokens {
  if (transport === 'body') {
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
    };
  }
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, options(secure, tokens.refreshExpiresAt));
  return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, options(secure));
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
