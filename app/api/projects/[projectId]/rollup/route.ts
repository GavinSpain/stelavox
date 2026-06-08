// Phase 8.5b B.1 — Project rollup endpoint.
//
// GET /api/projects/[projectId]/rollup
// Returns one ProjectRollup row computed by the Postgres RPC
// `get_project_rollup` (M-212). Used (eventually) by the dashboard
// ProjectCard via TanStack Query in B.3. For B.1 the dashboard reads
// from this RPC via getProjectAggregates (which is rewritten to call
// the rollup wrapper directly, not the API route — that path is for
// future per-card refresh and for browser-side consumers).
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §2.4
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 work item 7
//       lib/queries/rollups.ts

import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { getProjectRollup } from '@/lib/queries/rollups'

interface Context {
  params: Promise<{ projectId: string }>
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { projectId } = await params
    if (!isValidUuid(projectId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const rollup = await getProjectRollup(supabase, projectId)
    return NextResponse.json(rollup)
  } catch {
    return err.internal()
  }
}
