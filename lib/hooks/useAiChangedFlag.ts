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

import { useEffect, useState } from 'react'

const STORAGE_KEY_PREFIX = 'node-viewed:'

function storageKey(nodeId: string): string {
  return `${STORAGE_KEY_PREFIX}${nodeId}`
}

function readLastViewed(nodeId: string): Date | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(storageKey(nodeId))
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date
  } catch {
    return null
  }
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
  // SSR returns false to avoid hydration mismatch. Client effect updates
  // the state on mount.
  const [aiChanged, setAiChanged] = useState(false)

  useEffect(() => {
    if (!lastAiChangeAt) {
      setAiChanged(false)
      return
    }
    const aiChangeDate = new Date(lastAiChangeAt)
    if (Number.isNaN(aiChangeDate.getTime())) {
      setAiChanged(false)
      return
    }
    const lastViewed = readLastViewed(nodeId)
    setAiChanged(!lastViewed || aiChangeDate > lastViewed)
  }, [nodeId, lastAiChangeAt])

  return aiChanged
}
