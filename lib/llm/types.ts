/**
 * LLM abstraction layer — shared type interfaces.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.1. Build Checklist T-2.1.
 *
 * Types only. No implementation. Imported by lib/llm/factory.ts and the
 * provider modules in lib/llm/providers/.
 *
 * Phase 5 ships:
 *   - LLMProvider.complete()       → AnthropicProvider implements
 *   - LLMProvider.stream()         → V2/Phase 5c, not in Phase 5
 *   - LLMProvider.completeWithTools → Director (Phase 5b), not in Phase 5
 */

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
  }
  config: {
    model: string
    temperature: number
    maxTokens: number
    /** Phase 5: false (synthesise streaming is Phase 5c). */
    stream: boolean
    operationType: string
    tools?: ToolDefinition[]
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
  /** Phase 5c. Throws NotImplementedError in V1. */
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
