'use client'

// Phase 8.5b B.6 — Mount gate for UserRealtimeChannel.
//
// Wraps <UserRealtimeChannel> with `useTabIsActive`. When the tab has
// been continuously hidden for IDLE_THRESHOLD_MS (10 min), the gate
// returns null, which unmounts UserRealtimeChannel — triggering its
// useEffect cleanup, which calls supabase.removeChannel(channel) and
// closes the WebSocket. The Supabase channel slot is freed immediately
// in the 500-cap count (vs ~60s heartbeat-timeout for unplanned drops).
//
// On visibility return, useTabIsActive flips back to true; React mounts
// UserRealtimeChannel; ensureRealtimeAuth re-runs; 12 topic filters
// re-register; subscribers (already registered with the demuxer) start
// receiving events again; TanStack `refetchOnReconnect: 'always'`
// catches active queries up to current state.
//
// The brief 'connecting' → 'connected' status flicker is visible to the
// user as <RealtimeBadge>'s "Connecting…" pill, which is accurate (the
// channel IS reconnecting) and informative.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §5.7
//       lib/realtime/useTabIsActive.ts
//       lib/realtime/useUserChannel.ts (the wrapped component)

import { UserRealtimeChannel } from './useUserChannel'
import { useTabIsActive } from './useTabIsActive'

interface Props {
  userId: string | null
  orgId: string | null
}

export function ChannelGate({ userId, orgId }: Props): React.ReactElement | null {
  const active = useTabIsActive()
  if (!active) return null
  return <UserRealtimeChannel userId={userId} orgId={orgId} />
}
