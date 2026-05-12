// T-1 acceptance + T-11 cross-model verification — AnthropicProvider.stream()
// yields text chunks and a final message_stop chunk. Phase 5c Build
// Checklist §3 T-1 + T-11.
//
// T-1 acceptance: the streaming wire shape works at all (≥1 text chunk,
// followed by a message_stop chunk carrying usage and stop_reason).
//
// T-11 cross-model verification: the same wire shape works on Haiku 4.5,
// Sonnet 4.6, and Opus 4.7. The Opus 4.7 case specifically exercises the
// SU-46 modelAcceptsTemperature() denylist — the provider must omit the
// temperature parameter for Opus 4.7+ or the API rejects with a 400.
//
// Neither tier scores prose quality — that's deferred to manual review
// against the j5-novel probe class outputs (T-13 close-out).
//
// Total cost: ~$0.003 per run across all three models. Skipped
// automatically when ANTHROPIC_API_KEY is missing or empty.

import { describe, expect, it } from 'vitest'

import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { AssembledPrompt, LLMStreamChunk } from '@/lib/llm/types'

const hasLLMKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7 (SU-46 no-temperature path)' },
] as const

function buildPrompt(model: string): AssembledPrompt {
  return {
    stable: {
      systemPrompt: 'You are a brevity-focused assistant. Reply in plain prose.',
      ancestors: '',
      contextNodes: '',
      styleGuide: '',
      securityWrapped: '<context></context>',
    },
    dynamic: {
      currentNode: '',
      agentInstruction: 'Write a single short sentence about a quiet morning. Stop after one sentence.',
      editorialComments: '',
      precedingSiblings: '',
      succeedingSiblings: '',
      securityWrapped:
        '<user_data>Write a single short sentence about a quiet morning. Stop after one sentence.</user_data>',
    },
    config: {
      model,
      temperature: 0.7,
      maxTokens: 100,
      stream: true,
      operationType: 'synthesise',
    },
  }
}

describe.skipIf(!hasLLMKey)('AnthropicProvider.stream() — wire shape', () => {
  it.each(MODELS)('$label yields text chunks followed by a message_stop chunk', async ({ id }) => {
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)
    const chunks: LLMStreamChunk[] = []

    for await (const chunk of provider.stream!(buildPrompt(id))) {
      chunks.push(chunk)
    }

    const textChunks = chunks.filter((c) => c.type === 'text')
    const stopChunks = chunks.filter((c) => c.type === 'message_stop')

    expect(textChunks.length).toBeGreaterThanOrEqual(1)
    expect(stopChunks.length).toBe(1)

    // message_stop must be the final chunk (per Anthropic SSE protocol).
    expect(chunks[chunks.length - 1].type).toBe('message_stop')

    const stop = stopChunks[0]
    expect(stop.usage).toBeTruthy()
    expect(stop.usage!.tokens_input).toBeGreaterThan(0)
    expect(stop.usage!.tokens_output).toBeGreaterThan(0)
    expect(stop.stopReason).toBeTruthy()

    // Concatenated text is non-empty.
    const concatenated = textChunks.map((c) => c.text ?? '').join('')
    expect(concatenated.length).toBeGreaterThan(0)
  })
})
