/**
 * Director — shared route helpers.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.1, §2.2 (G-2),
 *         §3 endpoint specs.
 *
 * Tiny utilities used by the 12 Director route handlers. Returns
 * NextResponse objects on the failure paths; resolves to typed values
 * on success.
 */

import 'server-only'

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createServiceRoleClient } from '@/lib/supabase/service'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

export function apiError(
  status: number,
  error: string,
  message?: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error, ...(message ? { message } : {}), ...(extra ?? {}) },
    { status },
  )
}

/**
 * Author-of-conversation gate per API Contract §2.2 / G-2.
 * The conversation's *first* user message author is the author-of-conversation.
 * Only that user may approve / cancel / modify workflows arising from it.
 *
 * Returns null on pass; NextResponse on fail.
 */
export async function assertConversationAuthor(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<NextResponse | null> {
  const { data } = await supabase
    .from('conversation_messages')
    .select('author_user_id')
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .order('sequence', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data) {
    // No user messages yet (system-initiated turns can produce this).
    // DR-102 (audit F-89) — the Phase 5b behaviour admitted ANY caller
    // here; closed 2026-06-10. Fall back to verifying the caller is a
    // member of the conversation's organisation. Callers pass the
    // service-role client, so RLS can't carry this check — it must be
    // explicit. V1 = single-user orgs, so org membership IS the author;
    // when multi-user orgs land (V2) this tightens to a role check.
    // Any lookup failure fails CLOSED (deny), consistent with DR-095.
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('organisation_id')
      .eq('id', conversationId)
      .maybeSingle()
    if (convError || !conv) {
      return apiError(403, 'not_conversation_author')
    }
    const { data: membership, error: memberError } = await supabase
      .from('organisation_members')
      .select('user_id')
      .eq('organisation_id', conv.organisation_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (memberError || !membership) {
      return apiError(403, 'not_conversation_author')
    }
    return null
  }
  if (data.author_user_id !== userId) {
    return apiError(403, 'not_conversation_author')
  }
  return null
}

/**
 * Load a workflow + its steps with org scope check via the user-session
 * client (RLS enforces visibility). On success returns workflow+steps;
 * on failure returns the appropriate error response.
 */
export async function loadWorkflowWithSteps(
  userClient: SupabaseClient,
  workflowId: string,
): Promise<NextResponse | { workflow: WorkflowRow; steps: WorkflowStepRow[] }> {
  if (!isUuid(workflowId)) {
    return apiError(400, 'invalid_uuid')
  }
  const { data: workflow } = await userClient
    .from('workflows')
    .select(
      'id, organisation_id, document_id, conversation_id, title, description, impact_summary, status, estimated_total_minutes, locked_nodes_requiring_unlock, error_message, created_at, approved_at, completed_at, updated_at, last_heartbeat_at',
    )
    .eq('id', workflowId)
    .maybeSingle()

  if (!workflow) {
    return apiError(404, 'workflow_not_found')
  }

  // Steps via service-role to avoid an RLS double-traverse for the
  // already-authorised workflow.
  const service = createServiceRoleClient()
  const { data: steps } = await service
    .from('workflow_steps')
    .select(
      'id, workflow_id, "order", operation_type, target_node_id, parameters, description, estimated_duration_seconds, depends_on_step_orders, status, agent_job_id, result_summary, error_message, started_at, completed_at',
    )
    .eq('workflow_id', workflowId)
    .order('order')

  return {
    workflow: workflow as unknown as WorkflowRow,
    steps: (steps as unknown as WorkflowStepRow[] | null) ?? [],
  }
}

export interface WorkflowRow {
  id: string
  organisation_id: string
  document_id: string
  conversation_id: string | null
  title: string
  description: string | null
  impact_summary: string | null
  status: string
  estimated_total_minutes: number | null
  locked_nodes_requiring_unlock: string[] | null
  error_message: string | null
  created_at: string
  approved_at: string | null
  completed_at: string | null
  updated_at: string
  last_heartbeat_at: string | null
}

export interface WorkflowStepRow {
  id: string
  workflow_id: string
  order: number
  operation_type: string
  target_node_id: string | null
  parameters: unknown
  description: string | null
  estimated_duration_seconds: number | null
  depends_on_step_orders: number[] | null
  status: string
  agent_job_id: string | null
  result_summary: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
}

/** Format a workflow + steps response shape per API Contract §2.14. */
export function formatWorkflowResponse(
  workflow: WorkflowRow,
  steps: WorkflowStepRow[],
): { workflow: Record<string, unknown> } {
  return {
    workflow: {
      id: workflow.id,
      document_id: workflow.document_id,
      conversation_id: workflow.conversation_id,
      title: workflow.title,
      description: workflow.description,
      impact_summary: workflow.impact_summary,
      status: workflow.status,
      estimated_total_minutes: workflow.estimated_total_minutes,
      locked_nodes_requiring_unlock: workflow.locked_nodes_requiring_unlock ?? [],
      error_message: workflow.error_message,
      created_at: workflow.created_at,
      approved_at: workflow.approved_at,
      completed_at: workflow.completed_at,
      updated_at: workflow.updated_at,
      last_heartbeat_at: workflow.last_heartbeat_at,
      steps: steps.map((s) => ({
        id: s.id,
        order: s.order,
        operation_type: s.operation_type,
        target_node_id: s.target_node_id,
        parameters: s.parameters,
        description: s.description,
        estimated_duration_seconds: s.estimated_duration_seconds,
        depends_on_step_orders: s.depends_on_step_orders ?? [],
        status: s.status,
        agent_job_id: s.agent_job_id,
        result_summary: s.result_summary,
        error_message: s.error_message,
        started_at: s.started_at,
        completed_at: s.completed_at,
      })),
    },
  }
}
