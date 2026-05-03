// Spec: stelavox_phase3_api_contract_v1_0.md §2.11 (editor invariants)
//       stelavox_phase3_build_checklist_v1_0.md §3.4 T-4.1..T-4.9
//
// One active node at a time. The store owns:
//   • the debounce timer (1.5s idle → flush)
//   • the single-flight inflight Promise (no concurrent PATCH per node)
//   • the local-storage shadow (T-4.7) — survives crashes / tab closes
//   • the conflict + lock UI state (409 / 423)
//
// All side effects (fetch, localStorage) live here so the editors stay
// pure presentation. Node-switch flush (T-4.9) is exposed via flushPending().

import { create } from 'zustand'

const DEBOUNCE_MS = 1500
const SHADOW_PREFIX = 'stelavox_editor_'
const SHADOW_TTL_DAYS = 30

type ContentField = 'summary' | 'prose' | 'notes'
type Metadata = Record<string, unknown> | null

export interface NodeRecord {
  id: string
  version: number
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Metadata
  // Other node fields are present on the server response but we only need
  // these four for the editor surface.
  [extra: string]: unknown
}

export type LockedReason = 'node_locked' | 'parent_locked' | null

interface Shadow {
  summary: string | null
  prose: string | null
  notes: string | null
  expectedVersion: number
  savedAt: number  // epoch ms
}

interface EditorState {
  nodeId: string | null
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Metadata
  expectedVersion: number
  dirty: boolean
  inflight: Promise<void> | null
  conflictCurrent: NodeRecord | null
  lockedReason: LockedReason

  // Actions
  loadNode: (node: NodeRecord) => void
  setField: (field: ContentField, value: string | null) => void
  setMetadata: (metadata: Metadata) => void
  flushPending: () => Promise<void>
  acceptCurrent: () => Promise<void>
  keepMine: () => Promise<void>
  reloadFromServer: () => Promise<void>
  dismissLock: () => void
  clear: () => void
}

// ── Local-storage shadow helpers (T-4.7) ────────────────────────────────────

function shadowKey(nodeId: string): string {
  return `${SHADOW_PREFIX}${nodeId}`
}

function readShadow(nodeId: string): Shadow | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(shadowKey(nodeId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Shadow
    if (typeof parsed.expectedVersion !== 'number' || typeof parsed.savedAt !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function writeShadow(nodeId: string, shadow: Shadow): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(shadowKey(nodeId), JSON.stringify(shadow))
  } catch {
    // Quota / disabled — silently degrade
  }
}

function clearShadow(nodeId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(shadowKey(nodeId))
  } catch {
    // Same as above.
  }
}

// Garbage collect shadows older than 30 days. Called from loadNode.
function gcOldShadows(): void {
  if (typeof window === 'undefined') return
  const cutoff = Date.now() - SHADOW_TTL_DAYS * 24 * 60 * 60 * 1000
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(SHADOW_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      try {
        const raw = window.localStorage.getItem(k)
        if (!raw) continue
        const parsed = JSON.parse(raw) as { savedAt?: number }
        if (typeof parsed.savedAt === 'number' && parsed.savedAt < cutoff) {
          window.localStorage.removeItem(k)
        }
      } catch {
        window.localStorage.removeItem(k)
      }
    }
  } catch {
    // Ignore quota / access errors.
  }
}

// ── Debounce timer state (module-scoped: there is only one active node) ─────

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function clearDebounce(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

// ── PATCH side effect ───────────────────────────────────────────────────────

async function patchNode(
  nodeId: string,
  body: {
    summary?: string | null
    prose?: string | null
    notes?: string | null
    metadata?: Metadata
    expected_version: number
  },
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`/api/nodes/${nodeId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: unknown = null
  try { data = await res.json() } catch { /* empty body */ }
  return { status: res.status, data }
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>((set, get) => {
  // Internal flush — single-flight via the `inflight` promise.
  // Captures nodeId / expectedVersion at flush time so a node switch
  // mid-flight does not corrupt state on response (the response handler
  // checks get().nodeId before mutating live state).
  async function flushNow(): Promise<void> {
    clearDebounce()
    const prior = get().inflight
    if (prior) {
      await prior
    }

    const state = get()
    if (!state.dirty || !state.nodeId) return
    // While a conflict or lock is showing, autosave is paused — the user
    // must resolve via Keep Mine / Accept / Use Latest. Re-firing here
    // would loop on 409 / 423 (§2.4 + §2.11.5).
    if (state.conflictCurrent || state.lockedReason) return

    const targetNodeId = state.nodeId
    const targetExpectedVersion = state.expectedVersion
    const targetSummary = state.summary
    const targetProse = state.prose
    const targetNotes = state.notes
    const targetMetadata = state.metadata

    const promise = (async () => {
      const body: Parameters<typeof patchNode>[1] = {
        summary: targetSummary,
        prose: targetProse,
        notes: targetNotes,
        expected_version: targetExpectedVersion,
      }
      if (targetMetadata !== null && targetMetadata !== undefined) {
        body.metadata = targetMetadata
      }

      let result: { status: number; data: unknown }
      try {
        result = await patchNode(targetNodeId, body)
      } catch {
        // Network error — stay dirty, retry on next setField fire.
        return
      }

      const liveAfter = get()
      const stillOn = liveAfter.nodeId === targetNodeId
      // stillSame = "no setField fired between flush start and response"
      // (used to decide whether dirty can return to false and the shadow
      // can be cleared without losing in-flight typing).
      const stillSame = stillOn &&
        liveAfter.summary === targetSummary &&
        liveAfter.prose === targetProse &&
        liveAfter.notes === targetNotes &&
        JSON.stringify(liveAfter.metadata) === JSON.stringify(targetMetadata)

      if (result.status === 200) {
        const node = (result.data as { node?: NodeRecord })?.node
        const newVersion = node?.version ?? targetExpectedVersion
        if (stillSame) {
          // Local matches what we just sent — fully synced.
          clearShadow(targetNodeId)
          set({
            expectedVersion: newVersion,
            dirty: false,
            conflictCurrent: null,
            lockedReason: null,
          })
        } else if (stillOn) {
          // User typed during inflight. The captured edits are saved but
          // newer edits are pending — keep dirty=true; their setField has
          // already armed the next debounce timer. Refresh the shadow so
          // its expected_version matches the freshly-bumped server value.
          set({
            expectedVersion: newVersion,
            conflictCurrent: null,
            lockedReason: null,
          })
          captureShadow()
        }
        return
      }

      if (result.status === 409) {
        const current = (result.data as { current?: NodeRecord })?.current ?? null
        if (stillOn && current) {
          set({ conflictCurrent: current, lockedReason: null })
        }
        return
      }

      if (result.status === 423) {
        const errorCode = (result.data as { error?: string })?.error
        const reason: LockedReason =
          errorCode === 'parent_locked' ? 'parent_locked' :
          errorCode === 'node_locked'   ? 'node_locked'   : 'node_locked'
        if (stillOn) {
          set({ lockedReason: reason, conflictCurrent: null })
        }
        return
      }

      // Other 4xx/5xx: leave dirty so a future setField will retry, but
      // don't surface a banner here — this is the silent-on-other-errors
      // policy. The conflict / lock banners are the only autosave UI.
    })()

    set({ inflight: promise })
    try { await promise } finally {
      // Always release the inflight slot, even on failure paths above.
      if (get().inflight === promise) {
        set({ inflight: null })
      }
    }
  }

  function scheduleDebounce(): void {
    clearDebounce()
    debounceTimer = setTimeout(() => { void flushNow() }, DEBOUNCE_MS)
  }

  function captureShadow(): void {
    const s = get()
    if (!s.nodeId) return
    writeShadow(s.nodeId, {
      summary: s.summary,
      prose: s.prose,
      notes: s.notes,
      expectedVersion: s.expectedVersion,
      savedAt: Date.now(),
    })
  }

  return {
    nodeId: null,
    summary: null,
    prose: null,
    notes: null,
    metadata: null,
    expectedVersion: 0,
    dirty: false,
    inflight: null,
    conflictCurrent: null,
    lockedReason: null,

    loadNode: (node: NodeRecord) => {
      clearDebounce()
      gcOldShadows()

      const shadow = readShadow(node.id)

      // Default: load server state.
      set({
        nodeId: node.id,
        summary: node.summary,
        prose: node.prose,
        notes: node.notes,
        metadata: node.metadata,
        expectedVersion: node.version,
        dirty: false,
        inflight: null,
        conflictCurrent: null,
        lockedReason: null,
      })

      // Shadow recovery (§2.11.7):
      // If a shadow exists with an older version than the server, the
      // shadow holds unsaved edits made before the row moved on. Surface
      // the conflict UI by loading shadow content and synthesising a
      // conflictCurrent from the freshly-loaded server node.
      if (shadow && shadow.expectedVersion > 0 && shadow.expectedVersion < node.version) {
        set({
          summary: shadow.summary,
          prose: shadow.prose,
          notes: shadow.notes,
          expectedVersion: shadow.expectedVersion,
          dirty: true,
          conflictCurrent: node,
        })
      }
    },

    setField: (field, value) => {
      const s = get()
      if (!s.nodeId) return
      if (s.lockedReason) return  // read-only — silently drop
      set({ [field]: value, dirty: true } as Partial<EditorState>)
      captureShadow()
      // While a 409 banner is up, accept further typing into local state +
      // shadow but pause the debounce. Keep Mine resolves and flushes.
      if (!s.conflictCurrent) scheduleDebounce()
    },

    setMetadata: (metadata) => {
      const s = get()
      if (!s.nodeId) return
      if (s.lockedReason) return
      set({ metadata, dirty: true })
      captureShadow()
      if (!s.conflictCurrent) scheduleDebounce()
    },

    flushPending: async () => {
      await flushNow()
    },

    acceptCurrent: async () => {
      const s = get()
      const current = s.conflictCurrent
      if (!current || !s.nodeId) return
      clearDebounce()
      clearShadow(s.nodeId)
      set({
        summary: current.summary,
        prose: current.prose,
        notes: current.notes,
        metadata: current.metadata,
        expectedVersion: current.version,
        dirty: false,
        conflictCurrent: null,
      })
    },

    keepMine: async () => {
      const s = get()
      const current = s.conflictCurrent
      if (!current || !s.nodeId) return
      // Adopt the server's version as the new expectedVersion so the
      // next PATCH wins; keep our content as-is. Then flush.
      set({
        expectedVersion: current.version,
        dirty: true,
        conflictCurrent: null,
      })
      captureShadow()
      await flushNow()
    },

    reloadFromServer: async () => {
      const s = get()
      if (!s.nodeId) return
      const targetId = s.nodeId
      const res = await fetch(`/api/nodes/${targetId}`, {
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) return
      const body = await res.json()
      const node = body?.node as NodeRecord | undefined
      if (!node || get().nodeId !== targetId) return
      clearShadow(targetId)
      set({
        summary: node.summary,
        prose: node.prose,
        notes: node.notes,
        metadata: node.metadata,
        expectedVersion: node.version,
        dirty: false,
        conflictCurrent: null,
        lockedReason: null,
      })
    },

    dismissLock: () => {
      set({ lockedReason: null })
    },

    clear: () => {
      clearDebounce()
      set({
        nodeId: null,
        summary: null,
        prose: null,
        notes: null,
        metadata: null,
        expectedVersion: 0,
        dirty: false,
        inflight: null,
        conflictCurrent: null,
        lockedReason: null,
      })
    },
  }
})

// ── beforeunload guard (T-4.8) ──────────────────────────────────────────────
// Module-level listener: registers once when the store module loads on the
// client. Prompts the user when there are unflushed edits, then attempts a
// final sendBeacon PATCH on confirm-leave. The Beacon API survives unload
// where fetch() does not.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const s = useEditorStore.getState()
    if (!s.dirty || !s.nodeId) return
    event.preventDefault()
    // Some browsers honour returnValue rather than preventDefault alone.
    event.returnValue = ''
    try {
      const body = JSON.stringify({
        summary: s.summary,
        prose: s.prose,
        notes: s.notes,
        ...(s.metadata !== null && s.metadata !== undefined ? { metadata: s.metadata } : {}),
        expected_version: s.expectedVersion,
      })
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(`/api/nodes/${s.nodeId}`, blob)
    } catch {
      // Best-effort only; the shadow will surface on next load.
    }
  })
}
