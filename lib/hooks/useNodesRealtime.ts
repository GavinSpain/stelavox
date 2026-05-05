'use client'

/**
 * Real-time subscription to the nodes table, filtered by document.
 *
 * Source: stelavox_technical_architecture_v1_8.md §10.3 (real-time tables)
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §2.15 (real-time contract)
 * Build Checklist T-12.1 (proper fix surfaced from manual UI testing — SU-31).
 *
 * Mounts inside NodeTree. Subscribes to all nodes changes for the current
 * document and calls onChange() (debounced 200ms) on any INSERT/UPDATE/DELETE.
 * The consumer is responsible for the actual refetch.
 *
 * Why debounce: a single Accept can insert N child nodes in one transaction,
 * which fires N events. We want one refetch, not N. 200ms collects all events
 * from a single transaction without making the tree feel sluggish.
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

const REFETCH_DEBOUNCE_MS = 200

export function useNodesRealtime(
  documentId: string | null,
  onChange: () => void,
): void {
  // Stash the latest callback in a ref so we don't re-subscribe on every render
  // when the consumer passes an inline arrow function.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!documentId) return
    const supabase = createClient()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const triggerRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        onChangeRef.current()
      }, REFETCH_DEBOUNCE_MS)
    }

    const channel = supabase
      .channel(`nodes:doc:${documentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nodes',
          filter: `document_id=eq.${documentId}`,
        },
        triggerRefetch,
      )
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      void supabase.removeChannel(channel)
    }
  }, [documentId])
}
