import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';
import { DisabledAiProvider } from './providers/disabled.provider.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

export function createAiProvider(config: AppConfig): AiProvider {
  switch (config.AI_PROVIDER) {
    case 'openai-compatible':
      return new OpenAiCompatibleProvider({
        baseUrl: config.AI_BASE_URL,
        apiKey: config.AI_API_KEY,
        chatModel: config.AI_CHAT_MODEL,
        embeddingModel: config.AI_EMBEDDING_MODEL,
        embeddingDimensions: config.AI_EMBEDDING_DIMENSIONS,
        timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
      });
    case 'disabled':
      return new DisabledAiProvider();
  }
}

/**
 * AI platform foundation. Exposes the provider to other server-side modules only.
 * No HTTP endpoints until authentication, permission-aware retrieval, usage metering
 * and audit logging exist (Phase 02 / Phase 11).
 */
@Module({
  providers: [{ provide: AI_PROVIDER, inject: [APP_CONFIG], useFactory: createAiProvider }],
  exports: [AI_PROVIDER],
})
export class AiModule {}
