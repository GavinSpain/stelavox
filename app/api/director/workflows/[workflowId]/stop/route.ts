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

  await service
    .from('workflows')
    .update({ status: 'cancelled' })
    .eq('id', workflow.id)
    .in('status', ['running', 'paused'])

  // Pending steps → skipped.
  await service
    .from('workflow_steps')
    .update({ status: 'skipped' })
    .eq('workflow_id', workflow.id)
    .eq('status', 'pending')

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps))
}
