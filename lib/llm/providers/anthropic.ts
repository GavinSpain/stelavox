/**
 * Anthropic native provider.
 *
 * Source: stelavox_technical_architecture_v2_1.md §7.3.
 *
 * Wraps the Anthropic SDK. Implements:
 *   - complete()         — Phase 5 (single-node ops). Non-streaming, no tools.
 *   - stream()           — Phase 5c (synthesise streaming). Streaming, no tools.
 *   - streamWithTools()  — Phase 5b (Director). Streaming, with tool use.
 *
 * All methods:
 *   - Inject the canary token into the system prompt (TA §4.4).
 *   - Apply cache_control: ephemeral to the stable system block (35–40%
 *     cost saving on sequential calls in a session).
 *   - Scan model output for canary leakage before yielding to the caller.
 *
 * completeWithTools() remains a stub — the Director path uses streaming
 * exclusively; completeWithTools() is reserved for admin tooling, replay
 * tests, and V2 batch operations.
 */

import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { injectCanary, scanForCanaryLeak } from '@/lib/security/canary'
import {
  NotImplementedError,
  type AssembledContentBlock,
  type AssembledMessage,
  type AssembledPrompt,
  type LLMProvider,
  type LLMResponse,
  type LLMStreamChunk,
} from '@/lib/llm/types'

/**
 * Convert provider-neutral AssembledMessage[] to the Anthropic SDK's
 * MessageParam[] shape. Phase 5b SU-47.
 */
function toAnthropicMessages(messages: AssembledMessage[]): Anthropic.Messages.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }
    const blocks: Anthropic.Messages.ContentBlockParam[] = m.content.map((b: AssembledContentBlock) => {
      switch (b.type) {
        case 'text':
          return { type: 'text', text: b.text }
        case 'tool_use':
          return { type: 'tool_use', id: b.id, name: b.name, input: b.input }
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: b.tool_use_id,
            content: b.content,
            ...(b.is_error ? { is_error: true } : {}),
          }
        case 'thinking':
          // V1.x-LB task 5 — pass thinking blocks back to maintain multi-turn
          // coherence. Anthropic verifies `signature` and returns 400 if the
          // block was tampered with or dropped.
          return { type: 'thinking', thinking: b.thinking, signature: b.signature }
        case 'redacted_thinking':
          return { type: 'redacted_thinking', data: b.data }
      }
    })
    return { role: m.role, content: blocks }
  })
}

/**
 * Models that do NOT accept the `temperature` parameter at the API level.
 *
 * SU-46 (Phase 5b verification, 2026-05-08): cross-model T-17.1 testing
 * revealed that Anthropic's extended-thinking-class models reject
 * `temperature` outright with a 400 error
 * (`temperature is deprecated for this model`). The Director's executor
 * passes `temperature` unconditionally; this denylist lets the provider
 * skip the parameter for affected models.
 *
 * Currently affects Opus 4.7 and any later 4.x Opus revisions. Other
 * model families continue to accept temperature. Update this matcher
 * when Anthropic publishes a broader deprecation.
 */
function modelAcceptsTemperature(model: string): boolean {
  if (/^claude-opus-4-([7-9]|\d{2,})/.test(model)) return false
  return true
}

/**
 * Models that support Anthropic's extended-thinking parameter.
 *
 * V1.x-LB task 5. Currently Opus 4.7+ and Sonnet 4.6+ in the Claude 4
 * family. Haiku 4.5 does not support extended thinking. When the Director
 * config enables `extended_thinking: true` but the active model is not on
 * this list, the provider silently omits the `thinking` request parameter
 * — the flag becomes dormant rather than causing a 400.
 *
 * Update this matcher as Anthropic broadens support to additional models.
 */
function modelSupportsExtendedThinking(model: string): boolean {
  if (/^claude-opus-4-([7-9]|\d{2,})/.test(model)) return true
  if (/^claude-sonnet-4-([6-9]|\d{2,})/.test(model)) return true
  return false
}

/**
 * V1.x-LB task 5 — token budget for extended thinking when enabled.
 *
 * Anthropic recommends starting low and adjusting based on observed
 * reasoning quality. 4096 covers typical Director planning turns (1500-
 * 3000 thinking tokens in practice) with margin. The model self-budgets
 * within this ceiling; setting it higher does not force more thinking.
 *
 * Tunable: promote to platform_config if empirical sizing requires it.
 */
const EXTENDED_THINKING_BUDGET_TOKENS = 4096

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
      ...(modelAcceptsTemperature(prompt.config.model) && prompt.config.temperature !== null
        ? { temperature: prompt.config.temperature }
        : {}),
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

  /**
   * Streaming completion without tools — the production synthesise path
   * (Phase 5c). Yields text deltas as they arrive from the model and a
   * final `message_stop` chunk carrying usage + stop_reason.
   *
   * Mirrors streamWithTools structurally minus the tool-use branch. The
   * security frame (canary injection + per-delta canary scan + cache_control
   * on the stable system block) and the SU-46 temperature denylist apply
   * identically to both methods.
   *
   * Cancellation: when the consumer breaks out of the iteration (or Node
   * closes the underlying SSE connection), the SDK's stream object is
   * automatically aborted by the runtime — no explicit teardown required.
   */
  async *stream(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk> {
    const systemPromptWithCanary = injectCanary(prompt.stable.systemPrompt)

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

    // Phase 5c uses single-user-message wire shape — no agentic loop, so
    // no `dynamic.messages` array. The synthesise prompt-assembler emits
    // its full instruction in `dynamic.securityWrapped`.
    const messagesArray: Anthropic.Messages.MessageParam[] = [
      { role: 'user', content: prompt.dynamic.securityWrapped },
    ]

    const stream = this.client.messages.stream({
      model: prompt.config.model,
      max_tokens: prompt.config.maxTokens,
      ...(modelAcceptsTemperature(prompt.config.model) && prompt.config.temperature !== null
        ? { temperature: prompt.config.temperature }
        : {}),
      system: systemBlocks,
      messages: messagesArray,
    })

    let accumulatedText = ''
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let stopReason: string | undefined

    for await (const event of stream) {
      // F-34 (round-3 audit): Anthropic streams may emit an `error`
      // event (rate-limit, content-policy, transient overload). The SDK's
      // RawMessageStreamEvent discriminated union doesn't list this type,
      // so we widen via runtime check before the typed switch. Pre-fix,
      // the default case silently dropped error events; the consumer saw
      // a clean termination without the message_stop it expected. Throw
      // here to surface clearly. See
      // docs/architecture/error-handling-conventions.md.
      const rawType = (event as { type: string }).type
      if (rawType === 'error') {
        const ev = event as { error?: { type?: string; message?: string } }
        const errType = ev.error?.type ?? 'unknown'
        const errMsg = ev.error?.message ?? 'no message'
        throw new Error(`Anthropic stream error (${errType}): ${errMsg}`)
      }

      switch (event.type) {
        case 'message_start': {
          const u = event.message.usage
          inputTokens = u.input_tokens
          outputTokens = u.output_tokens ?? 0
          cacheReadTokens = u.cache_read_input_tokens ?? 0
          cacheWriteTokens = u.cache_creation_input_tokens ?? 0
          break
        }

        case 'content_block_delta': {
          const d = event.delta
          if (d.type === 'text_delta') {
            accumulatedText += d.text
            // Canary scan on the accumulated buffer — catches tokens split
            // across deltas. Throws SecurityViolationError on hit.
            scanForCanaryLeak(accumulatedText)
            yield { type: 'text', text: d.text }
          }
          break
        }

        case 'message_delta': {
          if (event.delta.stop_reason) {
            stopReason = event.delta.stop_reason
          }
          if (event.usage?.output_tokens != null) {
            outputTokens = event.usage.output_tokens
          }
          break
        }

        case 'message_stop': {
          yield {
            type: 'message_stop',
            usage: {
              tokens_input: inputTokens,
              tokens_output: outputTokens,
              tokens_cache_read: cacheReadTokens,
              tokens_cache_write: cacheWriteTokens,
            },
            stopReason,
          }
          break
        }

        // 'content_block_start', 'content_block_stop', 'ping', and any other
        // event types are ignored — synthesise has no tool-use blocks and
        // text blocks need no per-block bookkeeping. (Error events are
        // intercepted above the switch — see F-34 comment.)
        default:
          break
      }
    }
  }

  /**
   * Non-streaming tool-use. Kept as a stub — the Director path uses
   * streamWithTools() exclusively. Reserved for admin tooling, replay
   * tests, and V2 batch operations (Phase 5b API Contract G-13).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async completeWithTools(_prompt: AssembledPrompt): Promise<LLMResponse> {
    throw new NotImplementedError(
      'AnthropicProvider.completeWithTools()',
      'admin tooling / V2 batch (deferred)',
    )
  }

  /**
   * Streaming tool-use — the production Director agentic-loop path.
   * Yields text deltas, tool-use start/delta/complete chunks, and a
   * final usage chunk.
   *
   * Per Phase 5b API Contract §2.16 / §2.11 invariants:
   *   - Canary scan runs on every text chunk before it's yielded.
   *   - Tool definitions are passed through from prompt.config.tools.
   *   - cache_control: ephemeral on the stable system block AND on the
   *     last tool definition — two cache breakpoints across a turn.
   */
  async *streamWithTools(
    prompt: AssembledPrompt,
  ): AsyncIterable<LLMStreamChunk> {
    if (!prompt.config.tools || prompt.config.tools.length === 0) {
      throw new Error(
        'streamWithTools() requires prompt.config.tools to be a non-empty array',
      )
    }

    const systemPromptWithCanary = injectCanary(prompt.stable.systemPrompt)

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

    // Convert our ToolDefinition[] to Anthropic's Tool[]. cache_control on
    // the last tool gives us a cache breakpoint that covers the whole tool
    // suite (Anthropic caches up-to-and-including the breakpoint).
    const tools: Anthropic.Messages.Tool[] = prompt.config.tools.map(
      (t, idx, arr) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
        ...(idx === arr.length - 1
          ? { cache_control: { type: 'ephemeral' as const } }
          : {}),
      }),
    )

    // SU-47 — Anthropic agentic-loop protocol. When the executor supplies
    // a messages array (the proper multi-turn shape with assistant +
    // tool_result content blocks), use it directly. Otherwise fall back to
    // the legacy V1 wire format that flattens a single user message — kept
    // for backward compatibility during migration; new callers should
    // populate `dynamic.messages`.
    const messagesArray: Anthropic.Messages.MessageParam[] =
      prompt.dynamic.messages && prompt.dynamic.messages.length > 0
        ? toAnthropicMessages(prompt.dynamic.messages)
        : [{ role: 'user', content: prompt.dynamic.securityWrapped }]

    // V1.x-LB task 5 — extended thinking. Enable only when the config
    // requests it AND the active model supports it. Haiku 4.5 (the V1
    // default Director model) does not support thinking, so the flag is
    // dormant; a model bump to Opus 4.7 or Sonnet 4.6 activates it.
    // Anthropic rejects `temperature` alongside `thinking`, so when
    // thinking is on, temperature is unconditionally skipped.
    const thinkingActive =
      prompt.config.extendedThinking === true &&
      modelSupportsExtendedThinking(prompt.config.model)

    const stream = this.client.messages.stream({
      model: prompt.config.model,
      max_tokens: prompt.config.maxTokens,
      ...(thinkingActive
        ? {
            thinking: {
              type: 'enabled' as const,
              budget_tokens: EXTENDED_THINKING_BUDGET_TOKENS,
            },
          }
        : {}),
      ...(!thinkingActive &&
      modelAcceptsTemperature(prompt.config.model) &&
      prompt.config.temperature !== null
        ? { temperature: prompt.config.temperature }
        : {}),
      system: systemBlocks,
      tools,
      messages: messagesArray,
    })

    // Per-block accumulators. Indexed by content_block index from the SDK.
    const blocks: Record<
      number,
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; jsonBuffer: string }
      | { type: 'thinking'; thinking: string; signature: string }
      | { type: 'redacted_thinking'; data: string }
    > = {}

    // Accumulated text across the turn — scanned for canary on every delta.
    let accumulatedText = ''

    // Final usage figures — assembled across message_start + message_delta.
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let stopReason: string | undefined

    for await (const event of stream) {
      // F-37 (round-3 audit): mirror of F-34 in streamWithTools. SDK
      // type union doesn't include `error`, so widen via runtime check
      // before the typed switch.
      const rawType = (event as { type: string }).type
      if (rawType === 'error') {
        const ev = event as { error?: { type?: string; message?: string } }
        const errType = ev.error?.type ?? 'unknown'
        const errMsg = ev.error?.message ?? 'no message'
        throw new Error(`Anthropic stream error (${errType}): ${errMsg}`)
      }

      switch (event.type) {
        case 'message_start': {
          const u = event.message.usage
          inputTokens = u.input_tokens
          // output_tokens here is partial; the final value lives on message_delta.
          outputTokens = u.output_tokens ?? 0
          cacheReadTokens = u.cache_read_input_tokens ?? 0
          cacheWriteTokens = u.cache_creation_input_tokens ?? 0
          break
        }

        case 'content_block_start': {
          const b = event.content_block
          if (b.type === 'text') {
            blocks[event.index] = { type: 'text', text: '' }
          } else if (b.type === 'tool_use') {
            blocks[event.index] = {
              type: 'tool_use',
              id: b.id,
              name: b.name,
              jsonBuffer: '',
            }
            yield {
              type: 'tool_use_start',
              toolStart: { id: b.id, name: b.name },
            }
          } else if (b.type === 'thinking') {
            // V1.x-LB task 5 — extended-thinking block. Reasoning text +
            // signature accumulate via thinking_delta / signature_delta on
            // content_block_delta; not surfaced to user-visible text_delta.
            blocks[event.index] = { type: 'thinking', thinking: '', signature: '' }
          } else if (b.type === 'redacted_thinking') {
            // Encrypted thinking — opaque blob delivered in one piece at
            // content_block_start (no per-delta accumulation).
            blocks[event.index] = { type: 'redacted_thinking', data: b.data }
          }
          break
        }

        case 'content_block_delta': {
          const block = blocks[event.index]
          if (!block) break
          const d = event.delta
          if (d.type === 'text_delta' && block.type === 'text') {
            block.text += d.text
            accumulatedText += d.text
            // Canary scan on the whole accumulated buffer — catches tokens
            // split across deltas. Throws SecurityViolationError on hit.
            scanForCanaryLeak(accumulatedText)
            yield { type: 'text', text: d.text }
          } else if (
            d.type === 'input_json_delta' &&
            block.type === 'tool_use'
          ) {
            block.jsonBuffer += d.partial_json
            yield {
              type: 'tool_use_delta',
              toolDelta: {
                id: block.id,
                argumentsJsonDelta: d.partial_json,
              },
            }
          } else if (d.type === 'thinking_delta' && block.type === 'thinking') {
            block.thinking += d.thinking
            // Thinking is internal reasoning; not yielded as user-visible
            // `text` chunks. Surfaces only via thinking_block_complete at
            // content_block_stop for the executor to preserve in the
            // assistant message.
          } else if (d.type === 'signature_delta' && block.type === 'thinking') {
            block.signature += d.signature
          }
          break
        }

        case 'content_block_stop': {
          const block = blocks[event.index]
          if (!block) break
          if (block.type === 'tool_use') {
            // Parse the accumulated JSON buffer into the tool's arguments.
            // Anthropic SDK guarantees valid JSON at content_block_stop.
            let args: Record<string, unknown> = {}
            try {
              args = block.jsonBuffer
                ? (JSON.parse(block.jsonBuffer) as Record<string, unknown>)
                : {}
            } catch {
              // Malformed tool args — surface as an empty-args complete event
              // so the executor can return an error tool result. The
              // validateToolCall + Zod input schema layer will reject empty
              // args for tools that require parameters.
              args = {}
            }
            // Canary scan on the tool's arguments — defence-in-depth.
            scanForCanaryLeak('', { id: block.id, name: block.name, args })
            yield {
              type: 'tool_use_complete',
              toolCall: {
                id: block.id,
                name: block.name,
                arguments: args,
              },
            }
          } else if (block.type === 'thinking') {
            yield {
              type: 'thinking_block_complete',
              thinkingBlock: {
                kind: 'thinking',
                thinking: block.thinking,
                signature: block.signature,
              },
            }
          } else if (block.type === 'redacted_thinking') {
            yield {
              type: 'thinking_block_complete',
              thinkingBlock: {
                kind: 'redacted_thinking',
                data: block.data,
              },
            }
          }
          break
        }

        case 'message_delta': {
          // message_delta carries the final stop_reason and the running
          // output_tokens count.
          if (event.delta.stop_reason) {
            stopReason = event.delta.stop_reason
          }
          if (event.usage?.output_tokens != null) {
            outputTokens = event.usage.output_tokens
          }
          break
        }

        case 'message_stop': {
          // Final-tally chunk. Caller can read usage + stop_reason from here.
          yield {
            type: 'message_stop',
            usage: {
              tokens_input: inputTokens,
              tokens_output: outputTokens,
              tokens_cache_read: cacheReadTokens,
              tokens_cache_write: cacheWriteTokens,
            },
            stopReason,
          }
          break
        }

        // 'ping' and any other event types are ignored — they don't carry
        // application-level data. (Error events are intercepted above the
        // switch — see F-37 comment.)
        default:
          break
      }
    }
  }
}
