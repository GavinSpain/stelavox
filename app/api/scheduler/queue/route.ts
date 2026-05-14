/**
 * GET /api/scheduler/queue
 *
 * V1.x-B.1.1 — paginated read of the scheduler queue for a document
 * (mandatory ?document_id=). Returns the Brief → Stage → Workflow → Step
 * tree plus standalone agent_jobs for the SchedulerPanel.
 *
 * Filterable by ?status= (pending|running|completed|accepted|cancelled|failed)
 * and ?route= (platform|byok). Pagination via ?limit (default 50, max 200)
 * and ?offset.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { getBriefQueueStateForDocument } from '@/lib/brief/getBriefState'
import { createClient } from '@/lib/supabase/server'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const VALID_STATUS = new Set([
  'pending',
  'running',
  'completed',
  'accepted',
  'dismissed',
  'cancelled',
  'failed',
])
const VALID_ROUTE = new Set(['platform', 'byok'])

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const documentId = url.searchParams.get('document_id')
  if (!documentId || !isUuid(documentId)) return apiError(400, 'invalid_document_id')

  const statusFilter = url.searchParams.get('status')
  if (statusFilter && !VALID_STATUS.has(statusFilter)) {
    return apiError(400, 'invalid_status_filter')
  }
  const routeFilter = url.searchParams.get('route')
  if (routeFilter && !VALID_ROUTE.has(routeFilter)) {
    return apiError(400, 'invalid_route_filter')
  }

  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_LIMIT) : DEFAULT_LIMIT
  const offsetRaw = Number(url.searchParams.get('offset') ?? 0)
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // RLS scoping check: ensure the caller can read this document.
  const { data: doc } = await supabase
    .from('documents')
    .select('id, organisation_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return apiError(404, 'document_not_found')

  // Brief queue state — active + queued.
  const briefState = await getBriefQueueStateForDocument(supabase, documentId)

  // Agent jobs scoped to this document with the queue extension columns.
  let jobsQuery = supabase
    .from('agent_jobs')
    .select(
      'id, organisation_id, node_id, document_id, profile_id, operation_type, status, traffic_class, execution_intent, scheduled_at, cause, route, reservation_id, created_at, started_at, completed_at',
    )
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (statusFilter) jobsQuery = jobsQuery.eq('status', statusFilter)
  if (routeFilter) jobsQuery = jobsQuery.eq('route', routeFilter)

  const { data: jobsRaw, error: jobsErr, count } = await jobsQuery
  if (jobsErr) return apiError(500, 'jobs_query_failed', jobsErr.message)

  return NextResponse.json({
    document_id: documentId,
    brief: briefState,
    jobs: jobsRaw ?? [],
    pagination: {
      limit,
      offset,
      returned: jobsRaw?.length ?? 0,
      total: count ?? null,
    },
  })
}
