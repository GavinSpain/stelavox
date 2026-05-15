/**
 * POST /api/director/turns/[turnId]/auto-approve-workflow
 *
 * V1.x-B.2.3 — when a Director turn (running on a Brief with
 * auto_approve_workflow_proposals=true) emits a workflow_proposal,
 * the iteration-runner POSTs here to immediately approve the proposed
 * workflow without user intervention.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.4.
 *
 * Flow:
 *   1. Look up the Director turn → conversation → most recent
 *      workflow_id linked to a 'draft' workflow created by this turn.
 *   2. Verify the parent Brief has auto_approve_workflow_proposals=true.
 *   3. Mark the workflow status='approved' + approved_at=now.
 *   4. Insert agent_jobs for each workflow_step at queue_status='queued'.
 *      (The dispatcher picks them up on its next tick.)
 *
 * Authorisation: this is called server-side by the iteration-runner.
 * The route accepts a CRON_AUTH_TOKEN for service-role gating, and
 * also accepts a normal user session that owns the conversation as a
 * fallback for manual UI invocation (e.g. an "approve all subsequent"
 * batch action — not exposed in the UI in B.2.3, reserved for V1.x-D).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  const { turnId } = await context.params
  if (!isUuid(turnId)) return apiError(400, 'invalid_uuid')

  // Auth: either CRON_AUTH_TOKEN (server-side caller) or user session
  // (UI fallback). The server-side path is what the iteration-runner uses.
  const expectedCronToken = process.env.CRON_AUTH_TOKEN
  const auth = req.headers.get('authorization') ?? ''
  const cronTokenMatch = expectedCronToken && auth === `Bearer ${expectedCronToken}`

  let serverSide = false
  if (cronTokenMatch) {
    serverSide = true
  } else {
    const userClient = await createClient()
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) return apiError(401, 'unauthenticated')
    // Verify user owns the conversation (RLS-gated read).
    const { data: turn } = await userClient
      .from('director_turns')
      .select('id, conversation_id')
      .eq('id', turnId)
      .maybeSingle()
    if (!turn) return apiError(404, 'turn_not_found')
  }

  // Service-role lookup for the workflow + brief context.
  const service = createServiceRoleClient()

  const { data: turn } = await service
    .from('director_turns')
    .select('id, conversation_id')
    .eq('id', turnId)
    .single()
  if (!turn) return apiError(404, 'turn_not_found')

  // Find the most recent draft workflow linked to this turn's conversation.
  // The iteration-runner persistDraftWorkflow already linked
  // conversation_messages.workflow_id; we look up via that path.
  const { data: msgWithWorkflow } = await service
    .from('conversation_messages')
    .select('workflow_id')
    .eq('conversation_id', turn.conversation_id)
    .not('workflow_id', 'is', null)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!msgWithWorkflow?.workflow_id) {
    return apiError(404, 'no_workflow_to_approve', 'no workflow_id linked to this turn')
  }

  const workflowId = msgWithWorkflow.workflow_id as string

  // Verify the parent Brief has auto-approve enabled. The workflow_id
  // links to brief_stages.workflow_id; brief_stages → briefs.
  const { data: stage } = await service
    .from('brief_stages')
    .select('brief_id, briefs!inner(auto_approve_workflow_proposals)')
    .eq('workflow_id', workflowId)
    .maybeSingle()

  if (!serverSide) {
    // For UI-invoked auto-approve, we don't strictly require the flag
    // (user is approving manually anyway). Skip the check.
  } else if (!stage) {
    return apiError(404, 'workflow_not_linked_to_brief')
  } else {
    const briefs = stage.briefs as unknown as { auto_approve_workflow_proposals: boolean } | null
    if (!briefs?.auto_approve_workflow_proposals) {
      return apiError(409, 'auto_approve_not_enabled', 'parent Brief does not have auto_approve_workflow_proposals=true')
    }
  }

  // Approve: mark workflow approved + insert agent_jobs for each step.
  // Reuses the existing workflow approval path (the user-driven Approve
  // endpoint at /api/director/workflows/[id]/approve already does this).
  const { data: workflow } = await service
    .from('workflows')
    .select('id, status, organisation_id, document_id')
    .eq('id', workflowId)
    .single()
  if (!workflow) return apiError(404, 'workflow_not_found')
  if (workflow.status !== 'draft') {
    return NextResponse.json({
      already_approved: true,
      workflow_id: workflowId,
      status: workflow.status,
    })
  }

  await service
    .from('workflows')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', workflowId)

  // Insert agent_jobs for each workflow_step.
  const { data: steps } = await service
    .from('workflow_steps')
    .select('id, "order", operation_type, target_node_id, parameters')
    .eq('workflow_id', workflowId)
    .order('order', { ascending: true })

  const insertedJobIds: string[] = []
  for (const step of steps ?? []) {
    const { data: jobRow } = await service
      .from('agent_jobs')
      .insert({
        organisation_id: workflow.organisation_id,
        document_id: workflow.document_id,
        node_id: step.target_node_id,
        operation_type: step.operation_type,
        status: 'pending',
        queue_status: 'queued',
        triggered_by: `workflow_step:${step.id}:${workflowId}`,
        traffic_class: 2,
      })
      .select('id')
      .single()
    if (jobRow) {
      insertedJobIds.push(jobRow.id)
      await service.from('workflow_steps').update({ agent_job_id: jobRow.id }).eq('id', step.id)
    }
  }

  return NextResponse.json({
    workflow_id: workflowId,
    approved: true,
    step_count: insertedJobIds.length,
    job_ids: insertedJobIds,
  })
}
