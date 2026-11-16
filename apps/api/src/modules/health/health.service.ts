import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { DependencyHealth, HealthReport, LivenessReport } from '@hrm/shared-types';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { QueueName } from '../../infrastructure/queue/queue.constants.js';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';

const PROBE_TIMEOUT_MS = 3_000;

/** Maps a probe failure to a short, non-sensitive reason (never connection strings or credentials). */
export function describeProbeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'timeout') return 'Timed out';
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name !== 'Error') return name;
  }
  return 'Unavailable';
}

async function probe(fn: () => Promise<unknown>): Promise<DependencyHealth> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('timeout'));
        }, PROBE_TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      error: describeProbeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.SYSTEM) private readonly systemQueue: Queue,
  ) {}

  private uptimeSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  liveness(): LivenessReport {
    return { status: 'ok', uptimeSeconds: this.uptimeSeconds() };
  }

  async report(): Promise<HealthReport> {
    const [database, redis, storage, queue] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
      probe(() => this.storage.ping()),
      probe(async () => {
        // Queue is healthy when its Redis connection responds and at least one worker is attached.
        const workers = await this.systemQueue.getWorkersCount();
        if (workers < 1) throw Object.assign(new Error('no workers'), { code: 'NO_WORKERS' });
      }),
    ]);
    const checks = { database, redis, storage, queue };
    const allUp = Object.values(checks).every((c) => c.status === 'up');
    return {
      status: allUp ? 'ok' : 'degraded',
      version: this.config.APP_VERSION,
      environment: this.config.NODE_ENV,
      uptimeSeconds: this.uptimeSeconds(),
      checks,
    };
  }
}
