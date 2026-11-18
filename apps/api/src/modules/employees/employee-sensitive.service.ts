import { Injectable } from '@nestjs/common';
import { type BankAccountItem, PERMISSIONS, type StatutoryIdsItem } from '@hrm/shared-types';
import type {
  createBankAccountSchema,
  statutoryIdsSchema,
  updateBankAccountSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import { uuidv7 } from '../../common/ids.js';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import { FieldEncryption } from '../../infrastructure/security/field-encryption.service.js';
import { type AuthPrincipal, can } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { definedOnly } from '../structure/structure.util.js';
import { mask } from './employee-scope.js';
import { type AccessTarget, authorize, isSelf, loadTarget } from './employees.service.js';

const P = PERMISSIONS;
type CreateBank = z.output<typeof createBankAccountSchema>;
type UpdateBank = z.output<typeof updateBankAccountSchema>;
type Statutory = z.output<typeof statutoryIdsSchema>;

const bankSelect = {
  id: true,
  accountHolderName: true,
  bankName: true,
  branchName: true,
  ifsc: true,
  accountType: true,
  accountLast4: true,
  isPrimary: true,
} as const;

type BankRow = {
  id: string;
  accountHolderName: string;
  bankName: string;
  branchName: string | null;
  ifsc: string;
  accountType: 'SAVINGS' | 'CURRENT';
  accountLast4: string;
  isPrimary: boolean;
};

function toBankItem(r: BankRow): BankAccountItem {
  return {
    id: r.id,
    accountHolderName: r.accountHolderName,
    bankName: r.bankName,
    branchName: r.branchName,
    ifsc: r.ifsc,
    accountType: r.accountType,
    accountNumberMasked: mask(r.accountLast4, 12),
    isPrimary: r.isPrimary,
  };
}

/** Encryption contexts bind each ciphertext to its row and column (no copy-paste between rows). */
const bankContext = (id: string) => `employee_bank_accounts.account_number:${id}`;
const panContext = (employeeId: string) => `employee_statutory_ids.pan:${employeeId}`;
const uanContext = (employeeId: string) => `employee_statutory_ids.uan:${employeeId}`;

/**
 * Bank accounts and statutory identifiers. Values are encrypted at rest (AES-256-GCM); lists
 * return masked values; full values only through the audited reveal endpoints. Aadhaar numbers
 * are deliberately not collected (see ADR-011).
 */
@Injectable()
export class EmployeeSensitiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryption,
  ) {}

  listBankAccounts(
    principal: AuthPrincipal,
    employeeId: string,
    self = false,
  ): Promise<BankAccountItem[]> {
    return this.prisma.withTenant(async (tx) => {
      await this.readable(tx, principal, employeeId, self);
      const rows = await tx.employeeBankAccount.findMany({
        where: { employeeId },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: bankSelect,
      });
      return rows.map(toBankItem);
    });
  }

  createBankAccount(
    principal: AuthPrincipal,
    employeeId: string,
    input: CreateBank,
  ): Promise<BankAccountItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.manageable(tx, principal, employeeId);
      const id = uuidv7();
      const count = await tx.employeeBankAccount.count({ where: { employeeId } });
      const isPrimary = input.isPrimary || count === 0; // the first account is the primary one
      if (isPrimary)
        await tx.employeeBankAccount.updateMany({
          where: { employeeId },
          data: { isPrimary: false },
        });
      const row = await tx.employeeBankAccount.create({
        data: {
          id,
          organizationId: principal.organizationId ?? '',
          employeeId,
          accountHolderName: input.accountHolderName,
          bankName: input.bankName,
          branchName: input.branchName ?? null,
          ifsc: input.ifsc,
          accountType: input.accountType,
          accountNumberEncrypted: this.crypto.encrypt(input.accountNumber, bankContext(id)),
          accountLast4: input.accountNumber.slice(-4),
          isPrimary,
        },
        select: bankSelect,
      });
      await this.audit.record(tx, {
        action: 'employee_bank_account.created',
        entityType: 'employee_bank_account',
        entityId: id,
        metadata: { employeeId, ifsc: input.ifsc, last4: row.accountLast4 },
      });
      return toBankItem(row);
    });
  }

  updateBankAccount(
    principal: AuthPrincipal,
    employeeId: string,
    id: string,
    input: UpdateBank,
  ): Promise<BankAccountItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.manageable(tx, principal, employeeId);
      const before = await tx.employeeBankAccount.findFirst({
        where: { id, employeeId },
        select: bankSelect,
      });
      if (!before) throw AppException.notFound('Bank account');
      if (input.isPrimary === true)
        await tx.employeeBankAccount.updateMany({
          where: { employeeId, id: { not: id } },
          data: { isPrimary: false },
        });
      if (input.isPrimary === false && before.isPrimary)
        throw AppException.badRequest('Mark another account as primary instead', 'isPrimary');
      const { accountNumber, ...rest } = input;
      const row = await tx.employeeBankAccount.update({
        where: { id },
        data: {
          ...definedOnly(rest),
          ...(accountNumber
            ? {
                accountNumberEncrypted: this.crypto.encrypt(accountNumber, bankContext(id)),
                accountLast4: accountNumber.slice(-4),
              }
            : {}),
        },
        select: bankSelect,
      });
      await this.audit.record(tx, {
        action: 'employee_bank_account.updated',
        entityType: 'employee_bank_account',
        entityId: id,
        metadata: {
          employeeId,
          fields: Object.keys(input).filter((k) => input[k as keyof UpdateBank] !== undefined),
        },
      });
      return toBankItem(row);
    });
  }

  removeBankAccount(principal: AuthPrincipal, employeeId: string, id: string): Promise<void> {
    return this.prisma.withTenant(async (tx) => {
      await this.manageable(tx, principal, employeeId);
      const before = await tx.employeeBankAccount.findFirst({
        where: { id, employeeId },
        select: bankSelect,
      });
      if (!before) throw AppException.notFound('Bank account');
      await tx.employeeBankAccount.delete({ where: { id } });
      if (before.isPrimary) {
        const next = await tx.employeeBankAccount.findFirst({
          where: { employeeId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next)
          await tx.employeeBankAccount.update({
            where: { id: next.id },
            data: { isPrimary: true },
          });
      }
      await this.audit.record(tx, {
        action: 'employee_bank_account.deleted',
        entityType: 'employee_bank_account',
        entityId: id,
        metadata: { employeeId, last4: before.accountLast4 },
      });
    });
  }

  revealBankAccount(
    principal: AuthPrincipal,
    employeeId: string,
    id: string,
  ): Promise<{ accountNumber: string }> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, employeeId);
      authorize(principal, P.EMPLOYEES_SENSITIVE_READ, target);
      const row = await tx.employeeBankAccount.findFirst({
        where: { id, employeeId },
        select: { accountNumberEncrypted: true },
      });
      if (!row) throw AppException.notFound('Bank account');
      await this.audit.record(tx, {
        action: 'employee.sensitive_revealed',
        entityType: 'employee_bank_account',
        entityId: id,
        metadata: { employeeId, field: 'accountNumber' },
      });
      return { accountNumber: this.crypto.decrypt(row.accountNumberEncrypted, bankContext(id)) };
    });
  }

  getStatutory(
    principal: AuthPrincipal,
    employeeId: string,
    self = false,
  ): Promise<StatutoryIdsItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.readable(tx, principal, employeeId, self);
      const row = await tx.employeeStatutoryIds.findFirst({
        where: { employeeId },
        select: { panLast4: true, uanLast4: true },
      });
      return {
        panMasked: row?.panLast4 ? mask(row.panLast4, 10) : null,
        uanMasked: row?.uanLast4 ? mask(row.uanLast4, 12) : null,
      };
    });
  }

  setStatutory(
    principal: AuthPrincipal,
    employeeId: string,
    input: Statutory,
  ): Promise<StatutoryIdsItem> {
    return this.prisma.withTenant(async (tx) => {
      await this.manageable(tx, principal, employeeId);
      const data: Record<string, string | null> = {};
      if (input.pan !== undefined) {
        data.panEncrypted = input.pan
          ? this.crypto.encrypt(input.pan, panContext(employeeId))
          : null;
        data.panLast4 = input.pan ? input.pan.slice(-4) : null;
      }
      if (input.uan !== undefined) {
        data.uanEncrypted = input.uan
          ? this.crypto.encrypt(input.uan, uanContext(employeeId))
          : null;
        data.uanLast4 = input.uan ? input.uan.slice(-4) : null;
      }
      const row = await tx.employeeStatutoryIds.upsert({
        where: { employeeId },
        create: { employeeId, organizationId: principal.organizationId ?? '', ...data },
        update: data,
        select: { panLast4: true, uanLast4: true },
      });
      await this.audit.record(tx, {
        action: 'employee.statutory_ids_updated',
        entityType: 'employee',
        entityId: employeeId,
        metadata: {
          fields: Object.keys(input).filter((k) => input[k as keyof Statutory] !== undefined),
        },
      });
      return {
        panMasked: row.panLast4 ? mask(row.panLast4, 10) : null,
        uanMasked: row.uanLast4 ? mask(row.uanLast4, 12) : null,
      };
    });
  }

  revealStatutory(
    principal: AuthPrincipal,
    employeeId: string,
  ): Promise<{ pan: string | null; uan: string | null }> {
    return this.prisma.withTenant(async (tx) => {
      const target = await loadTarget(tx, principal, employeeId);
      authorize(principal, P.EMPLOYEES_SENSITIVE_READ, target);
      const row = await tx.employeeStatutoryIds.findFirst({
        where: { employeeId },
        select: { panEncrypted: true, uanEncrypted: true },
      });
      await this.audit.record(tx, {
        action: 'employee.sensitive_revealed',
        entityType: 'employee',
        entityId: employeeId,
        metadata: { field: 'statutoryIds' },
      });
      return {
        pan: row?.panEncrypted
          ? this.crypto.decrypt(row.panEncrypted, panContext(employeeId))
          : null,
        uan: row?.uanEncrypted
          ? this.crypto.decrypt(row.uanEncrypted, uanContext(employeeId))
          : null,
      };
    });
  }

  private async readable(
    tx: TenantTransaction,
    principal: AuthPrincipal,
    employeeId: string,
    self: boolean,
  ): Promise<AccessTarget> {
    const target = await loadTarget(tx, principal, employeeId);
    if (self) {
      if (!isSelf(principal, target)) throw AppException.notFound('Employee');
      return target;
    }
    if (!can(principal, P.EMPLOYEES_SENSITIVE_READ, target.attributes))
      throw AppException.forbidden();
    return target;
  }

  private async manageable(tx: TenantTransaction, principal: AuthPrincipal, employeeId: string) {
    const target = await loadTarget(tx, principal, employeeId);
    authorize(principal, P.EMPLOYEES_SENSITIVE_MANAGE, target);
    return target;
  }
}
