// Spec: stelavox_phase3_api_contract_v1_0.md §3.2
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.5
//
// GET /api/nodes/[nodeId]/versions — paginated list (newest first).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { versionsListQuerySchema } from '@/lib/validation/versions'
import { getNode } from '@/lib/data/nodes'
import { listVersions } from '@/lib/data/versions'

interface Context { params: Promise<{ nodeId: string }> }

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const url = new URL(request.url)
    const queryObject: Record<string, string> = {}
    url.searchParams.forEach((v, k) => { queryObject[k] = v })
    const parsed = versionsListQuerySchema.safeParse(queryObject)
    if (!parsed.success) return err.invalidQuery()

    const { limit, offset } = parsed.data

    // Existence check first (404 leakage avoidance — see §3.2 RLS notes).
    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    const { data: versions, count, error: listError } = await listVersions(
      supabase, nodeId, limit, offset,
    )

    // PostgREST returns 416 (PGRST103) when offset > total. That is a valid
    // "empty page beyond the end" case for clients paginating; surface it as
    // 200 with the count we already know and an empty rows array. We need a
    // separate count query because the range error short-circuits the count
    // header that Supabase normally folds into the response.
    if (listError) {
      const rangeOutOfBounds =
        listError.code === 'PGRST103' ||
        /range/i.test(listError.message ?? '')
      if (!rangeOutOfBounds) return err.internal()
      // Fetch the count so the client can still see total + has_more.
      const { count: totalCount } = await supabase
        .from('node_versions')
        .select('id', { count: 'exact', head: true })
        .eq('node_id', nodeId)
      return NextResponse.json({
        versions: [],
        total: totalCount ?? 0,
        has_more: false,
      })
    }

    const total = count ?? 0
    const rows = versions ?? []
    const hasMore = offset + rows.length < total

    return NextResponse.json({
      versions: rows,
      total,
      has_more: hasMore,
    })
  } catch {
    return err.internal()
  }
}
