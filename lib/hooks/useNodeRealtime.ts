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

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'

const REFETCH_DEBOUNCE_MS = 200

export function useNodeRealtime(
  nodeId: string | null,
  onChange: () => void,
): void {
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!nodeId) return
    const supabase = createClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null
    let mounted = true

    const triggerRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => onChangeRef.current(), REFETCH_DEBOUNCE_MS)
    }

    // Wait for auth before subscribing — see lib/supabase/realtime-auth.ts.
    void (async () => {
      await ensureRealtimeAuth(supabase)
      if (!mounted) return
      channel = supabase
        .channel(`node:${nodeId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'nodes',
            filter: `id=eq.${nodeId}`,
          },
          triggerRefetch,
        )
        .subscribe()
    })()

    return () => {
      mounted = false
      if (debounceTimer) clearTimeout(debounceTimer)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [nodeId])
}
