// B3.4 — round-3 audit F-170 + F-171 + F-172.
//
// editor-store.ts autosave was silent on:
//   F-170 (HIGH): network failure (`patchNode` throw → bare `return`,
//                 dirty stays true, no signal anywhere)
//   F-171 (HIGH): non-200/409/423 responses (422 / 500 / 503 silently
//                 leave dirty=true with no surface and no backoff)
//   F-172 (MED):  reloadFromServer no-ops on `!res.ok`
//
// Fix: store gains a `saveError: string | null` field, set on each of
// these failure paths. A console.error is also emitted so devs see it
// in the browser dev tools immediately. The UI banner that consumes
// `saveError` is a Phase 7 polish item — Phase 3's job is to stop the
// silence at the data layer. Convention:
// docs/architecture/error-handling-conventions.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// patchNode is an internal function in lib/stores/editor-store.ts; it
// uses global fetch under the hood. Stub fetch to inject network errors
// and arbitrary status codes per test.
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  // localStorage clear — the store reads/writes a shadow there.
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: Storage }).localStorage) {
    ;(globalThis as { localStorage: Storage }).localStorage.clear()
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Helper: build a Response object with the given status and JSON body.
function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const NODE = {
  id: 'node-1',
  version: 1,
  content_revision: 1,
  summary: 'initial',
  prose: null,
  notes: null,
  metadata: null,
}

async function loadStore() {
  const mod = await import('@/lib/stores/editor-store')
  return mod.useEditorStore
}

describe('B3.4 — F-170: editor-store autosave network failure must surface', () => {
  it('sets saveError when patchNode throws (network failure)', async () => {
    const useEditorStore = await loadStore()
    fetchMock.mockRejectedValue(new Error('network down'))

    useEditorStore.getState().loadNode(NODE)
    useEditorStore.getState().setField('summary', 'edited')
    await useEditorStore.getState().flushPending()

    const state = useEditorStore.getState()
    expect(state.saveError).toBeTruthy()
    expect(state.saveError).toMatch(/network|save failed|fetch/i)
    // Still dirty — the edit isn't persisted.
    expect(state.dirty).toBe(true)
  })

  it('clears saveError on successful save (next attempt succeeds)', async () => {
    const useEditorStore = await loadStore()
    // First call fails; second call succeeds.
    fetchMock.mockRejectedValueOnce(new Error('blip'))
    fetchMock.mockResolvedValueOnce(jsonResp(200, { node: { ...NODE, content_revision: 2 } }))

    useEditorStore.getState().loadNode(NODE)
    useEditorStore.getState().setField('summary', 'edit-1')
    await useEditorStore.getState().flushPending()
    expect(useEditorStore.getState().saveError).toBeTruthy()

    useEditorStore.getState().setField('summary', 'edit-2')
    await useEditorStore.getState().flushPending()

    expect(useEditorStore.getState().saveError).toBeNull()
    expect(useEditorStore.getState().dirty).toBe(false)
  })
})

describe('B3.4 — F-171: editor-store autosave unrecoverable response must surface', () => {
  it.each([
    [422],
    [500],
    [503],
  ])('sets saveError when patchNode returns %i', async (status) => {
    const useEditorStore = await loadStore()
    fetchMock.mockResolvedValue(jsonResp(status, { error: 'something_went_wrong', message: `HTTP ${status}` }))

    useEditorStore.getState().loadNode(NODE)
    useEditorStore.getState().setField('summary', 'edited')
    await useEditorStore.getState().flushPending()

    const state = useEditorStore.getState()
    expect(state.saveError).toBeTruthy()
    expect(state.saveError).toMatch(new RegExp(String(status)))
    // Still dirty (consistent with the recoverable-error retry policy).
    expect(state.dirty).toBe(true)
  })

  it('does NOT set saveError on 409 conflict (handled by conflictCurrent)', async () => {
    const useEditorStore = await loadStore()
    fetchMock.mockResolvedValue(jsonResp(409, { current: { ...NODE, content_revision: 5, summary: 'theirs' } }))

    useEditorStore.getState().loadNode(NODE)
    useEditorStore.getState().setField('summary', 'mine')
    await useEditorStore.getState().flushPending()

    expect(useEditorStore.getState().saveError).toBeNull()
    expect(useEditorStore.getState().conflictCurrent).toBeTruthy()
  })

  it('does NOT set saveError on 423 lock (handled by lockedReason)', async () => {
    const useEditorStore = await loadStore()
    fetchMock.mockResolvedValue(jsonResp(423, { error: 'node_locked' }))

    useEditorStore.getState().loadNode(NODE)
    useEditorStore.getState().setField('summary', 'mine')
    await useEditorStore.getState().flushPending()

    expect(useEditorStore.getState().saveError).toBeNull()
    expect(useEditorStore.getState().lockedReason).toBe('node_locked')
  })
})
