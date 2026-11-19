import { Injectable } from '@nestjs/common';
import type { TimeSettingsItem } from '@hrm/shared-types';
import type { timeSettingsSchema } from '@hrm/validation';
import type { z } from 'zod';
import {
  PrismaService,
  type TenantTransaction,
} from '../../infrastructure/database/prisma.service.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuditService, diffChanges } from '../audit/audit.service.js';

export async function timeSettings(tx: TenantTransaction, organizationId: string) {
  return tx.timeSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

export function toSettingsItem(s: Awaited<ReturnType<typeof timeSettings>>): TimeSettingsItem {
  return {
    leaveYearStartMonth: s.leaveYearStartMonth,
    webPunchEnabled: s.webPunchEnabled,
    mobilePunchEnabled: s.mobilePunchEnabled,
    qrPunchEnabled: s.qrPunchEnabled,
    geolocationRequired: s.geolocationRequired,
    qrRotationSeconds: s.qrRotationSeconds,
  };
}

@Injectable()
export class TimeSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get(principal: AuthPrincipal): Promise<TimeSettingsItem> {
    return this.prisma.withTenant(async (tx) =>
      toSettingsItem(await timeSettings(tx, principal.organizationId ?? '')),
    );
  }

  update(
    principal: AuthPrincipal,
    input: z.output<typeof timeSettingsSchema>,
  ): Promise<TimeSettingsItem> {
    return this.prisma.withTenant(async (tx) => {
      const before = await timeSettings(tx, principal.organizationId ?? '');
      const row = await tx.timeSettings.update({
        where: { organizationId: before.organizationId },
        data: input,
      });
      const changes = diffChanges(
        toSettingsItem(before) as unknown as Record<string, unknown>,
        input,
      );
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          action: 'time_settings.updated',
          entityType: 'time_settings',
          entityId: before.organizationId,
          changes,
        });
      }
      return toSettingsItem(row);
    });
  }
}
