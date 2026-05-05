// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.9 (GET document agent-jobs)
//       stelavox_phase5_test_plan_v1_0.md TC-A-35..TC-A-38
//       stelavox_phase5_build_checklist_v1_0.md T-9.5

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { createClient } from '@/lib/supabase/server'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ documentId: string }> }

const VALID_STATUSES = new Set([
  'pending', 'running', 'completed', 'accepted', 'dismissed', 'cancelled', 'failed',
])

const VALID_OPERATIONS = new Set(['expand', 'synthesise', 'refine', 'generate_context'])

const JOB_SELECT = `
  id, organisation_id, node_id, document_id, profile_id,
  operation_type, operation_class, status, triggered_by,
  tokens_input, tokens_output, tokens_cache_write, tokens_cache_read,
  model_id, provider, cost_usd,
  result_summary, result_prose, result_notes, result_metadata, result_child_nodes,
  target_node_version_at_capture,
  error_message, created_at, started_at, completed_at
`.trim()

export async function GET(request: NextRequest, { params }: Context) {
  const { documentId } = await params
  if (!isValidUuid(documentId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  // Document existence + visibility (RLS handles cross-org)
  const { data: doc } = await supabase
    .from('documents').select('id').eq('id', documentId).maybeSingle()
  if (!doc) return err.documentNotFound()

  // Query parameters
  const searchParams = request.nextUrl.searchParams
  const limitRaw = searchParams.get('limit')
  const offsetRaw = searchParams.get('offset')
  const limit = limitRaw ? Math.min(parseInt(limitRaw, 10) || 50, 100) : 50
  const offset = offsetRaw ? Math.max(parseInt(offsetRaw, 10) || 0, 0) : 0
  if (limit < 1 || limit > 100 || offset < 0) return err.invalidQuery()

  const statusFilter = searchParams.getAll('status').filter((s) => VALID_STATUSES.has(s))
  const opType = searchParams.get('operation_type')
  if (opType && !VALID_OPERATIONS.has(opType)) return err.invalidQuery()
  const nodeId = searchParams.get('node_id')
  if (nodeId && !isValidUuid(nodeId)) return err.invalidQuery()
  const since = searchParams.get('since')

  // Build query
  let query = supabase
    .from('agent_jobs')
    .select(JOB_SELECT, { count: 'exact' })
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (statusFilter.length > 0) query = query.in('status', statusFilter)
  if (opType) query = query.eq('operation_type', opType)
  if (nodeId) query = query.eq('node_id', nodeId)
  if (since) query = query.gte('created_at', since)

  const { data, error, count } = await query
  if (error) {
    console.error('[document agent-jobs] query error', error)
    return err.internal()
  }

  return NextResponse.json({
    agent_jobs: data ?? [],
    total: count ?? 0,
    has_more: (offset + (data?.length ?? 0)) < (count ?? 0),
  })
}
