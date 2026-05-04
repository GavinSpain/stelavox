// Spec: stelavox_phase4_api_contract_v1_0.md §3.4 (DELETE)
//       stelavox_phase4_test_plan_v1_0.md TC-A-23..TC-A-25
//       stelavox_phase4_build_checklist_v1_0.md §3.3 T-3.4
//
// DELETE /api/nodes/[nodeId]/context-links/[contextNodeId]
// Removes a single structural↔context link.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { getNode } from '@/lib/data/nodes'
import { deleteContextLink } from '@/lib/data/context-links'

interface Context {
  params: Promise<{ nodeId: string; contextNodeId: string }>
}

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

async function ancestorChainLocked(
  supabase: SupabaseRouteClient,
  startId: string | null,
): Promise<boolean> {
  let currentId: string | null = startId
  let hops = 0
  while (currentId !== null) {
    if (++hops > 10) return false
    const { data } = await supabase
      .from('nodes')
      .select('parent_id, locked')
      .eq('id', currentId)
      .maybeSingle()
    if (!data) return false
    if (data.locked) return true
    currentId = data.parent_id
  }
  return false
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId, contextNodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()
    if (!isValidUuid(contextNodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Step 3: source exists, visible.
    const { data: source } = await getNode(supabase, nodeId)
    if (!source) return err.notFound()

    // Step 4: target context node exists, visible.
    const { data: target } = await getNode(supabase, contextNodeId)
    if (!target) return err.contextNodeNotFound()

    // Step 5: lock check on source (the same lock-state guard as POST).
    if (source.locked) return err.nodeLocked()
    if (await ancestorChainLocked(supabase, source.parent_id)) return err.parentLocked()

    // Step 6: delete. 0 rows → 404 link_not_found.
    const { deletedCount, error } = await deleteContextLink(supabase, nodeId, contextNodeId)
    if (error) return err.internal()
    if (deletedCount === 0) return err.linkNotFound()

    return NextResponse.json({
      deleted: true,
      source_node_id: nodeId,
      target_node_id: contextNodeId,
    })
  } catch {
    return err.internal()
  }
}
