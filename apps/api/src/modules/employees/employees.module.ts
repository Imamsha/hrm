import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EmployeeDocumentsService } from './employee-documents.service.js';
import { EmployeeRecordsService } from './employee-records.service.js';
import { EmployeeSensitiveService } from './employee-sensitive.service.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { EmploymentService } from './employment.service.js';
import { SelfServiceController } from './self-service.controller.js';

/** Employee management and self-service (Phase 04). */
@Module({
  controllers: [EmployeesController, SelfServiceController],
  providers: [
    AuditService,
    EmployeesService,
    EmploymentService,
    EmployeeRecordsService,
    EmployeeSensitiveService,
    EmployeeDocumentsService,
  ],
  exports: [EmployeesService, EmployeeDocumentsService, EmploymentService],
})
export class EmployeesModule {}
