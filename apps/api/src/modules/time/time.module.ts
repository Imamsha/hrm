import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { ShiftsService } from './shifts.service.js';
import { AttendanceController, LeaveController, ShiftsController } from './time.controllers.js';
import { TimeSettingsService } from './time-settings.service.js';

/** Shifts, attendance and leave (Phase 05). */
@Module({
  controllers: [ShiftsController, AttendanceController, LeaveController],
  providers: [AuditService, ShiftsService, AttendanceService, LeaveService, TimeSettingsService],
})
export class TimeModule {}
