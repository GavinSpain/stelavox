'use client'

// Phase 8.5b B.3b — Mount the nodes Realtime patcher channel at the
// app shell so all in-tab UI shares one direct-patching channel.
//
// Replaces the per-component invalidate-then-refetch pattern (which
// B.3 substrate inherited from useNodesRealtime) with direct cache
// mutation per Tier-A §1.5. The result: a Realtime UPDATE event from
// another tab patches the local cache in place — no fetch fires.
//
// This component renders nothing. It exists as an effect-only
// boundary inside QueryProvider's subtree so it can use
// useQueryClient + Supabase together.
//
// B.5 will absorb this into the multiplexed user channel (Tier-A
// §5.2). Until then this stands alongside useNodesRealtime; the
// latter's invalidate path is gated off by checking whether the
// patcher is mounted (this component owns a window-level boolean).

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'
import { attachNodesRealtimePatcher } from './realtime-patcher'

/**
 * Marker that useNodesRealtime checks before firing an
 * invalidateQueries — when this is true, the direct patcher is on the
 * job and the per-document hook should NOT also refetch.
 */
declare global {
  interface Window {
    __stelavox_nodes_patcher_mounted?: boolean
  }
}

interface Props {
  orgId: string | null
}

export function NodesPatcherMount({ orgId }: Props) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!orgId) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let mounted = true

    void (async () => {
      await ensureRealtimeAuth(supabase)
      if (!mounted) return
      channel = attachNodesRealtimePatcher(supabase, queryClient, orgId)
      if (typeof window !== 'undefined') {
        window.__stelavox_nodes_patcher_mounted = true
      }
    })()

    return () => {
      mounted = false
      if (channel) void supabase.removeChannel(channel)
      if (typeof window !== 'undefined') {
        window.__stelavox_nodes_patcher_mounted = false
      }
    }
  }, [orgId, queryClient])

  return null
}
