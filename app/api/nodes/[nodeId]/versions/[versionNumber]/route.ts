// Spec: stelavox_phase3_api_contract_v1_0.md §3.3
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.6
//
// GET /api/nodes/[nodeId]/versions/[versionNumber] — single version body.
// Two-tier 404: not_found for the node, version_not_found for the version.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { getNode } from '@/lib/data/nodes'
import { getVersion } from '@/lib/data/versions'

interface Context { params: Promise<{ nodeId: string; versionNumber: string }> }

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId, versionNumber } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    // versionNumber must be a positive integer per §3.3 step 2.
    const versionInt = Number(versionNumber)
    if (
      !Number.isInteger(versionInt) ||
      versionInt < 1 ||
      String(versionInt) !== versionNumber
    ) {
      return err.invalidVersionNumber()
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Two-step 404 (§3.3 RLS note): node-existence first.
    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    const { data: version, error: getError } = await getVersion(supabase, nodeId, versionInt)
    if (getError) return err.internal()
    if (!version) return err.versionNotFound()

    return NextResponse.json({ version })
  } catch {
    return err.internal()
  }
}
