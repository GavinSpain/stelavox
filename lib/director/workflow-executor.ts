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

import { getConfigInt } from '@/lib/config/platform-config'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type { Database } from '@/lib/types/database'
import type { WorkflowProposalParsed } from '@/lib/director/schemas'

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
  const { data: stepsRaw } = await supabase
    .from('workflow_steps')
    .select('id, "order", operation_type, target_node_id, parameters, depends_on_step_orders, status, agent_job_id, error_message')
    .eq('workflow_id', workflowId)
    .order('order')

  // SU-48 — catch-up pass for async steps. The Phase 5b runner
  // (lib/agent/runner.ts) calls back into advanceWorkflow when an
  // agent_job reaches a terminal status, but does NOT transition the
  // owning workflow_step or auto-apply the result. So before the
  // dispatchable / completion logic runs, we reconcile stuck running
  // steps here:
  //   - completed agent_job → call accept_agent_job RPC to apply the
  //     result to the node (bumps node.version), transition the step
  //     to 'completed'.
  //   - failed / cancelled / dismissed agent_job → mark the step
  //     'failed' with the error_summary as the step's error_message.
  // Idempotent: accept_agent_job RPC is idempotent on already-'accepted'
  // jobs; the running→completed step transition is a one-shot UPDATE.
  if (stepsRaw && stepsRaw.length > 0) {
    const runningWithJob = stepsRaw.filter(
      (s) => s.status === 'running' && typeof s.agent_job_id === 'string',
    )
    for (const step of runningWithJob) {
      const jobId = step.agent_job_id as string
      const { data: job } = await supabase
        .from('agent_jobs')
        .select('status, result_summary, result_prose, result_notes, result_metadata, result_child_nodes, result_summary_text, error_message')
        .eq('id', jobId)
        .maybeSingle()
      if (!job) continue
      if (job.status === 'completed') {
        // Apply the agent's result to the target node atomically, then
        // mark the step completed.
        const { error: acceptErr } = await supabase.rpc('accept_agent_job', {
          p_job_id: jobId,
          p_actor_id: 'workflow_executor',
          p_target_summary: (job.result_summary as string | null) ?? null,
          p_target_prose: (job.result_prose as string | null) ?? null,
          p_target_notes: (job.result_notes as string | null) ?? null,
          p_target_metadata: job.result_metadata ?? null,
          p_child_nodes: job.result_child_nodes ?? null,
        })
        if (acceptErr) {
          await supabase
            .from('workflow_steps')
            .update({
              status: 'failed',
              error_message: `accept_agent_job_failed:${acceptErr.message}`,
              completed_at: new Date().toISOString(),
            })
            .eq('id', step.id)
          step.status = 'failed' as typeof step.status
          continue
        }
        await supabase
          .from('workflow_steps')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            result_summary: (job.result_summary_text as string | null) ?? null,
          })
          .eq('id', step.id)
        step.status = 'completed' as typeof step.status
      } else if (job.status === 'accepted') {
        // Already accepted — just mark the step completed.
        await supabase
          .from('workflow_steps')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            result_summary: (job.result_summary_text as string | null) ?? null,
          })
          .eq('id', step.id)
        step.status = 'completed' as typeof step.status
      } else if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'dismissed') {
        await supabase
          .from('workflow_steps')
          .update({
            status: 'failed',
            error_message: (job.error_message as string | null) ?? `agent_job_${job.status}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', step.id)
        step.status = 'failed' as typeof step.status
      }
    }
  }
  const steps = stepsRaw

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
 * Persist a draft workflow + its steps from a Director-emitted
 * WorkflowProposalParsed. Called by the streaming Director route at
 * end-of-turn when the agentic loop yields a workflow_proposal event.
 * Returns the new workflow id.
 *
 * Steps are inserted with status='pending'. Workflow inherits
 * status='draft'. The author must approve via /api/director/workflows/
 * [id]/approve before any agent_jobs are dispatched.
 *
 * Step count is capped at agent.director_max_workflow_steps (default 30).
 * Excess steps are truncated; the route layer's UI can show a "capped at
 * 30" notice.
 */
export async function persistDraftWorkflow(args: {
  supabase: SupabaseClient
  organisationId: string
  documentId: string
  conversationId: string
  proposal: WorkflowProposalParsed
}): Promise<string> {
  const { supabase, organisationId, documentId, conversationId, proposal } =
    args
  const cap = await getConfigInt('agent.director_max_workflow_steps')
  const cappedSteps = proposal.steps.slice(0, cap)

  const { data: wf, error: wfErr } = await supabase
    .from('workflows')
    .insert({
      organisation_id: organisationId,
      document_id: documentId,
      conversation_id: conversationId,
      title: proposal.title,
      description: proposal.description ?? null,
      impact_summary: proposal.impact_summary ?? null,
      estimated_total_minutes: proposal.estimated_total_minutes ?? null,
      status: 'draft',
      locked_nodes_requiring_unlock:
        proposal.locked_nodes_requiring_unlock ?? [],
    })
    .select('id')
    .single()

  if (wfErr || !wf) {
    throw new Error(`persistDraftWorkflow failed: ${wfErr?.message}`)
  }

  // Insert steps with order=1..N (1-indexed per Phase 2 convention).
  const stepRows = cappedSteps.map((s, i) => ({
    workflow_id: wf.id,
    order: i + 1,
    operation_type: s.operation_type,
    target_node_id: s.target_node_id,
    parameters: s.parameters,
    description: s.description,
    estimated_duration_seconds: s.estimated_duration_seconds,
    depends_on_step_orders: s.depends_on_step_orders ?? [],
    status: 'pending',
  }))

  if (stepRows.length > 0) {
    const { error: stepsErr } = await supabase
      .from('workflow_steps')
      .insert(stepRows)
    if (stepsErr) {
      // Rollback: delete the workflow row to avoid an empty draft.
      await supabase.from('workflows').delete().eq('id', wf.id)
      throw new Error(`persistDraftWorkflow steps failed: ${stepsErr.message}`)
    }
  }

  return wf.id
}

/**
 * Translate a workflow_step into an agent_jobs row + run-via-waitUntil.
 * Phase 5b T-11: lifts the Phase 5 createJobAndDispatch pattern into
 * a non-HTTP form so the workflow executor can dispatch without going
 * back through the API layer.
 *
 * Per Phase 5b §1.5: agent_jobs.triggered_by encodes the workflow
 * relationship as `workflow_step:<step_id>:<workflow_id>`. The Phase 5
 * agent runner's notifyWorkflowIfStep parses this on terminal status
 * to call advanceWorkflow().
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
  // Synchronous step types: comment + node_reorder run as direct DB
  // writes (no agent_jobs row, no LLM call). They're fast enough to
  // complete inline; the executor marks them complete immediately.
  if (step.operation_type === 'comment' || step.operation_type === 'node_reorder') {
    await executeSynchronousStep(supabase, workflow, step)
    return
  }

  // LLM-bearing step types: expand / synthesise / refine / generate_context.
  // Create the agent_jobs row, then fire-and-forget runAgentJob() via
  // Vercel waitUntil(). triggered_by encodes the workflow relationship
  // for the runner's notifyWorkflowIfStep continuation hook.
  const triggeredBy = `workflow_step:${step.id}:${workflow.id}`

  // Resolve a default profile for this operation_type. Phase 5b auto-Accept
  // mode: the workflow doesn't pin a profile_id at proposal time; resolve
  // the system default at dispatch time.
  // (More sophisticated profile selection — e.g. matching node_type — is a
  // V1.x SU; for now we pick any system profile for the operation_type.)
  const { data: profile } = await supabase
    .from('agent_profiles')
    .select('id')
    .eq('is_system_profile', true)
    .eq('operation_type', step.operation_type)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!profile) {
    await supabase
      .from('workflow_steps')
      .update({
        status: 'failed',
        error_message: `no_system_profile_for_${step.operation_type}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', step.id)
    return
  }

  // Build dynamic context block from step.parameters (operation-specific).
  const dynamicCtx: Record<string, unknown> = {}
  const params = (step.parameters ?? {}) as Record<string, unknown>
  if (typeof params.instruction === 'string') {
    dynamicCtx.refinement_instruction = params.instruction
    dynamicCtx.agent_instruction = params.instruction
  }
  if (typeof params.target_field === 'string') {
    dynamicCtx.target_field = params.target_field
  }

  const { data: jobRow, error: jobErr } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: workflow.organisation_id,
      document_id: workflow.document_id,
      node_id: step.target_node_id,
      profile_id: profile.id,
      operation_type: step.operation_type,
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: triggeredBy,
      context_snapshot: { dynamic: dynamicCtx } as never,
    })
    .select('id')
    .single()

  if (jobErr || !jobRow) {
    await supabase
      .from('workflow_steps')
      .update({
        status: 'failed',
        error_message: `dispatch_failed:${jobErr?.message ?? 'unknown'}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', step.id)
    return
  }

  await supabase
    .from('workflow_steps')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      agent_job_id: jobRow.id,
    })
    .eq('id', step.id)

  // Fire the runner via waitUntil(). Imported lazily to avoid a circular
  // import chain (runner imports advanceWorkflow from this module).
  const { runAgentJob } = await import('@/lib/agent/runner')
  const { waitUntil } = await import('@vercel/functions')
  waitUntil(runAgentJob(jobRow.id))
}

async function executeSynchronousStep(
  supabase: Client,
  workflow: { id: string; organisation_id: string },
  step: {
    id: string
    operation_type: string
    target_node_id: string | null
    parameters: unknown
  },
): Promise<void> {
  await supabase
    .from('workflow_steps')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', step.id)

  try {
    if (step.operation_type === 'comment' && step.target_node_id) {
      const params = (step.parameters ?? {}) as {
        comment_type?: string
        content?: string
      }
      if (!params.content || !params.comment_type) {
        throw new Error('comment_step_missing_parameters')
      }
      await supabase.from('node_comments').insert({
        node_id: step.target_node_id,
        organisation_id: workflow.organisation_id,
        author_type: 'agent',
        author_label: 'Director',
        comment_type: params.comment_type,
        content: params.content,
        resolved: false,
      })
    } else if (step.operation_type === 'node_reorder' && step.target_node_id) {
      const params = (step.parameters ?? {}) as {
        new_order?: number
        parent_id?: string
      }
      if (typeof params.new_order !== 'number') {
        throw new Error('node_reorder_step_missing_parameters')
      }
      // Resolve current parent if not provided.
      let parentId = params.parent_id
      if (!parentId) {
        const { data: cur } = await supabase
          .from('nodes')
          .select('parent_id')
          .eq('id', step.target_node_id)
          .maybeSingle()
        parentId = cur?.parent_id ?? undefined
      }
      if (!parentId) {
        throw new Error('node_reorder_root_node_cannot_be_reordered')
      }
      // Migration 021's move_node RPC handles atomic sibling renumber.
      // Phase 2 convention: position is 0-indexed in the RPC; new_order
      // from the proposal is 1-indexed → subtract 1.
      const { error: rpcErr } = await supabase.rpc('move_node', {
        p_node_id: step.target_node_id,
        p_parent_id: parentId,
        p_position: params.new_order - 1,
      })
      if (rpcErr) throw new Error(`move_node_failed:${rpcErr.message}`)
    }

    await supabase
      .from('workflow_steps')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result_summary: `${step.operation_type} executed`,
      })
      .eq('id', step.id)

    // Trigger the next continuation tick.
    await advanceWorkflow(workflow.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    await supabase
      .from('workflow_steps')
      .update({
        status: 'failed',
        error_message: msg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', step.id)
    await advanceWorkflow(workflow.id)
  }
}
