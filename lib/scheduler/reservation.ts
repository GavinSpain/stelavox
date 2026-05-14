import 'server-only'

/**
 * V1.x-B.1.1 session 3a — throttle reservation lifecycle.
 *
 * Source: Director Architecture v2.0 §9.9 (reservation pattern) +
 *         H-17 (reservation TTL hygiene) + M-095 throttle_reservations
 *         table + M-099 sweep procedure + M-101 platform_config keys.
 *
 * Three-step lifecycle per H-17:
 *   1. reserve()  — INSERT before opening the LLM connection
 *   2. consume()  — UPDATE consumed_at after the call returns
 *   3. release()  — UPDATE released_at on cleanup or failure
 *
 * Sweep — scheduler_sweep_throttle_reservations() (M-099 + cron M-102)
 * releases expired-but-never-consumed-or-released rows every 30s.
 * lib/constraints/recordViolation parallels this pattern for atom-size
 * caps.
 *
 * B.1.1 policy: reserves succeed without per-class accounting; the WFQ
 * + per-user-bucket logic that uses these reservations meaningfully
 * arrives in B.2. The schema and lifecycle ARE the contract that B.2
 * implementation drops behind. Per design record §1: "Architecture
 * right in the first stage; implementation can layer."
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'
import type { ThrottleRoute, TrafficClass } from './throttleInterface'

export interface ReservationInput {
  route: ThrottleRoute
  traffic_class?: TrafficClass | null
  user_id?: string | null
  organisation_id?: string | null
  slots: number
  estimated_tokens?: number
}

export interface ReservationHandle {
  id: string
  expires_at: string
}

const DEFAULT_TTL_SECONDS = 60

async function readTtlSeconds(): Promise<number> {
  const v = await getConfig<number>('throttle.reservation_ttl_seconds')
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : DEFAULT_TTL_SECONDS
}

/**
 * Reserve capacity. Called BEFORE opening the Anthropic streaming
 * connection. The TTL ensures crashed callers don't leave phantom
 * holds (H-17). Returns the reservation handle for the consume() /
 * release() callbacks.
 */
export async function reserve(input: ReservationInput): Promise<ReservationHandle> {
  const ttlSeconds = await readTtlSeconds()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('throttle_reservations')
    .insert({
      route: input.route,
      traffic_class: input.traffic_class ?? null,
      user_id: input.user_id ?? null,
      organisation_id: input.organisation_id ?? null,
      slots_reserved: Math.max(1, Math.trunc(input.slots)),
      tokens_reserved: Math.max(0, Math.trunc(input.estimated_tokens ?? 0)),
      expires_at: expiresAt,
    })
    .select('id, expires_at')
    .single()
  if (error || !data) {
    throw new Error(`reserve() failed: ${error?.message ?? 'no row returned'}`)
  }
  return { id: data.id, expires_at: data.expires_at }
}

/**
 * Mark the reservation consumed. Called AFTER the LLM call returns
 * (or after dispatch confirms the request opened). Idempotent — a
 * second call on an already-consumed reservation is a no-op.
 */
export async function consume(reservationId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('throttle_reservations')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', reservationId)
    .is('consumed_at', null)
    .is('released_at', null)
  if (error) throw new Error(`consume() failed: ${error.message}`)
}

/**
 * Release the reservation. Called on cleanup paths — handler errors,
 * cancellation, finally-block. Idempotent.
 */
export async function release(reservationId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('throttle_reservations')
    .update({ released_at: new Date().toISOString() })
    .eq('id', reservationId)
    .is('released_at', null)
  if (error) throw new Error(`release() failed: ${error.message}`)
}

/**
 * Manual sweep invocation — wraps the M-099 SQL procedure. pg_cron
 * runs this every 30s automatically (M-102 schedule). Direct
 * invocation is for tests / recovery paths.
 */
export async function sweepExpired(): Promise<{ swept: number }> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('scheduler_sweep_throttle_reservations')
  if (error) throw new Error(`sweepExpired() failed: ${error.message}`)
  return { swept: typeof data === 'number' ? data : Number(data ?? 0) }
}
