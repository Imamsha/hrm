import { type DynamicModule, type ExecutionContext, Module } from '@nestjs/common';
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
import { SecurityModule } from './infrastructure/security/security.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { AccessGuard } from './modules/access/access.guard.js';
import { AccessModule } from './modules/access/access.module.js';
import { AUTH_RATE_LIMITED } from './modules/access/decorators.js';
import { AiModule } from './modules/ai/ai.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdentityModule } from './modules/identity.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PayrollModule } from './modules/payroll/payroll.module.js';
import { RecruitmentModule } from './modules/recruitment/recruitment.module.js';
import { StructureModule } from './modules/structure/structure.module.js';
import { TimeModule } from './modules/time/time.module.js';

/** True unless the handler or controller is marked @AuthRateLimited(). */
function notAuthRateLimited(context: ExecutionContext): boolean {
  const marked =
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true ||
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getClass()) === true;
  return !marked;
}

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
              // Credential endpoints (login, register, reset, invitation acceptance).
              {
                name: 'auth',
                ttl: 60_000,
                limit: c.AUTH_RATE_LIMIT_MAX,
                skipIf: notAuthRateLimited,
              },
            ],
          }),
        }),
        DatabaseModule,
        RedisModule,
        StorageModule,
        QueueModule,
        SecurityModule,
        AccessModule,
        NotificationsModule,
        AiModule,
        HealthModule,
        IdentityModule,
        StructureModule,
        EmployeesModule,
        TimeModule,
        RecruitmentModule,
        PayrollModule,
      ],
      providers: [
        // Order matters: rate limiting runs before authentication work.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AccessGuard },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
      ],
    };
  }
}
