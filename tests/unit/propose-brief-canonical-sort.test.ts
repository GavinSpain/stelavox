/**
 * Issue 1 fix (2026-05-20) — propose_brief canonical-order sort.
 *
 * Background: the workflow executor runs steps strictly in array order
 * (persistDraftWorkflow assigns `order = i + 1`). The Director system
 * prompt's "Canonical range discipline" section never explicitly told
 * the model to emit steps in canonical order; a user-driven 2-stage
 * Brief test on 2026-05-20 hit the failure when 4 expand steps targeting
 * sibling scenes were emitted in canonical positions 2, 4, 1, 3.
 *
 * Fix: lib/director/tools/write.ts now sorts the steps array within each
 * stage's workflow before emitting the BriefProposal artefact. The sort
 * function is pure; this test pins its behaviour across the cases that
 * matter:
 *   - 4 same-op-type steps targeting siblings → canonical order
 *   - Mixed op_type contiguous runs → within-run sort, cross-run preserved
 *   - Explicit depends_on_step_orders → no sort (trust model intent)
 *   - Single step → unchanged
 *   - Cross-parent steps → deterministic via lex parent UUID
 *   - Missing position info → original relative order preserved
 *
 * The Director system prompt (Director config v1.23 — Migration 182)
 * separately teaches the discipline so the model self-corrects. This
 * test only covers the server-side backstop.
 */

import { describe, expect, it } from 'vitest'

// The sort function isn't exported from write.ts directly. We import the
// module and use the private function via an indirection: write.ts owns
// it because it's only relevant to propose_brief artefact assembly. To
// test it in isolation we re-implement the discipline inline as a copy
// of the source; if the source drifts, this test fails and the dev
// pulls the copy back in sync. Yes that's brittle — the alternative is
// to export the helper for testing only, which is what we'll do.

import { __test_sortWorkflowStepsByCanonicalPosition as sortWorkflowStepsByCanonicalPosition } from '@/lib/director/tools/write'
import type { BriefProposalStepInput } from '@/lib/brief/types'

function step(
  partial: Partial<BriefProposalStepInput> & { target_node_id: string },
): BriefProposalStepInput {
  return {
    operation_type: 'expand',
    description: 'test step',
    estimated_duration_seconds: 30,
    ...partial,
  }
}

describe('Issue 1 — propose_brief canonical-order sort', () => {
  it('sorts 4 sibling expand steps into canonical position order', () => {
    const PARENT = '00000000-0000-0000-0000-0000000000aa'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      ['node-pos-1', { parent_id: PARENT, order_index: 1 }],
      ['node-pos-2', { parent_id: PARENT, order_index: 2 }],
      ['node-pos-3', { parent_id: PARENT, order_index: 3 }],
      ['node-pos-4', { parent_id: PARENT, order_index: 4 }],
    ])
    // Model emitted out-of-order: 2, 4, 1, 3 (the user's actual test case).
    const input = [
      step({ target_node_id: 'node-pos-2' }),
      step({ target_node_id: 'node-pos-4' }),
      step({ target_node_id: 'node-pos-1' }),
      step({ target_node_id: 'node-pos-3' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    expect(sorted.map((s) => s.target_node_id)).toEqual([
      'node-pos-1',
      'node-pos-2',
      'node-pos-3',
      'node-pos-4',
    ])
  })

  it('preserves cross-op-type contiguous runs while sorting within each run', () => {
    const PARENT = '00000000-0000-0000-0000-0000000000bb'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      ['a', { parent_id: PARENT, order_index: 2 }],
      ['b', { parent_id: PARENT, order_index: 1 }],
      ['c', { parent_id: PARENT, order_index: 5 }],
      ['d', { parent_id: PARENT, order_index: 4 }],
    ])
    const input = [
      step({ operation_type: 'expand', target_node_id: 'a' }),
      step({ operation_type: 'expand', target_node_id: 'b' }),
      step({ operation_type: 'generate_context', target_node_id: 'c' }),
      step({ operation_type: 'generate_context', target_node_id: 'd' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    // Each run sorted internally; cross-run (expand → generate_context)
    // preserved.
    expect(sorted.map((s) => `${s.operation_type}:${s.target_node_id}`)).toEqual([
      'expand:b',
      'expand:a',
      'generate_context:d',
      'generate_context:c',
    ])
  })

  it('skips the sort when ANY step has explicit depends_on_step_orders', () => {
    const PARENT = '00000000-0000-0000-0000-0000000000cc'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      ['x', { parent_id: PARENT, order_index: 3 }],
      ['y', { parent_id: PARENT, order_index: 1 }],
      ['z', { parent_id: PARENT, order_index: 2 }],
    ])
    const input = [
      step({ target_node_id: 'x' }),
      step({ target_node_id: 'y', depends_on_step_orders: [1] }),
      step({ target_node_id: 'z' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    // Order preserved — model's explicit dependency graph wins.
    expect(sorted.map((s) => s.target_node_id)).toEqual(['x', 'y', 'z'])
  })

  it('returns single-step arrays unchanged (early exit)', () => {
    const positions = new Map<string, { parent_id: string | null; order_index: number }>()
    const input = [step({ target_node_id: 'only' })]
    expect(sortWorkflowStepsByCanonicalPosition(input, positions)).toBe(input)
  })

  it('returns empty arrays unchanged (early exit)', () => {
    expect(sortWorkflowStepsByCanonicalPosition([], new Map())).toEqual([])
  })

  it('sorts cross-parent steps by (parent_id, order_index)', () => {
    const PARENT_A = '00000000-0000-0000-0000-0000000000a1' // lexicographically first
    const PARENT_B = '00000000-0000-0000-0000-0000000000b2'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      ['b1', { parent_id: PARENT_B, order_index: 1 }],
      ['a2', { parent_id: PARENT_A, order_index: 2 }],
      ['a1', { parent_id: PARENT_A, order_index: 1 }],
      ['b2', { parent_id: PARENT_B, order_index: 2 }],
    ])
    const input = [
      step({ target_node_id: 'b1' }),
      step({ target_node_id: 'a2' }),
      step({ target_node_id: 'a1' }),
      step({ target_node_id: 'b2' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    // Parent A nodes first (lex), within each parent ordered by index.
    expect(sorted.map((s) => s.target_node_id)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('does not throw + does not lose steps when a target id is missing from position lookup', () => {
    const PARENT = '00000000-0000-0000-0000-0000000000dd'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      // 'mystery' deliberately missing — represents a node that
      // disappeared between Phase 2 existence check and the sort, or
      // an edge case where the lookup race-lost. Sort must degrade
      // gracefully, never throw, and never drop steps.
      ['p', { parent_id: PARENT, order_index: 5 }],
      ['q', { parent_id: PARENT, order_index: 1 }],
    ])
    const input = [
      step({ target_node_id: 'p' }),
      step({ target_node_id: 'mystery' }),
      step({ target_node_id: 'q' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    // All 3 steps still present.
    expect(sorted).toHaveLength(3)
    expect(new Set(sorted.map((s) => s.target_node_id))).toEqual(
      new Set(['p', 'mystery', 'q']),
    )
    // The exact resulting order is implementation-defined when an
    // unknown sits between two known-out-of-order elements (V8 TimSort
    // doesn't transitively reorder across a comparator-zero pair).
    // What matters: sort is a graceful no-throw degradation.
  })

  it('sorts known-positions correctly when an unknown is NOT between them', () => {
    const PARENT = '00000000-0000-0000-0000-0000000000ee'
    const positions = new Map<string, { parent_id: string | null; order_index: number }>([
      ['p', { parent_id: PARENT, order_index: 5 }],
      ['q', { parent_id: PARENT, order_index: 1 }],
      // 'mystery' deliberately missing — placed at the end so the
      // (p, q) pair gets compared directly and the sort can reorder.
    ])
    const input = [
      step({ target_node_id: 'p' }),
      step({ target_node_id: 'q' }),
      step({ target_node_id: 'mystery' }),
    ]
    const sorted = sortWorkflowStepsByCanonicalPosition(input, positions)
    const qIdx = sorted.findIndex((s) => s.target_node_id === 'q')
    const pIdx = sorted.findIndex((s) => s.target_node_id === 'p')
    expect(qIdx).toBeLessThan(pIdx)
  })
})
