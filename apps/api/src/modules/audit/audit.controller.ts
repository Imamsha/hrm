import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type AuditLogItem, type PaginatedResult, PERMISSIONS } from '@hrm/shared-types';
import { auditLogQuerySchema } from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { RequirePermissions } from '../access/decorators.js';
import { AuditService } from './audit.service.js';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_LOG_READ)
  list(
    @Query(new ZodValidationPipe(auditLogQuerySchema)) query: z.output<typeof auditLogQuerySchema>,
  ): Promise<PaginatedResult<AuditLogItem>> {
    return this.audit.list(query);
  }
}
