import { z } from 'zod';
import { requiredText } from './common.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address'));

/**
 * Password policy (NIST SP 800-63B aligned): length over composition rules, no maximum below
 * 64, no forced character classes. Contextual checks (e-mail, name) run server-side.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${String(PASSWORD_MAX_LENGTH)} characters`)
  .refine((v) => v.trim().length === v.length, 'Password must not start or end with spaces')
  .refine((v) => new Set(v).size >= 5, 'Password is too repetitive');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, 'Use 3–63 lowercase letters, digits or hyphens');

export const tokenTransportSchema = z.enum(['cookie', 'body']).default('cookie');

export const registerSchema = z.object({
  organizationName: requiredText(200),
  organizationSlug: slugSchema.optional(),
  fullName: requiredText(200),
  email: emailSchema,
  password: passwordSchema,
  tokenTransport: tokenTransportSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Login does not re-validate policy (old passwords may predate it).
  password: z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH),
  organizationId: z.uuid().optional(),
  tokenTransport: tokenTransportSchema,
});
export type LoginInput = z.input<typeof loginSchema>;

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const recoveryCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/, 'Enter a recovery code like abcde-12345');

export const mfaVerifySchema = z
  .object({
    mfaToken: z.string().min(1).max(2048),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
    tokenTransport: tokenTransportSchema,
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Provide either an authenticator code or a recovery code',
    path: ['code'],
  });
export type MfaVerifyInput = z.input<typeof mfaVerifySchema>;

export const refreshSchema = z.object({
  /** Mobile clients send the token in the body; browsers use the httpOnly cookie. */
  refreshToken: z.string().min(32).max(256).optional(),
  tokenTransport: tokenTransportSchema,
});

export const switchOrganizationSchema = z.object({
  organizationId: z.uuid(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Choose a password different from the current one',
    path: ['newPassword'],
  });

export const mfaEnableSchema = z.object({ code: totpCodeSchema });

export const mfaDisableSchema = z.object({
  password: z.string().min(1, 'Required').max(PASSWORD_MAX_LENGTH),
  code: totpCodeSchema,
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(256),
  /** Required only when no account exists yet for the invited e-mail. */
  fullName: requiredText(200).optional(),
  password: passwordSchema.optional(),
  tokenTransport: tokenTransportSchema,
});
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;
