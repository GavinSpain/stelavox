/**
 * POST /api/director/workflows/[workflowId]/resume
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.9. Build T-13.5.
 *
 * Sets workflows.status='approved' (executor's entry state) and re-
 * invokes advanceWorkflow() via waitUntil. The continuation chain
 * picks up dispatching pending steps from where it stopped.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'

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

  if (workflow.status !== 'paused') {
    return apiError(
      409,
      'workflow_invalid_status',
      `Cannot resume a workflow in status ${workflow.status}. Only paused workflows can be resumed.`,
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
    .update({
      status: 'approved',
      error_message: null,
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('id', workflow.id)
    .eq('status', 'paused')

  waitUntil(advanceWorkflow(workflow.id))

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps), {
    status: 202,
  })
}
