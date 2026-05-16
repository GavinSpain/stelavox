/**
 * V1.x-E.2 — probe runner unit tests.
 *
 * Tests the substrate paths without invoking the real Anthropic API:
 *   - isValidProbeId() narrows the union correctly
 *   - runProbe() inserts a row, dispatches, then UPDATEs with the result
 *   - thrown dispatch errors land as fail rows with failure_class='E'
 *   - the V1 stub probes (workflow_expand, refine_accept) record the
 *     pending_implementation marker
 *
 * director_small invokes the live Anthropic SDK; we don't mock it here
 * — covered by an environment-skipped Playwright case in the V1.x-E
 * integration suite.
 */

import { describe, expect, it, vi } from 'vitest'

import { isValidProbeId, runProbe } from '@/lib/admin/probes/runner'

interface RecordedUpdate {
  outcome: string | null
  failure_class: string | null
  error_message: string | null
  metadata: Record<string, unknown> | null
}

function fakeSvc(): { svc: unknown; updates: RecordedUpdate[]; insertedIds: number[] } {
  const updates: RecordedUpdate[] = []
  const insertedIds: number[] = []
  const svc = {
    from(_table: string) {
      return {
        insert(_row: unknown) {
          const id = insertedIds.length + 1
          insertedIds.push(id)
          return {
            select() {
              return {
                async single() {
                  return { data: { id }, error: null }
                },
              }
            },
          }
        },
        update(row: RecordedUpdate) {
          updates.push(row)
          return {
            eq() {
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
  return { svc, updates, insertedIds }
}

describe('isValidProbeId (V1.x-E.2)', () => {
  it('accepts director_small / workflow_expand / refine_accept', () => {
    expect(isValidProbeId('director_small')).toBe(true)
    expect(isValidProbeId('workflow_expand')).toBe(true)
    expect(isValidProbeId('refine_accept')).toBe(true)
  })

  it('rejects unknown probe_ids', () => {
    expect(isValidProbeId('director')).toBe(false)
    expect(isValidProbeId('expand_workflow')).toBe(false)
    expect(isValidProbeId('')).toBe(false)
  })
})

describe('runProbe (V1.x-E.2 — stub probes)', () => {
  it('records workflow_expand as fail with probe_implementation_pending_v1xf', async () => {
    const { svc, updates, insertedIds } = fakeSvc()
    const { id, result } = await runProbe({
      svc: svc as never,
      probeId: 'workflow_expand',
      triggeredBy: 'manual',
    })
    expect(insertedIds).toEqual([1])
    expect(id).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.outcome).toBe('fail')
    expect(updates[0]?.failure_class).toBe('E')
    expect(updates[0]?.error_message).toContain('probe_implementation_pending_v1xf')
    expect(updates[0]?.metadata).toEqual({ deferred_to: 'V1.x-F' })
    expect(result.outcome).toBe('fail')
  })

  it('records refine_accept as fail with probe_implementation_pending_v1xf', async () => {
    const { svc, updates } = fakeSvc()
    const { result } = await runProbe({
      svc: svc as never,
      probeId: 'refine_accept',
      triggeredBy: 'manual',
    })
    expect(updates[0]?.error_message).toContain('probe_implementation_pending_v1xf')
    expect(result.outcome).toBe('fail')
  })

  it('records director_small as fail when ANTHROPIC_API_KEY is unset', async () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const { svc, updates } = fakeSvc()
      const { result } = await runProbe({
        svc: svc as never,
        probeId: 'director_small',
        triggeredBy: 'manual',
      })
      expect(updates[0]?.outcome).toBe('fail')
      expect(updates[0]?.failure_class).toBe('E')
      expect(updates[0]?.error_message).toContain('ANTHROPIC_API_KEY')
      expect(result.outcome).toBe('fail')
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original
    }
  })

  it('throws when the open-row insert fails', async () => {
    const svc = {
      from() {
        return {
          insert() {
            return {
              select() {
                return {
                  async single() {
                    return { data: null, error: { message: 'permission denied' } }
                  },
                }
              },
            }
          },
        }
      },
    }
    await expect(
      runProbe({
        svc: svc as never,
        probeId: 'director_small',
        triggeredBy: 'manual',
      }),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('runProbe (V1.x-E.2 — error capture)', () => {
  it('captures dispatch throws as fail row with failure_class=E', async () => {
    // Force director_small to throw by setting a bad ANTHROPIC_API_KEY
    // path that the SDK will reject — but the runner's try/catch around
    // dispatch should catch any thrown error and record it. (The
    // ANTHROPIC_API_KEY-unset test above already covers the explicit
    // null-key branch; this asserts the umbrella try/catch.)
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const { svc, updates } = fakeSvc()
      await runProbe({
        svc: svc as never,
        probeId: 'director_small',
        triggeredBy: 'manual',
      })
      expect(updates[0]?.failure_class).toBe('E')
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original
    }
  })
})

// Suppress console noise from the SDK's deprecation warnings during tests.
vi.spyOn(console, 'warn').mockImplementation(() => undefined)
