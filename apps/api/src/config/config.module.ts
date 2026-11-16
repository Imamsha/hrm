import { type DynamicModule, Global, Module } from '@nestjs/common';
import { type AppConfig, loadConfig } from './env.schema.js';

/** Injection token for the validated, immutable application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  /** Pass an explicit config in tests; production parses `process.env`. */
  static forRoot(config?: AppConfig): DynamicModule {
    const value = Object.freeze(config ?? loadConfig());
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: value }],
      exports: [APP_CONFIG],
    };
  }
}
