// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.5 (GET /api/agent-jobs/[id])
//       stelavox_phase5_test_plan_v1_0.md TC-A-33 / TC-A-34 / TC-B-01..03
//       stelavox_phase5_build_checklist_v1_0.md T-9.1

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { createClient } from '@/lib/supabase/server'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ jobId: string }> }

// Fields surfaced to clients per §2.12 — context_snapshot is server-internal
// and excluded from the standard GET (admin tooling can request via
// `?include=snapshot`; deferred to V1.x).
const JOB_SELECT = `
  id, organisation_id, node_id, document_id, profile_id,
  operation_type, operation_class, status, triggered_by,
  tokens_input, tokens_output, tokens_cache_write, tokens_cache_read,
  model_id, provider, cost_usd,
  result_summary, result_prose, result_notes, result_metadata, result_child_nodes,
  target_node_version_at_capture,
  error_message, created_at, started_at, completed_at
`.trim()

export async function GET(_request: NextRequest, { params }: Context) {
  const { jobId } = await params
  if (!isValidUuid(jobId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const { data, error } = await supabase
    .from('agent_jobs')
    .select(JOB_SELECT)
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    console.error('[agent-jobs GET] query error', error)
    return err.internal()
  }
  if (!data) return err.notFound()

  return NextResponse.json(data)
}
