import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { REQUEST_ID_HEADER, requestContextMiddleware } from './common/http/request-id.js';
import type { AppConfig } from './config/env.schema.js';

export const API_PREFIX = 'api';
export const DOCS_PATH = `${API_PREFIX}/docs`;

/**
 * Creates and fully configures the Nest application without listening.
 * Shared by `main.ts` and integration tests so tests exercise the real HTTP pipeline.
 */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    bodyParser: false,
  });

  app.useLogger(app.get(Logger));
  app.use(requestContextMiddleware);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: false });
  // Only the httpOnly refresh-token cookie is read (auth endpoints).
  app.use(cookieParser());

  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; the API itself serves no HTML.
      contentSecurityPolicy: config.SWAGGER_ENABLED ? false : undefined,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  if (config.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('HRM Platform API')
        .setDescription(
          'Multi-tenant HRM SaaS REST API. All responses use the `{ success, data | error, meta }` envelope.',
        )
        .setVersion(config.APP_VERSION)
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
        .build(),
    );
    SwaggerModule.setup(DOCS_PATH, app, document, { jsonDocumentUrl: `${DOCS_PATH}/openapi.json` });
  }

  return app;
}
