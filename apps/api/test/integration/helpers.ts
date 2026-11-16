import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { integrationConfig, testEnv } from './env.js';

export const STRONG_PASSWORD = 'blue-tiger-river-2026';
export const OTHER_PASSWORD = 'green-falcon-ocean-1999';

export async function startApp(
  overrides: Partial<Record<string, string>> = {},
): Promise<NestExpressApplication> {
  const app = await createApp(integrationConfig(overrides));
  await app.init();
  return app;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${randomUUID().slice(0, 8)}@example.test`.toLowerCase();
}

export interface Account {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  userId: string;
  membershipId: string;
}

type Server = Parameters<typeof request>[0];

export function api(app: NestExpressApplication) {
  const server = app.getHttpServer() as Server;
  return {
    get: (path: string, token?: string) => {
      const r = request(server).get(`/api/v1${path}`);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    },
    post: (path: string, body?: object, token?: string) => {
      const r = request(server)
        .post(`/api/v1${path}`)
        .send(body ?? {});
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    },
    patch: (path: string, body: object, token?: string) => {
      const r = request(server).patch(`/api/v1${path}`).send(body);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    },
    put: (path: string, body: object, token?: string) => {
      const r = request(server).put(`/api/v1${path}`).send(body);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    },
    delete: (path: string, token?: string) => {
      const r = request(server).delete(`/api/v1${path}`);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    },
  };
}

export type Api = ReturnType<typeof api>;

/** Registers a new account + organization (body token transport) and loads its ids via /auth/me. */
export async function registerAccount(client: Api, orgName = 'Test Org'): Promise<Account> {
  const email = uniqueEmail('owner');
  const res = await client.post('/auth/register', {
    organizationName: `${orgName} ${randomUUID().slice(0, 6)}`,
    fullName: 'Olivia Owner',
    email,
    password: STRONG_PASSWORD,
    tokenTransport: 'body',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const { accessToken, refreshToken } = res.body.data as {
    accessToken: string;
    refreshToken: string;
  };
  const me = await client.get('/auth/me', accessToken);
  expect(me.status).toBe(200);
  return {
    email,
    password: STRONG_PASSWORD,
    accessToken,
    refreshToken,
    organizationId: me.body.data.activeOrganization.organizationId,
    membershipId: me.body.data.activeOrganization.membershipId,
    userId: me.body.data.user.id,
  };
}

export async function login(client: Api, email: string, password: string) {
  return client.post('/auth/login', { email, password, tokenTransport: 'body' });
}

/** Current TOTP code for a base32 secret, optionally shifted by whole periods. */
export function totpCode(secret: string, periodsAhead = 0): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({
    timestamp: Date.now() + periodsAhead * 30_000,
  });
}

interface MailpitSummary {
  ID: string;
  Subject: string;
}

/** Waits for the newest e-mail to `to` (delivered asynchronously via the queue) and returns its text. */
export async function waitForEmail(
  to: string,
  timeoutMs = 15_000,
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${testEnv.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitSummary[] };
      const first = body.messages[0];
      if (first) {
        const msg = (await (
          await fetch(`${testEnv.mailpitUrl}/api/v1/message/${first.ID}`)
        ).json()) as { Text: string };
        return { subject: first.Subject, text: msg.Text };
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No e-mail to ${to} within ${String(timeoutMs)}ms`);
}

export function tokenFromLink(text: string, path: string): string {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`).exec(text);
  if (!match?.[1]) throw new Error(`No ${path} link in e-mail`);
  return decodeURIComponent(match[1]);
}
