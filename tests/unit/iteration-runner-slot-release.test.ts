/**
 * H-17 regression — Class 1 reserved-slot release in iteration-runner.
 *
 * Discovery: 2026-05-20 a user-driven 2-stage Brief test left stage 2's
 * director_iteration permanently queued because class_1_reserved_slots
 * had leaked to in_use=5 against total_slots=3 / class_1_max=5. Root
 * cause: the WFQ dispatcher's claimClass1Slot was never paired with a
 * release call on the runner's exit path. Every dispatcher-invoked
 * iteration leaked one slot.
 *
 * Fix: runIteration was refactored into a wrapper that owns Class 1 slot
 * lifecycle; the inner body sets a `slotHeld` flag iff the loaded
 * agent_jobs row has a non-null `reservation_id` (dispatcher-claim
 * signal); the wrapper's try/finally releases exactly once on exit.
 *
 * This test pins the two cases:
 *   (a) jobRow.reservation_id non-null + traffic_class=1
 *       → releaseClass1Slot called exactly once on exit
 *   (b) jobRow.reservation_id NULL (inline-route path, no slot claimed)
 *       → releaseClass1Slot NOT called
 *
 * Both cases drive the wrong_operation_type early-exit path so the test
 * doesn't have to stub the entire LLM call chain. The release lives in
 * the outer wrapper's finally block — it fires for every exit path,
 * including throws and early returns.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Spy on the reserved-slots module before importing the runner.
const releaseClass1SlotSpy = vi.fn(async () => undefined)
vi.mock('@/lib/scheduler/reserved-slots', () => ({
  releaseClass1Slot: releaseClass1SlotSpy,
  claimClass1Slot: vi.fn(),
  readSlotsInUse: vi.fn(async () => 0),
}))

// Build a minimal fake supabase client that returns the configured
// agent_jobs row on the FIRST .from('agent_jobs').select(...).eq(...).maybeSingle()
// call. The runner's early-exit on wrong_operation_type aborts before
// any other DB call, so we only need to handle that one query.
function makeFakeService(jobRow: {
  id: string
  operation_type: string
  reservation_id: string | null
  traffic_class: number
} | null) {
  const svc = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                async maybeSingle() {
                  return { data: jobRow, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  return svc
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => makeFakeService(currentRow),
}))

// Module-level mutable rowfix — the supabase mock factory captures this
// in its closure. Each test sets `currentRow` before importing/invoking
// the runner.
let currentRow: {
  id: string
  operation_type: string
  reservation_id: string | null
  traffic_class: number
} | null = null

beforeEach(() => {
  releaseClass1SlotSpy.mockClear()
})

describe('iteration-runner — Class 1 slot release (H-17)', () => {
  it('releases exactly once when reservation_id is non-null (dispatcher path)', async () => {
    currentRow = {
      id: 'job-with-reservation',
      operation_type: 'expand', // wrong_operation_type → fast exit
      reservation_id: '00000000-0000-0000-0000-000000000001',
      traffic_class: 1,
    }
    const { runIteration } = await import('@/lib/director/iteration-runner')
    const events: unknown[] = []
    for await (const ev of runIteration('job-with-reservation')) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect((events[0] as { error?: string }).error).toBe('wrong_operation_type')
    expect(releaseClass1SlotSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT release when reservation_id is NULL (inline-route path)', async () => {
    currentRow = {
      id: 'job-without-reservation',
      operation_type: 'expand',
      reservation_id: null,
      traffic_class: 1,
    }
    const { runIteration } = await import('@/lib/director/iteration-runner')
    const events: unknown[] = []
    for await (const ev of runIteration('job-without-reservation')) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect((events[0] as { error?: string }).error).toBe('wrong_operation_type')
    expect(releaseClass1SlotSpy).not.toHaveBeenCalled()
  })

  it('does NOT release when traffic_class !== 1 (defensive guard)', async () => {
    currentRow = {
      id: 'job-class-2',
      operation_type: 'expand',
      reservation_id: '00000000-0000-0000-0000-000000000002',
      traffic_class: 2, // non-class-1; release would be wrong
    }
    const { runIteration } = await import('@/lib/director/iteration-runner')
    const events: unknown[] = []
    for await (const ev of runIteration('job-class-2')) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect(releaseClass1SlotSpy).not.toHaveBeenCalled()
  })

  it('releases when jobRow is null (job_not_found path) — control: only if reservation already set', async () => {
    // jobRow=null means the load returned nothing. No slot detection
    // possible from a null row, so no release. (This case represents
    // a job that was deleted before the runner could see it; the
    // dispatcher would have already CAS-released its claim because the
    // claim happens AFTER the row is selected for dispatch — so no real
    // leak risk here, but we pin the runner's behaviour either way.)
    currentRow = null
    const { runIteration } = await import('@/lib/director/iteration-runner')
    const events: unknown[] = []
    for await (const ev of runIteration('job-missing')) {
      events.push(ev)
    }
    expect(events).toHaveLength(1)
    expect((events[0] as { error?: string }).error).toBe('job_not_found')
    expect(releaseClass1SlotSpy).not.toHaveBeenCalled()
  })
})
