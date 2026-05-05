/**
 * Shared logic for the four agent operation API routes.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §3.1–§3.4.
 * Build Checklist: T-8.
 *
 * Each operation route (expand / synthesise / refine / generate-context)
 * follows the same validation arc with operation-specific deviations.
 * This module factors the shared steps into reusable helpers:
 *
 *   - validateProfile()           — load & validate profile_id (or pick default)
 *   - checkConcurrency()          — 409 agent_job_in_progress if a pending/running job exists
 *   - createJobAndDispatch()      — INSERT agent_jobs, fire runner via waitUntil, return 202
 *
 * The route itself does the operation-specific node-category check and
 * field-level validation before calling these helpers.
 */

import 'server-only'

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { runAgentJob } from '@/lib/agent/runner'
import { err } from '@/lib/api/errors'
import { hasHighSeverityMatch, logScanMatches, scanContent } from '@/lib/security/injection-scanner'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

interface Profile {
  id: string
  name: string
  operation_type: string
  node_type: string | null
  model_id: string
  max_tokens: number
}

/**
 * Resolve the agent_profiles row for an operation.
 * - If profile_id given: load and verify operation_type matches.
 * - If absent: load the system profile matching (operation_type, node_type).
 *
 * Returns NextResponse error on failure, the Profile row on success.
 */
export async function validateProfile(
  supabase: Client,
  operationType: string,
  nodeType: string,
  profileId?: string,
): Promise<Profile | NextResponse> {
  if (profileId) {
    const { data, error } = await supabase
      .from('agent_profiles')
      .select('id, name, operation_type, node_type, model_id, max_tokens')
      .eq('id', profileId)
      .maybeSingle()
    if (error || !data) return err.agentProfileNotFound()
    if (data.operation_type !== operationType) return err.profileOperationMismatch()
    return data as Profile
  }

  // Pick default — match (operation_type, node_type) exactly first;
  // fall back to (operation_type, node_type IS NULL) for the cross-type fallback.
  const { data: specific } = await supabase
    .from('agent_profiles')
    .select('id, name, operation_type, node_type, model_id, max_tokens')
    .eq('is_system_profile', true)
    .eq('operation_type', operationType)
    .eq('node_type', nodeType)
    .maybeSingle()

  if (specific) return specific as Profile

  const { data: fallback } = await supabase
    .from('agent_profiles')
    .select('id, name, operation_type, node_type, model_id, max_tokens')
    .eq('is_system_profile', true)
    .eq('operation_type', operationType)
    .is('node_type', null)
    .maybeSingle()

  if (!fallback) return err.invalidOperationForNodeType()
  return fallback as Profile
}

/**
 * Check if the target node already has a pending or running job.
 * Returns NextResponse 409 if yes; null if OK to proceed.
 */
export async function checkConcurrency(
  supabase: Client,
  nodeId: string,
): Promise<NextResponse | null> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('id, status')
    .eq('node_id', nodeId)
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle()

  if (data) return err.agentJobInProgress()
  return null
}

/**
 * Validate agent_instruction for length + injection patterns.
 * Returns NextResponse on injection block; null if OK (or empty).
 */
export function validateAgentInstruction(
  agentInstruction: string | undefined,
  nodeId: string,
): NextResponse | null {
  if (!agentInstruction || !agentInstruction.trim()) return null
  const scan = scanContent(agentInstruction)
  logScanMatches(scan, { fieldName: 'agent_instruction', nodeId })
  if (hasHighSeverityMatch(scan)) return err.injectionBlocked()
  return null
}

/**
 * Create the agent_jobs row, fire the runner via waitUntil, and return 202.
 * The dynamic context (agent_instruction, target_field, etc.) is stored on
 * context_snapshot.dynamic so the runner can read it.
 */
export async function createJobAndDispatch(args: {
  organisationId: string
  nodeId: string
  documentId: string | null
  profile: Profile
  triggeredBy: string
  targetNodeVersion: number | null
  dynamicContext: Record<string, unknown>
}): Promise<NextResponse> {
  // Use service role to insert (the API route's user-session client
  // would also work via RLS, but service-role is consistent with the
  // runner's later UPDATEs and avoids any policy-edge cases).
  const supabase = createServiceRoleClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: args.organisationId,
      node_id: args.nodeId,
      document_id: args.documentId,
      profile_id: args.profile.id,
      operation_type: args.profile.operation_type,
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: args.triggeredBy,
      target_node_version_at_capture: args.targetNodeVersion,
      context_snapshot: { dynamic: args.dynamicContext },
      created_at: now,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[agent-route] failed to insert agent_jobs', { error: error?.message })
    return err.internal()
  }

  // Fire-and-forget the runner. waitUntil keeps the function alive after
  // the response is sent so the LLM call completes.
  waitUntil(runAgentJob(data.id))

  return NextResponse.json(
    { jobId: data.id, status: 'pending', created_at: now },
    { status: 202, headers: { Location: `/api/agent-jobs/${data.id}` } },
  )
}
