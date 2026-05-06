/**
 * GET /api/documents/[documentId]/workflows
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.14. Build T-13.8.
 *
 * Workflow history for a document. Cursor pagination. Steps NOT
 * included in the list response — only step_count. Clients fetch
 * steps on-demand via §3.5.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params
  if (!isUuid(documentId)) return apiError(400, 'invalid_uuid')

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const { data: doc } = await userClient
    .from('documents')
    .select('id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return apiError(404, 'document_not_found')

  const limit = clampInt(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10),
    1,
    50,
    20,
  )
  const cursor = req.nextUrl.searchParams.get('cursor')
  if (cursor && !isUuid(cursor)) return apiError(400, 'invalid_cursor')

  const service = createServiceRoleClient()

  let cursorCreatedAt: string | null = null
  if (cursor) {
    const { data: cursorRow } = await service
      .from('workflows')
      .select('created_at')
      .eq('id', cursor)
      .maybeSingle()
    if (!cursorRow) return apiError(400, 'invalid_cursor')
    cursorCreatedAt = cursorRow.created_at
  }

  let q = service
    .from('workflows')
    .select(
      'id, title, description, impact_summary, status, estimated_total_minutes, error_message, created_at, approved_at, completed_at',
    )
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt)

  const { data: rows, error } = await q
  if (error) return apiError(500, 'query_failed', error.message)

  const hasNext = (rows ?? []).length > limit
  const page = (rows ?? []).slice(0, limit)
  const nextCursor = hasNext ? page[page.length - 1]?.id ?? null : null

  // Per-workflow step_count via a single grouped query.
  const ids = page.map((w) => w.id)
  const stepCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: counts } = await service
      .from('workflow_steps')
      .select('workflow_id')
      .in('workflow_id', ids)
    for (const row of counts ?? []) {
      const wfid = (row as { workflow_id: string }).workflow_id
      stepCounts.set(wfid, (stepCounts.get(wfid) ?? 0) + 1)
    }
  }

  return NextResponse.json({
    workflows: page.map((w) => ({
      ...w,
      step_count: stepCounts.get(w.id) ?? 0,
    })),
    next_cursor: nextCursor,
  })
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}
