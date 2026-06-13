/**
 * DR-121 — Admin Operations Summary capture + infra-health.
 *
 * Pins: (1) admin_ops_infra_health() returns the liveness shape;
 * (2) bump_conversation_window_pressure increments the minute counters;
 * (3) the export runner persists file_size_bytes for storage aggregation.
 */

import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('DR-121 admin_ops_infra_health', () => {
  it('returns the liveness shape', async () => {
    const { data, error } = await svc.rpc('admin_ops_infra_health')
    expect(error).toBeNull()
    const d = data as Record<string, unknown>
    expect(d).toHaveProperty('dispatcher_last_tick')
    expect(d).toHaveProperty('cron_jobs')
    expect(Array.isArray(d.cron_jobs)).toBe(true)
    expect(d).toHaveProperty('realtime_publication_count')
    expect(typeof d.realtime_publication_count).toBe('number')
  })
})

describe.skipIf(!hasServiceKey)('DR-121 conversation-window pressure', () => {
  it('increments total + summary_active + eviction counters', async () => {
    async function counters() {
      const { data } = await svc
        .from('metrics_minute_buckets')
        .select('dimensions, value')
        .eq('metric_kind', 'conversation_window_pressure')
      const map: Record<string, number> = {}
      for (const r of (data ?? []) as Array<{ dimensions: { k: string }; value: number }>) {
        map[r.dimensions.k] = (map[r.dimensions.k] ?? 0) + Number(r.value)
      }
      return map
    }
    const before = await counters()
    await svc.rpc('bump_conversation_window_pressure', { p_summary_active: true, p_evicted: true })
    const after = await counters()
    expect((after.total ?? 0)).toBe((before.total ?? 0) + 1)
    expect((after.summary_active ?? 0)).toBe((before.summary_active ?? 0) + 1)
    expect((after.eviction ?? 0)).toBe((before.eviction ?? 0) + 1)
  })

  it('summary_active does not increment when false', async () => {
    async function summaryActive() {
      const { data } = await svc
        .from('metrics_minute_buckets')
        .select('value')
        .eq('metric_kind', 'conversation_window_pressure')
        .eq('dimensions->>k', 'summary_active')
      return ((data ?? []) as Array<{ value: number }>).reduce((s, r) => s + Number(r.value), 0)
    }
    const before = await summaryActive()
    await svc.rpc('bump_conversation_window_pressure', { p_summary_active: false, p_evicted: false })
    const after = await summaryActive()
    expect(after).toBe(before)   // unchanged
  })
})

describe.skipIf(!hasServiceKey)('DR-121 export_jobs.file_size_bytes', () => {
  it('column exists for storage aggregation', async () => {
    // A select referencing the column succeeds only if it exists.
    const { error } = await svc.from('export_jobs').select('id, file_size_bytes').limit(1)
    expect(error).toBeNull()
  })
})
