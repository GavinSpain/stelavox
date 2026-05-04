// Spec: stelavox_phase4_api_contract_v1_0.md §3.6 (GET back-links),
//                                            §2.15 (response shape).
//       stelavox_phase4_test_plan_v1_0.md TC-A-31
//       stelavox_phase4_build_checklist_v1_0.md §3.3 T-3.5
//
// GET /api/nodes/[nodeId]/back-links
// Returns structural nodes that link to this context node, ordered
// by document_name then depth then name (§2.15). Powers the delete-
// confirmation UI (TC-U-17).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { getNode } from '@/lib/data/nodes'
import { listBackLinks } from '@/lib/data/context-links'

interface Context { params: Promise<{ nodeId: string }> }

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Step 3: node exists, visible.
    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    // Step 4: V1 admits back-links lookup only on context nodes.
    // Calling this on a structural node is meaningless in V1 — there's
    // no equivalent "back-link from a context node" concept since links
    // are one-directional structural→context.
    if (node.node_category !== 'context') return err.invalidLinkTarget()

    const { rows, total, error } = await listBackLinks(supabase, nodeId)
    if (error) return err.internal()

    const back_links = rows.map(r => ({
      structural_node: {
        id:            r.structural.id,
        name:          r.structural.name,
        node_type:     r.structural.node_type,
        depth:         r.structural.depth,
        document_id:   r.structural.document_id,
        document_name: r.structural.document?.name ?? null,
      },
      link: r.link,
    }))

    return NextResponse.json({ back_links, total })
  } catch {
    return err.internal()
  }
}
