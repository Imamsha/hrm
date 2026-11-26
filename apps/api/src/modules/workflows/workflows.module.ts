import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EscalationProcessor, WORKFLOW_QUEUE } from './escalation.processor.js';
import { WorkflowEngine } from './workflow-engine.service.js';
import { WorkflowRegistry } from './workflow-registry.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';

/**
 * Approval workflows (Phase 11a, ADR-018). Global so leave, expenses, travel and timesheets can
 * use the engine and register their handlers without import cycles.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_QUEUE })],
  controllers: [WorkflowsController],
  providers: [
    AuditService,
    WorkflowRegistry,
    WorkflowEngine,
    WorkflowsService,
    EscalationProcessor,
  ],
  exports: [WorkflowEngine, WorkflowRegistry],
})
export class WorkflowsModule {}
