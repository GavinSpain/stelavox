/**
 * POST /api/director/workflows/[workflowId]/cancel
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.7. Build T-13.3.
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

  if (workflow.status === 'cancelled') {
    return NextResponse.json(formatWorkflowResponse(workflow, loaded.steps))
  }
  if (workflow.status !== 'draft' && workflow.status !== 'approved') {
    return apiError(
      409,
      'workflow_invalid_status',
      `Cannot cancel a workflow in status ${workflow.status}. Use /stop instead.`,
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
    .in('status', ['draft', 'approved'])

  // Mark any pending steps as 'removed' for tidiness.
  await service
    .from('workflow_steps')
    .update({ status: 'removed' })
    .eq('workflow_id', workflow.id)
    .eq('status', 'pending')

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps))
}
