import 'server-only'

/**
 * V1.x-B.1.1 session 3b — Realtime broadcast helper for Director iterations.
 *
 * Source: Director Architecture v2.0 §8.1a + V1.x-B.1.1 build checklist
 *         §3.3 T-3.2 + §3.5.
 *
 * The per-iteration executor (session 3c) publishes events to a Realtime
 * broadcast channel `director_turn:{turn_id}` so the client UI can stream
 * the Director's response across function boundaries (session 3c rewrites
 * the executor as N scheduler-dispatched single-shot iterations rather
 * than one long-lived function).
 *
 * Supabase Realtime broadcast channels are different from postgres_changes
 * subscriptions:
 *   - postgres_changes are server-emitted on table mutations (we already
 *     use this for AppShellStatusIndicator + SchedulerPanel).
 *   - broadcast is explicit publisher-to-subscriber messaging that doesn't
 *     touch the DB. Lower-latency for streaming text deltas.
 *
 * Channel naming: `director_turn:{turn_id}` (per Director Arch v2.0 §8.1a).
 * Event names mirror IterationEvent's `type` discriminator.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import type { IterationEvent } from './types'

/**
 * Publish a single IterationEvent to the turn's broadcast channel.
 * Fire-and-forget: failures are logged + swallowed (don't disrupt the
 * iteration's primary work). The client may miss an event but the next
 * publish will catch them up; the persisted state in director_iterations
 * is the canonical record.
 *
 * Note: Supabase JS broadcast.send() requires the channel to be subscribed
 * before publishing. For server-side fire-and-forget, we send via the
 * broadcast.send() pattern that uses an HTTP endpoint, not a websocket.
 */
export async function publishIterationEvent(turnId: string, event: IterationEvent): Promise<void> {
  const supabase = createServiceRoleClient()
  const channelName = `director_turn:${turnId}`
  const channel = supabase.channel(channelName)

  try {
    // Subscribe first (required for send()). Server-side context — the
    // channel is short-lived; we tear it down after the send.
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
      })
      // Defensive timeout — if subscribe hangs (Realtime down etc.),
      // resolve anyway and let the send fail through the catch.
      setTimeout(resolve, 1500)
    })

    await channel.send({
      type: 'broadcast',
      event: event.type,
      payload: event,
    })
  } catch (e) {
    console.warn('[iteration/realtime] publish failed:', (e as Error).message, {
      turnId,
      eventType: event.type,
    })
  } finally {
    void supabase.removeChannel(channel)
  }
}

/**
 * Publish multiple events in order. Useful when an iteration completes
 * and the executor wants to flush iteration_complete + turn_complete
 * (when applicable) atomically from the caller's perspective.
 */
export async function publishIterationEvents(turnId: string, events: IterationEvent[]): Promise<void> {
  for (const event of events) {
    await publishIterationEvent(turnId, event)
  }
}

export const channelNameFor = (turnId: string) => `director_turn:${turnId}`
