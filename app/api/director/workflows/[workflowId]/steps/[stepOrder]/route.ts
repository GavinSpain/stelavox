/**
 * PATCH /api/director/workflows/[workflowId]/steps/[stepOrder]
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.11. Build T-13.7.
 *
 * Per-step edit on a draft workflow. Three operations:
 *   - Deselect a pending step:    { status: "removed" }
 *   - Re-select a removed step:   { status: "pending" }
 *   - Edit step parameters:       { parameters: { ... } }    (merged)
 *   - Edit step description:      { description: "..." }
 *
 * Workflow status MUST be 'draft' (the PlanCard pre-approval gate).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { StepPatchRequestSchema } from '@/lib/director/schemas'
import {
  apiError,
  assertConversationAuthor,
  formatWorkflowResponse,
  loadWorkflowWithSteps,
} from '@/lib/director/route-helpers'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workflowId: string; stepOrder: string }> },
): Promise<Response> {
  const { workflowId, stepOrder: stepOrderRaw } = await context.params
  const stepOrder = parseInt(stepOrderRaw, 10)
  if (Number.isNaN(stepOrder) || stepOrder < 1) {
    return apiError(400, 'invalid_step_order')
  }

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const loaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (loaded instanceof NextResponse) return loaded
  const { workflow, steps } = loaded

  if (workflow.status !== 'draft') {
    return apiError(
      409,
      'workflow_step_invalid_status',
      `Cannot patch steps on a workflow in status ${workflow.status}.`,
    )
  }

  const step = steps.find((s) => s.order === stepOrder)
  if (!step) return apiError(404, 'workflow_step_not_found')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError(400, 'invalid_json')
  }
  const parsed = StepPatchRequestSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'validation_failed', parsed.error.message)
  }

  const service = createServiceRoleClient()
  if (workflow.conversation_id) {
    const denial = await assertConversationAuthor(
      service,
      workflow.conversation_id,
      user.id,
    )
    if (denial) return denial
  }

  // Build the UPDATE payload.
  const update: Record<string, unknown> = {}
  if (parsed.data.status !== undefined) {
    if (
      step.status !== 'pending' &&
      step.status !== 'removed' &&
      parsed.data.status === 'pending'
    ) {
      // Cannot un-remove a step that's been completed/failed/etc.
      return apiError(
        409,
        'workflow_step_invalid_status',
        `Step is in status ${step.status} and cannot be re-set to pending.`,
      )
    }
    update.status = parsed.data.status
  }
  if (parsed.data.parameters !== undefined) {
    const merged = {
      ...((step.parameters ?? {}) as Record<string, unknown>),
      ...parsed.data.parameters,
    }
    update.parameters = merged
  }
  if (parsed.data.description !== undefined) {
    update.description = parsed.data.description
  }

  if (Object.keys(update).length > 0) {
    await service.from('workflow_steps').update(update).eq('id', step.id)
  }

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps))
}
