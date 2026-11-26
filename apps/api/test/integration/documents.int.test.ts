/**
 * Phase 11a documents: templates, generated letters, e-acceptance (login and e-mailed code),
 * the company library, and payslip/invoice PDFs. Template wording is fictional test text.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../../src/infrastructure/storage/storage.service.js';
import { testEnv } from './env.js';
import {
  type Account,
  type Api,
  api,
  OTHER_PASSWORD,
  registerAccount,
  startApp,
  tokenFromLink,
  uniqueEmail,
  waitForEmail,
} from './helpers.js';

let app: NestExpressApplication;
let client: Api;
let owner: Account;
let co: { id: string };
type Person = { id: string; token: string };
let emp: Person;
let other: Person;

/** Polls until the newest e-mail to the address has the subject prefix. */
async function mailWithSubject(
  to: string,
  prefix: string,
): Promise<{ subject: string; text: string }> {
  for (let i = 0; i < 50; i++) {
    const m = await waitForEmail(to);
    if (m.subject.startsWith(prefix)) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No e-mail starting with ${prefix}`);
}

const server = () => app.getHttpServer() as Parameters<typeof request>[0];
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

beforeAll(async () => {
  app = await startApp();
  client = api(app);
  owner = await registerAccount(client, 'Documents');
  co = await create('/companies', { code: 'DOC', name: 'Docs Co' });
  emp = await person('Esha');
  other = await person('Omar');
});

afterAll(async () => {
  await app.close();
});

async function create(
  path: string,
  body: object,
  token = owner.accessToken,
): Promise<{ id: string; [k: string]: unknown }> {
  const res = await client.post(path, body, token);
  expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
  return res.body.data as { id: string };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed accessor for response data in tests
function data<T = Record<string, unknown>>(
  res: { status: number; body: { data: unknown } },
  status = 200,
): T {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data as T;
}

async function person(firstName: string): Promise<Person> {
  const roles = await client.get('/roles', owner.accessToken);
  const roleId = (roles.body.data as { id: string; key: string }[]).find(
    (r) => r.key === 'employee',
  )?.id;
  const email = uniqueEmail(firstName.toLowerCase());
  await client.post('/invitations', { email, roleIds: [roleId] }, owner.accessToken);
  const token = tokenFromLink((await waitForEmail(email)).text, '/accept-invitation');
  const accepted = await client.post('/invitations/accept', {
    token,
    fullName: firstName,
    password: OTHER_PASSWORD,
    tokenTransport: 'body',
  });
  const me = await client.get('/auth/me', accepted.body.data.accessToken);
  const e = await create('/employees', {
    firstName,
    dateOfJoining: '2025-01-06',
    companyId: co.id,
    employmentType: 'FULL_TIME',
    workEmail: email,
    membershipId: me.body.data.activeOrganization.membershipId,
  });
  return { id: e.id, token: accepted.body.data.accessToken as string };
}

const download = async (path: string, token: string) =>
  request(server())
    .get(`/api/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        cb(null, Buffer.concat(chunks));
      });
    });

type Doc = {
  id: string;
  status: string;
  sha256: string;
  canAccept: boolean;
  hasCertificate: boolean;
  signers: { status: string; method: string | null; ip: string | null }[];
};

describe('templates and generated letters', () => {
  let experience: string;
  let appointment: string;

  it('rejects unknown merge fields and versions templates', async () => {
    const bad = await client.post(
      '/documents/templates',
      {
        name: 'Bad',
        category: 'EXPERIENCE_LETTER',
        title: 'Letter',
        body: 'Dear {{employee.name}}, CTC {{offer.ctc}}',
      },
      owner.accessToken,
    );
    expect(bad.body.error.details[0].message).toBe('Unknown merge field {{offer.ctc}}');
    const list = data<{ id: string; name: string; version: number; mergeFields: string[] }[]>(
      await client.post(
        '/documents/templates',
        {
          name: 'Experience',
          category: 'EXPERIENCE_LETTER',
          title: 'Experience letter',
          body: '{{employee.name}} ({{employee.number}}) worked at {{organization.name}} from {{employee.dateOfJoining}} to {{employee.lastWorkingDay}}.',
        },
        owner.accessToken,
      ),
      201,
    );
    experience = list[0]?.id ?? '';
    expect(list[0]?.mergeFields).toContain('employee.lastWorkingDay');
    const v2 = data<{ id: string; version: number }[]>(
      await client.post(
        `/documents/templates/${experience}/versions`,
        {
          title: 'Experience certificate',
          body: 'This certifies that {{employee.name}} worked with us until {{employee.lastWorkingDay}}.',
        },
        owner.accessToken,
      ),
      201,
    );
    expect(v2.find((t) => t.id === experience)?.version).toBe(2);
    appointment =
      data<{ id: string; name: string }[]>(
        await client.post(
          '/documents/templates',
          {
            name: 'Appointment',
            category: 'APPOINTMENT_LETTER',
            title: 'Appointment — {{employee.name}}',
            body: 'Welcome to {{organization.name}}, {{employee.firstName}}.',
          },
          owner.accessToken,
        ),
        201,
      ).find((t) => t.name === 'Appointment')?.id ?? '';
  });

  it('fills fields from records and refuses letters with gaps', async () => {
    const missing = await client.post(
      '/documents',
      { templateId: experience, employeeId: emp.id },
      owner.accessToken,
    );
    expect(missing.body.error.message).toBe('Fill in: employee.lastWorkingDay');
    expect(
      (
        await client.post(
          '/documents',
          { templateId: experience, employeeId: emp.id, values: { 'offer.ctc': '1' } },
          owner.accessToken,
        )
      ).body.error.message,
    ).toMatch(/Unknown merge field offer\.ctc/);
    const doc = data<Doc>(
      await client.post(
        '/documents',
        {
          templateId: experience,
          employeeId: emp.id,
          values: { 'employee.lastWorkingDay': '2026-11-30' },
        },
        owner.accessToken,
      ),
      201,
    );
    expect(doc.status).toBe('FINAL');
    const file = await download(`/documents/${doc.id}/file`, emp.token);
    expect(file.status).toBe(200);
    const body = file.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    // The stored file is exactly what was hashed.
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(body).digest('hex')).toBe(doc.sha256);
    // Letters about Esha are not visible to Omar.
    expect((await client.get(`/documents/${doc.id}`, other.token)).status).toBe(404);
    await (async () => {
      const db = new pg.Client({ connectionString: testEnv.databaseUrl });
      await db.connect();
      try {
        await db.query('BEGIN');
        await db.query(`SELECT set_config('app.organization_id', $1, true)`, [
          owner.organizationId,
        ]);
        await expect(
          db.query(`UPDATE generated_documents SET sha256 = repeat('0', 64) WHERE id = $1`, [
            doc.id,
          ]),
        ).rejects.toThrow(/cannot be altered/);
      } finally {
        await db.query('ROLLBACK');
        await db.end();
      }
    })();
  });

  it('records acceptance with a certificate, and refuses a tampered file', async () => {
    const doc = data<Doc>(
      await client.post(
        '/documents',
        {
          templateId: appointment,
          employeeId: emp.id,
          signers: [{ kind: 'EMPLOYEE', employeeId: emp.id }],
        },
        owner.accessToken,
      ),
      201,
    );
    expect(doc.status).toBe('AWAITING_ACCEPTANCE');
    expect((await client.post(`/documents/${doc.id}/accept`, {}, other.token)).status).toBe(404);
    const mine = data<Doc[]>(await client.get('/documents', emp.token));
    expect(mine.find((d) => d.id === doc.id)?.canAccept).toBe(true);
    const accepted = data<Doc>(await client.post(`/documents/${doc.id}/accept`, {}, emp.token));
    expect(accepted).toMatchObject({ status: 'ACCEPTED', hasCertificate: true });
    expect(accepted.signers[0]).toMatchObject({ status: 'ACCEPTED', method: 'LOGIN' });
    const cert = await download(`/documents/${doc.id}/file?certificate=true`, emp.token);
    expect((cert.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((cert.body as Buffer).length).toBeGreaterThan(
      (await download(`/documents/${doc.id}/file`, emp.token)).body.length as number,
    );

    // Someone replaces the stored file: acceptance is refused.
    const tampered = data<Doc>(
      await client.post(
        '/documents',
        {
          templateId: appointment,
          employeeId: emp.id,
          signers: [{ kind: 'EMPLOYEE', employeeId: emp.id }],
        },
        owner.accessToken,
      ),
      201,
    );
    const db = new pg.Client({ connectionString: testEnv.databaseUrl });
    await db.connect();
    await db.query('BEGIN');
    await db.query(`SELECT set_config('app.organization_id', $1, true)`, [owner.organizationId]);
    const key =
      (
        await db.query<{ storage_key: string }>(
          'SELECT storage_key FROM generated_documents WHERE id = $1',
          [tampered.id],
        )
      ).rows[0]?.storage_key ?? '';
    await db.query('ROLLBACK');
    await db.end();
    const storage = app.get(StorageService);
    await storage.client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: PDF,
        ContentType: 'application/pdf',
      }),
    );
    expect(
      (await client.post(`/documents/${tampered.id}/accept`, {}, emp.token)).body.error.message,
    ).toMatch(/no longer matches/);
  });
});

describe('offer letter accepted by the candidate with an e-mailed code', () => {
  it('accepts the offer through the public link', async () => {
    const opening = await create('/recruitment/openings', {
      title: 'Analyst',
      companyId: co.id,
      employmentType: 'FULL_TIME',
      description: 'Analyse data',
    });
    const email = uniqueEmail('cand');
    const cand = await create('/recruitment/candidates', {
      firstName: 'Kavya',
      lastName: 'Iyer',
      email,
    });
    const appl = await create('/recruitment/applications', {
      candidateId: cand.id,
      openingId: opening.id,
    });
    await client.post(
      `/recruitment/applications/${appl.id}/stage`,
      { stage: 'OFFER' },
      owner.accessToken,
    );
    const offered = await client.post(
      `/recruitment/applications/${appl.id}/offers`,
      { joiningDate: '2027-01-04', annualCtc: '900000' },
      owner.accessToken,
    );
    const offerId = offered.body.data.offers[0].id as string;
    await client.put(
      `/recruitment/offers/${offerId}/status`,
      { status: 'SENT' },
      owner.accessToken,
    );
    const tpl = data<{ id: string; name: string }[]>(
      await client.post(
        '/documents/templates',
        {
          name: 'Offer',
          category: 'OFFER_LETTER',
          title: 'Offer for {{candidate.name}}',
          body: 'We offer you the role of {{offer.jobTitle}} at {{offer.currency}} {{offer.ctc}} a year from {{offer.joiningDate}}.',
        },
        owner.accessToken,
      ),
      201,
    ).find((t) => t.name === 'Offer');
    data(
      await client.post(
        '/documents',
        { templateId: tpl?.id, offerId, signers: [{ kind: 'CANDIDATE' }] },
        owner.accessToken,
      ),
      201,
    );

    const link = tokenFromLink((await waitForEmail(email)).text, '/accept-document');
    const view = await request(server()).get(`/api/v1/public/acceptance/${link}`);
    expect(view.body.data).toMatchObject({
      organizationName: expect.stringContaining('Documents') as string,
      candidateName: 'Kavya Iyer',
      status: 'PENDING',
    });
    expect((await request(server()).get(`/api/v1/public/acceptance/${link}/file`)).status).toBe(
      200,
    );
    expect(
      (await request(server()).get('/api/v1/public/acceptance/not-a-real-token-123456789')).status,
    ).toBe(404);

    await request(server()).post(`/api/v1/public/acceptance/${link}/code`).send({});
    const codeMail = await mailWithSubject(email, 'Your code');
    const code = /\b(\d{6})\b/.exec(codeMail.text)?.[1] ?? '';
    expect(
      (
        await request(server())
          .post(`/api/v1/public/acceptance/${link}/accept`)
          .send({ code: code === '000000' ? '111111' : '000000' })
      ).status,
    ).toBe(400);
    const ok = await request(server())
      .post(`/api/v1/public/acceptance/${link}/accept`)
      .send({ code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('ACCEPTED');
    const offer = await client.get(`/recruitment/applications/${appl.id}`, owner.accessToken);
    expect(offer.body.data.offers[0].status).toBe('ACCEPTED');
    const docs = data<Doc[]>(await client.get(`/documents?offerId=${offerId}`, owner.accessToken));
    expect(docs[0]).toMatchObject({ status: 'ACCEPTED', hasCertificate: true });
    expect(docs[0]?.signers[0]).toMatchObject({ method: 'EMAIL_OTP' });
  });
});

describe('company library', () => {
  it('publishes PDFs, versions them and tracks acknowledgement per version', async () => {
    const notPdf = await request(server())
      .post('/api/v1/library')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('title', 'Code of conduct')
      .field('category', 'Policies')
      .field('requiresAcknowledgement', 'true')
      .attach('file', Buffer.from('MZ not a pdf'), {
        filename: 'conduct.pdf',
        contentType: 'application/pdf',
      });
    expect(notPdf.status).toBe(400);
    const pub = await request(server())
      .post('/api/v1/library')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .field('title', 'Code of conduct')
      .field('category', 'Policies')
      .field('requiresAcknowledgement', 'true')
      .attach('file', PDF, { filename: 'conduct.pdf', contentType: 'application/pdf' });
    expect(pub.status, JSON.stringify(pub.body)).toBe(201);
    const id = pub.body.data[0].id as string;
    const seen = data<{ id: string; acknowledgedAt: string | null }[]>(
      await client.get('/library', emp.token),
    );
    expect(seen[0]?.acknowledgedAt).toBeNull();
    data(await client.post(`/library/${id}/acknowledge`, {}, emp.token));
    const after = data<{ acknowledgedAt: string | null; stats: { acknowledged: number } | null }[]>(
      await client.get('/library', owner.accessToken),
    );
    expect(after[0]?.stats?.acknowledged).toBe(1);
    const v2 = await request(server())
      .post(`/api/v1/library/${id}/versions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('file', PDF, { filename: 'conduct-v2.pdf', contentType: 'application/pdf' });
    expect(v2.body.data[0]).toMatchObject({ version: 2, stats: { acknowledged: 0 } });
    expect(
      data<{ acknowledgedAt: string | null }[]>(await client.get('/library', emp.token))[0]
        ?.acknowledgedAt,
    ).toBeNull();
    expect((await download(`/library/${id}/file`, emp.token)).status).toBe(200);
  });

  it('isolates tenants', async () => {
    const outsider = await registerAccount(client, 'Other docs');
    expect(data<unknown[]>(await client.get('/library', outsider.accessToken))).toEqual([]);
    expect(data<unknown[]>(await client.get('/documents', outsider.accessToken))).toEqual([]);
  });
});
