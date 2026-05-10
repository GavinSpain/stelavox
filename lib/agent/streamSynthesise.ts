// SSE consumer for POST /api/agent/synthesise/stream.
//
// Source: stelavox_phase5c_api_contract_v1_0.md §2.2 wire format.
// Build Checklist: T-5.
//
// Wraps fetch + ReadableStream parsing for the synthesise streaming
// endpoint. Calls a callback for each recognised event. Returns a Promise
// that resolves on the `done` event (clean exit) or an `error` event, or
// rejects on transport failure (e.g. fetch threw).
//
// Cancellation: the caller passes an AbortSignal. When that signal aborts,
// the fetch's underlying request is cancelled, which the route handler
// detects via request.signal.aborted and propagates to the SDK stream and
// the agent_jobs row (status='cancelled', error_message='client_disconnect').

export interface SynthesiseStreamRequest {
  nodeId: string
  profileId?: string
  agentInstruction?: string
  proseTargetWords?: number
  expectedVersion?: number
  signal?: AbortSignal
}

export interface AgentJobCreatedEvent {
  agent_job_id: string
  operation_type: string
  target_node_id: string
  profile_id: string
  started_at: string
}

export interface AgentJobCompleteEvent {
  agent_job_id: string
  status: 'completed'
  result_prose: string
  completed_at: string
}

export interface SynthesiseUsageEvent {
  tokens_input: number
  tokens_output: number
  tokens_cache_read: number
  tokens_cache_write: number
  cost_usd: number
}

export interface SynthesiseStreamHandlers {
  onJobCreated?:  (data: AgentJobCreatedEvent) => void
  onTextDelta:    (delta: string) => void
  onHeartbeat?:   (data: { ts: string }) => void
  onUsage?:       (data: SynthesiseUsageEvent) => void
  onJobComplete:  (data: AgentJobCompleteEvent) => void
  onError?:       (data: { error: string; message: string }) => void
  onDone?:        () => void
}

interface ParsedSseEvent {
  event: string
  data: unknown
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataParts: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue
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
    const inner = (data.event as string | undefined) ?? event
    return { event: inner, data: 'data' in data ? data.data : data }
  } catch {
    return { event, data: dataStr }
  }
}

export async function streamSynthesise(
  req: SynthesiseStreamRequest,
  h: SynthesiseStreamHandlers,
): Promise<void> {
  const res = await fetch('/api/agent/synthesise/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      node_id: req.nodeId,
      ...(req.profileId ? { profile_id: req.profileId } : {}),
      ...(req.agentInstruction ? { agent_instruction: req.agentInstruction } : {}),
      ...(req.proseTargetWords !== undefined
        ? { prose_target_words: req.proseTargetWords }
        : {}),
      ...(req.expectedVersion !== undefined
        ? { expected_version: req.expectedVersion }
        : {}),
    }),
    signal: req.signal,
  })

  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`
    let errorCode = 'request_failed'
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      errorCode = body.error ?? errorCode
      message = body.message ?? body.error ?? message
    } catch {
      /* swallow */
    }
    h.onError?.({ error: errorCode, message })
    // F-139 (round-3 audit, mirror of F-92): throw so the Promise rejects
    // on transport failure. Pre-fix the bare `return` resolved the
    // Promise; callers doing `await streamSynthesise(...)` saw clean
    // completion when the request actually 4xx/5xx'd.
    throw new Error(`streamSynthesise transport failure (${errorCode}): ${message}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  // F-94 (round-3 audit, applied by extension to streamSynthesise):
  // surface a mid-stream crash. The Promise must reject if the server
  // closes the body without emitting either `done` or `error`.
  let saw_terminator = false

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
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

  if (!saw_terminator) {
    throw new Error(
      'streamSynthesise: stream ended without a terminating `done` or `error` event (server may have crashed mid-stream)',
    )
  }
}

function dispatch(ev: ParsedSseEvent, h: SynthesiseStreamHandlers): void {
  const data = ev.data as Record<string, unknown>
  switch (ev.event) {
    case 'agent_job_created':
      h.onJobCreated?.(data as unknown as AgentJobCreatedEvent)
      return
    case 'text_delta':
      if (typeof data?.delta === 'string') h.onTextDelta(data.delta)
      return
    case 'heartbeat':
      h.onHeartbeat?.(data as unknown as { ts: string })
      return
    case 'usage':
      h.onUsage?.(data as unknown as SynthesiseUsageEvent)
      return
    case 'agent_job_complete':
      h.onJobComplete(data as unknown as AgentJobCompleteEvent)
      return
    case 'error':
      h.onError?.(data as unknown as { error: string; message: string })
      return
    case 'done':
      h.onDone?.()
      return
  }
}
