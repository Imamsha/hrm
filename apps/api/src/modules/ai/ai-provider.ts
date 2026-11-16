/**
 * Provider-agnostic AI contracts. Business modules depend on these interfaces only, never on
 * a vendor SDK, so providers can be swapped or routed per tenant without touching domain code.
 *
 * Security model (enforced by the AI platform in Phase 11, see docs/architecture/ADR-006-ai-platform.md):
 *  - Providers are called only by server-side services after authorization checks.
 *  - Retrieval is tenant- and permission-filtered BEFORE content reaches a prompt.
 *  - LLMs never receive database credentials or free-form SQL capabilities.
 *  - Usage (tokens, latency, model) is returned on every call for cost tracking and audit.
 */
export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResult {
  content: string;
  model: string;
  finishReason: string | null;
  usage: TokenUsage;
  latencyMs: number;
}

export interface EmbeddingRequest {
  inputs: string[];
  model?: string;
  signal?: AbortSignal;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: Pick<TokenUsage, 'promptTokens' | 'totalTokens'>;
  latencyMs: number;
}

export interface AiProvider {
  readonly id: string;
  readonly enabled: boolean;
  chat(request: ChatRequest): Promise<ChatResult>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

/** Injection token for the configured provider. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
