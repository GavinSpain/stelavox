/**
 * POST /api/director/workflows/[workflowId]/approve
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.6.
 * Build Checklist: T-13.2.
 *
 * Transitions workflow draft → approved → running. Optional per-step
 * deselection (approved_step_orders) and parameter overrides
 * (step_parameter_overrides). Author-of-conversation gated (G-2).
 * Locked-node check before commit (I-6).
 *
 * Idempotent on already-approved (returns 200 with the workflow body).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { ApproveRequestSchema } from '@/lib/director/schemas'
import {
  apiError,
  assertConversationAuthor,
  formatWorkflowResponse,
  loadWorkflowWithSteps,
} from '@/lib/director/route-helpers'
import { advanceWorkflow } from '@/lib/director/workflow-executor'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await context.params

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // 1. Load + visibility check.
  const loaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (loaded instanceof NextResponse) return loaded
  const { workflow, steps } = loaded

  // 2. Idempotent on already-approved (return 200 with body).
  if (
    workflow.status === 'approved' ||
    workflow.status === 'running' ||
    workflow.status === 'paused'
  ) {
    if (workflow.status === 'approved') {
      return NextResponse.json(formatWorkflowResponse(workflow, steps))
    }
    return apiError(409, 'workflow_invalid_status', `Workflow is ${workflow.status}.`)
  }
  if (workflow.status !== 'draft') {
    return apiError(409, 'workflow_invalid_status', `Workflow is ${workflow.status}.`)
  }

  // 3. Author-of-conversation gate.
  if (workflow.conversation_id) {
    const service = createServiceRoleClient()
    const denial = await assertConversationAuthor(
      service,
      workflow.conversation_id,
      user.id,
    )
    if (denial) return denial
  }

  // 4. Body parse + validate.
  let body: unknown = {}
  if (req.headers.get('content-length') !== '0') {
    try {
      body = await req.json()
    } catch {
      return apiError(400, 'invalid_json')
    }
  }
  const parsed = ApproveRequestSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'validation_failed', parsed.error.message)
  }
  const { approved_step_orders, step_parameter_overrides } = parsed.data

  // 5. Validate approved_step_orders subset.
  if (approved_step_orders) {
    const stepOrders = new Set(steps.map((s) => s.order))
    const unknown = approved_step_orders.filter((o) => !stepOrders.has(o))
    if (unknown.length > 0) {
      return apiError(400, 'unknown_step_orders', `Unknown step orders: ${unknown.join(',')}`)
    }
  }

  // 6. Locked-node check on the steps that will execute.
  const service = createServiceRoleClient()
  const stepsToExecute = approved_step_orders
    ? steps.filter((s) => approved_step_orders.includes(s.order))
    : steps.filter((s) => s.status === 'pending')

  const targetIds = stepsToExecute
    .map((s) => s.target_node_id)
    .filter((id): id is string => typeof id === 'string')
  if (targetIds.length > 0) {
    const { data: lockedNodes } = await service
      .from('nodes')
      .select('id')
      .in('id', targetIds)
      .eq('locked', true)
    const lockedIds = (lockedNodes ?? []).map((n) => n.id)
    if (lockedIds.length > 0) {
      return apiError(
        423,
        'workflow_locked_nodes',
        'One or more steps target locked nodes.',
        { locked_node_ids: lockedIds },
      )
    }
  }

  // 7. Atomic-ish transaction: deselect + overrides + status update.
  // (Not actually transactional across multiple supabase calls — V1
  // accepts the small race window since the workflow is single-author.)
  if (approved_step_orders) {
    // Mark steps NOT in the approved list as 'removed'.
    const ordersToRemove = steps
      .filter(
        (s) =>
          !approved_step_orders.includes(s.order) &&
          (s.status === 'pending' || s.status === 'removed'),
      )
      .map((s) => s.id)
    // Apollo Phase 3: per-step transitions via orchestration. Only
    // pending → removed is legal (already-removed is no-op).
    const { transitionWorkflowStep } = await import('@/lib/orchestration')
    for (const stepId of ordersToRemove) {
      await transitionWorkflowStep(service, stepId, 'user_deselect', 'removed')
    }
  }

  if (step_parameter_overrides) {
    for (const [orderStr, overrides] of Object.entries(
      step_parameter_overrides,
    )) {
      const order = parseInt(orderStr, 10)
      const step = steps.find((s) => s.order === order)
      if (!step) continue
      const merged = {
        ...((step.parameters ?? {}) as Record<string, unknown>),
        ...overrides,
      }
      await service
        .from('workflow_steps')
        .update({ parameters: merged })
        .eq('id', step.id)
    }
  }

  // 8. Update workflow status + approved_at + heartbeat. Apollo Phase 3:
  // delegate to orchestration. The DB trigger refuses if workflow isn't
  // in 'draft' (the CAS we had explicit in code is now enforced).
  {
    const { transitionWorkflow } = await import('@/lib/orchestration')
    await transitionWorkflow(service, workflow.id, 'approve_workflow', 'approved', {
      last_heartbeat_at: new Date().toISOString(),
    })
  }

  // 9. Kick off the workflow executor (continuation chain) via waitUntil.
  // advanceWorkflow promotes 'approved' → 'running' on the first batch.
  waitUntil(advanceWorkflow(workflow.id))

  // 10. Reload + return.
  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded

  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps), {
    status: 202,
  })
}
