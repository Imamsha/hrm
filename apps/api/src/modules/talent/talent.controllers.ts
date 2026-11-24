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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  announcementSchema,
  badgeSchema,
  calibrationSchema,
  competencySchema,
  courseFeedbackSchema,
  courseSchema,
  cycleStatusSchema,
  eventSchema,
  goalCheckInSchema,
  goalSchema,
  learningAssignmentSchema,
  learningPathSchema,
  peerNominationSchema,
  pipCheckInSchema,
  pipOutcomeSchema,
  pipSchema,
  quizAttemptSchema,
  ratingScaleSchema,
  recognitionSchema,
  redemptionDecisionSchema,
  reviewCycleSchema,
  reviewResponseSchema,
  reviewTemplateSchema,
  rewardSchema,
  rsvpSchema,
  suggestionSchema,
  suggestionStatusSchema,
  surveyResponseSchema,
  surveySchema,
  talentListQuerySchema,
  updateCompetencySchema,
  updateCourseSchema,
  updateGoalSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { EngagementService } from './engagement.service.js';
import { LearningService } from './learning.service.js';
import { PerformanceService } from './performance.service.js';

const P = PERMISSIONS;
const SELF = P.EMPLOYEES_SELF_ACCESS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const enrollmentQuery = z.object({
  courseId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  status: z.string().trim().toUpperCase().max(20).optional(),
});
const matrixQuery = z.object({ days: z.coerce.number().int().min(1).max(730).default(60) });
const allQuery = z.object({ all: z.stringbool().optional() });
const statusQuery = z.object({ status: z.enum(['PENDING', 'FULFILLED', 'REJECTED']).optional() });

@ApiTags('Performance')
@ApiBearerAuth()
@Controller()
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  @Get('performance/scales')
  @RequirePermissions(SELF)
  scales() {
    return this.perf.scales();
  }

  @Post('performance/scales')
  @RequirePermissions(P.PERFORMANCE_CONFIG_MANAGE)
  createScale(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(ratingScaleSchema)) b: Out<typeof ratingScaleSchema>,
  ) {
    return this.perf.createScale(p, b);
  }

  @Get('performance/competencies')
  @RequirePermissions(SELF)
  competencies() {
    return this.perf.competencies();
  }

  @Post('performance/competencies')
  @RequirePermissions(P.PERFORMANCE_CONFIG_MANAGE)
  createCompetency(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(competencySchema)) b: Out<typeof competencySchema>,
  ) {
    return this.perf.createCompetency(p, b);
  }

  @Patch('performance/competencies/:id')
  @RequirePermissions(P.PERFORMANCE_CONFIG_MANAGE)
  updateCompetency(
    @Param('id', uuid) id: string,
    @Body(pipe(updateCompetencySchema)) b: Out<typeof updateCompetencySchema>,
  ) {
    return this.perf.updateCompetency(id, b);
  }

  @Get('performance/templates')
  @RequirePermissions(SELF)
  templates() {
    return this.perf.templates();
  }

  @Post('performance/templates')
  @RequirePermissions(P.PERFORMANCE_CONFIG_MANAGE)
  createTemplate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(reviewTemplateSchema)) b: Out<typeof reviewTemplateSchema>,
  ) {
    return this.perf.createTemplate(p, b);
  }

  @Get('performance/cycles')
  @RequirePermissions(SELF)
  cycles() {
    return this.perf.cycles();
  }

  @Post('performance/cycles')
  @RequirePermissions(P.PERFORMANCE_CYCLE_MANAGE)
  createCycle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(reviewCycleSchema)) b: Out<typeof reviewCycleSchema>,
  ) {
    return this.perf.createCycle(p, b);
  }

  @Put('performance/cycles/:id/status')
  @RequirePermissions(P.PERFORMANCE_CYCLE_MANAGE)
  cycleStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(cycleStatusSchema)) b: Out<typeof cycleStatusSchema>,
  ) {
    return this.perf.setCycleStatus(p, id, b.status);
  }

  /** HR: everyone in the cycle; managers: their direct reports. */
  @Get('performance/cycles/:id/participants')
  @RequirePermissions(SELF)
  participants(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.participants(p, id);
  }

  @Get('performance/cycles/:id/distribution')
  @RequirePermissions(P.PERFORMANCE_CYCLE_MANAGE)
  distribution(@Param('id', uuid) id: string) {
    return this.perf.distribution(id);
  }

  @Get('performance/reviews/:id')
  @RequirePermissions(SELF)
  review(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.review(p, id);
  }

  @Post('performance/reviews/:id/peers')
  @RequirePermissions(SELF)
  nominate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(peerNominationSchema)) b: Out<typeof peerNominationSchema>,
  ) {
    return this.perf.nominatePeers(p, id, b.reviewerEmployeeIds);
  }

  @Post('performance/reviews/:id/calibrate')
  @RequirePermissions(P.PERFORMANCE_CYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  calibrate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(calibrationSchema)) b: Out<typeof calibrationSchema>,
  ) {
    return this.perf.calibrate(p, id, b);
  }

  @Post('performance/reviews/:id/acknowledge')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  acknowledge(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.acknowledge(p, id);
  }

  @Put('performance/responses/:id')
  @RequirePermissions(SELF)
  saveResponse(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(reviewResponseSchema)) b: Out<typeof reviewResponseSchema>,
  ) {
    return this.perf.saveResponse(p, id, b);
  }

  @Post('performance/responses/:id/decline')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  decline(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.declineResponse(p, id);
  }

  @Get('me/review-tasks')
  @RequirePermissions(SELF)
  myTasks(@CurrentPrincipal() p: AuthPrincipal) {
    return this.perf.myTasks(p);
  }

  @Get('me/reviews')
  @RequirePermissions(SELF)
  myReviews(@CurrentPrincipal() p: AuthPrincipal) {
    return this.perf.myReviews(p);
  }

  @Get('goals')
  @RequirePermissions(SELF)
  goals(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(talentListQuerySchema)) q: Out<typeof talentListQuerySchema>,
  ) {
    return this.perf.goals(p, q);
  }

  @Post('goals')
  @RequirePermissions(SELF)
  createGoal(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(goalSchema)) b: Out<typeof goalSchema>,
  ) {
    return this.perf.createGoal(p, b);
  }

  @Patch('goals/:id')
  @RequirePermissions(SELF)
  updateGoal(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateGoalSchema)) b: Out<typeof updateGoalSchema>,
  ) {
    return this.perf.updateGoal(p, id, b);
  }

  @Get('goals/:id/check-ins')
  @RequirePermissions(SELF)
  goalHistory(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.goalHistory(p, id);
  }

  @Post('goals/:id/check-ins')
  @RequirePermissions(SELF)
  checkIn(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(goalCheckInSchema)) b: Out<typeof goalCheckInSchema>,
  ) {
    return this.perf.checkIn(p, id, b);
  }

  @Get('performance/pips')
  @RequirePermissions(SELF)
  pips(@CurrentPrincipal() p: AuthPrincipal) {
    return this.perf.pips(p);
  }

  @Post('performance/pips')
  @RequirePermissions(SELF)
  createPip(@CurrentPrincipal() p: AuthPrincipal, @Body(pipe(pipSchema)) b: Out<typeof pipSchema>) {
    return this.perf.createPip(p, b);
  }

  @Get('performance/pips/:id')
  @RequirePermissions(SELF)
  pip(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.perf.pip(p, id);
  }

  @Post('performance/pips/:id/check-ins')
  @RequirePermissions(SELF)
  pipCheckIn(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(pipCheckInSchema)) b: Out<typeof pipCheckInSchema>,
  ) {
    return this.perf.pipCheckIn(p, id, b);
  }

  @Post('performance/pips/:id/outcome')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  pipOutcome(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(pipOutcomeSchema)) b: Out<typeof pipOutcomeSchema>,
  ) {
    return this.perf.pipOutcome(p, id, b);
  }
}

@ApiTags('Learning')
@ApiBearerAuth()
@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get('learning/courses')
  @RequirePermissions(SELF)
  courses(@CurrentPrincipal() p: AuthPrincipal) {
    return this.learning.courses(p);
  }

  @Post('learning/courses')
  @RequirePermissions(P.LEARNING_COURSE_MANAGE)
  createCourse(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(courseSchema)) b: Out<typeof courseSchema>,
  ) {
    return this.learning.createCourse(p, b);
  }

  @Get('learning/courses/:id')
  @RequirePermissions(SELF)
  course(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.learning.course(p, id);
  }

  @Patch('learning/courses/:id')
  @RequirePermissions(P.LEARNING_COURSE_MANAGE)
  updateCourse(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateCourseSchema)) b: Out<typeof updateCourseSchema>,
  ) {
    return this.learning.updateCourse(p, id, b);
  }

  @Post('learning/courses/:id/enroll')
  @RequirePermissions(SELF)
  enroll(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.learning.selfEnroll(p, id);
  }

  @Get('learning/paths')
  @RequirePermissions(SELF)
  paths() {
    return this.learning.paths();
  }

  @Post('learning/paths')
  @RequirePermissions(P.LEARNING_COURSE_MANAGE)
  createPath(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(learningPathSchema)) b: Out<typeof learningPathSchema>,
  ) {
    return this.learning.createPath(p, b);
  }

  /** HR assigns to anyone or an audience; managers to their direct reports. */
  @Post('learning/assignments')
  @RequirePermissions(SELF)
  assign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(learningAssignmentSchema)) b: Out<typeof learningAssignmentSchema>,
  ) {
    return this.learning.assign(p, b);
  }

  @Get('learning/enrollments')
  @RequirePermissions(SELF)
  enrollments(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(enrollmentQuery)) q: Out<typeof enrollmentQuery>,
  ) {
    return this.learning.enrollments(p, q);
  }

  @Get('learning/skill-matrix')
  @RequirePermissions(SELF)
  matrix(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(matrixQuery)) q: Out<typeof matrixQuery>,
  ) {
    return this.learning.skillMatrix(p, q.days);
  }

  @Get('me/learning')
  @RequirePermissions(SELF)
  mine(@CurrentPrincipal() p: AuthPrincipal) {
    return this.learning.myLearning(p);
  }

  @Post('me/learning/:enrollmentId/modules/:moduleId/complete')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('enrollmentId', uuid) e: string,
    @Param('moduleId', uuid) m: string,
  ) {
    return this.learning.completeModule(p, e, m);
  }

  @Post('me/learning/:enrollmentId/quizzes/:moduleId')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  quiz(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('enrollmentId', uuid) e: string,
    @Param('moduleId', uuid) m: string,
    @Body(pipe(quizAttemptSchema)) b: Out<typeof quizAttemptSchema>,
  ) {
    return this.learning.attemptQuiz(p, e, m, b);
  }

  @Post('me/learning/:enrollmentId/feedback')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  feedback(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('enrollmentId', uuid) e: string,
    @Body(pipe(courseFeedbackSchema)) b: Out<typeof courseFeedbackSchema>,
  ) {
    return this.learning.feedback(p, e, b);
  }

  @Post('me/learning/:enrollmentId/withdraw')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentPrincipal() p: AuthPrincipal, @Param('enrollmentId', uuid) e: string) {
    return this.learning.withdraw(p, e);
  }
}

@ApiTags('Engagement')
@ApiBearerAuth()
@Controller()
export class EngagementController {
  constructor(private readonly eng: EngagementService) {}

  @Get('engagement/surveys')
  @RequirePermissions(SELF)
  surveys(@CurrentPrincipal() p: AuthPrincipal) {
    return this.eng.surveys(p);
  }

  @Post('engagement/surveys')
  @RequirePermissions(P.ENGAGEMENT_SURVEY_MANAGE)
  createSurvey(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(surveySchema)) b: Out<typeof surveySchema>,
  ) {
    return this.eng.createSurvey(p, b);
  }

  @Post('engagement/surveys/:id/publish')
  @RequirePermissions(P.ENGAGEMENT_SURVEY_MANAGE)
  @HttpCode(HttpStatus.OK)
  publish(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.publishSurvey(p, id);
  }

  @Post('engagement/surveys/:id/close')
  @RequirePermissions(P.ENGAGEMENT_SURVEY_MANAGE)
  @HttpCode(HttpStatus.OK)
  close(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.closeSurvey(p, id);
  }

  @Post('engagement/surveys/:id/responses')
  @RequirePermissions(SELF)
  respond(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(surveyResponseSchema)) b: Out<typeof surveyResponseSchema>,
  ) {
    return this.eng.respond(p, id, b);
  }

  @Get('engagement/surveys/:id/results')
  @RequirePermissions(P.ENGAGEMENT_SURVEY_MANAGE)
  results(@Param('id', uuid) id: string) {
    return this.eng.results(id);
  }

  @Get('engagement/badges')
  @RequirePermissions(SELF)
  badges() {
    return this.eng.badges();
  }

  @Post('engagement/badges')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  createBadge(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(badgeSchema)) b: Out<typeof badgeSchema>,
  ) {
    return this.eng.createBadge(p, b);
  }

  @Get('engagement/recognitions')
  @RequirePermissions(SELF)
  feed(@CurrentPrincipal() p: AuthPrincipal) {
    return this.eng.feed(p);
  }

  @Post('engagement/recognitions')
  @RequirePermissions(SELF)
  recognize(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(recognitionSchema)) b: Out<typeof recognitionSchema>,
  ) {
    return this.eng.recognize(p, b);
  }

  @Get('me/recognition')
  @RequirePermissions(SELF)
  mySummary(@CurrentPrincipal() p: AuthPrincipal) {
    return this.eng.mySummary(p);
  }

  @Get('engagement/rewards')
  @RequirePermissions(SELF)
  rewards() {
    return this.eng.rewards();
  }

  @Post('engagement/rewards')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  createReward(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(rewardSchema)) b: Out<typeof rewardSchema>,
  ) {
    return this.eng.createReward(p, b);
  }

  @Post('engagement/rewards/:id/redeem')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  redeem(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.redeem(p, id);
  }

  @Get('engagement/redemptions')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  redemptions(@Query(pipe(statusQuery)) q: Out<typeof statusQuery>) {
    return this.eng.redemptions(q.status);
  }

  @Post('engagement/redemptions/:id/decision')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  decideRedemption(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(redemptionDecisionSchema)) b: Out<typeof redemptionDecisionSchema>,
  ) {
    return this.eng.decideRedemption(p, id, b);
  }

  @Get('engagement/announcements')
  @RequirePermissions(SELF)
  announcements(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(allQuery)) q: Out<typeof allQuery>,
  ) {
    return this.eng.announcements(p, q.all ?? false);
  }

  @Post('engagement/announcements')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  createAnnouncement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(announcementSchema)) b: Out<typeof announcementSchema>,
  ) {
    return this.eng.createAnnouncement(p, b);
  }

  @Post('engagement/announcements/:id/read')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  read(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.markRead(p, id, false);
  }

  @Post('engagement/announcements/:id/acknowledge')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  ack(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.markRead(p, id, true);
  }

  @Get('engagement/events')
  @RequirePermissions(SELF)
  events(@CurrentPrincipal() p: AuthPrincipal) {
    return this.eng.events(p);
  }

  @Post('engagement/events')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  createEvent(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(eventSchema)) b: Out<typeof eventSchema>,
  ) {
    return this.eng.createEvent(p, b);
  }

  @Post('engagement/events/:id/cancel')
  @RequirePermissions(P.ENGAGEMENT_CONTENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancelEvent(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.cancelEvent(p, id);
  }

  @Post('engagement/events/:id/rsvp')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  rsvp(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(rsvpSchema)) b: Out<typeof rsvpSchema>,
  ) {
    return this.eng.rsvp(p, id, b);
  }

  @Get('engagement/suggestions')
  @RequirePermissions(SELF)
  suggestions(@CurrentPrincipal() p: AuthPrincipal) {
    return this.eng.suggestions(p);
  }

  @Post('engagement/suggestions')
  @RequirePermissions(SELF)
  suggest(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(suggestionSchema)) b: Out<typeof suggestionSchema>,
  ) {
    return this.eng.suggest(p, b);
  }

  @Post('engagement/suggestions/:id/vote')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  vote(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.vote(p, id, true);
  }

  @Delete('engagement/suggestions/:id/vote')
  @RequirePermissions(SELF)
  unvote(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.eng.vote(p, id, false);
  }

  @Put('engagement/suggestions/:id/status')
  @RequirePermissions(P.ENGAGEMENT_SUGGESTION_MANAGE)
  suggestionStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(suggestionStatusSchema)) b: Out<typeof suggestionStatusSchema>,
  ) {
    return this.eng.setSuggestionStatus(p, id, b);
  }
}
