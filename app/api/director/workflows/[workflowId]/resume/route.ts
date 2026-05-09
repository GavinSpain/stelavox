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

  // SU-J14-5 (round-3 drive 2026-05-09): Resume previously left failed
  // workflow_steps in their failed state, then called advanceWorkflow.
  // advanceWorkflow's first check is "any failed step → re-pause" (line
  // ~226 of workflow-executor.ts), so Resume was a visible no-op for the
  // common case of a paused-because-step-failed workflow. The author saw
  // the button do nothing.
  //
  // Reset every failed step to 'pending' (clearing its error_message and
  // agent_job_id) before re-invoking advanceWorkflow. The executor then
  // re-dispatches the step. This matches the user's mental model of
  // "Resume retries what failed."
  await service
    .from('workflow_steps')
    .update({
      status: 'pending',
      error_message: null,
      agent_job_id: null,
      started_at: null,
      completed_at: null,
    })
    .eq('workflow_id', workflow.id)
    .eq('status', 'failed')

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
