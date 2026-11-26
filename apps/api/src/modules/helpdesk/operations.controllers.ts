import type { Readable } from 'node:stream';
import {
  Body,
  Controller,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  articleSchema,
  clearanceDecisionSchema,
  clearanceTemplateSchema,
  completeComplianceTaskSchema,
  DOCUMENT_MAX_BYTES,
  exitAnalyticsQuerySchema,
  exitAnswersSchema,
  exitQuestionsSchema,
  expiryQuerySchema,
  helpdeskCategorySchema,
  obligationSchema,
  resignationDecisionSchema,
  resignationSchema,
  separationCaseSchema,
  separationSettingsSchema,
  ticketCommentSchema,
  ticketListQuerySchema,
  ticketRatingSchema,
  ticketSchema,
  ticketUpdateSchema,
  updateArticleSchema,
  updateHelpdeskCategorySchema,
  updateObligationSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import type { UploadedFileLike } from '../employees/employee-documents.service.js';
import { contentDisposition } from '../employees/employees.controller.js';
import { SeparationService } from '../separation/separation.service.js';
import { HelpdeskService } from './helpdesk.service.js';

const P = PERMISSIONS;
const SELF = P.EMPLOYEES_SELF_ACCESS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const upload = FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES + 1, files: 1 } });
const file = (f: { stream: Readable; fileName: string; size: number; contentType?: string }) =>
  new StreamableFile(f.stream, {
    type: f.contentType ?? 'application/octet-stream',
    ...(f.size ? { length: f.size } : {}),
    disposition: contentDisposition(f.fileName),
  });
const searchQuery = z.object({ search: z.string().trim().max(200).optional() });
const voteSchema = z.object({ helpful: z.boolean() });
const scopeQuery = z.object({ scope: z.enum(['mine', 'approvals', 'all']).default('mine') });
const caseQuery = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});
const settingsSchema = separationSettingsSchema.partial().extend({
  items: clearanceTemplateSchema.shape.items.optional(),
  questions: exitQuestionsSchema.shape.questions.optional(),
});
const taskQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['OPEN', 'COMPLETED']).optional(),
});

@ApiTags('Helpdesk')
@ApiBearerAuth()
@Controller('helpdesk')
export class HelpdeskController {
  constructor(private readonly helpdesk: HelpdeskService) {}

  @Get('categories')
  @RequirePermissions(SELF)
  categories() {
    return this.helpdesk.categories();
  }

  @Post('categories')
  @RequirePermissions(P.HELPDESK_CONFIG_MANAGE)
  createCategory(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(helpdeskCategorySchema)) b: Out<typeof helpdeskCategorySchema>,
  ) {
    return this.helpdesk.createCategory(p, b);
  }

  @Put('categories/:id')
  @RequirePermissions(P.HELPDESK_CONFIG_MANAGE)
  updateCategory(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateHelpdeskCategorySchema)) b: Out<typeof updateHelpdeskCategorySchema>,
  ) {
    return this.helpdesk.updateCategory(p, id, b);
  }

  @Get('tickets')
  @RequirePermissions(SELF)
  tickets(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(ticketListQuerySchema)) q: Out<typeof ticketListQuerySchema>,
  ) {
    return this.helpdesk.list(p, q);
  }

  @Post('tickets')
  @RequirePermissions(SELF)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(ticketSchema)) b: Out<typeof ticketSchema>,
  ) {
    return this.helpdesk.create(p, b);
  }

  @Get('tickets/:id')
  @RequirePermissions(SELF)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.helpdesk.get(p, id);
  }

  @Patch('tickets/:id')
  @RequirePermissions(SELF)
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(ticketUpdateSchema)) b: Out<typeof ticketUpdateSchema>,
  ) {
    return this.helpdesk.update(p, id, b);
  }

  @Post('tickets/:id/comments')
  @RequirePermissions(SELF)
  comment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(ticketCommentSchema)) b: Out<typeof ticketCommentSchema>,
  ) {
    return this.helpdesk.comment(p, id, b);
  }

  @Post('tickets/:id/rating')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  rate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(ticketRatingSchema)) b: Out<typeof ticketRatingSchema>,
  ) {
    return this.helpdesk.rate(p, id, b);
  }

  @Post('tickets/:id/attachments')
  @RequirePermissions(SELF)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  attach(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() f: UploadedFileLike | undefined,
  ) {
    return this.helpdesk.attach(p, id, f);
  }

  @Get('tickets/:id/attachments/:attachmentId')
  @RequirePermissions(SELF)
  async attachment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('attachmentId', uuid) attachmentId: string,
  ) {
    return file(await this.helpdesk.openAttachment(p, id, attachmentId));
  }

  @Get('articles')
  @RequirePermissions(SELF)
  articles(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(searchQuery)) q: Out<typeof searchQuery>,
  ) {
    return this.helpdesk.articles(p, q.search);
  }

  @Post('articles')
  @RequirePermissions(P.HELPDESK_KNOWLEDGE_MANAGE)
  createArticle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(articleSchema)) b: Out<typeof articleSchema>,
  ) {
    return this.helpdesk.createArticle(p, b);
  }

  @Patch('articles/:id')
  @RequirePermissions(P.HELPDESK_KNOWLEDGE_MANAGE)
  updateArticle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateArticleSchema)) b: Out<typeof updateArticleSchema>,
  ) {
    return this.helpdesk.updateArticle(p, id, b);
  }

  @Post('articles/:id/vote')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  vote(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(voteSchema)) b: Out<typeof voteSchema>,
  ) {
    return this.helpdesk.vote(p, id, b.helpful);
  }
}

@ApiTags('Separation')
@ApiBearerAuth()
@Controller()
export class SeparationController {
  constructor(private readonly separation: SeparationService) {}

  @Get('separation/settings')
  @RequirePermissions(P.SEPARATION_CASE_MANAGE)
  settings(@CurrentPrincipal() p: AuthPrincipal) {
    return this.separation.settings(p);
  }

  @Put('separation/settings')
  @RequirePermissions(P.SEPARATION_CASE_MANAGE)
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(settingsSchema)) b: Out<typeof settingsSchema>,
  ) {
    return this.separation.updateSettings(p, b);
  }

  @Post('me/resignation')
  @RequirePermissions(SELF)
  resign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(resignationSchema)) b: Out<typeof resignationSchema>,
  ) {
    return this.separation.resign(p, b);
  }

  @Get('separation/resignations')
  @RequirePermissions(SELF)
  resignations(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(scopeQuery)) q: Out<typeof scopeQuery>,
  ) {
    return this.separation.resignations(p, q.scope);
  }

  @Post('separation/resignations/:id/decision')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(resignationDecisionSchema)) b: Out<typeof resignationDecisionSchema>,
  ) {
    return this.separation.decideResignation(p, id, b);
  }

  @Post('separation/resignations/:id/withdraw')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.separation.withdrawResignation(p, id);
  }

  @Get('separation/cases')
  @RequirePermissions(SELF)
  cases(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(caseQuery)) q: Out<typeof caseQuery>) {
    return this.separation.cases(p, q.status);
  }

  @Post('separation/cases')
  @RequirePermissions(P.SEPARATION_CASE_MANAGE)
  startCase(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(separationCaseSchema)) b: Out<typeof separationCaseSchema>,
  ) {
    return this.separation.startCase(p, b);
  }

  @Get('separation/cases/:id')
  @RequirePermissions(SELF)
  getCase(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.separation.getCase(p, id);
  }

  @Post('separation/cases/:id/items/:itemId')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  item(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body(pipe(clearanceDecisionSchema)) b: Out<typeof clearanceDecisionSchema>,
  ) {
    return this.separation.decideItem(p, id, itemId, b);
  }

  @Post('separation/cases/:id/complete')
  @RequirePermissions(P.SEPARATION_CASE_MANAGE)
  @HttpCode(HttpStatus.OK)
  complete(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.separation.complete(p, id);
  }

  @Post('separation/cases/:id/cancel')
  @RequirePermissions(P.SEPARATION_CASE_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.separation.cancel(p, id);
  }

  @Get('separation/cases/:id/interview')
  @RequirePermissions(SELF)
  interview(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.separation.interviewQuestions(p, id);
  }

  @Post('separation/cases/:id/interview')
  @RequirePermissions(SELF)
  submitInterview(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(exitAnswersSchema)) b: Out<typeof exitAnswersSchema>,
  ) {
    return this.separation.submitInterview(p, id, b);
  }

  @Get('separation/analytics')
  @RequirePermissions(P.SEPARATION_INTERVIEW_READ)
  analytics(@Query(pipe(exitAnalyticsQuerySchema)) q: Out<typeof exitAnalyticsQuerySchema>) {
    return this.separation.analytics(q.from, q.to);
  }
}

@ApiTags('Compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get('obligations')
  @RequirePermissions(P.COMPLIANCE_CALENDAR_MANAGE)
  obligations() {
    return this.compliance.obligations();
  }

  @Post('obligations')
  @RequirePermissions(P.COMPLIANCE_CALENDAR_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(obligationSchema)) b: Out<typeof obligationSchema>,
  ) {
    return this.compliance.createObligation(p, b);
  }

  @Patch('obligations/:id')
  @RequirePermissions(P.COMPLIANCE_CALENDAR_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body(pipe(updateObligationSchema)) b: Out<typeof updateObligationSchema>,
  ) {
    return this.compliance.updateObligation(id, b);
  }

  @Get('tasks')
  @RequirePermissions(SELF)
  tasks(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(taskQuery)) q: Out<typeof taskQuery>) {
    return this.compliance.tasks(p, q.scope, q.status);
  }

  @Post('tasks/:id/complete')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  completeTask(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(completeComplianceTaskSchema)) b: Out<typeof completeComplianceTaskSchema>,
    @UploadedFile() f: UploadedFileLike | undefined,
  ) {
    return this.compliance.complete(p, id, b, f);
  }

  @Get('tasks/:id/evidence')
  @RequirePermissions(SELF)
  async evidence(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return file(await this.compliance.openEvidence(p, id));
  }

  @Get('expiring')
  @RequirePermissions(P.COMPLIANCE_DASHBOARD_READ)
  expiring(@Query(pipe(expiryQuerySchema)) q: Out<typeof expiryQuerySchema>) {
    return this.compliance.expiring(q.days);
  }

  @Get('dashboard')
  @RequirePermissions(P.COMPLIANCE_DASHBOARD_READ)
  dashboard(@CurrentPrincipal() p: AuthPrincipal) {
    return this.compliance.dashboard(p);
  }
}
