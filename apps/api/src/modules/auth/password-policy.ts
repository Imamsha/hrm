import { passwordSchema } from '@hrm/validation';
import { AppException } from '../../common/http/app.exception.js';

/**
 * Server-side password acceptance: the shared length policy plus context checks a client cannot
 * be trusted to perform (password must not contain the user's e-mail name or full name).
 */
export function assertAcceptablePassword(
  password: string,
  ctx: { email: string; fullName?: string },
): void {
  const base = passwordSchema.safeParse(password);
  if (!base.success) {
    throw AppException.badRequest(
      base.error.issues[0]?.message ?? 'Password is not acceptable',
      'password',
    );
  }
  const lower = password.toLowerCase();
  const localPart = ctx.email.split('@')[0]?.toLowerCase() ?? '';
  const nameParts = (ctx.fullName ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length >= 4);
  if (
    (localPart.length >= 4 && lower.includes(localPart)) ||
    nameParts.some((p) => lower.includes(p))
  ) {
    throw AppException.badRequest(
      'Password must not contain your name or e-mail address',
      'password',
    );
  }
}
