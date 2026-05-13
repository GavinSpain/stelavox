/**
 * Stage trigger cycle detection (H-19 mitigation).
 *
 * Brief stages can reference other stages via `after_stage` triggers and
 * `compound` triggers that combine after_stage conditions. A cycle in
 * those references would create a stage that can never run — A waits for
 * B, B waits for A.
 *
 * V1.x-A doesn't fire stage triggers (that's V1.x-B), but we detect
 * cycles at proposal-validation time so a cyclic Brief never reaches the
 * DB. The check is cheap (DFS over typically 4-10 stages) and prevents a
 * landmine for V1.x-B's scheduler.
 *
 * Returns { ok: true } for a clean DAG, or { ok: false, cycle: [order...] }
 * for a detected cycle (the array of orders forming the cycle).
 */

import type { BriefProposalStageInput, BriefStageTriggerConfigAfterStage, BriefStageTriggerConfigCompound } from './types'

export type CycleCheckResult = { ok: true } | { ok: false; cycle: number[] }

/**
 * Detect cycles in the after_stage dependency graph implied by `stages`.
 * Stages are referenced by their `order` value (1-indexed).
 */
export function detectStageTriggerCycles(stages: BriefProposalStageInput[]): CycleCheckResult {
  const dependsOn: Map<number, number[]> = new Map()

  for (const stage of stages) {
    const deps = extractAfterStageDeps(stage)
    dependsOn.set(stage.order, deps)
  }

  // DFS with three-colour marking: 0 = unvisited, 1 = on stack, 2 = done.
  const colour: Map<number, 0 | 1 | 2> = new Map()
  for (const order of dependsOn.keys()) colour.set(order, 0)

  const stack: number[] = []
  for (const start of dependsOn.keys()) {
    if (colour.get(start) === 2) continue
    const found = visit(start, dependsOn, colour, stack)
    if (found) return { ok: false, cycle: found }
  }
  return { ok: true }
}

function extractAfterStageDeps(stage: BriefProposalStageInput): number[] {
  const cfg = stage.trigger_config
  if (stage.trigger_type === 'after_stage') {
    const c = cfg as BriefStageTriggerConfigAfterStage | undefined
    if (typeof c?.after_stage_order === 'number') return [c.after_stage_order]
    return []
  }
  if (stage.trigger_type === 'compound') {
    const c = cfg as BriefStageTriggerConfigCompound | undefined
    if (!c?.conditions) return []
    return c.conditions
      .filter((cond): cond is { type: 'after_stage'; after_stage_order: number } => cond.type === 'after_stage')
      .map((cond) => cond.after_stage_order)
  }
  return []
}

function visit(
  node: number,
  graph: Map<number, number[]>,
  colour: Map<number, 0 | 1 | 2>,
  stack: number[],
): number[] | null {
  colour.set(node, 1)
  stack.push(node)

  const deps = graph.get(node) ?? []
  for (const dep of deps) {
    if (!graph.has(dep)) continue                       // dangling ref — handled separately
    const c = colour.get(dep)
    if (c === 1) {
      // Cycle found. Return the cycle slice starting at dep.
      const idx = stack.indexOf(dep)
      return stack.slice(idx).concat(dep)
    }
    if (c === 0) {
      const found = visit(dep, graph, colour, stack)
      if (found) return found
    }
  }

  colour.set(node, 2)
  stack.pop()
  return null
}
