/**
 * Stage trigger cycle detection (H-19 mitigation).
 *
 * Brief stages can reference other stages via after_stage triggers and
 * compound triggers that combine after_stage conditions. A cycle would
 * create a stage that can never run.
 *
 * V1.x-A.1 doesn't fire triggers automatically — that's V1.x-B work —
 * but we detect cycles at proposal-validation time so a cyclic Brief
 * never reaches the DB.
 */

import type {
  BriefProposalStageInput,
  BriefStageTriggerConfigAfterStage,
  BriefStageTriggerConfigCompound,
} from './types'

export type CycleCheckResult = { ok: true } | { ok: false; cycle: number[] }

export function detectStageTriggerCycles(stages: BriefProposalStageInput[]): CycleCheckResult {
  const dependsOn: Map<number, number[]> = new Map()
  for (const stage of stages) dependsOn.set(stage.order, extractAfterStageDeps(stage))

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
  // 2026-05-21 simplification (M-183): only 'after_stage' creates a
  // stage dependency. 'manual' triggers have no implicit predecessor.
  // 'scheduled_at' and 'compound' trigger types were dropped.
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
    if (!graph.has(dep)) continue
    const c = colour.get(dep)
    if (c === 1) {
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
