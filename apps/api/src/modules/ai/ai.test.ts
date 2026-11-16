import { describe, expect, it, vi } from 'vitest';
import { AppException } from '../../common/http/app.exception.js';
import { fromPgVector, toPgVector } from './pgvector.js';
import { DisabledAiProvider } from './providers/disabled.provider.js';
import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from './providers/openai-compatible.provider.js';

function provider(fetchImpl: typeof fetch, dims = 3) {
  return new OpenAiCompatibleProvider({
    baseUrl: 'https://llm.test/v1/',
    apiKey: 'sk-test',
    chatModel: 'chat-model',
    embeddingModel: 'embed-model',
    embeddingDimensions: dims,
    timeoutMs: 1_000,
    fetch: fetchImpl,
  });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpenAiCompatibleProvider.chat', () => {
  it('calls /chat/completions and reports usage', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        model: 'chat-model-2026',
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      }),
    );
    const res = await provider(f).chat({
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
    });
    expect(f.mock.calls[0]?.[0]).toBe('https://llm.test/v1/chat/completions');
    const init = f.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: 'chat-model', temperature: 0 });
    expect(res).toMatchObject({ content: 'Hello', model: 'chat-model-2026', finishReason: 'stop' });
    expect(res.usage).toEqual({ promptTokens: 7, completionTokens: 2, totalTokens: 9 });
  });

  it('does not leak provider error bodies', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'secret prompt echoed' }, 500));
    const err = await provider(f)
      .chat({ messages: [{ role: 'user', content: 'x' }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).message).not.toContain('secret');
    expect((err as AiProviderError).retryable).toBe(true);
  });

  it('rejects malformed responses', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ unexpected: true }));
    await expect(provider(f).chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /unexpected/,
    );
  });
});

describe('OpenAiCompatibleProvider.embed', () => {
  it('returns vectors ordered by index', async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        model: 'embed-model',
        data: [
          { index: 1, embedding: [4, 5, 6] },
          { index: 0, embedding: [1, 2, 3] },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }),
    );
    const res = await provider(f).embed({ inputs: ['a', 'b'] });
    expect(res.vectors).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(res.dimensions).toBe(3);
  });

  it('rejects dimension mismatches with the pgvector column', async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ model: 'm', data: [{ index: 0, embedding: [1, 2] }], usage: {} }));
    await expect(provider(f).embed({ inputs: ['a'] })).rejects.toThrow(/dimension/);
  });
});

describe('DisabledAiProvider', () => {
  it('fails explicitly instead of fabricating output', async () => {
    const p = new DisabledAiProvider();
    expect(p.enabled).toBe(false);
    await expect(p.chat()).rejects.toBeInstanceOf(AppException);
  });
});

describe('pgvector serialisation', () => {
  it('round-trips vectors', () => {
    expect(toPgVector([1, -0.5, 3e-3])).toBe('[1,-0.5,0.003]');
    expect(fromPgVector('[1,-0.5,0.003]')).toEqual([1, -0.5, 0.003]);
  });

  it('rejects invalid vectors', () => {
    expect(() => toPgVector([])).toThrow();
    expect(() => toPgVector([1, Number.NaN])).toThrow(/non-finite/);
    expect(() => toPgVector([1, 2], 3)).toThrow(/expected 3/);
  });
});
