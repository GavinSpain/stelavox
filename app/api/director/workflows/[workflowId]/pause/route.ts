/**
 * POST /api/director/workflows/[workflowId]/pause
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.8. Build T-13.4.
 *
 * Sets workflows.status='paused'. The workflow executor's continuation
 * chain checks workflow.status at each tick; on 'paused' it stops
 * dispatching new batches. In-flight agent jobs complete normally.
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

  if (workflow.status === 'paused') {
    return NextResponse.json(formatWorkflowResponse(workflow, loaded.steps))
  }
  if (workflow.status !== 'running') {
    return apiError(
      409,
      'workflow_invalid_status',
      `Cannot pause a workflow in status ${workflow.status}.`,
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
  const { transitionWorkflow } = await import('@/lib/orchestration')
  await transitionWorkflow(service, workflow.id, 'step_failed_or_budget', 'paused')

  const reloaded = await loadWorkflowWithSteps(userClient, workflowId)
  if (reloaded instanceof NextResponse) return reloaded
  return NextResponse.json(formatWorkflowResponse(reloaded.workflow, reloaded.steps))
}
