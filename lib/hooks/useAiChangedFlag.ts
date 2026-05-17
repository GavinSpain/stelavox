'use client'

/**
 * V1.x-D.2 — AI-changed flag client-side tracking.
 *
 * Source: Component Spec §17.8 · wireframe_node_row_v2_badges_v1.html.
 *
 * The flag shows when AI has changed a node's content since the author
 * last opened it. Server-side: M-142 added `nodes.last_ai_change_at`,
 * stamped by accept_agent_job whenever an agent operation replaces the
 * node's content. Client-side: per-node "last viewed" timestamps in
 * localStorage. The hook compares them.
 *
 * Storage key shape: `node-viewed:<nodeId>` → ISO timestamp.
 * Reads via getItem; writes via markNodeAsViewed() called by the
 * detail-panel mount or row-click. localStorage is per-browser-per-
 * device, which is the intended scope ("last viewed by me on this
 * device"). Cross-device sync is V2.
 */

import { useSyncExternalStore } from 'react'

const STORAGE_KEY_PREFIX = 'node-viewed:'

function storageKey(nodeId: string): string {
  return `${STORAGE_KEY_PREFIX}${nodeId}`
}

function readLastViewedIso(nodeId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(storageKey(nodeId))
  } catch {
    return null
  }
}

// useSyncExternalStore subscribe: cross-tab updates via the `storage`
// event. Same-tab markNodeAsViewed() writes don't fire storage events
// in the writing tab; that's fine for V1 because the row-click that
// triggers markNodeAsViewed also navigates / re-renders the host
// component, which re-reads localStorage anyway.
function subscribeToStorage(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

export function markNodeAsViewed(nodeId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(nodeId), new Date().toISOString())
  } catch {
    // Quota / privacy mode — silently ignore. The dot persists; that's
    // acceptable (slight UX degradation, no functional break).
  }
}

/**
 * Returns true iff the node has been AI-changed since the last time the
 * author viewed it on this device.
 *
 * Empty `lastAiChangeAt` (no AI change ever) → false.
 * No localStorage entry but `lastAiChangeAt` set → true (author hasn't
 *   viewed since AI changed it — possibly the first time the author
 *   sees the node post-creation by an expand operation).
 */
export function useAiChangedFlag(
  nodeId: string,
  lastAiChangeAt: string | null | undefined,
): boolean {
  // useSyncExternalStore reads the snapshot during render (no useEffect
  // + setState cascade). Server snapshot returns null to match SSR;
  // client snapshot reads localStorage directly. The first client
  // render replaces the SSR-rendered "no flag" with the localStorage-
  // derived value via the standard hydration mechanism.
  const lastViewedIso = useSyncExternalStore(
    subscribeToStorage,
    () => readLastViewedIso(nodeId),
    () => null,
  )

  if (!lastAiChangeAt) return false
  const aiChangeDate = new Date(lastAiChangeAt)
  if (Number.isNaN(aiChangeDate.getTime())) return false
  if (!lastViewedIso) return true
  const lastViewed = new Date(lastViewedIso)
  if (Number.isNaN(lastViewed.getTime())) return true
  return aiChangeDate > lastViewed
}
