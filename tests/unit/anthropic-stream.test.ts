// T-1 acceptance — AnthropicProvider.stream() yields text chunks and a
// final message_stop chunk. Phase 5c Build Checklist §3 T-1.
//
// This test only exercises the wire shape: ≥1 text chunk, followed
// (eventually) by a message_stop chunk carrying usage and stop_reason.
// It does NOT score the prose — synthesise quality is covered in the
// cross-model verification step (T-11) and the j5-novel probe class (T-8).
//
// Cost: ~$0.001 per run on Haiku 4.5 (very small completion). Skipped
// automatically when ANTHROPIC_API_KEY is missing or empty.

import { describe, expect, it } from 'vitest'

import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { AssembledPrompt, LLMStreamChunk } from '@/lib/llm/types'

const hasLLMKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0

function buildPrompt(): AssembledPrompt {
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
      securityWrapped:
        '<user_data>Write a single short sentence about a quiet morning. Stop after one sentence.</user_data>',
    },
    config: {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      maxTokens: 100,
      stream: true,
      operationType: 'synthesise',
    },
  }
}

describe.skipIf(!hasLLMKey)('AnthropicProvider.stream() — T-1 acceptance', () => {
  it('yields one or more text chunks followed by a message_stop chunk', async () => {
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)
    const chunks: LLMStreamChunk[] = []

    for await (const chunk of provider.stream!(buildPrompt())) {
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
