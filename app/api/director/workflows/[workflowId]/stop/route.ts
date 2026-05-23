/**
 * POST /api/director/workflows/[workflowId]/stop
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.10. Build T-13.6.
 *
 * Sets workflows.status='cancelled'. The continuation chain sees this
 * at the next tick and exits. Pending steps are marked 'skipped';
 * in-flight agent jobs complete (their results are retained).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import {
  apiError,
  assertConversationAuthor,
  formatWorkflowResponse,
  loadWorkflowWithSteps,
} from '@/lib/director/route-helpers'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await context.params
  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const loaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (loaded instanceof NextResponse) return loaded
  const { workflow } = loaded

  if (workflow.status === 'cancelled' || workflow.status === 'completed') {
    return apiError(
      409,
      'workflow_invalid_status',
      `Cannot stop a workflow in status ${workflow.status}.`,
    )
  }
  if (workflow.status !== 'running' && workflow.status !== 'paused') {
    return apiError(
      409,
      'workflow_invalid_status',
      `Cannot stop a workflow in status ${workflow.status}.`,
    )
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

  // Apollo Phase 3: delegate to orchestration.
  const { transitionWorkflow, transitionWorkflowStep } = await import('@/lib/orchestration')
  await transitionWorkflow(service, workflow.id, 'cancel', 'cancelled')

  // Pending steps → skipped.
  const { data: pendingSteps } = await service
    .from('workflow_steps')
    .select('id')
    .eq('workflow_id', workflow.id)
    .eq('state', 'pending')
  for (const step of pendingSteps ?? []) {
    await transitionWorkflowStep(service, step.id as string, 'stop_request_or_cascade', 'skipped')
  }

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps))
}
