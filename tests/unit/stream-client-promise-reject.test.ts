// B3.3 — round-3 audit F-92 + F-94 + F-139.
//
// streamMessage and streamSynthesise are the client-side SSE consumers
// for the Director and synthesise streaming routes. Pre-fix they both
// resolve their Promise on transport failure (`!res.ok || !res.body`)
// after calling the optional `onError` handler. A caller that does
// `await streamDirectorMessage(...)` sees clean completion when the
// request actually 4xx/5xx'd; only callers wired with onError noticed.
//
// F-92 (HIGH): lib/director/streamMessage.ts:89-99
// F-139 (HIGH): lib/agent/streamSynthesise.ts:110-122 (mirror of F-92)
// F-94 (MEDIUM): lib/director/streamMessage.ts:120-121 — tail buffer
//   dropped without `done` event triggers no callback, Promise resolves
//   on stream close even when the server crashed mid-stream.
//
// Fix: throw after onError, AND throw if the read loop ends without
// seeing a `done` or `error` event. Promise rejects on any of:
//   - fetch threw (already rejected)
//   - !res.ok || !res.body (was resolve → throw)
//   - read loop ended without `done` or `error` (was resolve → throw)
//
// Failing-test-first proof: each scenario red pre-fix; green post-fix.

import { afterEach, describe, expect, it, vi } from 'vitest'

const ENC = new TextEncoder()
const NDJSON_LINE = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

// Build a Response whose body is a ReadableStream emitting the given chunks.
function makeStreamResponse(status: number, chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(ENC.encode(c))
      controller.close()
    },
  })
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('B3.3 — F-92: streamDirectorMessage Promise rejects on transport failure', () => {
  it('rejects on 500 with JSON body containing the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse(500, { error: 'internal', message: 'database down' })))
    const { streamDirectorMessage } = await import('@/lib/director/streamMessage')

    await expect(
      streamDirectorMessage(
        { documentId: 'd', conversationId: null, content: 'x', mentionedNodeIds: [] },
        { onTextDelta: () => {} },
      ),
    ).rejects.toThrow(/database down|HTTP 500|request_failed/)
  })

  it('rejects on 4xx with no JSON body (fallback to HTTP status code)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('plain text', { status: 401 })))
    const { streamDirectorMessage } = await import('@/lib/director/streamMessage')

    await expect(
      streamDirectorMessage(
        { documentId: 'd', conversationId: null, content: 'x', mentionedNodeIds: [] },
        { onTextDelta: () => {} },
      ),
    ).rejects.toThrow(/HTTP 401|request_failed/)
  })

  it('F-94: rejects when the stream closes without a `done` event', async () => {
    // Server sends some text deltas, then closes the body without sending
    // either an `error` or a `done` event. Pre-fix the Promise resolved
    // (the read loop ends naturally); post-fix it must reject.
    const chunks = [
      NDJSON_LINE('text_delta', { delta: 'partial' }),
      // server crashed here — no more events, body closes
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse(200, chunks)))
    const { streamDirectorMessage } = await import('@/lib/director/streamMessage')

    await expect(
      streamDirectorMessage(
        { documentId: 'd', conversationId: null, content: 'x', mentionedNodeIds: [] },
        { onTextDelta: () => {} },
      ),
    ).rejects.toThrow(/done|terminated|incomplete|stream/i)
  })

  it('resolves cleanly when the stream ends with `done` (no regression)', async () => {
    const chunks = [
      NDJSON_LINE('start', { conversation_id: 'c1', user_message_id: 'u1' }),
      NDJSON_LINE('text_delta', { delta: 'hello' }),
      NDJSON_LINE('done', {}),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse(200, chunks)))
    const { streamDirectorMessage } = await import('@/lib/director/streamMessage')

    let donefired = false
    await streamDirectorMessage(
      { documentId: 'd', conversationId: null, content: 'x', mentionedNodeIds: [] },
      { onTextDelta: () => {}, onDone: () => { donefired = true } },
    )
    expect(donefired).toBe(true)
  })

  it('resolves cleanly when the server emits an explicit `error` event (caller decides what to do)', async () => {
    // The application-level `error` event is *not* a transport failure;
    // it's the server saying "I tried but couldn't". The Promise resolves
    // (caller's onError handler took the data). This is the pre-existing
    // contract from the file's docstring.
    const chunks = [
      NDJSON_LINE('start', { conversation_id: 'c1', user_message_id: 'u1' }),
      NDJSON_LINE('error', { error: 'workflow_invalid', message: 'plan rejected' }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse(200, chunks)))
    const { streamDirectorMessage } = await import('@/lib/director/streamMessage')

    let errorFired = false
    await streamDirectorMessage(
      { documentId: 'd', conversationId: null, content: 'x', mentionedNodeIds: [] },
      { onTextDelta: () => {}, onError: () => { errorFired = true } },
    )
    expect(errorFired).toBe(true)
  })
})

describe('B3.3 — F-139: streamSynthesise Promise rejects on transport failure (mirror of F-92)', () => {
  it('rejects on 402 token_budget_exceeded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse(402, { error: 'token_budget_exceeded', message: 'period budget exhausted' })))
    const { streamSynthesise } = await import('@/lib/agent/streamSynthesise')

    await expect(
      streamSynthesise(
        { nodeId: 'n1' },
        { onTextDelta: () => {}, onJobComplete: () => {} },
      ),
    ).rejects.toThrow(/budget|HTTP 402|request_failed/)
  })

  it('rejects when the stream closes without a `done` or `error` event', async () => {
    const chunks = [
      NDJSON_LINE('agent_job_created', { agent_job_id: 'j1', operation_type: 'synthesise', target_node_id: 'n1', profile_id: 'p1', started_at: '2026-05-10' }),
      NDJSON_LINE('text_delta', { delta: 'partial' }),
      // crash — no done event
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamResponse(200, chunks)))
    const { streamSynthesise } = await import('@/lib/agent/streamSynthesise')

    await expect(
      streamSynthesise(
        { nodeId: 'n1' },
        { onTextDelta: () => {}, onJobComplete: () => {} },
      ),
    ).rejects.toThrow(/done|terminated|incomplete|stream/i)
  })
})
