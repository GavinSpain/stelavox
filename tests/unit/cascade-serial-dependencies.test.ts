/**
 * Regression — cascade-serial dependency auto-derivation.
 *
 * User surfaced 2026-05-22: a propose_workflow with 5 synthesise steps
 * on sibling beats produced 5 parallel dispatches. The cascade
 * architecture depends on each synthesise reading the preceding
 * sibling's prose for continuity context (Migration 053 +
 * lib/llm/context-assembler.ts:fetchPrecedingSiblingsAtLayer). With
 * parallel dispatch, no peer step has accepted prose yet → cascade
 * silently degrades.
 *
 * Per Director V2 architecture, the server auto-derives serial
 * dependencies on synthesise-after-synthesise pairs when the Director
 * doesn't declare them. The helper under test is the post-canonical-
 * sort backstop.
 */

import { describe, expect, it } from 'vitest'

import { __test_deriveCascadeSerialDependencies as derive } from '@/lib/director/tools/write'
import type { BriefProposalStepInput } from '@/lib/brief/types'

function step(
  op: BriefProposalStepInput['operation_type'],
  targetIdx: number,
  parameters: BriefProposalStepInput['parameters'] = {},
  depends_on_step_orders?: number[],
): BriefProposalStepInput {
  return {
    operation_type: op,
    target_node_id: `00000000-0000-0000-0000-00000000000${targetIdx}`,
    description: `${op}#${targetIdx}`,
    estimated_duration_seconds: 60,
    parameters,
    ...(depends_on_step_orders !== undefined ? { depends_on_step_orders } : {}),
  } as BriefProposalStepInput
}

describe('deriveCascadeSerialDependencies', () => {
  it('returns the input unchanged when only one step', () => {
    const input = [step('synthesise', 1)]
    const out = derive(input)
    expect(out[0].depends_on_step_orders).toBeUndefined()
  })

  it('serialises a contiguous run of synthesise steps', () => {
    // The exact scenario the user hit — 5 synthesise on sibling beats.
    const input = [
      step('synthesise', 1),
      step('synthesise', 2),
      step('synthesise', 3),
      step('synthesise', 4),
      step('synthesise', 5),
    ]
    const out = derive(input)
    // First step has no dep.
    expect(out[0].depends_on_step_orders).toBeUndefined()
    // Each subsequent depends on the immediately-preceding step's order.
    expect(out[1].depends_on_step_orders).toEqual([1])
    expect(out[2].depends_on_step_orders).toEqual([2])
    expect(out[3].depends_on_step_orders).toEqual([3])
    expect(out[4].depends_on_step_orders).toEqual([4])
  })

  it('does NOT add deps to expand steps (sibling expands are independent)', () => {
    const input = [
      step('expand', 1, { child_count_target: 3 }),
      step('expand', 2, { child_count_target: 3 }),
      step('expand', 3, { child_count_target: 3 }),
    ]
    const out = derive(input)
    expect(out[0].depends_on_step_orders).toBeUndefined()
    expect(out[1].depends_on_step_orders).toBeUndefined()
    expect(out[2].depends_on_step_orders).toBeUndefined()
  })

  it('does NOT bridge across a non-synthesise step', () => {
    // synth → synth → expand → synth → synth
    //  no   →  1   →  no   →  no  →  4
    // The trailing synthesise pair (indexes 3,4) still get serialised
    // relative to each other, but step 3 does NOT depend on the
    // synthesise at index 1 — the bridge would skip over an expand
    // whose semantics the helper doesn't know.
    const input = [
      step('synthesise', 1),
      step('synthesise', 2),
      step('expand', 3, { child_count_target: 3 }),
      step('synthesise', 4),
      step('synthesise', 5),
    ]
    const out = derive(input)
    expect(out[0].depends_on_step_orders).toBeUndefined()
    expect(out[1].depends_on_step_orders).toEqual([1])
    expect(out[2].depends_on_step_orders).toBeUndefined()
    expect(out[3].depends_on_step_orders).toBeUndefined()
    expect(out[4].depends_on_step_orders).toEqual([4])
  })

  it('respects explicit deps — skips derivation entirely if Director declared anything', () => {
    // Director declared [3] on the third step; the helper leaves the
    // entire workflow alone (the Director presumably had reasons that
    // overlap with or supersede the auto-rule).
    const input = [
      step('synthesise', 1),
      step('synthesise', 2),
      step('synthesise', 3, {}, [1]), // explicit dep
      step('synthesise', 4),
    ]
    const out = derive(input)
    expect(out[0].depends_on_step_orders).toBeUndefined()
    expect(out[1].depends_on_step_orders).toBeUndefined()
    expect(out[2].depends_on_step_orders).toEqual([1])
    expect(out[3].depends_on_step_orders).toBeUndefined()
  })

  it('handles mixed workflow with synthesise at the end', () => {
    // expand → synth → synth: the first synthesise (idx 1) does NOT
    // depend on the expand (different op type); the second synth
    // (idx 2) DOES depend on the first (immediately preceding synth).
    const input = [
      step('expand', 1, { child_count_target: 3 }),
      step('synthesise', 2),
      step('synthesise', 3),
    ]
    const out = derive(input)
    expect(out[0].depends_on_step_orders).toBeUndefined()
    expect(out[1].depends_on_step_orders).toBeUndefined()
    expect(out[2].depends_on_step_orders).toEqual([2])
  })

  it('does not mutate the input array (returns new objects)', () => {
    const input = [step('synthesise', 1), step('synthesise', 2)]
    const inputBefore = JSON.parse(JSON.stringify(input))
    derive(input)
    expect(input).toEqual(inputBefore)
  })
})
