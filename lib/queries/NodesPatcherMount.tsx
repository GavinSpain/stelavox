'use client'

// Phase 8.5b B.5c — Mount the nodes Realtime patcher on the
// multiplexed user channel. Replaces the standalone `nodes-patcher:{orgId}`
// channel B.3b shipped with a useRealtimeTopic('nodes') subscriber that
// runs alongside everything else on the user channel.
//
// The patcher itself (applyNodeInsert / applyNodeUpdate / applyNodeDelete
// in lib/queries/realtime-patcher.ts) is unchanged — only its event
// source changes. Same ordering buffer (H-33) and same aggregate-affecting
// invalidation logic apply.
//
// This component renders nothing. It exists as an effect-only boundary
// inside QueryProvider's subtree so it can use useQueryClient.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'
import {
  applyNodeInsert,
  applyNodeUpdate,
  applyNodeDelete,
} from './realtime-patcher'
import type { TreeNodeRow } from './useDocumentNodes'

/**
 * Marker that useNodesRealtime checks before firing an
 * invalidateQueries — when this is true, the direct patcher is on the
 * job and the per-document hook should NOT also refetch. The marker is
 * still useful even though both run off the same demuxer events: the
 * patcher dispatches setQueryData synchronously when its subscriber
 * fires, and useNodesRealtime sees its own subscriber-callback skip the
 * invalidate while keeping the structural-vs-data remount logic.
 */
declare global {
  interface Window {
    __stelavox_nodes_patcher_mounted?: boolean
  }
}

interface Props {
  // orgId retained for callsite compatibility; the user channel
  // applies the organisation_id filter at the channel level so we no
  // longer need to look at it here. It's kept in the props shape so
  // the layout doesn't have to change in lockstep.
  orgId: string | null
}

export function NodesPatcherMount({ orgId }: Props) {
  const queryClient = useQueryClient()

  // Set the marker on every render where org is known. useRealtimeTopic
  // unsub on unmount handles the channel detach; the marker is purely
  // informational for useNodesRealtime's gate.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!orgId) {
      window.__stelavox_nodes_patcher_mounted = false
      return
    }
    window.__stelavox_nodes_patcher_mounted = true
    return () => {
      window.__stelavox_nodes_patcher_mounted = false
    }
  }, [orgId])

  // Subscribe to nodes events through the demuxer. The user channel
  // filters by organisation_id at the channel level, so the subscriber
  // sees only events for the user's org — no additional filter needed.
  useRealtimeTopic<TreeNodeRow & { id: string; document_id?: string | null }>(
    'nodes',
    (payload) => {
      if (!orgId) return
      if (payload.eventType === 'INSERT') {
        const row = payload.new as TreeNodeRow & { document_id?: string | null }
        if (row && row.document_id) {
          applyNodeInsert(queryClient, row as TreeNodeRow & { document_id: string })
        }
        return
      }
      if (payload.eventType === 'UPDATE') {
        const oldRow = (payload.old && Object.keys(payload.old).length > 0
          ? (payload.old as Partial<TreeNodeRow>)
          : null)
        applyNodeUpdate(
          queryClient,
          oldRow,
          payload.new as Partial<TreeNodeRow> & { id: string; document_id?: string | null },
        )
        return
      }
      if (payload.eventType === 'DELETE') {
        const oldRow = payload.old as { id?: string; document_id?: string | null }
        if (oldRow?.id) {
          applyNodeDelete(queryClient, {
            id: oldRow.id,
            document_id: oldRow.document_id ?? null,
          })
        }
      }
    },
  )

  return null
}
