import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EngagementService } from './engagement.service.js';
import { LearningService } from './learning.service.js';
import { PerformanceService } from './performance.service.js';
import {
  EngagementController,
  LearningController,
  PerformanceController,
} from './talent.controllers.js';

/** Performance, learning and engagement (Phase 09, ADR-016). */
@Module({
  controllers: [PerformanceController, LearningController, EngagementController],
  providers: [AuditService, PerformanceService, LearningService, EngagementService],
})
export class TalentModule {}
