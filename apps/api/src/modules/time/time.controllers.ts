import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type ApprovalInbox, PERMISSIONS } from '@hrm/shared-types';
import {
  attendanceSummaryQuerySchema,
  balanceAdjustmentSchema,
  balanceQuerySchema,
  createLeaveTypeSchema,
  createShiftSchema,
  decisionSchema,
  leaveRequestQuerySchema,
  leaveRequestSchema,
  manualPunchSchema,
  punchImportSchema,
  punchSchema,
  rangeQuerySchema,
  regularizationSchema,
  rosterEntriesSchema,
  rosterQuerySchema,
  shiftAssignmentQuerySchema,
  shiftAssignmentSchema,
  timeSettingsSchema,
  updateLeaveTypeSchema,
  updateShiftSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireScopedPermissions,
} from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { ShiftsService } from './shifts.service.js';
import { TimeSettingsService } from './time-settings.service.js';

const P = PERMISSIONS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;

const ledgerQuery = z.object({
  leaveTypeId: z.uuid(),
  year: z.coerce.number().int().min(2000).max(2200),
});
const regListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  employeeId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

// ==================================================================================== shifts

@ApiTags('Shifts')
@ApiBearerAuth()
@Controller()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('shifts')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_READ)
  list() {
    return this.shifts.list();
  }

  @Post('shifts')
  @RequirePermissions(P.SHIFTS_SHIFT_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createShiftSchema)) body: Out<typeof createShiftSchema>,
  ) {
    return this.shifts.create(p, body);
  }

  @Patch('shifts/:id')
  @RequirePermissions(P.SHIFTS_SHIFT_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body(pipe(updateShiftSchema)) body: Out<typeof updateShiftSchema>,
  ) {
    return this.shifts.update(id, body);
  }

  @Delete('shifts/:id')
  @RequirePermissions(P.SHIFTS_SHIFT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', uuid) id: string) {
    await this.shifts.remove(id);
  }

  @Get('shift-assignments')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_READ)
  assignments(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(shiftAssignmentQuerySchema)) q: Out<typeof shiftAssignmentQuerySchema>,
  ) {
    return this.shifts.listAssignments(p, q);
  }

  @Post('shift-assignments')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_MANAGE)
  assign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(shiftAssignmentSchema)) body: Out<typeof shiftAssignmentSchema>,
  ) {
    return this.shifts.assign(p, body);
  }

  @Delete('shift-assignments/:id')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    await this.shifts.removeAssignment(p, id);
  }

  @Get('roster')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_READ)
  roster(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(rosterQuerySchema)) q: Out<typeof rosterQuerySchema>,
  ) {
    return this.shifts.roster(p, q);
  }

  @Put('roster')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_MANAGE)
  setRoster(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(rosterEntriesSchema)) body: Out<typeof rosterEntriesSchema>,
  ) {
    return this.shifts.setRoster(p, body);
  }

  @Delete('roster/:id')
  @RequireScopedPermissions(P.SHIFTS_SHIFT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRoster(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    await this.shifts.removeRosterEntry(p, id);
  }
}

// ==================================================================================== attendance

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly settings: TimeSettingsService,
  ) {}

  // ------------------------------------------------------------------ self-service
  @Get('me/attendance/today')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  today(@CurrentPrincipal() p: AuthPrincipal) {
    return this.attendance.today(p);
  }

  @Post('me/attendance/punches')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  @ApiOperation({ summary: 'Clock in/out (web, mobile or a kiosk QR token)' })
  punch(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(punchSchema)) body: Out<typeof punchSchema>,
    @Ip() ip: string,
  ) {
    return this.attendance.punch(p, body, ip);
  }

  @Get('me/attendance')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  myRange(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(rangeQuerySchema)) q: Out<typeof rangeQuerySchema>,
  ) {
    return this.attendance.range(p, 'self', q.from, q.to);
  }

  @Get('me/attendance/punches')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  myPunches(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(rangeQuerySchema)) q: Out<typeof rangeQuerySchema>,
  ) {
    return this.attendance.punches(p, 'self', q.from, q.to);
  }

  @Get('me/attendance/regularizations')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  myRegularizations(@CurrentPrincipal() p: AuthPrincipal) {
    return this.attendance.myRegularizations(p);
  }

  @Post('me/attendance/regularizations')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  requestRegularization(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(regularizationSchema)) body: Out<typeof regularizationSchema>,
  ) {
    return this.attendance.requestRegularization(p, body);
  }

  @Post('me/attendance/regularizations/:id/cancel')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  @HttpCode(HttpStatus.OK)
  cancelRegularization(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.attendance.cancelRegularization(p, id);
  }

  // ------------------------------------------------------------------ HR / managers
  @Get('attendance/summary')
  @RequireScopedPermissions(P.ATTENDANCE_RECORD_READ)
  summary(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(attendanceSummaryQuerySchema)) q: Out<typeof attendanceSummaryQuerySchema>,
  ) {
    return this.attendance.summary(p, q);
  }

  @Get('employees/:id/attendance/days')
  @RequireScopedPermissions(P.ATTENDANCE_RECORD_READ)
  employeeRange(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(rangeQuerySchema)) q: Out<typeof rangeQuerySchema>,
  ) {
    return this.attendance.range(p, id, q.from, q.to);
  }

  @Get('employees/:id/attendance/punches')
  @RequireScopedPermissions(P.ATTENDANCE_RECORD_READ)
  employeePunches(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(rangeQuerySchema)) q: Out<typeof rangeQuerySchema>,
  ) {
    return this.attendance.punches(p, id, q.from, q.to);
  }

  @Post('employees/:id/attendance/punches')
  @RequireScopedPermissions(P.ATTENDANCE_RECORD_MANAGE)
  manualPunch(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(manualPunchSchema)) body: Out<typeof manualPunchSchema>,
  ) {
    return this.attendance.manualPunch(p, id, body);
  }

  @Post('attendance/punches/import')
  @RequirePermissions(P.ATTENDANCE_PUNCH_IMPORT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Import device punches (idempotent)' })
  importPunches(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(punchImportSchema)) body: Out<typeof punchImportSchema>,
  ) {
    return this.attendance.importPunches(p, body);
  }

  @Get('attendance/kiosk/:branchId/token')
  @RequireScopedPermissions(P.ATTENDANCE_KIOSK_OPERATE)
  kioskToken(@CurrentPrincipal() p: AuthPrincipal, @Param('branchId', uuid) branchId: string) {
    return this.attendance.kioskToken(p, branchId);
  }

  @Get('attendance/regularizations')
  @RequireScopedPermissions(P.ATTENDANCE_RECORD_READ)
  regularizations(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(regListQuery)) q: Out<typeof regListQuery>,
  ) {
    return this.attendance.listRegularizations(p, q);
  }

  /** Managers decide for their reports by reporting line; HR by scoped permission. */
  @Post('attendance/regularizations/:id/decision')
  @RequireScopedPermissions(P.ATTENDANCE_SELF_USE)
  @HttpCode(HttpStatus.OK)
  decideRegularization(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(decisionSchema)) body: Out<typeof decisionSchema>,
  ) {
    return this.attendance.decideRegularization(p, id, body);
  }

  @Get('attendance/settings')
  @RequirePermissions(P.ATTENDANCE_SELF_USE)
  getSettings(@CurrentPrincipal() p: AuthPrincipal) {
    return this.settings.get(p);
  }

  @Put('attendance/settings')
  @RequirePermissions(P.ATTENDANCE_SETTINGS_MANAGE)
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(timeSettingsSchema)) body: Out<typeof timeSettingsSchema>,
  ) {
    return this.settings.update(p, body);
  }
}

// ==================================================================================== leave

@ApiTags('Leave')
@ApiBearerAuth()
@Controller()
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('leave/types')
  @RequirePermissions(P.LEAVE_SELF_USE)
  types(@Query('includeInactive') includeInactive?: string) {
    return this.leave.listTypes(includeInactive === 'true');
  }

  @Post('leave/types')
  @RequirePermissions(P.LEAVE_TYPE_MANAGE)
  createType(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createLeaveTypeSchema)) body: Out<typeof createLeaveTypeSchema>,
  ) {
    return this.leave.createType(p, body);
  }

  @Patch('leave/types/:id')
  @RequirePermissions(P.LEAVE_TYPE_MANAGE)
  updateType(
    @Param('id', uuid) id: string,
    @Body(pipe(updateLeaveTypeSchema)) body: Out<typeof updateLeaveTypeSchema>,
  ) {
    return this.leave.updateType(id, body);
  }

  // ------------------------------------------------------------------ self-service
  @Get('me/leave/balances')
  @RequirePermissions(P.LEAVE_SELF_USE)
  myBalances(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(balanceQuerySchema)) q: Out<typeof balanceQuerySchema>,
  ) {
    return this.leave.balances(p, 'self', q.year);
  }

  @Get('me/leave/ledger')
  @RequirePermissions(P.LEAVE_SELF_USE)
  myLedger(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(ledgerQuery)) q: Out<typeof ledgerQuery>,
  ) {
    return this.leave.ledger(p, 'self', q.leaveTypeId, q.year);
  }

  @Get('me/leave/requests')
  @RequirePermissions(P.LEAVE_SELF_USE)
  myRequests(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(leaveRequestQuerySchema)) q: Out<typeof leaveRequestQuerySchema>,
  ) {
    return this.leave.list(p, q, true);
  }

  @Post('me/leave/requests/preview')
  @RequirePermissions(P.LEAVE_SELF_USE)
  @HttpCode(HttpStatus.OK)
  myPreview(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(leaveRequestSchema)) body: Out<typeof leaveRequestSchema>,
  ) {
    return this.leave.preview(p, 'self', body);
  }

  @Post('me/leave/requests')
  @RequirePermissions(P.LEAVE_SELF_USE)
  apply(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(leaveRequestSchema)) body: Out<typeof leaveRequestSchema>,
  ) {
    return this.leave.apply(p, 'self', body);
  }

  @Get('me/approvals')
  @RequireScopedPermissions(P.LEAVE_SELF_USE)
  @ApiOperation({ summary: 'Leave and regularization requests awaiting my decision' })
  inbox(@CurrentPrincipal() p: AuthPrincipal): Promise<ApprovalInbox> {
    return this.prisma.withTenant(async (tx) => {
      const me = p.membershipId
        ? await tx.employee.findFirst({
            where: { membershipId: p.membershipId },
            select: { id: true },
          })
        : null;
      return {
        leave: await this.leave.pendingForApprover(tx, p, me?.id ?? null),
        regularizations: await this.attendance.pendingForApprover(tx, p, me?.id ?? null),
      };
    });
  }

  // ------------------------------------------------------------------ HR / managers
  @Get('leave/requests')
  @RequireScopedPermissions(P.LEAVE_REQUEST_READ)
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(leaveRequestQuerySchema)) q: Out<typeof leaveRequestQuerySchema>,
  ) {
    return this.leave.list(p, q, false);
  }

  @Post('leave/requests/:id/decision')
  @RequireScopedPermissions(P.LEAVE_SELF_USE)
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(decisionSchema)) body: Out<typeof decisionSchema>,
  ) {
    return this.leave.decide(p, id, body);
  }

  @Post('leave/requests/:id/cancel')
  @RequireScopedPermissions(P.LEAVE_SELF_USE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.leave.cancel(p, id);
  }

  @Get('employees/:id/leave/balances')
  @RequireScopedPermissions(P.LEAVE_REQUEST_READ)
  balances(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(balanceQuerySchema)) q: Out<typeof balanceQuerySchema>,
  ) {
    return this.leave.balances(p, id, q.year);
  }

  @Get('employees/:id/leave/ledger')
  @RequireScopedPermissions(P.LEAVE_REQUEST_READ)
  ledger(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(ledgerQuery)) q: Out<typeof ledgerQuery>,
  ) {
    return this.leave.ledger(p, id, q.leaveTypeId, q.year);
  }

  @Post('employees/:id/leave/preview')
  @RequireScopedPermissions(P.LEAVE_REQUEST_APPROVE)
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(leaveRequestSchema)) body: Out<typeof leaveRequestSchema>,
  ) {
    return this.leave.preview(p, id, body);
  }

  @Post('employees/:id/leave/requests')
  @RequireScopedPermissions(P.LEAVE_REQUEST_APPROVE)
  applyFor(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(leaveRequestSchema)) body: Out<typeof leaveRequestSchema>,
  ) {
    return this.leave.apply(p, id, body);
  }

  @Post('employees/:id/leave/adjustments')
  @RequireScopedPermissions(P.LEAVE_BALANCE_ADJUST)
  adjust(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(balanceAdjustmentSchema)) body: Out<typeof balanceAdjustmentSchema>,
  ) {
    return this.leave.adjust(p, id, body);
  }
}
