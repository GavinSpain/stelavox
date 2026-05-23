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

import { plainTextToTiptap } from '@/lib/agent/prose-to-tiptap'
import { getConfigInt } from '@/lib/config/platform-config'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { transitionWorkflow, transitionWorkflowStep } from '@/lib/orchestration'
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
        //
        // Convert plain-text result_* fields to stringified Tiptap JSON
        // before calling accept_agent_job (G-9). The RPC's docstring at
        // Migration 029 line 38 specifies p_target_summary expects
        // "Pre-stringified Tiptap JSON"; the agent operations
        // (lib/agent/operations/*) emit plain text. The user-Accept
        // route at app/api/agent-jobs/[jobId]/accept/route.ts:62
        // does the conversion; the workflow_executor catch-up MUST do
        // the same — without it, accept_agent_job writes plain text
        // straight to nodes.summary, the Tiptap-based SummaryEditor
        // can't parse it, falls back to empty doc, and on autosave
        // clobbers the field.
        const summaryJson = job.result_summary
          ? JSON.stringify(plainTextToTiptap(job.result_summary as string))
          : null
        const proseJson = job.result_prose
          ? JSON.stringify(plainTextToTiptap(job.result_prose as string))
          : null
        const notesJson = job.result_notes
          ? JSON.stringify(plainTextToTiptap(job.result_notes as string))
          : null

        // Expand: pre-convert each child node's summary to Tiptap JSON.
        let childNodesForRpc: unknown[] | null = null
        if (Array.isArray(job.result_child_nodes)) {
          childNodesForRpc = (job.result_child_nodes as Array<Record<string, unknown>>).map(
            (child) => ({
              name: (child.name as string | null) ?? null,
              short_description: (child.short_description as string | null) ?? '',
              summary: child.summary
                ? JSON.stringify(plainTextToTiptap(child.summary as string))
                : null,
              metadata: child.metadata ?? {},
              word_count_target: child.word_count_target ?? null,
              position: child.position,
            }),
          )
        }

        const { error: acceptErr } = await supabase.rpc('accept_agent_job', {
          p_job_id: jobId,
          p_actor_id: 'workflow_executor',
          p_target_summary: summaryJson,
          p_target_prose: proseJson,
          p_target_notes: notesJson,
          p_target_metadata: job.result_metadata ?? null,
          p_child_nodes: childNodesForRpc,
        })
        if (acceptErr) {
          await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
            error_message: `accept_agent_job_failed:${acceptErr.message}`,
          })
          step.status = 'failed' as typeof step.status
          continue
        }
        await transitionWorkflowStep(supabase, step.id, 'job_terminal_success', 'completed', {
          result_summary: (job.result_summary_text as string | null) ?? null,
        })
        step.status = 'completed' as typeof step.status
      } else if (job.status === 'accepted') {
        // Already accepted — just mark the step completed.
        await transitionWorkflowStep(supabase, step.id, 'job_terminal_success', 'completed', {
          result_summary: (job.result_summary_text as string | null) ?? null,
        })
        step.status = 'completed' as typeof step.status
      } else if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'dismissed') {
        await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
          error_message: (job.error_message as string | null) ?? `agent_job_${job.status}`,
        })
        step.status = 'failed' as typeof step.status
      }
    }
  }
  const steps = stepsRaw

  if (!steps || steps.length === 0) {
    // No steps — mark completed. Apollo: legal transitions are running->completed
    // or approved->cancelled etc; only the running->completed path applies here.
    await transitionWorkflow(supabase, workflowId, 'all_steps_terminal_success', 'completed')
    return
  }

  // Detect failed steps — pause workflow.
  const failed = steps.find((s) => s.status === 'failed')
  if (failed) {
    await transitionWorkflow(supabase, workflowId, 'step_failed_or_budget', 'paused', {
      error_message: failed.error_message ?? `step ${failed.order} failed`,
    })
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
        await transitionWorkflow(supabase, workflowId, 'all_steps_terminal_success', 'completed')

        // Brief stage propagation: when a workflow completes, fire the
        // push-model evaluator (M-120) which marks the linked brief_stage
        // 'completed' and inserts a director_iteration for the next stage's
        // trigger. The RPC short-circuits with no_linked_stage when the
        // workflow isn't tied to a stage.
        //
        // Discovered during Phase 7 review when Stage 2 of a 2-stage Brief
        // failed to auto-promote — the DB-side RPCs have existed since
        // V1.x-B.1.1 (M-097) + V1.x-B.2 (M-120) but the TS caller was
        // never wired in.
        const { error: rpcError } = await supabase
          .rpc('complete_brief_stage_workflow', { p_workflow_id: workflowId })
        if (rpcError) {
          console.warn('[advanceWorkflow] complete_brief_stage_workflow failed', {
            workflowId,
            error: rpcError.message,
          })
        }
      }
    }
    return
  }

  // Promote workflow to 'running' if we're dispatching the first batch.
  if (workflow.status === 'approved') {
    await transitionWorkflow(supabase, workflowId, 'dispatch_first', 'running')
  }

  // Dispatch each step in the batch. Per Phase 5 pattern, this happens
  // via dispatchAgentJobForStep() which builds the agent_jobs row and
  // fires waitUntil(runAgentJob(jobId)). The actual implementation
  // imports the Phase 5 helpers; deferred to T-11 final wiring.
  //
  // Launch-test session 2026-05-10 fanout-rate-limit fix:
  // Cap the number of in-flight dispatches by `agent.director_max_concurrent_dispatch`
  // (default 1, sequential). Without this, a Director plan with N
  // independent steps fires all N LLM calls within seconds and trips
  // the Anthropic concurrent-connections limit on the platform key.
  // As each running step completes, the agent runner already calls
  // back into advanceWorkflow which picks up the next slot, so the
  // remaining 'pending' steps drain naturally. The full multi-tenant
  // throttle (per-user + global, throttle-not-deny semantics) is
  // queued for the Director architecture deep review; this is the
  // holding-pattern shape.
  const maxConcurrent = await getConfigInt('agent.director_max_concurrent_dispatch')
  const runningCount = steps.filter((s) => s.status === 'running').length
  const slots = Math.max(0, maxConcurrent - runningCount)
  if (slots === 0) return
  const toDispatch = dispatchable.slice(0, slots)
  for (const step of toDispatch) {
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

/**
 * Derive a human-readable name for an auto-created context node from
 * the Director's seed_content. Falls back to the capitalized context
 * type if seed_content is empty.
 *
 * Examples:
 *   ('theme', 'CORE THEMES\n\n1. Ambition...')   → 'Core Themes'
 *   ('theme', 'Ambition and hubris drive ...')   → 'Ambition and hubris'
 *   ('world', 'Hard physics: gravity wells...')  → 'Hard physics'
 *   ('character', '')                            → 'Character'
 *
 * Used by SU-J11-2 auto-create-context-node logic.
 */
export function deriveContextName(contextType: string, seedContent: string): string {
  const trimmed = seedContent.trim()
  if (!trimmed) {
    return contextType.charAt(0).toUpperCase() + contextType.slice(1)
  }
  // First non-empty line, stripped of leading numbering / markdown headers.
  const firstLine = trimmed.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  let cleaned = firstLine
    .replace(/^#+\s*/, '')        // markdown headers
    .replace(/^\d+\.\s*/, '')     // numeric list prefixes
    .replace(/^[-*]\s*/, '')      // bullet list prefixes
    .trim()
  // Trim a trailing colon if the line was a heading.
  cleaned = cleaned.replace(/:\s*$/, '')
  // Truncate to a reasonable name length (200 chars max per nodes.name).
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 77).trim() + '…'
  if (!cleaned) {
    return contextType.charAt(0).toUpperCase() + contextType.slice(1)
  }
  // Title-case if the line is ALL CAPS (typical of "CORE THEMES" headings).
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    cleaned = cleaned
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return cleaned
}

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
  if (
    step.operation_type === 'comment' ||
    step.operation_type === 'node_reorder' ||
    step.operation_type === 'node_rename'
  ) {
    await executeSynchronousStep(supabase, workflow, step)
    return
  }

  // LLM-bearing step types: expand / synthesise / refine / generate_context.
  // Create the agent_jobs row, then fire-and-forget runAgentJob() via
  // Vercel waitUntil(). triggered_by encodes the workflow relationship
  // for the runner's notifyWorkflowIfStep continuation hook.
  const triggeredBy = `workflow_step:${step.id}:${workflow.id}`

  // Resolve the system profile for this step:
  //   1. Match by (operation_type, node_type) — needs target_node's node_type
  //   2. For refine: if multiple candidates (only beat has 2 — _summary + _prose),
  //      disambiguate by target_field via name-suffix match
  //   3. For refine: fall back to refine_default (node_type IS NULL) if no
  //      match — covers any node_type Phase 5 didn't ship a dedicated profile for
  //   4. For other ops: error out — every (op, node_type) combo is supposed
  //      to have a dedicated profile (per agent_profile_library v1.2)
  //
  // Earlier implementation picked profile by oldest-created_at-for-this-op,
  // which always returned `refine_beat_prose` for ANY refine step regardless
  // of target node type. Acts/Chapters/Scenes refines all corrupted because
  // refine_beat_prose's prompt expects a `<prose>` field; the model wrote
  // an "I need the prose" complaint into result_summary, which then got
  // written to nodes.summary, corrupting the tree.
  //
  // The user-clicked refine route's `validateProfile` helper has a related
  // weakness (no target_field disambiguation for beats); that's a separate
  // SU. This fix is scoped to the workflow path.

  const params = (step.parameters ?? {}) as Record<string, unknown>
  const targetField =
    typeof params.target_field === 'string' ? params.target_field : null

  // Step's target_node_id should always be set for LLM-bearing steps.
  if (!step.target_node_id) {
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: 'step_missing_target_node_id',
      })
    return
  }

  let { data: targetNode } = await supabase
    .from('nodes')
    .select('id, node_type, node_category, project_id')
    .eq('id', step.target_node_id)
    .maybeSingle()

  if (!targetNode) {
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: 'target_node_not_found',
      })
    return
  }

  // SU-J11-2 / Bug 4 (Mars series 2026-05-08): when Director plans
  // generate_context against a structural parent (e.g. series root), the
  // workflow_executor auto-creates the requested context node, links it
  // to the structural target, re-targets the step, and dispatches the
  // agent_job against the new context node. This bridges the gap
  // between the Director's "create-and-fill" planning model and the
  // system's "fill an existing context node" operation semantics.
  //
  // The user-clicked /api/agent/generate-context route requires
  // node.node_category === 'context' — running generate_context against
  // a structural node would corrupt it on Accept. Auto-creating ensures
  // the target IS a context node before dispatch.
  if (step.operation_type === 'generate_context' && targetNode.node_category !== 'context') {
    const contextType = typeof params.context_type === 'string' ? params.context_type : null
    if (!contextType) {
      await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: 'generate_context_missing_context_type',
      })
      return
    }

    const seedContent = typeof params.seed_content === 'string' ? params.seed_content : ''
    const derivedName = deriveContextName(contextType, seedContent)
    const initialSummaryJson = seedContent
      ? JSON.stringify({
          type: 'doc',
          content: seedContent
            .split(/\n\n+/)
            .map((para) => ({
              type: 'paragraph',
              content: [{ type: 'text', text: para }],
            })),
        })
      : null

    const { data: newContextNode, error: createErr } = await supabase
      .from('nodes')
      .insert({
        organisation_id: workflow.organisation_id,
        project_id: targetNode.project_id,
        document_id: workflow.document_id,
        node_category: 'context',
        node_type: contextType,
        scope: 'document',
        parent_id: null,
        name: derivedName,
        summary: initialSummaryJson,
        metadata: {} as never,
        tags: [],
        status: 'draft',
        version: 1,
      })
      .select('id, node_type, node_category, project_id')
      .single()

    if (createErr || !newContextNode) {
      await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: `auto_create_context_node_failed:${createErr?.message ?? 'unknown'}`,
      })
      return
    }

    // Link the new context node back to the structural target so the
    // tree view shows the relationship (Theme of Series).
    await supabase
      .from('node_context_links')
      .insert({
        organisation_id: workflow.organisation_id,
        source_node_id: step.target_node_id,
        target_node_id: newContextNode.id,
        link_type: 'structural_to_context',
      })

    // Persistently re-target the step at the new context node so retries
    // dispatch against the same context (idempotent).
    await supabase
      .from('workflow_steps')
      .update({ target_node_id: newContextNode.id })
      .eq('id', step.id)

    step.target_node_id = newContextNode.id
    targetNode = newContextNode
  }

  // For generate_context, the profile node_type is the CONTEXT node's type
  // (theme/world/character/etc.). After the auto-create branch above, the
  // target IS a context node; targetNode.node_type matches params.context_type
  // (and the original case where Director plans against an existing context
  // node also satisfies this).
  const profileNodeType: string =
    step.operation_type === 'generate_context' && typeof params.context_type === 'string'
      ? params.context_type
      : targetNode.node_type

  // Phase 1: candidates matching (operation_type, profileNodeType).
  // B5.5 (round-3 audit F-124): expand the SELECT to include max_tokens
  // so the budget gate below can size its estimate per-operation rather
  // than using a single global default.
  // V1.x-C.2: also pull model_id so the gate can convert tokens → credits
  // via the active pricing_rates row for the profile's model.
  const { data: candidates } = await supabase
    .from('agent_profiles')
    .select('id, name, node_type, max_tokens, model_id')
    .eq('is_system_profile', true)
    .eq('operation_type', step.operation_type)
    .eq('node_type', profileNodeType)

  let profile: { id: string; name: string; max_tokens?: number; model_id: string } | null = null

  if (candidates && candidates.length > 0) {
    if (candidates.length === 1) {
      profile = candidates[0]
    } else if (targetField) {
      // Disambiguate by target_field via name-suffix match. Profile naming
      // convention: refine_<node_type>_<field> (e.g. refine_beat_prose,
      // refine_beat_summary). Fall back to first candidate if no exact
      // suffix match.
      profile =
        candidates.find((c) => c.name.endsWith(`_${targetField}`)) ??
        candidates[0]
    } else {
      profile = candidates[0]
    }
  }

  // Phase 2: refine fallback to cross-type default.
  if (!profile && step.operation_type === 'refine') {
    const { data: fallback } = await supabase
      .from('agent_profiles')
      .select('id, name, max_tokens, model_id')
      .eq('is_system_profile', true)
      .eq('operation_type', 'refine')
      .is('node_type', null)
      .maybeSingle()
    profile = fallback
  }

  if (!profile) {
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: `no_system_profile_for_${step.operation_type}_${profileNodeType}`,
      })
    return
  }

  // Build dynamic context block from step.parameters (operation-specific).
  const dynamicCtx: Record<string, unknown> = {}
  if (typeof params.instruction === 'string') {
    dynamicCtx.refinement_instruction = params.instruction
    dynamicCtx.agent_instruction = params.instruction
  }
  if (targetField) {
    dynamicCtx.target_field = targetField
  }

  // B5.5 (round-3 audit F-124): H-07 token budget gate. Pre-fix the
  // workflow path bypassed the budget — only the user-clicked agent
  // routes called checkTokenBudget. Combined with F-187 (Director
  // message route bypass, fixed in this batch) the budget had three
  // holes total. The check runs BEFORE the agent_jobs INSERT so an
  // over-budget step never produces an orphaned pending job (matches
  // H-07's invariant). On exceeded budget, mark the workflow_step
  // failed and pause the workflow per the audit's recommended shape.
  const { data: org } = await supabase
    .from('organisations')
    .select('id, plan, current_period_start')
    .eq('id', workflow.organisation_id)
    .maybeSingle()
  if (!org) {
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: 'organisation_not_found',
      })
    return
  }
  const stepEstimate = (profile.max_tokens ?? 16384) + 4096
  const budgetOk = await checkTokenBudget(
    { id: org.id, plan: org.plan ?? 'trial', current_period_start: org.current_period_start },
    stepEstimate,
    profile.model_id,
  )
  if (!budgetOk) {
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: 'token_budget_exceeded',
      })
    // Pause the workflow so subsequent batches don't fire while the
    // org is over budget.
    await transitionWorkflow(supabase, workflow.id, 'step_failed_or_budget', 'paused')
    return
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
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: `dispatch_failed:${jobErr?.message ?? 'unknown'}`,
      })
    return
  }

  await transitionWorkflowStep(supabase, step.id, 'dispatch', 'running', { agent_job_id: jobRow.id })

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
  await transitionWorkflowStep(supabase, step.id, 'dispatch', 'running')

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
    } else if (step.operation_type === 'node_rename' && step.target_node_id) {
      // M-179 / 2026-05-18: rename a node's `name` field. Metadata
      // operation — does NOT bump version (M-023 trigger ignores
      // name changes; matches TC-A-47). The Director propose-tool
      // already trim+validated 1-200 chars; defensive re-check here.
      const params = (step.parameters ?? {}) as { new_name?: string }
      const trimmed = (params.new_name ?? '').trim()
      if (trimmed.length === 0) {
        throw new Error('node_rename_step_missing_new_name')
      }
      if (trimmed.length > 200) {
        throw new Error('node_rename_new_name_too_long')
      }
      // Writability gate via M-150 RPC. The RPC takes a requesting_user_id
      // for Edit Session bookkeeping; pass NULL — Director-driven workflow
      // executions are system-actor-equivalent, so they shouldn't be
      // blocked by another user being in an Edit Session on the node.
      // The author_locked / node_in_progress branches still fire.
      // Cast: SQL function accepts NULL UUID (NULL-safe inequality in
      // the Edit Session check yields no rows = bypass), but Supabase's
      // generated TS type insists on non-null.
      const { data: gate, error: gateErr } = await supabase.rpc('check_node_writable', {
        p_node_id: step.target_node_id,
        p_requesting_user_id: null as unknown as string,
      })
      if (gateErr) throw new Error(`node_rename_write_gate_failed:${gateErr.message}`)
      const gateRow = (gate ?? {}) as { writable?: boolean; blocker?: string | null }
      if (gateRow.writable === false) {
        throw new Error(`node_rename_blocked:${gateRow.blocker ?? 'unknown'}`)
      }
      const { error: updErr } = await supabase
        .from('nodes')
        .update({ name: trimmed })
        .eq('id', step.target_node_id)
      if (updErr) throw new Error(`node_rename_update_failed:${updErr.message}`)
    }

    await transitionWorkflowStep(supabase, step.id, 'job_terminal_success', 'completed', { result_summary: `${step.operation_type} executed` })

    // Trigger the next continuation tick.
    await advanceWorkflow(workflow.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error'
    await transitionWorkflowStep(supabase, step.id, 'job_terminal_failure', 'failed', {
        error_message: msg,
      })
    await advanceWorkflow(workflow.id)
  }
}
