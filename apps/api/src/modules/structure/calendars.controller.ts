import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  bulkHolidaysSchema,
  calendarResolveQuerySchema,
  createHolidayCalendarSchema,
  createWorkWeekSchema,
  holidayListQuerySchema,
  updateHolidayCalendarSchema,
  updateHolidaySchema,
  updateWorkWeekSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { CalendarsService } from './calendars.service.js';
import { OrgChartService } from './org-chart.service.js';

const READ = PERMISSIONS.ORGANIZATION_CALENDAR_READ;
const MANAGE = PERMISSIONS.ORGANIZATION_CALENDAR_MANAGE;
const orgChartQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@ApiTags('Calendars')
@ApiBearerAuth()
@Controller()
export class CalendarsController {
  constructor(
    private readonly calendars: CalendarsService,
    private readonly orgChart: OrgChartService,
  ) {}

  // ------------------------------------------------------------------ work weeks
  @Get('work-weeks')
  @RequirePermissions(READ)
  listWorkWeeks() {
    return this.calendars.listWorkWeeks();
  }

  @Post('work-weeks')
  @RequirePermissions(MANAGE)
  createWorkWeek(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createWorkWeekSchema)) body: z.output<typeof createWorkWeekSchema>,
  ) {
    return this.calendars.createWorkWeek(p, body);
  }

  @Patch('work-weeks/:id')
  @RequirePermissions(MANAGE)
  updateWorkWeek(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkWeekSchema)) body: z.output<typeof updateWorkWeekSchema>,
  ) {
    return this.calendars.updateWorkWeek(p, id, body);
  }

  @Delete('work-weeks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeWorkWeek(@Param('id', ParseUUIDPipe) id: string) {
    await this.calendars.removeWorkWeek(id);
  }

  // ------------------------------------------------------------------ holiday calendars
  @Get('holiday-calendars')
  @RequirePermissions(READ)
  listCalendars() {
    return this.calendars.listCalendars();
  }

  @Post('holiday-calendars')
  @RequirePermissions(MANAGE)
  createCalendar(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createHolidayCalendarSchema))
    body: z.output<typeof createHolidayCalendarSchema>,
  ) {
    return this.calendars.createCalendar(p, body);
  }

  @Patch('holiday-calendars/:id')
  @RequirePermissions(MANAGE)
  updateCalendar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHolidayCalendarSchema))
    body: z.output<typeof updateHolidayCalendarSchema>,
  ) {
    return this.calendars.updateCalendar(id, body);
  }

  @Delete('holiday-calendars/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeCalendar(@Param('id', ParseUUIDPipe) id: string) {
    await this.calendars.removeCalendar(id);
  }

  @Get('holiday-calendars/:id/holidays')
  @RequirePermissions(READ)
  listHolidays(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(holidayListQuerySchema))
    q: z.output<typeof holidayListQuerySchema>,
  ) {
    return this.calendars.listHolidays(id, q.year);
  }

  @Post('holiday-calendars/:id/holidays')
  @RequirePermissions(MANAGE)
  @ApiOperation({ summary: 'Add one or more holidays (all-or-nothing)' })
  addHolidays(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(bulkHolidaysSchema)) body: z.output<typeof bulkHolidaysSchema>,
  ) {
    return this.calendars.addHolidays(p, id, body.holidays);
  }

  @Patch('holiday-calendars/:id/holidays/:holidayId')
  @RequirePermissions(MANAGE)
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Body(new ZodValidationPipe(updateHolidaySchema)) body: z.output<typeof updateHolidaySchema>,
  ) {
    return this.calendars.updateHoliday(id, holidayId, body);
  }

  @Delete('holiday-calendars/:id/holidays/:holidayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
  ) {
    await this.calendars.removeHoliday(id, holidayId);
  }

  // ------------------------------------------------------------------ resolution & chart
  @Get('calendar/resolve')
  @RequirePermissions(READ)
  @ApiOperation({
    summary: 'Working days for a branch (or organization defaults) over a date range',
  })
  resolve(
    @Query(new ZodValidationPipe(calendarResolveQuerySchema))
    q: z.output<typeof calendarResolveQuerySchema>,
  ) {
    return this.calendars.resolve(q);
  }

  @Get('org-chart')
  @RequirePermissions(PERMISSIONS.ORGANIZATION_STRUCTURE_READ)
  @ApiOperation({ summary: 'Structure tree: companies → branches and departments → teams' })
  getOrgChart(
    @Query(new ZodValidationPipe(orgChartQuerySchema)) q: z.output<typeof orgChartQuerySchema>,
  ) {
    return this.orgChart.get(q.includeInactive);
  }
}
