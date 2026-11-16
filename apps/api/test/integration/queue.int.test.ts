import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import {
  QUEUE_PREFIX,
  QueueName,
  SystemJob,
} from '../../src/infrastructure/queue/queue.constants.js';
import { bullConnectionFromUrl } from '../../src/infrastructure/queue/redis-connection.js';
import type { SelfTestResult } from '../../src/infrastructure/queue/system.processor.js';
import { integrationConfig, testEnv } from './env.js';

describe('BullMQ pipeline', () => {
  let app: NestExpressApplication;
  let events: QueueEvents;

  beforeAll(async () => {
    app = await createApp(integrationConfig());
    await app.init();
    events = new QueueEvents(QueueName.SYSTEM, {
      connection: bullConnectionFromUrl(testEnv.redisUrl),
      prefix: QUEUE_PREFIX,
    });
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await events.close();
    await app.close();
  });

  it('processes a job end to end through Redis and the worker', async () => {
    const queue = app.get<Queue>(getQueueToken(QueueName.SYSTEM));
    const nonce = randomUUID();
    const job = await queue.add(SystemJob.SELF_TEST, { nonce });
    const result = (await job.waitUntilFinished(events, 15_000)) as SelfTestResult;
    expect(result.nonce).toBe(nonce);
    expect(result.workerPid).toBe(process.pid);
  });
});
