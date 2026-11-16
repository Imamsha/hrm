import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { QUEUE_PREFIX, QueueName } from './queue.constants.js';
import { bullConnectionFromUrl } from './redis-connection.js';
import { SystemProcessor } from './system.processor.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: bullConnectionFromUrl(config.REDIS_URL),
        prefix: QUEUE_PREFIX,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { age: 24 * 3600, count: 1_000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QueueName.SYSTEM }),
  ],
  providers: [SystemProcessor],
  exports: [BullModule],
})
export class QueueModule {}
