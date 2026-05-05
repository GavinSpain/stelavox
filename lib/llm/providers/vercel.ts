/**
 * Vercel AI SDK provider — V2 stub.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.4. Build Checklist T-2.4.
 *
 * V1 ships only the AnthropicProvider (platform users + BYOK Anthropic
 * users). The Vercel AI SDK provider lands in V2 alongside non-Anthropic
 * BYOK (OpenAI, Google, Mistral). This file reserves the namespace and
 * throws on any attempted use to make the V1 vs V2 boundary explicit.
 *
 * Per TA §7.4:
 *   "Used for: all non-Anthropic BYOK providers (OpenAI, Google, Mistral).
 *    Normalises tool use, streaming, and token counts to the LLMResponse
 *    interface. No caching available for these providers."
 */

import {
  NotImplementedError,
  type AssembledPrompt,
  type LLMProvider,
  type LLMResponse,
} from '@/lib/llm/types'

export type VercelProviderName = 'openai' | 'google' | 'mistral'

export class VercelProvider implements LLMProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_provider: VercelProviderName, _apiKey: string, _modelId: string) {
    // V2 work — constructor accepts the params for forward-compat.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(_prompt: AssembledPrompt): Promise<LLMResponse> {
    throw new NotImplementedError(
      'VercelProvider.complete()',
      'V2 (non-Anthropic BYOK)',
    )
  }
}
