// SSE consumer for POST /api/director/message.
//
// Source: stelavox_phase5b_api_contract_v1_0.md §2.16 wire format.
//
// Wraps fetch + ReadableStream parsing. Calls a callback for each
// recognised event. Returns a Promise that resolves on `done` or an
// error event, or rejects on transport failure.

export interface DirectorStreamRequest {
  documentId: string
  conversationId: string | null
  content: string
  mentionedNodeIds: string[]
  signal?: AbortSignal
}

export interface DirectorStreamHandlers {
  onStart?:    (data: { conversation_id: string; user_message_id: string; turn_id?: string }) => void
  onTextDelta: (delta: string) => void
  onToolUseStart?:    (data: { tool_call_id: string; name: string; arguments_partial: unknown }) => void
  onToolUseComplete?: (data: { tool_call_id: string; validation_result: string; result_summary?: string }) => void
  onWorkflowProposal?: (data: { workflow: unknown; assistant_message_id: string }) => void
  onAssistantMessageComplete?: (data: {
    assistant_message_id: string
    tokens_input: number
    tokens_output: number
    tokens_cache_read: number
    tokens_cache_write: number
    cost_usd: number
  }) => void
  onError?: (data: { error: string; message: string }) => void
  onDone?:  () => void
}

interface ParsedSseEvent {
  event: string
  data: unknown
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  // SSE blocks are terminated by `\n\n`. Comment lines start with `:`.
  // We expect `event: <name>\ndata: <json>` per the wire format. Some
  // events arrive as `data: {"event":"text_delta", ...}` — handle both.
  const lines = block.split('\n')
  let event = 'message'
  const dataParts: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue // comment / heartbeat
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trim())
    }
  }
  if (dataParts.length === 0) return null
  const dataStr = dataParts.join('\n')
  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>
    // Some servers tag inside the JSON; normalise.
    const inner = (data.event as string | undefined) ?? event
    return { event: inner, data: 'data' in data ? data.data : data }
  } catch {
    return { event, data: dataStr }
  }
}

export async function streamDirectorMessage(
  req: DirectorStreamRequest,
  h: DirectorStreamHandlers,
): Promise<void> {
  const res = await fetch('/api/director/message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      document_id: req.documentId,
      // SU-45: API contract §3.1 specifies "uuid-or-omit" — null is not
      // permitted. Omit the field entirely when no conversation exists
      // yet (server then calls getOrCreateConversation).
      ...(req.conversationId ? { conversation_id: req.conversationId } : {}),
      content: req.content,
      mentioned_node_ids: req.mentionedNodeIds,
    }),
    signal: req.signal,
  })

  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      message = body.message ?? body.error ?? message
    } catch {
      /* swallow */
    }
    h.onError?.({ error: 'request_failed', message })
    // F-92 (round-3 audit): throw so the Promise rejects on transport
    // failure. Pre-fix the bare `return` resolved the Promise; callers
    // doing `await streamDirectorMessage(...)` saw clean completion when
    // the request actually 4xx/5xx'd. Convention:
    // docs/architecture/error-handling-conventions.md.
    throw new Error(`streamDirectorMessage transport failure: ${message}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // F-94 (round-3 audit): track whether a terminal application-level
  // event arrived. If the network stream closes without `done` or
  // `error`, the server crashed mid-stream and we must surface it.
  let saw_terminator = false

  // Read until done.
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Process all complete event blocks.
    let sep = buf.indexOf('\n\n')
    while (sep !== -1) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const parsed = parseSseBlock(block)
      if (parsed) {
        if (parsed.event === 'done' || parsed.event === 'error') saw_terminator = true
        dispatch(parsed, h)
      }
      sep = buf.indexOf('\n\n')
    }
  }
  // Any tail buffer is ignored — last event must be `done` per spec.

  // F-94: surface a mid-stream crash. If the server-side route handler
  // throws or the network is severed before emitting `done`/`error`,
  // the read loop ends naturally and pre-fix the Promise resolved as
  // if the stream completed successfully.
  if (!saw_terminator) {
    throw new Error(
      'streamDirectorMessage: stream ended without a terminating `done` or `error` event (server may have crashed mid-stream)',
    )
  }
}

function dispatch(ev: ParsedSseEvent, h: DirectorStreamHandlers) {
  const data = ev.data as Record<string, unknown>
  switch (ev.event) {
    case 'start':
      h.onStart?.(data as never)
      return
    case 'text_delta':
      if (typeof data?.delta === 'string') h.onTextDelta(data.delta)
      return
    case 'tool_use_start':
      h.onToolUseStart?.(data as never)
      return
    case 'tool_use_complete':
      h.onToolUseComplete?.(data as never)
      return
    case 'workflow_proposal':
      h.onWorkflowProposal?.(data as never)
      return
    case 'assistant_message_complete':
      h.onAssistantMessageComplete?.(data as never)
      return
    case 'error':
      h.onError?.(data as never)
      return
    case 'done':
      h.onDone?.()
      return
  }
}
