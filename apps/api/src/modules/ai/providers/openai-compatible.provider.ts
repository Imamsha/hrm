import { z } from 'zod';
import type {
  AiProvider,
  ChatRequest,
  ChatResult,
  EmbeddingRequest,
  EmbeddingResult,
} from '../ai-provider.js';

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  /** Must match the pgvector column dimension; mismatches are rejected. */
  embeddingDimensions: number;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const usageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().default(0),
    completion_tokens: z.number().int().nonnegative().default(0),
    total_tokens: z.number().int().nonnegative().default(0),
  })
  .partial()
  .default({});

const chatResponseSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: usageSchema,
});

const embeddingResponseSchema = z.object({
  model: z.string(),
  data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })),
  usage: usageSchema,
});

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiProviderError';
  }
}

/**
 * Adapter for any OpenAI-compatible HTTP API (OpenAI, Azure OpenAI-compatible gateways,
 * vLLM, Ollama, LiteLLM, ...). Uses `fetch` directly: no vendor SDK dependency.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';
  readonly enabled = true;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      const timedOut = timeout.aborted;
      throw new AiProviderError(
        timedOut ? 'AI provider request timed out' : 'AI provider unreachable',
        undefined,
        true,
        {
          cause: err,
        },
      );
    }
    if (!res.ok) {
      // Provider error bodies may echo prompts; never include them in the thrown message.
      throw new AiProviderError(
        `AI provider responded with HTTP ${res.status}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    return res.json();
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    if (request.messages.length === 0)
      throw new AiProviderError('At least one message is required');
    const started = performance.now();
    const raw = await this.post(
      '/chat/completions',
      {
        model: request.model ?? this.config.chatModel,
        messages: request.messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      },
      request.signal,
    );
    const parsed = chatResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new AiProviderError('AI provider returned an unexpected chat response');
    const choice = parsed.data.choices[0];
    const u = parsed.data.usage;
    return {
      content: choice?.message.content ?? '',
      model: parsed.data.model,
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
      },
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (request.inputs.length === 0) throw new AiProviderError('At least one input is required');
    if (!this.config.embeddingModel) throw new AiProviderError('No embedding model is configured');
    const started = performance.now();
    const raw = await this.post(
      '/embeddings',
      {
        model: request.model ?? this.config.embeddingModel,
        input: request.inputs,
        dimensions: this.config.embeddingDimensions,
      },
      request.signal,
    );
    const parsed = embeddingResponseSchema.safeParse(raw);
    if (!parsed.success)
      throw new AiProviderError('AI provider returned an unexpected embedding response');
    const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (ordered.length !== request.inputs.length) {
      throw new AiProviderError(
        'AI provider returned a different number of embeddings than inputs',
      );
    }
    for (const v of ordered) {
      if (v.length !== this.config.embeddingDimensions) {
        throw new AiProviderError(
          `Embedding dimension ${v.length} does not match configured ${this.config.embeddingDimensions}`,
        );
      }
    }
    const u = parsed.data.usage;
    return {
      vectors: ordered,
      model: parsed.data.model,
      dimensions: this.config.embeddingDimensions,
      usage: {
        promptTokens: u.prompt_tokens ?? 0,
        totalTokens: u.total_tokens ?? u.prompt_tokens ?? 0,
      },
      latencyMs: Math.round(performance.now() - started),
    };
  }
}
