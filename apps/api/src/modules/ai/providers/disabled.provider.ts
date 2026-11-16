import { AppException } from '../../../common/http/app.exception.js';
import type { AiProvider, ChatResult, EmbeddingResult } from '../ai-provider.js';

/** Used when no provider is configured. Fails explicitly; never fabricates AI output. */
export class DisabledAiProvider implements AiProvider {
  readonly id = 'disabled';
  readonly enabled = false;

  chat(): Promise<ChatResult> {
    return Promise.reject(
      AppException.serviceUnavailable('AI features are not configured for this deployment'),
    );
  }

  embed(): Promise<EmbeddingResult> {
    return Promise.reject(
      AppException.serviceUnavailable('AI features are not configured for this deployment'),
    );
  }
}
