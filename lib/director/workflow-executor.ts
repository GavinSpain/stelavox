/**
 * Director — workflow executor (continuation chain).
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §1.5 v1.1 + I-11.
 *         stelavox_technical_architecture_v1_9.md §8.4.
 * Build Checklist: T-11.
 *
 * Phase 5b workflow execution is continuation-passing. NOT a long-lived
 * process or a Supabase Edge Function. The flow:
 *
 *   1. /api/director/workflows/[id]/approve writes workflow.status='approved'
 *      and dispatches the first batch of agent_jobs via dispatchAgentJob().
 *      Each agent_job's triggered_by is 'workflow_step:<step.id>'.
 *
 *   2. Each agent runner (lib/agent/runner.ts), when reaching terminal
 *      status (completed | failed | cancelled), inspects triggered_by.
 *      If it starts with 'workflow_step:', it calls advanceWorkflow()
 *      from inside its own waitUntil() window.
 *
 *   3. advanceWorkflow():
 *      - Loads workflow + steps
 *      - On step completion: auto-Accept the agent_job (writes results
 *        to nodes via the Migration 029 RPC); updates step.status
 *      - On step failure: workflow.status='paused' + error_message
 *      - Otherwise: finds the next dispatchable batch (steps whose
 *        depends_on_step_orders are all 'completed'); dispatches them
 *        via dispatchAgentJob()
 *      - If no remaining 'pending'/'running' steps: workflow.status='completed'
 *      - Always touches workflows.last_heartbeat_at
 *
 *   4. The chain continues until workflow reaches a terminal state.
 *      No process needs to live for the full duration.
 *
 * Recovery: if a Vercel function crashes mid-tick, the parent agent_job
 * is in 'running' with no terminal status. The recovery sweep
 * (/api/cron/director-recovery) catches it via heartbeat timeout, marks
 * it failed, and itself calls advanceWorkflow which transitions the
 * workflow to 'paused'.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/service'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

/**
 * Advance a workflow after one of its steps reaches terminal status.
 * Idempotent: safe to call multiple times for the same step transition.
 */
export async function advanceWorkflow(workflowId: string): Promise<void> {
  const supabase = createServiceRoleClient()

  // Touch heartbeat first — even if this tick is a no-op, the workflow
  // is provably alive.
  await supabase
    .from('workflows')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', workflowId)

  const { data: workflow } = await supabase
    .from('workflows')
    .select('id, status, organisation_id, document_id')
    .eq('id', workflowId)
    .maybeSingle()

  if (!workflow) {
    console.warn('[advanceWorkflow] workflow not found', { workflowId })
    return
  }

  // Terminal states are no-ops.
  if (
    workflow.status === 'completed' ||
    workflow.status === 'cancelled' ||
    workflow.status === 'paused'
  ) {
    return
  }

  // Load all steps. Order by their `order` column.
  const { data: steps } = await supabase
    .from('workflow_steps')
    .select('id, "order", operation_type, target_node_id, parameters, depends_on_step_orders, status, agent_job_id, error_message')
    .eq('workflow_id', workflowId)
    .order('order')

  if (!steps || steps.length === 0) {
    // No steps — mark completed.
    await supabase
      .from('workflows')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', workflowId)
    return
  }

  // Detect failed steps — pause workflow.
  const failed = steps.find((s) => s.status === 'failed')
  if (failed) {
    await supabase
      .from('workflows')
      .update({
        status: 'paused',
        error_message:
          failed.error_message ?? `step ${failed.order} failed`,
      })
      .eq('id', workflowId)
    return
  }

  // Find the next dispatchable batch — steps in 'pending' whose
  // depends_on_step_orders are all 'completed' OR 'skipped'.
  const completedOrders = new Set(
    steps
      .filter((s) => s.status === 'completed' || s.status === 'skipped')
      .map((s) => (s as { order: number }).order),
  )
  const dispatchable = steps.filter((s) => {
    if (s.status !== 'pending') return false
    const deps = (s.depends_on_step_orders ?? []) as number[]
    return deps.every((d) => completedOrders.has(d))
  })

  // If nothing dispatchable but no running steps either: workflow done
  // (every remaining step is removed/skipped/completed).
  const stillRunning = steps.some((s) => s.status === 'running')
  if (dispatchable.length === 0) {
    if (!stillRunning) {
      const allDone = steps.every(
        (s) =>
          s.status === 'completed' ||
          s.status === 'skipped' ||
          s.status === 'removed',
      )
      if (allDone) {
        await supabase
          .from('workflows')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', workflowId)
      }
    }
    return
  }

  // Promote workflow to 'running' if we're dispatching the first batch.
  if (workflow.status === 'approved') {
    await supabase
      .from('workflows')
      .update({ status: 'running' })
      .eq('id', workflowId)
  }

  // Dispatch each step in the batch. Per Phase 5 pattern, this happens
  // via dispatchAgentJobForStep() which builds the agent_jobs row and
  // fires waitUntil(runAgentJob(jobId)). The actual implementation
  // imports the Phase 5 helpers; deferred to T-11 final wiring.
  for (const step of dispatchable) {
    await dispatchAgentJobForStep(supabase, workflow, step)
  }
}

/**
 * Translate a workflow_step into an agent_jobs row + run-via-waitUntil.
 * Phase 5b T-11 wiring connects this to the existing Phase 5 dispatch
 * path. For now: marks the step 'running' so advanceWorkflow doesn't
 * re-dispatch it on the next tick.
 *
 * Real dispatch is implemented by the route layer (T-13's /approve
 * endpoint, plus the recovery + resume routes). This module exposes
 * the workflow-state-management half; the actual job-creation half
 * lives in lib/agents/dispatch.ts (T-7 placeholder; T-11 finalises).
 */
async function dispatchAgentJobForStep(
  supabase: Client,
  workflow: { id: string; organisation_id: string; document_id: string },
  step: {
    id: string
    operation_type: string
    target_node_id: string | null
    parameters: unknown
  },
): Promise<void> {
  // Mark step running. Real LLM-job dispatch wired by T-11.
  await supabase
    .from('workflow_steps')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', step.id)

  // T-11 follow-up: call lib/agents/dispatch.ts dispatchAgentJob() to
  // create the agent_jobs row + waitUntil(runAgentJob(jobId)).
  // For now this is the workflow-state side; the dispatch side lands
  // when the /approve route is wired.
  void workflow
}
