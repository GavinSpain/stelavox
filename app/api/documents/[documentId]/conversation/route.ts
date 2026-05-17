/**
 * GET /api/documents/[documentId]/conversation
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.3.
 * Build Checklist: T-12.3.
 *
 * UI mounting endpoint: when the author opens Director Mode, the panel
 * needs the conversation row + recent 20 messages + current workflow
 * (with steps). Returns all three in one round-trip; creates an empty
 * conversation if absent.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, formatWorkflowResponse, isUuid, type WorkflowRow, type WorkflowStepRow } from '@/lib/director/route-helpers'
import { getOrCreateConversation } from '@/lib/director/conversation-context'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params
  if (!isUuid(documentId)) return apiError(400, 'invalid_uuid')

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // RLS-guarded document lookup gives us org membership for free.
  const { data: doc } = await userClient
    .from('documents')
    .select('id, organisation_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return apiError(404, 'document_not_found')

  const service = createServiceRoleClient()

  // Resolve-or-create conversation (idempotent due to UNIQUE on document_id).
  const conv = await getOrCreateConversation(
    service,
    doc.organisation_id,
    documentId,
  )

  // Recent 20 messages (oldest first within the page).
  const { data: messages } = await service
    .from('conversation_messages')
    .select(
      'id, role, content, sequence, tool_calls, workflow_id, turn_state, event_type, event_payload, cause, created_at, tokens_input, tokens_output, cost_usd',
    )
    .eq('conversation_id', conv.id)
    .eq('turn_state', 'final')
    .order('sequence', { ascending: false })
    .limit(20)

  const recentMessages = (messages ?? []).slice().reverse()

  // Current active workflow (latest non-terminal).
  const { data: activeWf } = await service
    .from('workflows')
    .select(
      'id, organisation_id, document_id, conversation_id, title, description, impact_summary, status, estimated_total_minutes, locked_nodes_requiring_unlock, error_message, created_at, approved_at, completed_at, updated_at, last_heartbeat_at',
    )
    .eq('document_id', documentId)
    .eq('conversation_id', conv.id)
    .in('status', ['draft', 'approved', 'running', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let currentWorkflow: ReturnType<typeof formatWorkflowResponse>['workflow'] | null = null
  if (activeWf) {
    const { data: steps } = await service
      .from('workflow_steps')
      .select(
        'id, workflow_id, "order", operation_type, target_node_id, parameters, description, estimated_duration_seconds, depends_on_step_orders, status, agent_job_id, result_summary, error_message, started_at, completed_at',
      )
      .eq('workflow_id', activeWf.id)
      .order('order')
    const formatted = formatWorkflowResponse(
      activeWf as unknown as WorkflowRow,
      (steps as unknown as WorkflowStepRow[] | null) ?? [],
    )
    currentWorkflow = formatted.workflow
  }

  // Look up an interrupted turn (Phase 5b I-12 — surfaces the Resume button).
  const { data: interrupted } = await service
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conv.id)
    .eq('turn_state', 'interrupted')
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    conversation: {
      id: conv.id,
      document_id: conv.document_id,
      conversation_summary: conv.conversation_summary,
      summary_covers_through: conv.summary_covers_through,
    },
    recent_messages: recentMessages,
    current_workflow: currentWorkflow,
    interrupted_message_id: interrupted?.id ?? null,
  })
}
