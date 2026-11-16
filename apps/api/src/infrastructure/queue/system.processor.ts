import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueName, SystemJob } from './queue.constants.js';

export interface SelfTestPayload {
  nonce: string;
}

export interface SelfTestResult {
  nonce: string;
  processedAt: string;
  workerPid: number;
}

@Processor(QueueName.SYSTEM, { concurrency: 2 })
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  process(job: Job<SelfTestPayload>): Promise<SelfTestResult> {
    if (job.name !== SystemJob.SELF_TEST) {
      return Promise.reject(new Error(`Unknown system job: ${job.name}`));
    }
    this.logger.debug(`Processed ${job.name} (${String(job.id)})`);
    return Promise.resolve({
      nonce: job.data.nonce,
      processedAt: new Date().toISOString(),
      workerPid: process.pid,
    });
  }
}
