import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/env.schema.js';
import { RequestContext } from '../context/request-context.js';

/** Paths whose values must never reach log storage. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.apiKey',
];

type Req = IncomingMessage;

/** Structured JSON logging (pretty-printed in development) with request correlation. */
export function buildPinoOptions(config: AppConfig): Params {
  const pretty = config.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: (req: Req) => (typeof req.id === 'string' ? req.id : 'unknown'),
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      customProps: () => {
        const ctx = RequestContext.get();
        return {
          ...(ctx?.organizationId ? { organizationId: ctx.organizationId } : {}),
          ...(ctx?.userId ? { userId: ctx.userId } : {}),
        };
      },
      autoLogging: {
        // Probes run every few seconds; logging them would drown real traffic.
        ignore: (req: Req) => (req.url ?? '').startsWith('/api/v1/health'),
      },
      serializers: {
        req: (req: { id?: string; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
      base: { service: 'hrm-api', env: config.NODE_ENV },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          }
        : {}),
    },
  };
}
