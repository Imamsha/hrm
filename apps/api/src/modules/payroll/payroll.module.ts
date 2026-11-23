import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { PayrollConfigService } from './payroll-config.service.js';
import { PayrollEmployeesService } from './payroll-employees.service.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { MyPayrollController, PayrollController } from './payroll.controllers.js';
import { SettlementsService } from './settlements.service.js';

/** India payroll (Phase 07, ADR-014). */
@Module({
  controllers: [PayrollController, MyPayrollController],
  providers: [
    AuditService,
    PayrollConfigService,
    PayrollEmployeesService,
    PayrollRunsService,
    SettlementsService,
  ],
})
export class PayrollModule {}
