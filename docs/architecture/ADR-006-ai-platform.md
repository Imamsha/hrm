# ADR-006: AI platform foundation and guardrails

- Status: Accepted (2026-11-16). Phase 01 = provider abstraction; Phase 11 = AI platform.

## Decision (Phase 01)

- Domain code depends on the `AiProvider` interface (`chat`, `embed`) — never on a vendor SDK.
- `OpenAiCompatibleProvider` talks to any OpenAI-compatible endpoint with `fetch`: response schemas
  validated with Zod, request timeouts, retryable flag for 429/5xx, provider error bodies never
  included in thrown messages (they can echo prompts), embedding dimension enforced to match the
  pgvector column (`AI_EMBEDDING_DIMENSIONS`).
- `DisabledAiProvider` is the default (`AI_PROVIDER=disabled`) and fails explicitly — no simulated
  AI output anywhere.
- pgvector 0.8.7 is installed; `toPgVector()` serialises vectors for **bound parameters** only.
- No AI HTTP endpoints exist yet.

## Guardrails that Phase 11 must implement (non-negotiable)

1. Every AI call runs server-side after the caller's normal authorization; AI tools invoke the same
   service methods (and permission checks) as the UI — no privileged AI path.
2. Retrieval (RAG) filters by tenant **and** by the requesting user's permissions before content
   enters a prompt; embeddings are stored with `organization_id` under RLS.
3. LLMs never receive credentials or raw SQL access; NL analytics compiles to an allow-listed,
   parameterised query model.
4. PII minimisation/redaction before prompts; prompt-injection defences on retrieved content and
   tool outputs; output validation for structured responses.
5. Usage metering per tenant/user/feature (tokens, cost, latency, model, prompt version) and AI
   audit logs; per-tenant rate limits and budgets.
6. Human approval for sensitive actions; AI is never the sole decision-maker for hiring, firing,
   promotion, compensation or discipline.
7. Versioned prompts and an evaluation suite gate prompt/model changes.
