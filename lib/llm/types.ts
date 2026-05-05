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
  type: 'text' | 'usage' | 'tool_use'
  text?: string
  usage?: TokenUsage
  toolCall?: ToolCall
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
  /** V2/Phase 5c. Throws NotImplementedError in V1. */
  stream?(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk>
  /** Phase 5b (Director). Throws NotImplementedError in Phase 5. */
  completeWithTools?(prompt: AssembledPrompt): Promise<LLMResponse>
}

export class NotImplementedError extends Error {
  constructor(feature: string, deferredTo: string) {
    super(`${feature} is not implemented in V1 — deferred to ${deferredTo}.`)
    this.name = 'NotImplementedError'
  }
}
