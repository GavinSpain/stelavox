/**
 * POST /api/brief/proposals/approve
 *
 * V1.x-A.1 — approves a Director-proposed <brief_proposal>. Creates
 * briefs + brief_stages rows atomically via accept_brief RPC. Stage 1's
 * workflow is then created as a workflow row + workflow_steps rows, and
 * stage 1's workflow_id is updated to point at it.
 *
 * H-08: the RPC is the only write path that touches briefs / brief_stages
 * directly. Workflow creation reuses existing Phase 5b workflow tables.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { ProposeBriefInputSchema, buildBriefProposal } from '@/lib/brief/proposalBuilder'
import { acceptBrief, BriefRpcError } from '@/lib/brief/rpcWrappers'
import { advanceWorkflow } from '@/lib/director/workflow-executor'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

const ApproveRequestSchema = z.object({
  document_id: z.string().uuid(),
  proposal: ProposeBriefInputSchema,
  // V1.x-B.2.3 — when true, sets briefs.auto_approve_workflow_proposals
  // so the iteration-runner auto-approves any workflow_proposal it
  // emits during subsequent stages of this Brief. Defaults to false.
  auto_approve_workflow_proposals: z.boolean().optional(),
})

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let body: unknown
  try { body = await req.json() } catch { return apiError(400, 'invalid_json') }

  const parsed = ApproveRequestSchema.safeParse(body)
  if (!parsed.success) return apiError(400, 'invalid_body', parsed.error.message)
  if (!isUuid(parsed.data.document_id)) return apiError(400, 'invalid_uuid')

  let validated
  try {
    validated = buildBriefProposal(parsed.data.proposal)
  } catch (e: unknown) {
    return apiError(400, 'invalid_proposal', e instanceof Error ? e.message : String(e))
  }

  try {
    const result = await acceptBrief(supabase, parsed.data.document_id, validated)

    // V1.x-B.2.3 — apply auto_approve_workflow_proposals flag if requested.
    // The flag is read by lib/director/iteration-runner.ts when emitting
    // a workflow_proposal during a push-model stage trigger.
    if (parsed.data.auto_approve_workflow_proposals) {
      const service = createServiceRoleClient()
      await service
        .from('briefs')
        .update({ auto_approve_workflow_proposals: true })
        .eq('id', result.brief.id)
    }

    // After Brief + Stages created, create the workflow for stage 1 and
    // attach it via brief_stages.workflow_id. Stage 2..N have null workflow
    // until just-in-time planning kicks in.
    const firstStageInput = validated.stages.find((s) => s.order === 1)
    const firstStageRow = result.stages.find((s) => s.order === 1)
    if (firstStageInput?.workflow && firstStageRow) {
      const service = createServiceRoleClient()
      const { data: workflow, error: wfErr } = await service
        .from('workflows')
        .insert({
          organisation_id: result.brief.organisation_id,
          document_id: result.brief.document_id,
          title: firstStageInput.workflow.title,
          description: firstStageInput.workflow.description ?? null,
          impact_summary: firstStageInput.workflow.impact_summary ?? null,
          estimated_total_minutes: firstStageInput.workflow.estimated_total_minutes ?? null,
          status: 'approved',
          approved_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (wfErr) {
        return apiError(500, 'workflow_create_failed', wfErr.message)
      }

      const stepRows = firstStageInput.workflow.steps.map((step, idx) => ({
        workflow_id: workflow!.id,
        order: idx + 1,
        operation_type: step.operation_type,
        target_node_id: step.target_node_id,
        parameters: step.parameters ?? {},
        description: step.description,
        estimated_duration_seconds: step.estimated_duration_seconds,
        depends_on_step_orders: step.depends_on_step_orders ?? [],
        status: 'pending',
      }))

      const { error: stepsErr } = await service.from('workflow_steps').insert(stepRows)
      if (stepsErr) {
        return apiError(500, 'workflow_steps_create_failed', stepsErr.message)
      }

      // Attach workflow to stage 1.
      await service
        .from('brief_stages')
        .update({ workflow_id: workflow!.id })
        .eq('id', firstStageRow.id)

      // Kick off stage 1's workflow execution. advanceWorkflow promotes
      // status 'approved' → 'running' and dispatches the first batch of
      // agent_jobs (Phase 5b workflow-executor). Same pattern as
      // POST /api/director/workflows/[id]/approve.
      waitUntil(advanceWorkflow(workflow!.id))
    }

    return NextResponse.json(result)
  } catch (e: unknown) {
    if (e instanceof BriefRpcError) {
      const code = e.message.includes('another_brief_active') ? 409
        : e.message.includes('document_not_found') ? 404
        : e.message.includes('forbidden') ? 403
        : 400
      return apiError(code, e.message)
    }
    const msg = e instanceof Error ? e.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
