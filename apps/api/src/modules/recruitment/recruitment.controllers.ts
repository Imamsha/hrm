import {
  Body,
  Controller,
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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  assessmentSchema,
  candidateSchema,
  completeTaskSchema,
  createApplicationSchema,
  createOpeningSchema,
  createRequisitionSchema,
  DOCUMENT_MAX_BYTES,
  feedbackSchema,
  hireSchema,
  interviewSchema,
  interviewStatusSchema,
  moveStageSchema,
  offerSchema,
  offerStatusSchema,
  onboardingTemplateSchema,
  openingStatusSchema,
  recruitmentListQuerySchema,
  requisitionDecisionSchema,
  startOnboardingSchema,
  updateCandidateSchema,
  updateOnboardingTemplateSchema,
  updateOpeningSchema,
  updateRequisitionSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  AuthRateLimited,
  CurrentPrincipal,
  Public,
  RequirePermissions,
} from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import type { UploadedFileLike } from '../employees/employee-documents.service.js';
import { contentDisposition } from '../employees/employees.controller.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { ApplicationsService } from './applications.service.js';
import { CandidatesService } from './candidates.service.js';
import { OpeningsService } from './openings.service.js';

const P = PERMISSIONS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const listPipe = pipe(recruitmentListQuerySchema);
type ListQuery = Out<typeof recruitmentListQuerySchema>;
const fileUpload = (field: string) =>
  FileInterceptor(field, { limits: { fileSize: DOCUMENT_MAX_BYTES + 1, files: 1 } });

@ApiTags('Recruitment')
@ApiBearerAuth()
@Controller('recruitment')
export class RecruitmentController {
  constructor(
    private readonly openings: OpeningsService,
    private readonly candidates: CandidatesService,
    private readonly applications: ApplicationsService,
  ) {}

  // ------------------------------------------------------------------ requisitions
  @Get('requisitions')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_READ)
  requisitions(@Query(listPipe) q: ListQuery) {
    return this.openings.listRequisitions(q);
  }

  @Get('requisitions/:id')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_READ)
  requisition(@Param('id', uuid) id: string) {
    return this.openings.getRequisition(id);
  }

  @Post('requisitions')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_MANAGE)
  createRequisition(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createRequisitionSchema)) body: Out<typeof createRequisitionSchema>,
  ) {
    return this.openings.createRequisition(p, body);
  }

  @Patch('requisitions/:id')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_MANAGE)
  updateRequisition(
    @Param('id', uuid) id: string,
    @Body(pipe(updateRequisitionSchema)) body: Out<typeof updateRequisitionSchema>,
  ) {
    return this.openings.updateRequisition(id, body);
  }

  @Post('requisitions/:id/submit')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_MANAGE)
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', uuid) id: string) {
    return this.openings.submitRequisition(id);
  }

  @Post('requisitions/:id/cancel')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancelRequisition(@Param('id', uuid) id: string) {
    return this.openings.cancelRequisition(id);
  }

  @Post('requisitions/:id/decision')
  @RequirePermissions(P.RECRUITMENT_REQUISITION_APPROVE)
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(requisitionDecisionSchema)) body: Out<typeof requisitionDecisionSchema>,
  ) {
    return this.openings.decideRequisition(p, id, body);
  }

  // ------------------------------------------------------------------ openings
  @Get('openings')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  openingsList(@Query(listPipe) q: ListQuery) {
    return this.openings.listOpenings(q);
  }

  @Get('openings/:id')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  opening(@Param('id', uuid) id: string) {
    return this.openings.getOpening(id);
  }

  @Post('openings')
  @RequirePermissions(P.RECRUITMENT_OPENING_MANAGE)
  createOpening(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createOpeningSchema)) body: Out<typeof createOpeningSchema>,
  ) {
    return this.openings.createOpening(p, body);
  }

  @Patch('openings/:id')
  @RequirePermissions(P.RECRUITMENT_OPENING_MANAGE)
  updateOpening(
    @Param('id', uuid) id: string,
    @Body(pipe(updateOpeningSchema)) body: Out<typeof updateOpeningSchema>,
  ) {
    return this.openings.updateOpening(id, body);
  }

  @Put('openings/:id/status')
  @RequirePermissions(P.RECRUITMENT_OPENING_MANAGE)
  openingStatus(
    @Param('id', uuid) id: string,
    @Body(pipe(openingStatusSchema)) body: Out<typeof openingStatusSchema>,
  ) {
    return this.openings.setOpeningStatus(id, body.status);
  }

  // ------------------------------------------------------------------ candidates
  @Get('candidates')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  candidatesList(@Query(listPipe) q: ListQuery) {
    return this.candidates.list(q);
  }

  @Get('candidates/:id')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  candidate(@Param('id', uuid) id: string) {
    return this.candidates.get(id);
  }

  @Post('candidates')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  createCandidate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(candidateSchema)) body: Out<typeof candidateSchema>,
  ) {
    return this.candidates.create(p, body);
  }

  @Patch('candidates/:id')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  updateCandidate(
    @Param('id', uuid) id: string,
    @Body(pipe(updateCandidateSchema)) body: Out<typeof updateCandidateSchema>,
  ) {
    return this.candidates.update(id, body);
  }

  @Post('candidates/:id/resume')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(fileUpload('resume'))
  uploadResume(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.candidates.uploadResume(p, id, file);
  }

  @Get('candidates/:id/resume')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  async resume(@Param('id', uuid) id: string) {
    const r = await this.candidates.openResume(id);
    return new StreamableFile(r.stream, {
      type: r.contentType,
      length: r.sizeBytes,
      disposition: contentDisposition(r.fileName),
    });
  }

  // ------------------------------------------------------------------ applications
  @Get('applications')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  applicationsList(@Query(listPipe) q: ListQuery) {
    return this.applications.list(q);
  }

  @Get('applications/:id')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_READ)
  application(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.applications.get(p, id);
  }

  @Post('applications')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  createApplication(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createApplicationSchema)) body: Out<typeof createApplicationSchema>,
  ) {
    return this.applications.create(p, body.candidateId, body.openingId);
  }

  @Post('applications/:id/stage')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move through the pipeline (always a human decision)' })
  moveStage(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(moveStageSchema)) body: Out<typeof moveStageSchema>,
  ) {
    return this.applications.moveStage(p, id, body);
  }

  @Post('applications/:id/assessments')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  assess(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(assessmentSchema)) body: Out<typeof assessmentSchema>,
  ) {
    return this.applications.addAssessment(p, id, body);
  }

  @Post('applications/:id/interviews')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  schedule(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(interviewSchema)) body: Out<typeof interviewSchema>,
  ) {
    return this.applications.scheduleInterview(p, id, body);
  }

  @Put('interviews/:id/status')
  @RequirePermissions(P.RECRUITMENT_CANDIDATE_MANAGE)
  interviewStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(interviewStatusSchema)) body: Out<typeof interviewStatusSchema>,
  ) {
    return this.applications.setInterviewStatus(p, id, body.status);
  }

  @Post('applications/:id/offers')
  @RequirePermissions(P.RECRUITMENT_OFFER_MANAGE)
  offer(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(offerSchema)) body: Out<typeof offerSchema>,
  ) {
    return this.applications.createOffer(p, id, body);
  }

  @Put('offers/:id/status')
  @RequirePermissions(P.RECRUITMENT_OFFER_MANAGE)
  offerStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(offerStatusSchema)) body: Out<typeof offerStatusSchema>,
  ) {
    return this.applications.setOfferStatus(p, id, body.status);
  }

  @Post('applications/:id/hire')
  @RequirePermissions(P.RECRUITMENT_OFFER_MANAGE)
  @ApiOperation({
    summary:
      'Create the employee from the accepted offer (joining) and optionally start onboarding',
  })
  hire(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(hireSchema)) body: Out<typeof hireSchema>,
  ) {
    return this.applications.hire(p, id, body);
  }
}

/** Interviews assigned to the caller as a panelist (any employee). */
@ApiTags('Recruitment')
@ApiBearerAuth()
@RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
@Controller('me/interviews')
export class MyInterviewsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@CurrentPrincipal() p: AuthPrincipal) {
    return this.applications.myInterviews(p);
  }

  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  feedback(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(feedbackSchema)) body: Out<typeof feedbackSchema>,
  ) {
    return this.applications.submitFeedback(p, id, body);
  }
}

/** Public career portal (no authentication; rate-limited like credential endpoints). */
@ApiTags('Career portal')
@Public()
@Controller('careers/:organizationSlug')
export class CareersController {
  constructor(
    private readonly openings: OpeningsService,
    private readonly candidates: CandidatesService,
  ) {}

  @Get('jobs')
  jobs(@Param('organizationSlug') org: string) {
    return this.openings.careers(org);
  }

  @Get('jobs/:slug')
  async job(@Param('organizationSlug') org: string, @Param('slug') slug: string) {
    const { id: _id, ...publicFields } = await this.openings.publicOpening(org, slug);
    return publicFields;
  }

  @Post('jobs/:slug/applications')
  @AuthRateLimited()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(fileUpload('resume'))
  apply(
    @Param('organizationSlug') org: string,
    @Param('slug') slug: string,
    @Body() fields: unknown,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Ip() ip: string,
  ) {
    return this.candidates.applyFromPortal(org, slug, fields, file, ip);
  }
}

@ApiTags('Onboarding')
@ApiBearerAuth()
@Controller()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('onboarding/templates')
  @RequirePermissions(P.ONBOARDING_PLAN_READ)
  templates() {
    return this.onboarding.listTemplates();
  }

  @Post('onboarding/templates')
  @RequirePermissions(P.ONBOARDING_TEMPLATE_MANAGE)
  createTemplate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(onboardingTemplateSchema)) body: Out<typeof onboardingTemplateSchema>,
  ) {
    return this.onboarding.createTemplate(p, body);
  }

  @Patch('onboarding/templates/:id')
  @RequirePermissions(P.ONBOARDING_TEMPLATE_MANAGE)
  updateTemplate(
    @Param('id', uuid) id: string,
    @Body(pipe(updateOnboardingTemplateSchema)) body: Out<typeof updateOnboardingTemplateSchema>,
  ) {
    return this.onboarding.updateTemplate(id, body);
  }

  @Get('onboarding/plans')
  @RequirePermissions(P.ONBOARDING_PLAN_READ)
  plans(@CurrentPrincipal() p: AuthPrincipal, @Query('status') status?: string) {
    return this.onboarding.listPlans(p, status);
  }

  @Post('onboarding/plans')
  @RequirePermissions(P.ONBOARDING_PLAN_MANAGE)
  start(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(startOnboardingSchema)) body: Out<typeof startOnboardingSchema>,
  ) {
    return this.onboarding.start(p, body.employeeId, body.templateId);
  }

  @Get('onboarding/plans/:id')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  plan(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.onboarding.getPlan(p, id);
  }

  @Post('onboarding/plans/:id/cancel')
  @RequirePermissions(P.ONBOARDING_PLAN_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.onboarding.cancelPlan(p, id);
  }

  /** HR, or the task's assignee (the joiner or their manager). */
  @Put('onboarding/tasks/:id/status')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  taskStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(completeTaskSchema)) body: Out<typeof completeTaskSchema>,
  ) {
    return this.onboarding.setTaskStatus(p, id, body.status);
  }

  @Get('me/onboarding')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  myPlan(@CurrentPrincipal() p: AuthPrincipal) {
    return this.onboarding.myPlan(p);
  }

  @Get('me/onboarding/tasks')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  myTasks(@CurrentPrincipal() p: AuthPrincipal) {
    return this.onboarding.myTasks(p);
  }

  @Post('me/onboarding/tasks/:id/document')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(fileUpload('file'))
  @HttpCode(HttpStatus.OK)
  uploadTaskDocument(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.onboarding.uploadTaskDocument(p, id, file);
  }
}
