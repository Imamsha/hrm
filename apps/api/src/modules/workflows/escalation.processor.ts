import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { runInTenantJobContext } from '../../infrastructure/queue/tenant-job.js';
import { WorkflowsService } from './workflows.service.js';

export const WORKFLOW_QUEUE = 'workflows';
export const ESCALATE_JOB = 'workflows.escalate';

/**
 * Every 15 minutes: reassign overdue approval steps to their escalation target, tenant by
 * tenant (ADR-018). Escalation never approves or rejects anything.
 */
@Processor(WORKFLOW_QUEUE, { concurrency: 1 })
export class EscalationProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(EscalationProcessor.name);

  constructor(
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
    private readonly workflows: WorkflowsService,
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

  async process(job: Job): Promise<{ tenants: number; escalated: number }> {
    if (job.name !== ESCALATE_JOB) throw new Error(`Unknown workflow job: ${job.name}`);
    let escalated = 0;
    const tenants = await this.workflows.tenantsWithOverdue();
    for (const org of tenants)
      escalated += await runInTenantJobContext({ organizationId: org }, () =>
        this.workflows.escalate(org),
      );
    if (escalated) this.logger.log(`Escalated ${String(escalated)} overdue approval step(s)`);
    return { tenants: tenants.length, escalated };
  }
}
