/**
 * Anthropic native provider.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.3. Build Checklist T-2.3.
 *
 * Wraps the Anthropic SDK. Implements LLMProvider.complete() with:
 *   - Unconditional cache_control: ephemeral on the stable block (TA §7.3,
 *     35–40% cost saving on sequential calls in a session).
 *   - Canary token injection on the system prompt.
 *   - Canary leak scan on the model response.
 *   - Token usage normalisation including cache_read/cache_write tokens.
 *
 * Phase 5 does NOT implement stream() (Phase 5c) or completeWithTools()
 * (Phase 5b — Director). Both throw NotImplementedError if called.
 */

import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { injectCanary, scanForCanaryLeak } from '@/lib/security/canary'
import {
  NotImplementedError,
  type AssembledPrompt,
  type LLMProvider,
  type LLMResponse,
  type LLMStreamChunk,
} from '@/lib/llm/types'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(prompt: AssembledPrompt): Promise<LLMResponse> {
    const systemPromptWithCanary = injectCanary(prompt.stable.systemPrompt)

    // Build the system block with cache_control: ephemeral on the stable
    // sub-blocks. Per TA §7.3: "Stable content is byte-for-byte identical
    // across sequential calls in a session." Cache hit on the second call
    // saves ~56% on input tokens.
    const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
      {
        type: 'text',
        text: systemPromptWithCanary,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: prompt.stable.securityWrapped,
        cache_control: { type: 'ephemeral' },
      },
    ]

    const response = await this.client.messages.create({
      model: prompt.config.model,
      max_tokens: prompt.config.maxTokens,
      temperature: prompt.config.temperature,
      system: systemBlocks,
      messages: [
        {
          role: 'user',
          content: prompt.dynamic.securityWrapped,
        },
      ],
    })

    // Extract text content (Phase 5 doesn't use tool-use; that's Phase 5b)
    const textBlocks = response.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    )
    const content = textBlocks.map((b) => b.text).join('')

    // Canary scan BEFORE returning — caller never sees a leaked-canary response
    scanForCanaryLeak(content)

    const usage = response.usage
    return {
      content,
      usage: {
        tokens_input: usage.input_tokens,
        tokens_output: usage.output_tokens,
        tokens_cache_write: usage.cache_creation_input_tokens ?? 0,
        tokens_cache_read: usage.cache_read_input_tokens ?? 0,
      },
      model: response.model,
      provider: 'anthropic',
      cached: (usage.cache_read_input_tokens ?? 0) > 0,
    }
  }

  // V1 placeholder — Phase 5c implements streaming for synthesise.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, require-yield
  async *stream(_prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk> {
    throw new NotImplementedError('AnthropicProvider.stream()', 'Phase 5c')
  }

  // V1 placeholder — Phase 5b (Director) implements tool use.
  async completeWithTools(_prompt: AssembledPrompt): Promise<LLMResponse> {
    throw new NotImplementedError(
      'AnthropicProvider.completeWithTools()',
      'Phase 5b (Director)',
    )
  }
}
