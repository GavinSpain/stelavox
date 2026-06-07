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

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'

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

  useEffect(() => {
    if (!documentId) return
    const supabase = createClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingKind: NodesRealtimeKind | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null
    let mounted = true

    const onEvent = (payload: { eventType?: string; type?: string }) => {
      // postgres_changes payloads use `eventType`; the older / unfiltered
      // shape uses `type`. Cover both.
      const evt = payload.eventType ?? payload.type ?? ''
      const structural = evt === 'INSERT' || evt === 'DELETE'
      // Structural wins over data within a debounce batch.
      if (structural || pendingKind !== 'structural') {
        pendingKind = structural ? 'structural' : 'data'
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const kind = pendingKind ?? 'data'
        pendingKind = null
        onChangeRef.current(kind)
      }, REFETCH_DEBOUNCE_MS)
    }

    // Wait for auth before subscribing — see lib/supabase/realtime-auth.ts.
    void (async () => {
      await ensureRealtimeAuth(supabase)
      if (!mounted) return
      channel = supabase
        .channel(`nodes:doc:${documentId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'nodes',
            filter: `document_id=eq.${documentId}`,
          },
          onEvent,
        )
        .subscribe()
    })()

    return () => {
      mounted = false
      if (debounceTimer) clearTimeout(debounceTimer)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [documentId])
}
