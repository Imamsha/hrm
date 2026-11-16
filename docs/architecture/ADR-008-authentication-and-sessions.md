# ADR-008: Authentication and sessions

- Status: Accepted (2026-11-16, Phase 02)

## Decision

| Concern           | Choice                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage  | argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1 — OWASP minimum); PHC string allows raising cost later                                                                                                                                                              |
| Password policy   | ≥ 12 chars, ≤ 128, ≥ 5 distinct chars, no leading/trailing spaces, must not contain e-mail local part or name parts (NIST 800-63B style; no composition rules)                                                                                                      |
| Access token      | JWT HS256 (`jose`), 15 min, claims `sub` (user), `sid` (session), `org` (active organization), `iss`, `aud=hrm-api`, `jti`                                                                                                                                          |
| Refresh token     | Opaque 256-bit random, stored as SHA-256 only, **rotated on every use**; reuse of a used token revokes the whole session (theft signal)                                                                                                                             |
| Session           | One row per device sign-in; absolute lifetime 30 days (`AUTH_SESSION_TTL_DAYS`); revocation is pushed to Redis so access tokens die immediately (≤ guard check)                                                                                                     |
| Browser transport | Refresh token only in an `httpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` cookie (`Secure` required in production); access token kept in memory                                                                                                                   |
| Mobile transport  | Refresh token in the response body, persisted only in the OS keystore (`expo-secure-store`)                                                                                                                                                                         |
| MFA               | TOTP (RFC 6238, SHA-1/6/30 s, ±1 step), secret AES-256-GCM-encrypted with AAD bound to the user; replay protection per time step (Redis); 10 one-time recovery codes (SHA-256); MFA challenge = 5-minute JWT (`aud=hrm-mfa`), max 5 attempts, single successful use |
| Lockout           | 5 failures → 15-minute lock; locked/unknown/wrong-password all return the same 401 message; dummy argon2 verification for unknown e-mails (timing parity)                                                                                                           |
| Rate limiting     | Credential endpoints: `AUTH_RATE_LIMIT_MAX`/min/IP (named throttler `auth`); everything else the default throttler                                                                                                                                                  |
| Password reset    | Single-use, 30-minute token e-mailed via the queue; identical response for unknown accounts; completing a reset revokes all sessions and clears lockout                                                                                                             |
| Password change   | Requires current password; revokes all other sessions                                                                                                                                                                                                               |
| Security audit    | Append-only `auth_events` (login success/failure/lock, MFA, resets, token reuse, org switch, revocations) — the user's login history                                                                                                                                |

## Why not

- **Server sessions only / opaque access tokens:** every request would hit the session store; JWT + revocation list gives the same immediacy for revoked sessions with fewer lookups.
- **Refresh token in localStorage:** readable by any XSS; the cookie is not.
- **RS256/EdDSA now:** only the API verifies tokens; HS256 is simpler. Switch when another service must verify tokens (key rotation via `kid`).

## Known limitations (tracked)

- Strict reuse detection: two browser tabs refreshing at the same instant could end the session; the web client de-duplicates refreshes (single-flight) to avoid this.
- No e-mail verification flow for self-registered owners yet (`emailVerifiedAt` is set for invited users who click the link). Planned with notification preferences.
- No WebAuthn/passkeys yet.
