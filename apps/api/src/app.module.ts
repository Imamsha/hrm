import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/http/exception.filter.js';
import { EnvelopeInterceptor } from './common/http/envelope.interceptor.js';
import { buildPinoOptions } from './common/logging/pino.options.js';
import { APP_CONFIG, ConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { QueueModule } from './infrastructure/queue/queue.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => buildPinoOptions(c),
        }),
        ThrottlerModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => ({
            throttlers: [
              { name: 'default', ttl: c.RATE_LIMIT_TTL_SECONDS * 1000, limit: c.RATE_LIMIT_MAX },
            ],
          }),
        }),
        DatabaseModule,
        RedisModule,
        StorageModule,
        QueueModule,
        AiModule,
        HealthModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
