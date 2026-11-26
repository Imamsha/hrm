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
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  billingSettingsSchema,
  boardColumnsSchema,
  clientContactSchema,
  clientSchema,
  commentSchema,
  completeSprintSchema,
  invoiceSchema,
  issueInvoiceSchema,
  paymentSchema,
  portalCommentSchema,
  portalRequestSchema,
  portalUserSchema,
  projectListQuerySchema,
  projectMemberSchema,
  projectSchema,
  sprintSchema,
  taxRateSchema,
  timeReportQuerySchema,
  timesheetDecisionSchema,
  timesheetListQuerySchema,
  timesheetSchema,
  updateClientSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  updateWorkItemSchema,
  voidInvoiceSchema,
  workItemListQuerySchema,
  workItemSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { todayIso } from '../employees/employee-scope.js';
import { BillingService } from './billing.service.js';
import { ClientsService } from './clients.service.js';
import { PortalService } from './portal.service.js';
import { ProjectsService } from './projects.service.js';
import { TimesheetsService } from './timesheets.service.js';

const P = PERMISSIONS;
const SELF = P.EMPLOYEES_SELF_ACCESS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const boardQuery = z.object({ sprintId: z.uuid().optional() });
const weekQuery = z.object({ date: z.iso.date().optional() });
const invoiceQuery = z.object({
  status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID']).optional(),
  clientId: z.uuid().optional(),
});

@ApiTags('Clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  /** Client managers, billing, and project readers (service check). */
  @Get()
  @RequirePermissions(SELF)
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.clients.list(p);
  }

  @Post()
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(clientSchema)) b: Out<typeof clientSchema>,
  ) {
    return this.clients.create(p, b);
  }

  @Patch(':id')
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body(pipe(updateClientSchema)) b: Out<typeof updateClientSchema>,
  ) {
    return this.clients.update(id, b);
  }

  @Post(':id/contacts')
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  addContact(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(clientContactSchema)) b: Out<typeof clientContactSchema>,
  ) {
    return this.clients.addContact(p, id, b);
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  removeContact(@Param('id', uuid) id: string, @Param('contactId', uuid) contactId: string) {
    return this.clients.removeContact(id, contactId);
  }

  @Post(':id/portal-users')
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  addPortalUser(
    @Param('id', uuid) id: string,
    @Body(pipe(portalUserSchema)) b: Out<typeof portalUserSchema>,
  ) {
    return this.clients.addPortalUser(id, b);
  }

  @Delete(':id/portal-users/:membershipId')
  @RequirePermissions(P.PROJECTS_CLIENT_MANAGE)
  removePortalUser(
    @Param('id', uuid) id: string,
    @Param('membershipId', uuid) membershipId: string,
  ) {
    return this.clients.removePortalUser(id, membershipId);
  }
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  @RequirePermissions(SELF)
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(projectListQuerySchema)) q: Out<typeof projectListQuerySchema>,
  ) {
    return this.projects.list(p, q);
  }

  @Post('projects')
  @RequirePermissions(P.PROJECTS_PROJECT_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(projectSchema)) b: Out<typeof projectSchema>,
  ) {
    return this.projects.create(p, b);
  }

  @Get('projects/:id')
  @RequirePermissions(SELF)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.projects.get(p, id);
  }

  @Patch('projects/:id')
  @RequirePermissions(SELF)
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateProjectSchema)) b: Out<typeof updateProjectSchema>,
  ) {
    return this.projects.update(p, id, b);
  }

  @Post('projects/:id/members')
  @RequirePermissions(SELF)
  addMember(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(projectMemberSchema)) b: Out<typeof projectMemberSchema>,
  ) {
    return this.projects.addMember(p, id, b);
  }

  @Patch('projects/:id/members/:memberId')
  @RequirePermissions(SELF)
  updateMember(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('memberId', uuid) memberId: string,
    @Body(pipe(updateProjectMemberSchema)) b: Out<typeof updateProjectMemberSchema>,
  ) {
    return this.projects.updateMember(p, id, memberId, b);
  }

  @Delete('projects/:id/members/:memberId')
  @RequirePermissions(SELF)
  removeMember(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('memberId', uuid) memberId: string,
  ) {
    return this.projects.removeMember(p, id, memberId);
  }

  @Put('projects/:id/columns')
  @RequirePermissions(SELF)
  columns(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(boardColumnsSchema)) b: Out<typeof boardColumnsSchema>,
  ) {
    return this.projects.setColumns(p, id, b);
  }

  @Post('projects/:id/sprints')
  @RequirePermissions(SELF)
  createSprint(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(sprintSchema)) b: Out<typeof sprintSchema>,
  ) {
    return this.projects.createSprint(p, id, b);
  }

  @Post('projects/:id/sprints/:sprintId/start')
  @RequirePermissions(SELF)
  startSprint(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('sprintId', uuid) sprintId: string,
  ) {
    return this.projects.startSprint(p, id, sprintId);
  }

  @Post('projects/:id/sprints/:sprintId/complete')
  @RequirePermissions(SELF)
  completeSprint(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('sprintId', uuid) sprintId: string,
    @Body(pipe(completeSprintSchema)) b: Out<typeof completeSprintSchema>,
  ) {
    return this.projects.completeSprint(p, id, sprintId, b);
  }

  @Get('projects/:id/board')
  @RequirePermissions(SELF)
  board(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(boardQuery)) q: Out<typeof boardQuery>,
  ) {
    return this.projects.board(p, id, q.sprintId);
  }

  @Get('projects/:id/items')
  @RequirePermissions(SELF)
  items(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(workItemListQuerySchema)) q: Out<typeof workItemListQuerySchema>,
  ) {
    return this.projects.listItems(p, id, q);
  }

  @Post('projects/:id/items')
  @RequirePermissions(SELF)
  createItem(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(workItemSchema)) b: Out<typeof workItemSchema>,
  ) {
    return this.projects.createItem(p, id, b);
  }

  @Get('projects/:id/items/:itemId')
  @RequirePermissions(SELF)
  item(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
  ) {
    return this.projects.getItem(p, id, itemId);
  }

  @Patch('projects/:id/items/:itemId')
  @RequirePermissions(SELF)
  updateItem(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body(pipe(updateWorkItemSchema)) b: Out<typeof updateWorkItemSchema>,
  ) {
    return this.projects.updateItem(p, id, itemId, b);
  }

  @Post('projects/:id/items/:itemId/comments')
  @RequirePermissions(SELF)
  comment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body(pipe(commentSchema)) b: Out<typeof commentSchema>,
  ) {
    return this.projects.addComment(p, id, itemId, b);
  }

  @Get('me/work')
  @RequirePermissions(SELF)
  myWork(@CurrentPrincipal() p: AuthPrincipal) {
    return this.projects.myWork(p);
  }
}

@ApiTags('Timesheets')
@ApiBearerAuth()
@Controller()
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get('me/timesheet')
  @RequirePermissions(SELF)
  mine(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(weekQuery)) q: Out<typeof weekQuery>) {
    return this.timesheets.mine(p, q.date ?? todayIso());
  }

  @Put('me/timesheet')
  @RequirePermissions(SELF)
  save(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(timesheetSchema)) b: Out<typeof timesheetSchema>,
  ) {
    return this.timesheets.save(p, b);
  }

  @Post('timesheets/:id/submit')
  @RequirePermissions(SELF)
  submit(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.timesheets.submit(p, id);
  }

  @Post('timesheets/:id/recall')
  @RequirePermissions(SELF)
  recall(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.timesheets.recall(p, id);
  }

  @Get('timesheets')
  @RequirePermissions(SELF)
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(timesheetListQuerySchema)) q: Out<typeof timesheetListQuerySchema>,
  ) {
    return this.timesheets.list(p, q);
  }

  @Get('timesheets/:id')
  @RequirePermissions(SELF)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.timesheets.get(p, id);
  }

  @Post('timesheets/:id/decision')
  @RequirePermissions(SELF)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(timesheetDecisionSchema)) b: Out<typeof timesheetDecisionSchema>,
  ) {
    return this.timesheets.decide(p, id, b);
  }

  /** Timesheet readers and billing (service check). */
  @Get('reports/time')
  @RequirePermissions(SELF)
  report(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(timeReportQuerySchema)) q: Out<typeof timeReportQuerySchema>,
  ) {
    return this.timesheets.report(p, q);
  }
}

@ApiTags('Billing')
@ApiBearerAuth()
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/tax-rates')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  taxRates() {
    return this.billing.taxRates();
  }

  @Post('billing/tax-rates')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  createTaxRate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(taxRateSchema)) b: Out<typeof taxRateSchema>,
  ) {
    return this.billing.createTaxRate(p, b);
  }

  @Get('billing/settings')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  settings(@CurrentPrincipal() p: AuthPrincipal) {
    return this.billing.settings(p);
  }

  @Put('billing/settings')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(billingSettingsSchema)) b: Out<typeof billingSettingsSchema>,
  ) {
    return this.billing.updateSettings(p, b);
  }

  @Get('invoices')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  list(@Query(pipe(invoiceQuery)) q: Out<typeof invoiceQuery>) {
    return this.billing.list(q);
  }

  @Post('invoices')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(invoiceSchema)) b: Out<typeof invoiceSchema>,
  ) {
    return this.billing.create(p, b);
  }

  @Get('invoices/:id')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  get(@Param('id', uuid) id: string) {
    return this.billing.get(id);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  async pdf(@Param('id', uuid) id: string) {
    const f = await this.billing.pdf(id);
    return new StreamableFile(Buffer.from(f.body), {
      type: 'application/pdf',
      length: f.body.length,
      disposition: `inline; filename="${f.fileName}"`,
    });
  }

  @Delete('invoices/:id')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', uuid) id: string): Promise<void> {
    await this.billing.deleteDraft(id);
  }

  @Post('invoices/:id/issue')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  issue(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(issueInvoiceSchema)) b: Out<typeof issueInvoiceSchema>,
  ) {
    return this.billing.issue(p, id, b);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  pay(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(paymentSchema)) b: Out<typeof paymentSchema>,
  ) {
    return this.billing.recordPayment(p, id, b);
  }

  @Post('invoices/:id/void')
  @RequirePermissions(P.PROJECTS_BILLING_MANAGE)
  void(
    @Param('id', uuid) id: string,
    @Body(pipe(voidInvoiceSchema)) b: Out<typeof voidInvoiceSchema>,
  ) {
    return this.billing.void(id, b);
  }
}

@ApiTags('Client portal')
@ApiBearerAuth()
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  summary(@CurrentPrincipal() p: AuthPrincipal) {
    return this.portal.summary(p);
  }

  @Get('projects/:id/items')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  items(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.portal.items(p, id);
  }

  @Get('items/:id')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  item(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.portal.item(p, id);
  }

  @Post('requests')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  request(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(portalRequestSchema)) b: Out<typeof portalRequestSchema>,
  ) {
    return this.portal.request(p, b);
  }

  @Post('items/:id/comments')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  comment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(portalCommentSchema)) b: Out<typeof portalCommentSchema>,
  ) {
    return this.portal.comment(p, id, b);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  async invoicePdf(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    const f = await this.portal.invoicePdf(p, id);
    return new StreamableFile(Buffer.from(f.body), {
      type: 'application/pdf',
      length: f.body.length,
      disposition: `inline; filename="${f.fileName}"`,
    });
  }

  @Get('invoices/:id')
  @RequirePermissions(P.PROJECTS_PORTAL_ACCESS)
  invoice(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.portal.invoice(p, id);
  }
}
