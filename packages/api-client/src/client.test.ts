import { ErrorCode } from '@hrm/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client.js';
import { ApiClientError } from './error.js';

const meta = { requestId: 'req-1', timestamp: '2026-01-01T00:00:00.000Z' };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function client(fetchImpl: typeof fetch, token?: string) {
  return createApiClient({
    baseUrl: 'http://api.test/api/v1/',
    fetch: fetchImpl,
    getAccessToken: () => token,
    timeoutMs: 50,
  });
}

describe('createApiClient', () => {
  it('unwraps the success envelope and builds URLs with query params', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { success: true, data: { ok: 1 }, meta }));
    const data = await client(fetchMock).get<{ ok: number }>('/things', {
      query: { page: 2, search: '', skip: undefined },
    });
    expect(data).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/api/v1/things?page=2');
  });

  it('sends bearer token and JSON body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(201, { success: true, data: null, meta }));
    await client(fetchMock, 'tok').post('/x', { a: 1 });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('maps the error envelope to ApiClientError', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(400, {
        success: false,
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Invalid',
          details: [{ path: 'name', message: 'Required' }],
        },
        meta,
      }),
    );
    const err = await client(fetchMock)
      .get('/x')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      status: 400,
      requestId: 'req-1',
      details: [{ path: 'name', message: 'Required' }],
    });
  });

  it('maps non-envelope HTTP failures by status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(client(fetchMock).get('/x')).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('reports network failures as NETWORK_ERROR', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client(fetchMock).get('/x')).rejects.toMatchObject({
      code: ErrorCode.NETWORK_ERROR,
      status: 0,
    });
  });

  it('times out slow requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    await expect(client(fetchMock).get('/slow')).rejects.toMatchObject({
      code: ErrorCode.NETWORK_ERROR,
      message: 'Request timed out after 50ms',
    });
  });

  it('uses the global fetch at call time when none is injected', async () => {
    const api = createApiClient({ baseUrl: 'http://api.test/api/v1' });
    const late = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { success: true, data: 1, meta }));
    vi.stubGlobal('fetch', late);
    try {
      await expect(api.get('/x')).resolves.toBe(1);
      expect(late).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a health report that violates the contract', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { success: true, data: { status: 'weird' }, meta }));
    await expect(client(fetchMock).health.report()).rejects.toBeInstanceOf(ApiClientError);
  });
});
