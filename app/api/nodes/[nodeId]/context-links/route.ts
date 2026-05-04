// Spec: stelavox_phase4_api_contract_v1_0.md §3.3 (POST), §3.5 (GET),
//                                            §2.11 invariants 4–10,
//                                            §2.13 (link object),
//                                            §2.14 (list shape).
//       stelavox_phase4_test_plan_v1_0.md TC-A-15..TC-A-22, TC-A-26..TC-A-30
//       stelavox_phase4_build_checklist_v1_0.md §3.3 T-3.3
//
// Two handlers for /api/nodes/[nodeId]/context-links:
//   POST — link [nodeId] (structural) to a context node (§3.3)
//   GET  — list direct + ancestor-inherited context links (§3.5)
//
// The route is responsible for the closest-ancestor + direct-supersedes
// dedupe per §2.11 invariants 9–10. The data-layer wrappers in
// lib/data/context-links.ts return raw rows tagged with depth.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { contextLinkPostSchema } from '@/lib/validation/context-links'
import { getNode, decorateWithLeaf } from '@/lib/data/nodes'
import {
  createContextLink, findExistingLink,
  listDirectLinks, listAncestorLinksForNode,
} from '@/lib/data/context-links'

interface Context { params: Promise<{ nodeId: string }> }

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

// Walk parent_id chain upward from `startId`. Returns true if any node
// in the chain has locked = TRUE. Same shape as the helpers in
// app/api/nodes/[nodeId]/route.ts and app/api/documents/[id]/nodes/route.ts.
async function ancestorChainLocked(
  supabase: SupabaseRouteClient,
  startId: string | null,
): Promise<boolean> {
  let currentId: string | null = startId
  let hops = 0
  while (currentId !== null) {
    if (++hops > 10) return false  // cycle guard (Migration 021 prevents)
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

// ─── POST ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = contextLinkPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      return err.invalidUuid()
    }
    const targetId = parsed.data.context_node_id

    // Step 5: source exists, visible.
    const { data: source } = await getNode(supabase, nodeId)
    if (!source) return err.notFound()

    // Step 6: source is structural (V1 forbids context-to-context links).
    if (source.node_category !== 'structural') return err.invalidLinkSource()

    // Step 7: target exists, visible.
    const { data: target } = await getNode(supabase, targetId)
    if (!target) return err.contextNodeNotFound()

    // Step 8: target is context.
    if (target.node_category !== 'context') return err.invalidLinkTarget()

    // Step 9: same project.
    if (source.project_id !== target.project_id) return err.linkCrossProject()

    // Step 10: if target is document-scoped, source must be in the same document.
    if (target.scope === 'document' && target.document_id !== source.document_id) {
      return err.linkCrossDocument()
    }

    // Step 11: lock checks.
    if (source.locked) return err.nodeLocked()
    if (await ancestorChainLocked(supabase, source.parent_id)) return err.parentLocked()

    // Step 12: insert.
    const { data: link, error: insertError } = await createContextLink(
      supabase, source.id, target.id, source.organisation_id,
    )
    if (insertError) {
      // PostgREST unique-violation comes back as code 23505 / status 409.
      // We map this to the existing-link 409 by fetching the row.
      const errObj = insertError as { code?: string; message?: string }
      if (errObj.code === '23505' || /unique/i.test(errObj.message ?? '')) {
        const { data: existing } = await findExistingLink(supabase, source.id, target.id)
        if (existing) return err.linkAlreadyExists(existing)
      }
      return err.internal()
    }
    if (!link) return err.internal()

    return NextResponse.json({ link }, { status: 201 })
  } catch {
    return err.internal()
  }
}

// ─── GET ──────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Step 3: source exists, visible, structural.
    const { data: source } = await getNode(supabase, nodeId)
    if (!source) return err.notFound()
    if (source.node_category !== 'structural') return err.invalidLinkSource()

    const [{ rows: directRows }, { rows: ancestorRows }] = await Promise.all([
      listDirectLinks(supabase, nodeId),
      listAncestorLinksForNode(supabase, nodeId),
    ])

    // Format direct entries per §2.14. Each direct row carries its target
    // already; decorate with is_leaf=false for context nodes.
    const direct = directRows
      .filter(r => r.target !== null)
      .map(r => ({
        link: {
          id:             r.id,
          source_node_id: r.source_node_id,
          target_node_id: r.target_node_id,
          link_type:      r.link_type,
          created_at:     r.created_at,
        },
        context_node: decorateWithLeaf(r.target!, null),
      }))

    // Format inherited entries per §2.14 with closest-ancestor (invariant 9)
    // and direct-supersedes-inherited (invariant 10).
    const directTargetIds = new Set(directRows.map(r => r.target_node_id))

    // Bucket by target_node_id, keeping the row whose source has the
    // greatest depth (closest ancestor wins).
    type AncRow = typeof ancestorRows[number]
    const byTarget = new Map<string, AncRow>()
    for (const r of ancestorRows) {
      // Suppress if directly linked on the requesting node.
      if (directTargetIds.has(r.link.target_node_id)) continue
      const existing = byTarget.get(r.link.target_node_id)
      if (!existing) {
        byTarget.set(r.link.target_node_id, r)
        continue
      }
      const existingDepth = existing.source.depth ?? 0
      const newDepth      = r.source.depth ?? 0
      if (newDepth > existingDepth) {
        byTarget.set(r.link.target_node_id, r)
      }
    }

    // Order: ancestor depth DESC (closest first) per §2.14.
    const inheritedRaw = Array.from(byTarget.values())
    inheritedRaw.sort((a, b) => (b.source.depth ?? 0) - (a.source.depth ?? 0))

    const inherited = inheritedRaw.map(r => ({
      link: {
        id:             r.link.id,
        source_node_id: r.link.source_node_id,
        target_node_id: r.link.target_node_id,
        link_type:      r.link.link_type,
        created_at:     r.link.created_at,
      },
      context_node: decorateWithLeaf(r.target, null),
      inherited_from: {
        id:        r.source.id,
        name:      r.source.name,
        node_type: r.source.node_type,
        depth:     r.source.depth,
      },
    }))

    return NextResponse.json({ direct, inherited })
  } catch {
    return err.internal()
  }
}
