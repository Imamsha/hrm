import { ALL_PERMISSIONS, type Permission } from '@hrm/shared-types';
import { z } from 'zod';
import { listQuerySchema, optionalText, requiredText } from './common.js';
import { emailSchema } from './auth.js';

/** IANA time zone validated by the runtime's Intl database. */
export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code');

export const localeSchema = z
  .string()
  .trim()
  .max(35)
  .refine((l) => {
    try {
      return Intl.getCanonicalLocales(l).length === 1;
    } catch {
      return false;
    }
  }, 'Unknown locale');

export const updateOrganizationSchema = z
  .object({
    name: requiredText(200),
    legalName: optionalText(300).nullable(),
    defaultTimezone: timezoneSchema,
    defaultCurrency: currencySchema,
    defaultLocale: localeSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const createOrganizationSchema = z.object({
  name: requiredText(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/)
    .optional(),
});

const roleIdsSchema = z
  .array(z.uuid())
  .min(1, 'Select at least one role')
  .max(20)
  .transform((ids) => [...new Set(ids)]);

export const inviteMemberSchema = z.object({
  email: emailSchema,
  fullName: optionalText(200),
  roleIds: roleIdsSchema,
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const setMemberRolesSchema = z.object({ roleIds: roleIdsSchema });

export const memberListQuerySchema = listQuerySchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  roleId: z.uuid().optional(),
});
export type MemberListQuery = z.output<typeof memberListQuerySchema>;

export const permissionKeySchema = z.custom<Permission>(
  (v) => typeof v === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(v),
  'Unknown permission',
);

export const roleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,63}$/, 'Use 2–64 lowercase letters, digits or underscores');

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: requiredText(100),
  description: optionalText(500),
  permissions: z
    .array(permissionKeySchema)
    .max(500)
    .transform((p) => [...new Set(p)]),
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema
  .omit({ key: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const auditLogQuerySchema = listQuerySchema.extend({
  action: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_.]*$/)
    .max(100)
    .optional(),
  actorId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type AuditLogQuery = z.output<typeof auditLogQuerySchema>;
