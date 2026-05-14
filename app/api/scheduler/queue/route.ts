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

  // FU-1 enrichment (V1.x-B.1.1 phase close-out): for each job, attach
  // the target node's name + node_type and the workflow context (title +
  // step ordering) when the job is dispatched as part of a workflow_step.
  // The user's manual-test feedback was that multiple expand jobs
  // targeting different nodes all looked identical; this enrichment
  // disambiguates them at the API layer so SchedulerPanel can render
  // human-readable detail without per-row N+1 fetches.
  const jobs = jobsRaw ?? []
  const nodeIds = Array.from(new Set(jobs.map((j) => j.node_id).filter((x): x is string => !!x)))
  const jobIds = jobs.map((j) => j.id)

  const [nodeMap, stepMap] = await Promise.all([
    nodeIds.length > 0
      ? supabase
          .from('nodes')
          .select('id, name, node_type')
          .in('id', nodeIds)
          .then(({ data }) => new Map((data ?? []).map((n) => [n.id, { name: n.name, node_type: n.node_type }])))
      : Promise.resolve(new Map<string, { name: string; node_type: string }>()),
    jobIds.length > 0
      ? supabase
          .from('workflow_steps')
          .select('agent_job_id, workflow_id, order, workflows(title)')
          .in('agent_job_id', jobIds)
          .then(({ data }) =>
            new Map(
              (data ?? []).map((s) => {
                const workflows = s.workflows as unknown as { title: string } | null
                return [
                  s.agent_job_id as string,
                  {
                    workflow_id: s.workflow_id as string,
                    workflow_title: workflows?.title ?? null,
                    step_order: s.order as number,
                  },
                ]
              }),
            ),
          )
      : Promise.resolve(
          new Map<
            string,
            { workflow_id: string; workflow_title: string | null; step_order: number }
          >(),
        ),
  ])

  // Attach detail per row + count total steps in each workflow so the UI
  // can render "step N of M".
  const workflowIds = Array.from(new Set(Array.from(stepMap.values()).map((s) => s.workflow_id)))
  const workflowStepCounts = workflowIds.length > 0
    ? await supabase
        .from('workflow_steps')
        .select('workflow_id', { count: 'exact', head: false })
        .in('workflow_id', workflowIds)
        .then(({ data }) => {
          const counts = new Map<string, number>()
          for (const row of data ?? []) {
            const id = (row as { workflow_id: string }).workflow_id
            counts.set(id, (counts.get(id) ?? 0) + 1)
          }
          return counts
        })
    : new Map<string, number>()

  const enrichedJobs = jobs.map((j) => {
    const node = j.node_id ? nodeMap.get(j.node_id) : null
    const step = stepMap.get(j.id) ?? null
    const totalSteps = step ? workflowStepCounts.get(step.workflow_id) ?? null : null
    return {
      ...j,
      target_node_name: node?.name ?? null,
      target_node_type: node?.node_type ?? null,
      workflow_id: step?.workflow_id ?? null,
      workflow_title: step?.workflow_title ?? null,
      step_order: step?.step_order ?? null,
      step_total: totalSteps,
    }
  })

  return NextResponse.json({
    document_id: documentId,
    brief: briefState,
    jobs: enrichedJobs,
    pagination: {
      limit,
      offset,
      returned: enrichedJobs.length,
      total: count ?? null,
    },
  })
}
