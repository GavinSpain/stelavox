/**
 * validateToolCall — the Director's per-tool-call security gate.
 *
 * Source: stelavox_technical_architecture_v1_9.md §4.5 (Defence 4).
 *         stelavox_phase5b_api_contract_v1_0.md §2.11 invariants I-3 / I-7.
 *         Build Checklist T-6.
 *
 * Five defences run in sequence on every tool call. First failure
 * short-circuits with the denial reason; the agentic loop turns this
 * into an error tool result that the model sees and can recover from
 * (typically: stop calling tools, give the user a plain-language
 * explanation).
 *
 *   1. Cross-organisation check — node.organisation_id must match the
 *      caller's org. Severity critical on violation.
 *   2. Cross-document check — node.document_id must match the
 *      conversation's document_id. Severity high.
 *   3. Locked-node protection — write tools rejected on nodes.locked.
 *      Read tools admitted (reading a locked node is fine; the model
 *      may want to analyse it for context).
 *   4. Injection scan on tool-call parameters — every string-valued
 *      parameter is scanned for prompt-injection patterns. High
 *      severity → reject. Medium → continue (audit only).
 *   5. Per-conversation rate limit — the count of validateToolCall
 *      passes for this conversation in the last 60s, against
 *      platform_config.agent.director_tool_call_rate_limit_per_60s
 *      (default 30). Exceeded → reject.
 *
 * Audit log entries are written to console.error with a SECURITY tag
 * per Phase 5's pattern; future audit_log table swap is non-breaking.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getConfigInt } from '@/lib/config/platform-config'
import { scanContent } from '@/lib/security/injection-scanner'
import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  isWriteTool,
  ToolInputSchemas,
  type ToolName,
} from '@/lib/director/schemas'
import type {
  DirectorSession,
  ValidationDenialReason,
  ValidationResult,
} from '@/lib/director/types'

export interface ValidateContext {
  toolName: string
  arguments: Record<string, unknown>
  session: DirectorSession
}

function audit(event: string, severity: 'critical' | 'high' | 'medium', detail: Record<string, unknown>): void {
  console.error('[SECURITY]', event, {
    severity,
    timestamp: new Date().toISOString(),
    ...detail,
  })
}

function deny(reason: ValidationDenialReason): ValidationResult {
  return { allowed: false, reason }
}

/**
 * Run all five defences. Returns { allowed: true } on pass; on failure,
 * returns the first defence to fail with its denial reason.
 */
export async function validateToolCall(ctx: ValidateContext): Promise<ValidationResult> {
  const { toolName, arguments: args, session } = ctx
  const supabase = createServiceRoleClient()

  // ---- Defence 0 (precondition) — tool name + Zod input schema -----------
  const schema = (ToolInputSchemas as Record<string, unknown>)[toolName] as
    | { safeParse: (v: unknown) => { success: boolean } }
    | undefined
  if (!schema) {
    audit('tool_call_unknown_tool', 'high', {
      tool: toolName,
      conversation: session.conversation_id,
    })
    return deny('unknown_tool')
  }

  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    audit('tool_call_invalid_parameters', 'medium', {
      tool: toolName,
      conversation: session.conversation_id,
    })
    return deny('invalid_parameters')
  }

  // ---- Defences 1, 2, 3 — target_node_id checks if present ---------------
  const targetNodeId = (args as { target_node_id?: string; node_id?: string })
    .target_node_id ??
    (args as { node_id?: string }).node_id
  // Tools that don't have a target_node_id (get_document_state,
  // get_conversation_history, get_workflow_history) skip these defences.

  if (typeof targetNodeId === 'string' && targetNodeId.length > 0) {
    const denial = await checkNodeScope(
      supabase,
      targetNodeId,
      toolName,
      session,
    )
    if (denial) return denial
  }

  // For node_reorder, also check the destination parent_id.
  const newParent = (args as { parent_id?: string }).parent_id
  if (typeof newParent === 'string' && newParent.length > 0) {
    const denial = await checkNodeScope(
      supabase,
      newParent,
      toolName,
      session,
      /* isWriteTarget */ false,
    )
    if (denial) return denial
  }

  // ---- Defence 4 — injection scan on string-valued parameters ------------
  const injectionDenial = scanForInjection(args, toolName, session)
  if (injectionDenial) return injectionDenial

  // ---- Defence 5 — per-conversation rate limit ---------------------------
  const rateDenial = await checkToolCallRateLimit(supabase, session)
  if (rateDenial) return rateDenial

  return { allowed: true }
}

async function checkNodeScope(
  supabase: SupabaseClient,
  nodeId: string,
  toolName: string,
  session: DirectorSession,
  isWriteTarget = true,
): Promise<ValidationResult | null> {
  const { data: node } = await supabase
    .from('nodes')
    .select('id, organisation_id, document_id, locked')
    .eq('id', nodeId)
    .maybeSingle()

  if (!node) {
    // Non-existent node — treat as cross-org (the model fabricated a UUID).
    audit('tool_call_unknown_node', 'high', {
      tool: toolName,
      node_id: nodeId,
      conversation: session.conversation_id,
    })
    return deny('cross_org_access_denied')
  }

  if (node.organisation_id !== session.organisation_id) {
    audit('tool_call_cross_org_attempt', 'critical', {
      tool: toolName,
      node_id: nodeId,
      caller_org: session.organisation_id,
      target_org: node.organisation_id,
      conversation: session.conversation_id,
    })
    return deny('cross_org_access_denied')
  }

  if (node.document_id !== session.document_id) {
    audit('tool_call_cross_document_attempt', 'high', {
      tool: toolName,
      node_id: nodeId,
      caller_document: session.document_id,
      target_document: node.document_id,
      conversation: session.conversation_id,
    })
    return deny('cross_document_access_denied')
  }

  if (node.locked && isWriteTool(toolName as ToolName) && isWriteTarget) {
    // Write tool targeting a locked node — denied. Comments are an
    // exception (admitted on locked nodes); checked at the executor layer.
    if (toolName !== 'create_comment_step') {
      audit('tool_call_locked_node', 'medium', {
        tool: toolName,
        node_id: nodeId,
        conversation: session.conversation_id,
      })
      return deny('node_locked')
    }
  }

  return null
}

function scanForInjection(
  args: Record<string, unknown>,
  toolName: string,
  session: DirectorSession,
): ValidationResult | null {
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string') continue
    if (value.length === 0) continue
    const result = scanContent(value)
    if (!result.clean) {
      const high = result.matches.find((m) => m.severity === 'high')
      if (high) {
        audit('tool_call_injection_in_params', 'high', {
          tool: toolName,
          parameter: key,
          pattern: high.pattern,
          conversation: session.conversation_id,
        })
        return deny('injection_pattern_in_parameters')
      }
      // Medium-severity matches log but don't reject (TA §4.3).
      audit('tool_call_injection_medium', 'medium', {
        tool: toolName,
        parameter: key,
        matches: result.matches.length,
        conversation: session.conversation_id,
      })
    }
  }
  return null
}

async function checkToolCallRateLimit(
  supabase: SupabaseClient,
  session: DirectorSession,
): Promise<ValidationResult | null> {
  const limit = await getConfigInt('agent.director_tool_call_rate_limit_per_60s')
  // B5.6a (round-3 audit): window length config-ified per H-12. The
  // F-74 finding flagged the 60_000ms hardcode; the broader F-74 fix
  // (rate-limit subsystem redesign — fail-open vs throttle, per-user
  // and global layers, workflow-pacing) is deferred to the Director
  // architecture deep review (project_director_architecture_review.md).
  const windowMs = await getConfigInt('agent.director_tool_call_rate_limit_window_ms')

  // Count tool_calls in conversation_messages in the configured window.
  // Tool calls are stored as JSONB array on assistant messages with their
  // own executed_at timestamps. We sum array lengths over recent messages.
  const cutoff = new Date(Date.now() - windowMs).toISOString()
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('tool_calls')
    .eq('conversation_id', session.conversation_id)
    .gte('created_at', cutoff)

  if (error) {
    // Fail-open: if the rate-limit query errors, allow the call but log.
    // A persistent rate-limit-counter failure would noisily surface in logs.
    audit('tool_call_rate_limit_query_failed', 'medium', {
      reason: error.message,
      conversation: session.conversation_id,
    })
    return null
  }

  let count = 0
  for (const row of data ?? []) {
    const calls = (row as { tool_calls: unknown }).tool_calls
    if (Array.isArray(calls)) count += calls.length
  }

  if (count >= limit) {
    audit('tool_call_rate_exceeded', 'medium', {
      count,
      limit,
      conversation: session.conversation_id,
    })
    return deny('tool_rate_limit_exceeded')
  }

  return null
}
