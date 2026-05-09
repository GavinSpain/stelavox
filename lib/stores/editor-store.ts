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
  // SU-J14-1: content_revision is the autosave durability anchor. Server
  // responses include both fields. version bumps only on agent Accept;
  // content_revision bumps on every content-changing UPDATE.
  content_revision?: number
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
  // SU-J14-1: shadow now anchors on content_revision. Old shadows that
  // wrote `expectedVersion` are read with a fallback in readShadow().
  expectedContentRevision: number
  savedAt: number  // epoch ms
}

interface EditorState {
  nodeId: string | null
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Metadata
  // SU-J14-1: autosave concurrency anchor. Was named `expectedVersion`
  // in Phase 3; renamed because version no longer bumps on autosave.
  expectedContentRevision: number
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
    // SU-J14-1: tolerate the old `expectedVersion` field for shadows
    // written before the rename. Either field, normalised to the new
    // name, is enough to recover.
    const parsed = JSON.parse(raw) as Partial<Shadow> & { expectedVersion?: number }
    const anchor =
      typeof parsed.expectedContentRevision === 'number' ? parsed.expectedContentRevision :
      typeof parsed.expectedVersion === 'number'         ? parsed.expectedVersion :
      null
    if (anchor === null || typeof parsed.savedAt !== 'number') return null
    return {
      summary: parsed.summary ?? null,
      prose: parsed.prose ?? null,
      notes: parsed.notes ?? null,
      expectedContentRevision: anchor,
      savedAt: parsed.savedAt,
    }
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
    // SU-J14-1: autosave PATCH uses content_revision (always-current
    // durability anchor) instead of version. version no longer bumps on
    // autosave, so it would not catch concurrent autosaves between two
    // tabs writing to the same node.
    expected_content_revision: number
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
    const targetExpectedRevision = state.expectedContentRevision
    const targetSummary = state.summary
    const targetProse = state.prose
    const targetNotes = state.notes
    const targetMetadata = state.metadata

    // SU-J14-1: skip the PATCH entirely when nothing actually differs from
    // the last-known server state. Tiptap's onUpdate can fire on no-op
    // re-serializations (the very bug that produced spurious version
    // bumps). The store still cleared dirty=true via setField, but the
    // PATCH itself would be a true no-op against the server. Bail here.
    // The trigger's IS DISTINCT FROM check would also bail server-side,
    // but skipping the round-trip saves bandwidth + log noise.
    // (We compare against the originalServer state by reading the shadow
    // we just captured; if no shadow, fall through.)
    // — left as documentation; the actual no-op detection would require
    // tracking last-saved values. The trigger's IS DISTINCT FROM remains
    // the source of truth.

    const promise = (async () => {
      const body: Parameters<typeof patchNode>[1] = {
        summary: targetSummary,
        prose: targetProse,
        notes: targetNotes,
        expected_content_revision: targetExpectedRevision,
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
        const newRevision = node?.content_revision ?? targetExpectedRevision
        if (stillSame) {
          // Local matches what we just sent — fully synced.
          clearShadow(targetNodeId)
          set({
            expectedContentRevision: newRevision,
            dirty: false,
            conflictCurrent: null,
            lockedReason: null,
          })
        } else if (stillOn) {
          // User typed during inflight. The captured edits are saved but
          // newer edits are pending — keep dirty=true; their setField has
          // already armed the next debounce timer. Refresh the shadow so
          // its expectedContentRevision matches the freshly-bumped server value.
          set({
            expectedContentRevision: newRevision,
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
      expectedContentRevision: s.expectedContentRevision,
      savedAt: Date.now(),
    })
  }

  // Resolve the load-time anchor for a server node. Prefers content_revision
  // (SU-J14-1) and falls back to version for backwards compat with any
  // server response shape that hasn't picked up the new field yet.
  function nodeAnchor(node: NodeRecord): number {
    return typeof node.content_revision === 'number' ? node.content_revision : node.version
  }

  return {
    nodeId: null,
    summary: null,
    prose: null,
    notes: null,
    metadata: null,
    expectedContentRevision: 0,
    dirty: false,
    inflight: null,
    conflictCurrent: null,
    lockedReason: null,

    loadNode: (node: NodeRecord) => {
      clearDebounce()
      gcOldShadows()

      const shadow = readShadow(node.id)
      const serverAnchor = nodeAnchor(node)

      // Default: load server state.
      set({
        nodeId: node.id,
        summary: node.summary,
        prose: node.prose,
        notes: node.notes,
        metadata: node.metadata,
        expectedContentRevision: serverAnchor,
        dirty: false,
        inflight: null,
        conflictCurrent: null,
        lockedReason: null,
      })

      // Shadow recovery (§2.11.7):
      // If a shadow exists with an older revision than the server, the
      // shadow holds unsaved edits made before the row moved on. Surface
      // the conflict UI by loading shadow content and synthesising a
      // conflictCurrent from the freshly-loaded server node.
      if (shadow && shadow.expectedContentRevision > 0 && shadow.expectedContentRevision < serverAnchor) {
        set({
          summary: shadow.summary,
          prose: shadow.prose,
          notes: shadow.notes,
          expectedContentRevision: shadow.expectedContentRevision,
          dirty: true,
          conflictCurrent: node,
        })
      }
    },

    setField: (field, value) => {
      const s = get()
      if (!s.nodeId) return
      if (s.lockedReason) return  // read-only — silently drop
      // SU-J14-1: skip the dirty-flag flip when the value is byte-identical
      // to what the store already has. Tiptap can fire onUpdate with a
      // re-serialised but semantically-equal value (paragraph normalisation
      // on first focus, mark attribute reordering, etc.); without this
      // guard, the store dirty flips → autosave fires → server sees no
      // content delta and the trigger correctly skips the version bump,
      // but the round-trip is wasted bandwidth + log noise. Bail here.
      if (s[field] === value) return
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
      // Same no-op guard as setField, by deep-equality on the JSON form.
      // Metadata is a small object so this is cheap.
      if (JSON.stringify(s.metadata) === JSON.stringify(metadata)) return
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
        expectedContentRevision: nodeAnchor(current),
        dirty: false,
        conflictCurrent: null,
      })
    },

    keepMine: async () => {
      const s = get()
      const current = s.conflictCurrent
      if (!current || !s.nodeId) return
      // Adopt the server's revision as the new expectedContentRevision so
      // the next PATCH wins; keep our content as-is. Then flush.
      set({
        expectedContentRevision: nodeAnchor(current),
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
        expectedContentRevision: nodeAnchor(node),
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
        expectedContentRevision: 0,
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
        expected_content_revision: s.expectedContentRevision,
      })
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon(`/api/nodes/${s.nodeId}`, blob)
    } catch {
      // Best-effort only; the shadow will surface on next load.
    }
  })
}
