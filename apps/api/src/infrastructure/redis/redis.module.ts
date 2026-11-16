import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

/** Shared general-purpose Redis client (cache, rate limits, locks). BullMQ manages its own connections. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger('Redis');
        const client = new Redis(config.REDIS_URL, {
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          connectTimeout: 5_000,
          enableOfflineQueue: false,
        });
        // Log transitions only; ioredis retries continuously and would otherwise flood the logs.
        let degraded = false;
        client.on('error', (err: Error) => {
          if (degraded) return;
          degraded = true;
          logger.warn(`Redis connection error: ${err.message} (retrying in background)`);
        });
        client.on('ready', () => {
          if (degraded) logger.log('Redis connection restored');
          degraded = false;
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
