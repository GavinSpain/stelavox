'use client'

/**
 * Real-time subscription to the nodes table, filtered by document.
 *
 * Source: stelavox_technical_architecture_v1_8.md §10.3 (real-time tables)
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §2.15 (real-time contract)
 * Build Checklist T-12.1 (proper fix surfaced from manual UI testing — SU-31).
 *
 * Mounts inside NodeTree. Subscribes to all nodes changes for the current
 * document and calls onChange(kind) (debounced 200ms) on any
 * INSERT/UPDATE/DELETE. The consumer is responsible for the actual refetch.
 *
 * Phase 8.01 round-3 follow-up — `onChange` now receives a `kind` argument:
 *   - `'structural'` for INSERT / DELETE events. These can add or remove
 *     tree rows that react-arborist needs to reveal via openByDefault, so
 *     the consumer (NodeTree) bumps the remount key — preserving the
 *     SU-J13-1 invisible-children fix.
 *   - `'data'` for UPDATE events. These change visible content (name,
 *     status, word counts, last_ai_change_at, content_revision, etc.)
 *     but never add or remove rows. The consumer refetches the data
 *     prop without remounting, so the user's scroll position is
 *     preserved through autosaves, agent-accept word-count rolls, etc.
 *
 * Why debounce: a single Accept can insert N child nodes in one transaction,
 * which fires N events. We want one refetch, not N. 200ms collects all events
 * from a single transaction without making the tree feel sluggish. If a
 * batch contains both structural and data events, the strongest kind wins
 * — structural — so the remount happens.
 *
 * Why a hook (not a Zustand store like agent_jobs): the tree's data fetch is
 * already React-state-managed. We just need to trigger its existing refetch
 * mechanism. Keeping the subscription scoped to NodeTree means:
 *   - The subscription tears down with the document (no leaks if user
 *     navigates between documents)
 *   - No global node store to keep in sync with the tree's local state
 *
 * Cleanup on unmount per H-05.
 */

import { useCallback, useEffect, useRef } from 'react'
// Phase 8.5b B.5c — createClient + ensureRealtimeAuth dropped; the
// multiplexed user channel carries the `nodes` topic. Subscribe via
// the demuxer hook + filter by document_id at the subscriber level.
import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'

const REFETCH_DEBOUNCE_MS = 200

/** Kind of change observed during a debounce window. Structural wins over
 *  data — if any event in the window was an INSERT/DELETE, the consumer
 *  treats the whole batch as structural and remounts. */
export type NodesRealtimeKind = 'structural' | 'data'

export function useNodesRealtime(
  documentId: string | null,
  onChange: (kind: NodesRealtimeKind) => void,
): void {
  // Stash the latest callback in a ref so we don't re-subscribe on every render
  // when the consumer passes an inline arrow function.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Debounce machinery lives in refs so the callback identity is
  // stable across renders. The demuxer cleanup tears down the
  // subscription; we also clear any pending timer on unmount.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingKindRef = useRef<NodesRealtimeKind | null>(null)

  const handleEvent = useCallback((payload: { eventType: string; new: { document_id?: string }; old: { document_id?: string } }) => {
    const evt = payload.eventType
    const structural = evt === 'INSERT' || evt === 'DELETE'
    if (structural || pendingKindRef.current !== 'structural') {
      pendingKindRef.current = structural ? 'structural' : 'data'
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      const kind = pendingKindRef.current ?? 'data'
      pendingKindRef.current = null
      debounceTimerRef.current = null
      onChangeRef.current(kind)
    }, REFETCH_DEBOUNCE_MS)
  }, [])

  const filter = useCallback(
    (payload: { new: { document_id?: string }; old: { document_id?: string } }) => {
      if (!documentId) return false
      const row = payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old
      return row.document_id === documentId
    },
    [documentId],
  )

  // Skip the subscription entirely when documentId is null — register
  // a no-op subscriber so the hook stays unconditional but no events
  // ever match.
  useRealtimeTopic<{ document_id?: string }>('nodes', handleEvent, filter)

  // Cleanup any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])
}
