import 'reflect-metadata';
import { Body, Controller, Get, type INestApplication, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ErrorCode } from '@hrm/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppException } from './app.exception.js';
import { EnvelopeInterceptor } from './envelope.interceptor.js';
import { GlobalExceptionFilter } from './exception.filter.js';
import { REQUEST_ID_HEADER, requestContextMiddleware, resolveRequestId } from './request-id.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

const createSchema = z.object({ name: z.string().trim().min(1), age: z.number().int().min(18) });

@Controller('t')
class TestController {
  @Get('ok')
  ok() {
    return { hello: 'world' };
  }

  @Get('page')
  page() {
    return { items: [1, 2], pagination: { page: 1, pageSize: 2, total: 5, totalPages: 3 } };
  }

  @Post('create')
  create(@Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return body;
  }

  @Get('forbidden')
  forbidden() {
    throw AppException.forbidden();
  }

  @Get('boom')
  boom() {
    throw new Error('database password is hunter2');
  }
}

@Module({
  controllers: [TestController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
class TestModule {}

describe('HTTP pipeline (envelope, errors, validation, request id)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use(requestContextMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps results in the success envelope with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/t/ok').expect(200);
    expect(res.body).toMatchObject({ success: true, data: { hello: 'world' } });
    expect(res.body.meta.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it('honours a safe caller-supplied request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/t/ok')
      .set(REQUEST_ID_HEADER, 'client-req-0001');
    expect(res.headers[REQUEST_ID_HEADER]).toBe('client-req-0001');
  });

  it('moves pagination into meta', async () => {
    const res = await request(app.getHttpServer()).get('/t/page').expect(200);
    expect(res.body.data).toEqual([1, 2]);
    expect(res.body.meta.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
  });

  it('returns field-level validation errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/create')
      .send({ name: ' ', age: 12 })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'age',
      'name',
    ]);
  });

  it('passes validated and transformed bodies to the handler', async () => {
    const res = await request(app.getHttpServer())
      .post('/t/create')
      .send({ name: '  Asha ', age: 30 })
      .expect(201);
    expect(res.body.data).toEqual({ name: 'Asha', age: 30 });
  });

  it('maps domain exceptions to their status and code', async () => {
    const res = await request(app.getHttpServer()).get('/t/forbidden').expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('hides internal error details from clients', async () => {
    const res = await request(app.getHttpServer()).get('/t/boom').expect(500);
    expect(res.body.error).toEqual({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });
});

describe('resolveRequestId', () => {
  it.each(['short', 'has spaces in it', 'x'.repeat(65), '<script>alert(1)</script>'])(
    'replaces unsafe id %j',
    (id) => {
      expect(resolveRequestId(id)).not.toBe(id);
    },
  );
});
