import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { BullModule } from '@nestjs/bullmq';
import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { runInTenantJobContext } from '../../infrastructure/queue/tenant-job.js';
import { AuditService } from '../audit/audit.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { SeparationService } from '../separation/separation.service.js';
import { HelpdeskService } from './helpdesk.service.js';
import {
  ComplianceController,
  HelpdeskController,
  SeparationController,
} from './operations.controllers.js';

export const HELPDESK_QUEUE = 'helpdesk';
const ESCALATE_JOB = 'helpdesk.escalate';

/** Every 15 minutes: escalate tickets past their resolution time (ADR-019). */
@Processor(HELPDESK_QUEUE, { concurrency: 1 })
export class TicketEscalationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(TicketEscalationProcessor.name);

  constructor(
    @InjectQueue(HELPDESK_QUEUE) private readonly queue: Queue,
    private readonly helpdesk: HelpdeskService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.upsertJobScheduler(
      ESCALATE_JOB,
      { every: 15 * 60_000 },
      { name: ESCALATE_JOB, data: {} },
    );
  }

  async process(job: Job): Promise<{ escalated: number }> {
    if (job.name !== ESCALATE_JOB) throw new Error(`Unknown helpdesk job: ${job.name}`);
    let escalated = 0;
    for (const org of await this.helpdesk.tenantsWithBreaches())
      escalated += await runInTenantJobContext({ organizationId: org }, () =>
        this.helpdesk.escalate(org),
      );
    if (escalated) this.logger.log(`Escalated ${String(escalated)} ticket(s)`);
    return { escalated };
  }
}

/** Helpdesk, separation & offboarding, compliance (Phase 11b, ADR-019). */
@Module({
  imports: [EmployeesModule, BullModule.registerQueue({ name: HELPDESK_QUEUE })],
  controllers: [HelpdeskController, SeparationController, ComplianceController],
  providers: [
    AuditService,
    HelpdeskService,
    SeparationService,
    ComplianceService,
    TicketEscalationProcessor,
  ],
})
export class OperationsModule {}
