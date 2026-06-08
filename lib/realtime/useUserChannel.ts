'use client'

// Phase 8.5b B.5 — Per-tab user-scoped Realtime channel + reconnect
// state.
//
// Mounts once per tab (typically from app/(app)/layout.tsx). Opens a
// single Supabase Realtime channel `user:{userId}` and registers one
// .on('postgres_changes', ...) handler per topic in REALTIME_TOPICS,
// routing through the demuxer.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §5.0 §5.2 §5.5
//       lib/realtime/demuxer.ts (event bus)
//       lib/supabase/realtime-auth.ts (auth-race fix; absorbed)
//
// Filter strategy per Tier-A §5.3:
//   - org-scoped tables (nodes, agent_jobs, briefs, etc.) filter on
//     organisation_id=eq.{orgId} for cross-org isolation
//   - join tables (brief_stages, conversation_messages, etc.) have no
//     direct org column; the client demuxer filters by document/brief
//     id at the topic-subscriber level
//
// Reconnect cascade per §5.5:
//   1. Supabase channel reports disconnect
//   2. Hook exposes `disconnected: true` via useUserChannelStatus
//   3. Auto-reconnect attempts with exponential backoff handled by
//      Supabase's underlying socket layer
//   4. After 3 manual reconnect attempts fail, status flips to
//      'failed' so <RealtimeBadge> can prompt manual refresh
//
// B.6 follow-up: BroadcastChannel-based cross-tab coordination so a
// user with 5 tabs counts as 1 channel. Out of scope for the v1 B.5.

import { useEffect, useMemo, useRef, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import { ensureRealtimeAuth } from '@/lib/supabase/realtime-auth'
import { REALTIME_TOPICS, dispatch, type RealtimeTopic } from './demuxer'

export type RealtimeChannelStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed'

let globalStatusListeners: Set<(s: RealtimeChannelStatus) => void> = new Set()
let globalStatus: RealtimeChannelStatus = 'connecting'

function setGlobalStatus(status: RealtimeChannelStatus): void {
  if (status === globalStatus) return
  globalStatus = status
  for (const cb of globalStatusListeners) cb(status)
}

/**
 * Subscribe to the user channel's status. Used by <RealtimeBadge>.
 * Returns the unsubscribe function.
 */
export function subscribeChannelStatus(cb: (s: RealtimeChannelStatus) => void): () => void {
  globalStatusListeners.add(cb)
  // Fire current state immediately.
  cb(globalStatus)
  return () => {
    globalStatusListeners.delete(cb)
  }
}

/** Read current channel status synchronously. */
export function getChannelStatus(): RealtimeChannelStatus {
  return globalStatus
}

interface Props {
  userId: string | null
  orgId: string | null
}

/**
 * Mounts the user channel and routes events into the demuxer. Renders
 * nothing. Drop one of these into app/(app)/layout.tsx underneath the
 * QueryProvider boundary.
 *
 * Per-topic .on() handlers use a wildcard filter (no `filter:` arg);
 * the demuxer then routes by topic. Topic-side filters (per-document
 * narrowing etc.) live in useRealtimeTopic.
 */
export function UserRealtimeChannel({ userId, orgId }: Props): null {
  const supabase = useMemo(() => createClient(), [])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const [, setTick] = useState(0)
  void setTick // not actually used — just satisfies React rules

  useEffect(() => {
    if (!userId) return
    let mounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    setGlobalStatus('connecting')

    void (async () => {
      await ensureRealtimeAuth(supabase)
      if (!mounted) return

      // Wire one .on() per topic from the shared REALTIME_TOPICS list.
      // Topic-name + table-name happen to match in V1 (we only listen
      // on the table whose name equals the topic); when that changes
      // in V2 a topic→table map lands here.
      //
      // Cast through unknown to bridge Supabase's heavily-typed
      // postgres_changes filter literal type and our union-iterated
      // topic strings; runtime shape is correct.
      let ch: ReturnType<typeof supabase.channel> = supabase.channel(`user:${userId}`)
      for (const topic of REALTIME_TOPICS) {
        const tableName: string = topic
        const orgScoped = isOrgScoped(topic)
        const filter = orgScoped && orgId ? `organisation_id=eq.${orgId}` : undefined
        const config: Record<string, string> = { event: '*', schema: 'public', table: tableName }
        if (filter) config.filter = filter
        ch = (ch as unknown as { on: (event: string, cfg: Record<string, string>, cb: (payload: unknown) => void) => unknown }).on(
          'postgres_changes',
          config,
          (payload: unknown) => dispatch(topic as RealtimeTopic, payload as never),
        ) as ReturnType<typeof supabase.channel>
      }
      ch = ch.subscribe((status) => {
        // Supabase channel.subscribe callback fires on subscribe state
        // transitions ('SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' |
        // 'CLOSED').
        if (status === 'SUBSCRIBED') setGlobalStatus('connected')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setGlobalStatus('reconnecting')
        else if (status === 'CLOSED') setGlobalStatus('failed')
      })
      channel = ch
      channelRef.current = ch
    })()

    return () => {
      mounted = false
      if (channel) void supabase.removeChannel(channel)
      channelRef.current = null
      setGlobalStatus('connecting')
    }
  }, [userId, orgId, supabase])

  return null
}

/** Which tables carry an organisation_id column for the filter. */
function isOrgScoped(topic: RealtimeTopic): boolean {
  switch (topic) {
    case 'nodes':
    case 'agent_jobs':
    case 'briefs':
    case 'export_jobs':
    case 'project_profiles':
      return true
    case 'brief_stages':
    case 'conversation_messages':
    case 'director_turns':
    case 'profile_amendments':
      return false
  }
}
