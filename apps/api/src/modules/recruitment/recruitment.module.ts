import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { OnboardingService } from '../onboarding/onboarding.service.js';
import { ApplicationsService } from './applications.service.js';
import { CandidatesService } from './candidates.service.js';
import { OpeningsService } from './openings.service.js';
import {
  CareersController,
  MyInterviewsController,
  OnboardingController,
  RecruitmentController,
} from './recruitment.controllers.js';

/** Recruitment (requisitions → hire) and onboarding (Phase 06). */
@Module({
  imports: [EmployeesModule],
  controllers: [
    RecruitmentController,
    MyInterviewsController,
    CareersController,
    OnboardingController,
  ],
  providers: [
    AuditService,
    OpeningsService,
    CandidatesService,
    ApplicationsService,
    OnboardingService,
  ],
})
export class RecruitmentModule {}
