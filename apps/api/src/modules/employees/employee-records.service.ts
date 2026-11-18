import { Injectable } from '@nestjs/common';
import { type EmployeeCollection, PERMISSIONS, type Permission } from '@hrm/shared-types';
import {
  addressSchema,
  certificationFields,
  certificationSchema,
  educationFields,
  educationSchema,
  emergencyContactSchema,
  experienceFields,
  experienceSchema,
  familyMemberFields,
  familyMemberSchema,
  skillSchema,
  toErrorDetails,
} from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';
import { mapWriteError } from '../structure/structure.util.js';
import { isoOrNull, toDate } from './employee-scope.js';
import { type AccessTarget, isSelf, loadTarget } from './employees.service.js';

type Row = Record<string, unknown> & { id: string };

/** The subset of a Prisma delegate the generic collection service needs. */
interface Delegate {
  findMany(args: object): Promise<Row[]>;
  findFirst(args: object): Promise<Row | null>;
  create(args: object): Promise<Row>;
  update(args: object): Promise<Row>;
  updateMany(args: object): Promise<unknown>;
  delete(args: object): Promise<Row>;
}

interface CollectionConfig {
  delegate: (tx: TenantTransaction) => Delegate;
  /** Create schema; updates use its `.partial()` equivalent via `partial: true` parsing. */
  schema: z.ZodType;
  partial: z.ZodType;
  label: string;
  audit: string;
  read: Permission;
  orderBy: object;
  dateFields: string[];
  /** One flagged row per employee (e.g. primary emergency contact). */
  primaryFlag?: string;
  uniqueField?: string;
}

const P = PERMISSIONS;

export const COLLECTIONS: Record<EmployeeCollection, CollectionConfig> = {
  addresses: {
    delegate: (tx) => tx.employeeAddress,
    schema: addressSchema,
    partial: addressSchema.partial(),
    label: 'address',
    audit: 'employee_address',
    read: P.EMPLOYEES_PERSONAL_READ,
    orderBy: { type: 'asc' },
    dateFields: [],
    uniqueField: 'type',
  },
  'emergency-contacts': {
    delegate: (tx) => tx.employeeEmergencyContact,
    schema: emergencyContactSchema,
    partial: emergencyContactSchema.partial(),
    label: 'emergency contact',
    audit: 'employee_emergency_contact',
    read: P.EMPLOYEES_PERSONAL_READ,
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    dateFields: [],
    primaryFlag: 'isPrimary',
  },
  'family-members': {
    delegate: (tx) => tx.employeeFamilyMember,
    schema: familyMemberSchema,
    partial: familyMemberFields.partial(),
    label: 'family member',
    audit: 'employee_family_member',
    read: P.EMPLOYEES_PERSONAL_READ,
    orderBy: { name: 'asc' },
    dateFields: ['dateOfBirth'],
  },
  education: {
    delegate: (tx) => tx.employeeEducation,
    schema: educationSchema,
    partial: educationFields.partial(),
    label: 'education record',
    audit: 'employee_education',
    read: P.EMPLOYEES_EMPLOYEE_READ,
    orderBy: [{ endYear: { sort: 'desc', nulls: 'first' } }, { qualification: 'asc' }],
    dateFields: [],
  },
  experience: {
    delegate: (tx) => tx.employeeExperience,
    schema: experienceSchema,
    partial: experienceFields.partial(),
    label: 'experience record',
    audit: 'employee_experience',
    read: P.EMPLOYEES_EMPLOYEE_READ,
    orderBy: { startDate: 'desc' },
    dateFields: ['startDate', 'endDate'],
  },
  certifications: {
    delegate: (tx) => tx.employeeCertification,
    schema: certificationSchema,
    partial: certificationFields.partial(),
    label: 'certification',
    audit: 'employee_certification',
    read: P.EMPLOYEES_EMPLOYEE_READ,
    orderBy: [{ issuedOn: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    dateFields: ['issuedOn', 'expiresOn'],
  },
  skills: {
    delegate: (tx) => tx.employeeSkill,
    schema: skillSchema,
    partial: skillSchema.partial(),
    label: 'skill',
    audit: 'employee_skill',
    read: P.EMPLOYEES_EMPLOYEE_READ,
    orderBy: { name: 'asc' },
    dateFields: [],
    uniqueField: 'name',
  },
};

export function collectionConfig(name: string): CollectionConfig {
  const cfg = (COLLECTIONS as Record<string, CollectionConfig | undefined>)[name];
  if (!cfg) throw AppException.notFound('Collection');
  return cfg;
}

const HIDDEN = new Set(['organizationId', 'employeeId', 'createdAt', 'updatedAt']);

function toItem(cfg: CollectionConfig, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (HIDDEN.has(k)) continue;
    out[k] = cfg.dateFields.includes(k) ? isoOrNull(v as Date | null) : v;
  }
  return out;
}

function toData(cfg: CollectionConfig, input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k] = cfg.dateFields.includes(k) && typeof v === 'string' ? toDate(v) : v;
  }
  return out;
}

function parse(schema: z.ZodType, body: unknown): Record<string, unknown> {
  const result = schema.safeParse(body);
  if (!result.success) throw AppException.validation(toErrorDetails(result.error));
  return result.data as Record<string, unknown>;
}

export type Actor = 'hr' | 'self';

/**
 * Profile sub-collections. HR access follows ABAC (`read` permission per collection; writes need
 * `employees.employee.update`); self-service callers act only on their own record.
 */
@Injectable()
export class EmployeeRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(principal: AuthPrincipal, actor: Actor, employeeId: string, name: string) {
    const cfg = collectionConfig(name);
    return this.prisma.withTenant(async (tx) => {
      await this.authorize(tx, principal, actor, employeeId, cfg.read);
      const rows = await cfg.delegate(tx).findMany({ where: { employeeId }, orderBy: cfg.orderBy });
      return rows.map((r) => toItem(cfg, r));
    });
  }

  create(principal: AuthPrincipal, actor: Actor, employeeId: string, name: string, body: unknown) {
    const cfg = collectionConfig(name);
    const input = parse(cfg.schema, body);
    return this.prisma.withTenant(async (tx) => {
      await this.authorize(tx, principal, actor, employeeId, P.EMPLOYEES_EMPLOYEE_UPDATE);
      const d = cfg.delegate(tx);
      if (cfg.primaryFlag && input[cfg.primaryFlag] === true)
        await d.updateMany({ where: { employeeId }, data: { [cfg.primaryFlag]: false } });
      const row = await d
        .create({
          data: { organizationId: principal.organizationId, employeeId, ...toData(cfg, input) },
        })
        .catch((err: unknown) => this.mapError(cfg, err));
      await this.audit.record(tx, {
        action: `${cfg.audit}.created`,
        entityType: cfg.audit,
        entityId: row.id,
        metadata: { employeeId, by: actor },
      });
      return toItem(cfg, row);
    });
  }

  update(
    principal: AuthPrincipal,
    actor: Actor,
    employeeId: string,
    name: string,
    id: string,
    body: unknown,
  ) {
    const cfg = collectionConfig(name);
    const input = parse(cfg.partial, body);
    return this.prisma.withTenant(async (tx) => {
      await this.authorize(tx, principal, actor, employeeId, P.EMPLOYEES_EMPLOYEE_UPDATE);
      const d = cfg.delegate(tx);
      const before = await d.findFirst({ where: { id, employeeId } });
      if (!before) throw AppException.notFound(capitalize(cfg.label));
      // Re-validate the merged record so cross-field rules (date ranges) still hold.
      const merged = { ...toItem(cfg, before), ...input };
      parse(cfg.schema, merged);
      if (cfg.primaryFlag && input[cfg.primaryFlag] === true)
        await d.updateMany({
          where: { employeeId, id: { not: id } },
          data: { [cfg.primaryFlag]: false },
        });
      const data = toData(cfg, input);
      const row = await d
        .update({ where: { id }, data })
        .catch((err: unknown) => this.mapError(cfg, err));
      const changes = diffChanges(before, data);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          action: `${cfg.audit}.updated`,
          entityType: cfg.audit,
          entityId: id,
          // Field names only: these records hold personal data.
          metadata: { employeeId, by: actor, fields: Object.keys(changes) },
        });
      }
      return toItem(cfg, row);
    });
  }

  remove(principal: AuthPrincipal, actor: Actor, employeeId: string, name: string, id: string) {
    const cfg = collectionConfig(name);
    return this.prisma.withTenant(async (tx) => {
      await this.authorize(tx, principal, actor, employeeId, P.EMPLOYEES_EMPLOYEE_UPDATE);
      const d = cfg.delegate(tx);
      const before = await d.findFirst({ where: { id, employeeId } });
      if (!before) throw AppException.notFound(capitalize(cfg.label));
      await d.delete({ where: { id } });
      await this.audit.record(tx, {
        action: `${cfg.audit}.deleted`,
        entityType: cfg.audit,
        entityId: id,
        metadata: { employeeId, by: actor },
      });
    });
  }

  private async authorize(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    actor: Actor,
    employeeId: string,
    permission: Permission,
  ): Promise<AccessTarget> {
    const target = await loadTarget(tx, principal, employeeId);
    if (actor === 'self') {
      if (!isSelf(principal, target)) throw AppException.notFound('Employee');
      if (target.status === 'SEPARATED') throw AppException.forbidden('Your employment has ended');
      return target;
    }
    if (!can(principal, permission, target.attributes)) {
      // Invisible collections behave as absent; visible-but-not-writable is a 403.
      if (permission === P.EMPLOYEES_EMPLOYEE_UPDATE) throw AppException.forbidden();
      throw AppException.forbidden('You cannot view this part of the profile');
    }
    return target;
  }

  private mapError(cfg: CollectionConfig, err: unknown): never {
    return mapWriteError(err, {
      entity: cfg.label,
      ...(cfg.uniqueField ? { uniqueField: cfg.uniqueField } : {}),
    });
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
