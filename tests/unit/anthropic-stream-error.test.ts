// B3.2 — round-3 audit F-34 + F-37.
//
// Anthropic streams can emit `error` events (rate-limit, content-policy,
// transient). The for-await loops in AnthropicProvider.stream() and
// .streamWithTools() handle the documented event types and fall through
// to `default: break` for everything else — *including error events*.
// The loop continues, eventually exhausts, and the consumer sees a clean
// termination without the message_stop it expects.
//
// F-34: lib/llm/providers/anthropic.ts:251–255 (stream())
// F-37: lib/llm/providers/anthropic.ts:478–481 (streamWithTools())
//
// Fix: throw on error events with a message naming the kind. The
// consumer's try/catch surfaces it; no more silent truncation.
//
// Failing-test-first proof: the tests below mock the SDK to inject an
// error event mid-stream. Pre-fix the iteration completes without
// throwing (silent F-34/F-37). Post-fix the iteration throws an Error
// whose message contains the SDK error's text.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssembledPrompt, LLMStreamChunk } from '@/lib/llm/types'

// Minimal AssembledPrompt for the provider under test.
function buildPrompt(model: string): AssembledPrompt {
  return {
    stable: {
      systemPrompt: '',
      ancestors: '',
      contextNodes: '',
      styleGuide: '',
      securityWrapped: '<context></context>',
    },
    dynamic: {
      currentNode: '',
      agentInstruction: '',
      editorialComments: '',
      securityWrapped: '<user_data>x</user_data>',
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

// Build an async iterable that yields the configured events in order.
function makeMockStream(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e
    },
  }
}

vi.mock('@anthropic-ai/sdk', () => {
  const mockStream = vi.fn()
  const mockCreate = vi.fn()
  class MockAnthropic {
    messages = { stream: mockStream, create: mockCreate }
  }
  return {
    default: MockAnthropic,
    Anthropic: MockAnthropic,
    __setMockStream: (impl: (..._args: unknown[]) => unknown) => mockStream.mockImplementation(impl),
    __setMockCreate: (impl: (..._args: unknown[]) => unknown) => mockCreate.mockImplementation(impl),
  }
})

import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import * as MockedSDK from '@anthropic-ai/sdk'

describe('B3.2 — F-34 / F-37: anthropic stream error events must throw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('F-34: stream() throws when an error event is emitted (instead of silently truncating)', async () => {
    // Inject: message_start, a text delta, then an error event. Pre-fix
    // behavior: text yielded, error swallowed by `default: break`,
    // message_stop never arrives → consumer sees clean termination
    // with no message_stop chunk.
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Anthropic API is temporarily unavailable.' } },
    ]
    ;(MockedSDK as unknown as { __setMockStream: (impl: () => unknown) => void })
      .__setMockStream(() => makeMockStream(events))

    const provider = new AnthropicProvider('fake-key')
    const chunks: LLMStreamChunk[] = []

    await expect(async () => {
      for await (const chunk of provider.stream!(buildPrompt('claude-haiku-4-5-20251001'))) {
        chunks.push(chunk)
      }
    }).rejects.toThrow(/Anthropic|overloaded|stream error/i)

    // The text we yielded before the error should still have come through —
    // the throw doesn't unwind already-yielded values.
    const textChunks = chunks.filter((c) => c.type === 'text')
    expect(textChunks.length).toBeGreaterThanOrEqual(1)
    // But we should NOT see message_stop (the stream was aborted).
    const stopChunks = chunks.filter((c) => c.type === 'message_stop')
    expect(stopChunks.length).toBe(0)
  })

  it('F-37: streamWithTools() throws when an error event is emitted (mirror of F-34)', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'thinking…' } },
      { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded.' } },
    ]
    ;(MockedSDK as unknown as { __setMockStream: (impl: () => unknown) => void })
      .__setMockStream(() => makeMockStream(events))

    const provider = new AnthropicProvider('fake-key')

    await expect(async () => {
      // streamWithTools requires the tools array to exist.
      const promptWithTools: AssembledPrompt = {
        ...buildPrompt('claude-haiku-4-5-20251001'),
        config: {
          ...buildPrompt('claude-haiku-4-5-20251001').config,
          tools: [{ name: 't', description: 'd', input_schema: {} }],
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of provider.streamWithTools!(promptWithTools)) {
        // consume
      }
    }).rejects.toThrow(/rate limit|Rate limit|stream error/i)
  })

  it('does NOT throw when the stream completes normally (no regression on happy path)', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    ;(MockedSDK as unknown as { __setMockStream: (impl: () => unknown) => void })
      .__setMockStream(() => makeMockStream(events))

    const provider = new AnthropicProvider('fake-key')
    const chunks: LLMStreamChunk[] = []
    for await (const chunk of provider.stream!(buildPrompt('claude-haiku-4-5-20251001'))) {
      chunks.push(chunk)
    }

    expect(chunks.find((c) => c.type === 'message_stop')).toBeTruthy()
  })
})
