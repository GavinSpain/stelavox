/**
 * LLM abstraction layer — shared type interfaces.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.1. Build Checklist T-2.1.
 *
 * Types only. No implementation. Imported by lib/llm/factory.ts and the
 * provider modules in lib/llm/providers/.
 *
 * Implementation status:
 *   - LLMProvider.complete()        → AnthropicProvider (Phase 5)
 *   - LLMProvider.stream()          → AnthropicProvider (Phase 5c)
 *   - LLMProvider.streamWithTools() → AnthropicProvider (Phase 5b — Director)
 *   - LLMProvider.completeWithTools → stub (V2 batch / replay tooling)
 */

/**
 * Provider-neutral content block for assembled messages. Phase 5b SU-47.
 * Maps 1:1 to Anthropic's content-block shape but kept abstract so other
 * providers (Vercel SDK, future BYOK) can implement their own translation.
 */
export type AssembledContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  // V1.x-LB task 5 — Anthropic extended thinking.
  // `thinking` is the model's reasoning text + a cryptographic signature
  // Anthropic verifies when the block is passed back in subsequent turns.
  // `redacted_thinking` is encrypted thinking — opaque to us but must be
  // passed back so the model maintains conversational coherence across
  // iterations. Without these, multi-iteration agentic loops with
  // thinking enabled return 400 ("Expected `thinking` or
  // `redacted_thinking` block to be present in the assistant message").
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }

/**
 * Provider-neutral message for the multi-turn agentic loop. Phase 5b SU-47.
 *
 * `content` may be a plain string (single-text-block shorthand) or an array
 * of content blocks (when the message contains tool_use / tool_result blocks).
 */
export type AssembledMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'user' | 'assistant'; content: AssembledContentBlock[] }

export interface AssembledPrompt {
  stable: {
    systemPrompt: string
    ancestors: string
    contextNodes: string
    styleGuide: string
    /** The wrapped+escapeXml'd stable block, ready for the provider. */
    securityWrapped: string
  }
  dynamic: {
    currentNode: string
    agentInstruction: string
    editorialComments: string
    /** The wrapped+escapeXml'd dynamic block, ready for the provider. */
    securityWrapped: string
    /**
     * Phase 5b SU-47 — multi-turn messages array for Anthropic's tool-use
     * protocol. When set, streamWithTools sends this messages array directly
     * to the API, preserving the model's view of its own assistant turns and
     * tool_result blocks across iterations.
     *
     * When unset, streamWithTools falls back to a single-user-message wire
     * format built from `securityWrapped` (legacy V1 path).
     *
     * The executor must include the new user message as the final entry.
     */
    messages?: AssembledMessage[]
  }
  config: {
    model: string
    temperature: number
    maxTokens: number
    /** Phase 5: false (synthesise streaming is Phase 5c). */
    stream: boolean
    operationType: string
    tools?: ToolDefinition[]
    /**
     * V1.x-LB task 5 — extended thinking on Opus-class models.
     * When true AND the model supports it (provider decides), the provider
     * sends `thinking: { type: 'enabled', budget_tokens: ... }` and skips
     * the `temperature` parameter (Anthropic rejects both together).
     */
    extendedThinking?: boolean
  }
}

export interface TokenUsage {
  tokens_input: number
  tokens_output: number
  tokens_cache_write: number
  tokens_cache_read: number
}

export interface LLMResponse {
  content: string
  toolCalls?: ToolCall[]
  usage: TokenUsage
  model: string
  provider: string
  cached: boolean
}

export interface LLMStreamChunk {
  type:
    | 'text'
    | 'usage'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_complete'
    | 'thinking_block_complete'
    | 'message_stop'
  /** Text fragment for `text` chunks. */
  text?: string
  /** Final usage figures for `usage` / `message_stop` chunks. */
  usage?: TokenUsage
  /** For `tool_use_start`: the tool's id + name (arguments not yet known). */
  toolStart?: { id: string; name: string }
  /** For `tool_use_delta`: a partial JSON fragment of the tool's arguments. */
  toolDelta?: { id: string; argumentsJsonDelta: string }
  /** For `tool_use_complete`: fully-assembled tool call. */
  toolCall?: ToolCall
  /**
   * For `thinking_block_complete`: the assembled extended-thinking block.
   * The executor must include this in the assistant message it appends to
   * the messages array before the next iteration; otherwise Anthropic
   * returns 400.
   */
  thinkingBlock?:
    | { kind: 'thinking'; thinking: string; signature: string }
    | { kind: 'redacted_thinking'; data: string }
  /** For `message_stop`: the model's stop_reason. */
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal' | string
}

/** Tool definition for Director write/read tools (Phase 5b). */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** A single tool call emitted by the model (Phase 5b). */
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface LLMProvider {
  complete(prompt: AssembledPrompt): Promise<LLMResponse>
  /**
   * Phase 5c — synthesise streaming. Yields text chunks and a final
   * message_stop chunk carrying usage + stop_reason.
   */
  stream?(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk>
  /**
   * Phase 5b (Director). Non-streaming tool-use — kept as an explicit
   * stub; the Director path uses streamWithTools() instead. Reserved for
   * admin tooling, replay tests, and V2 batch operations.
   */
  completeWithTools?(prompt: AssembledPrompt): Promise<LLMResponse>
  /**
   * Phase 5b (Director). Streaming tool-use — the production Director
   * agentic-loop path. Yields text deltas, tool-use start/delta/complete
   * chunks, and a final usage chunk.
   */
  streamWithTools?(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk>
}

export class NotImplementedError extends Error {
  constructor(feature: string, deferredTo: string) {
    super(`${feature} is not implemented in V1 — deferred to ${deferredTo}.`)
    this.name = 'NotImplementedError'
  }
}
