'use client'

/**
 * Real-time subscription to a single node's changes.
 *
 * Sibling hook to useNodesRealtime — that one subscribes to all nodes in a
 * document (used by NodeTree); this one subscribes to a single node
 * (used by NodeDetailPanel to refresh its open node when an Accept or
 * other mutation lands on it).
 *
 * Calls onChange() (debounced 200ms) on UPDATE events for the given
 * nodeId. Cleanup on unmount per H-05.
 */

import { useCallback, useEffect, useRef } from 'react'
// Phase 8.5b B.5c — createClient + ensureRealtimeAuth dropped; the
// multiplexed user channel carries the `nodes` topic. Subscribe via
// the demuxer hook + filter by id at the subscriber level.
import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'

const REFETCH_DEBOUNCE_MS = 200

export function useNodeRealtime(
  nodeId: string | null,
  onChange: () => void,
): void {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEvent = useCallback((payload: { eventType: string }) => {
    // Original hook only fired on UPDATE; preserve that behaviour.
    if (payload.eventType !== 'UPDATE') return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      onChangeRef.current()
      debounceTimerRef.current = null
    }, REFETCH_DEBOUNCE_MS)
  }, [])

  const filter = useCallback(
    (payload: { new: { id?: string }; old: { id?: string } }) => {
      if (!nodeId) return false
      const row = payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old
      return row.id === nodeId
    },
    [nodeId],
  )

  useRealtimeTopic<{ id?: string }>('nodes', handleEvent, filter)

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
