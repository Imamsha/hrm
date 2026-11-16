import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode } from '@hrm/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { integrationConfig } from './env.js';

describe('Health endpoints against real infrastructure', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp(integrationConfig());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health/live', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('GET /api/v1/health reports every dependency as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const { checks, status } = res.body.data;
    expect({
      database: checks.database.status,
      redis: checks.redis.status,
      storage: checks.storage.status,
      queue: checks.queue.status,
    }).toEqual({ database: 'up', redis: 'up', storage: 'up', queue: 'up' });
    expect(status).toBe('ok');
  });

  it('GET /api/v1/health/ready returns 200 when healthy', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });

  it('sets security headers and echoes the request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('allows configured CORS origins only', async () => {
    const ok = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5180')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5180');
    const bad = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects malformed JSON with the error envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.paths).toHaveProperty('/api/v1/health/ready');
  });
});

describe('Readiness when a dependency is down', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    // Point storage at a closed port: readiness must degrade, not crash.
    app = await createApp(integrationConfig({ STORAGE_ENDPOINT: 'http://127.0.0.1:1' }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports degraded on /health and 503 on /health/ready', async () => {
    const report = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(report.body.data.status).toBe('degraded');
    expect(report.body.data.checks.storage.status).toBe('down');
    expect(report.body.data.checks.database.status).toBe('up');

    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(ready.body.error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(ready.body.error.details).toEqual([expect.objectContaining({ path: 'storage' })]);
    expect(JSON.stringify(ready.body)).not.toContain('hrm_storage_dev_secret');
  });
});
