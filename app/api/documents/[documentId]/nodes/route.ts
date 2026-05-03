// Spec: stelavox_phase2_api_contract_v1_0.md §3.1 (POST), §3.2 (GET list)
//       stelavox_phase2_test_plan_v1_0.md TC-A-01 to TC-A-33
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.3 T-3.3
//
// POST creates a single structural node under a parent. GET returns the
// document's nodes as a flat depth-first array. Auth (RLS) is at the
// database layer — these handlers never filter by user_id.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { nodePostSchema } from '@/lib/validation/nodes'
import { getDocument } from '@/lib/data/documents'
import { createNode, getNode, listNodes } from '@/lib/data/nodes'

interface Context { params: Promise<{ documentId: string }> }

const VALID_CATEGORIES = new Set(['structural', 'context', 'all'])

// ─── helpers ──────────────────────────────────────────────────────────

// Depth-first sort over a flat node array. O(N) using parent_id linkage.
// Per API Contract §3.2 / TC-A-26: response order is root → A → A's
// subtree → B → B's subtree, etc. Children of each parent visited in
// `order` ascending.
function depthFirstSort<T extends { id: string; parent_id: string | null; order: number }>(
  rows: T[],
): T[] {
  const childrenByParent = new Map<string | null, T[]>()
  for (const r of rows) {
    const arr = childrenByParent.get(r.parent_id) ?? []
    arr.push(r)
    childrenByParent.set(r.parent_id, arr)
  }
  for (const arr of childrenByParent.values()) arr.sort((a, b) => a.order - b.order)

  const result: T[] = []
  function visit(parentId: string | null) {
    for (const child of childrenByParent.get(parentId) ?? []) {
      result.push(child)
      visit(child.id)
    }
  }
  visit(null)
  return result
}

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

// Walk parent_id chain upward from `startId`. Returns true if any ancestor
// has locked = TRUE, false otherwise. Phase 2 max depth is 5 so at most
// 5 round trips per call. (`startId` itself IS visited.)
async function ancestorChainLocked(
  supabase: SupabaseRouteClient,
  startId: string | null,
): Promise<boolean> {
  let currentId: string | null = startId
  while (currentId !== null) {
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

interface LayerEntry { node_type: string }

// ─── POST ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = nodePostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      const path0 = issue?.path[0]
      if (path0 === 'parent_id') {
        if (issue?.code === 'invalid_type') return err.missingParentId()
        return err.invalidUuid()
      }
      if (path0 === 'node_type')         return err.invalidNodeType()
      if (path0 === 'node_category')     return err.invalidCategory()
      if (path0 === 'name')              return err.invalidName()
      if (path0 === 'short_description') return err.invalidShortDescription()
      if (path0 === 'agent_instruction') return err.invalidAgentInstruction()
      if (path0 === 'word_count_target') return err.invalidWordCountTarget()
      if (path0 === 'summary')           return err.invalidSummary()
      if (path0 === 'prose')             return err.invalidProse()
      if (path0 === 'notes')             return err.invalidNotes()
      if (path0 === 'metadata')          return err.invalidMetadata()
      return err.invalidName()
    }

    // Document exists (and is accessible by RLS).
    const { data: doc } = await getDocument(supabase, documentId)
    if (!doc) return err.notFound('document_not_found')

    // Parent node exists, in this document, structural.
    const { data: parent } = await getNode(supabase, parsed.data.parent_id)
    if (!parent) return err.invalidParent()
    if (parent.document_id !== documentId) return err.invalidParent()
    if (parent.node_category !== 'structural') return err.invalidParent()

    // Lock-chain check on parent (and its ancestors). The parent's own
    // `locked` is included in the walk — TC-A-20 sets the parent locked.
    if (await ancestorChainLocked(supabase, parent.id)) return err.parentLocked()

    // Layer hierarchy: parent's child layer must exist (max-depth check)
    // and equal the requested node_type.
    const { data: stack } = await supabase
      .from('layer_stacks')
      .select('layers')
      .eq('document_id', documentId)
      .eq('is_template', false)
      .maybeSingle()
    if (!stack || !Array.isArray(stack.layers)) return err.internal()

    const layers = stack.layers as unknown as LayerEntry[]
    const childLayerIndex = (parent.layer_index ?? 0) + 1
    const expectedLayer = layers[childLayerIndex]
    if (!expectedLayer || typeof expectedLayer.node_type !== 'string') {
      return err.maxDepthExceeded()
    }
    if (parsed.data.node_type !== expectedLayer.node_type) return err.layerViolation()

    // Compute order = max(sibling.order) + 1, defaulting to 1 if no siblings.
    const { data: maxRow } = await supabase
      .from('nodes')
      .select('order')
      .eq('parent_id', parent.id)
      .order('order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const newOrder = (maxRow?.order ?? 0) + 1

    // Insert.
    const { data: inserted, error: insertError } = await createNode(supabase, {
      organisation_id:   parent.organisation_id,
      document_id:       documentId,
      project_id:        parent.project_id,
      parent_id:         parent.id,
      node_type:         parsed.data.node_type,
      node_category:     parsed.data.node_category ?? 'structural',
      order:             newOrder,
      depth:             (parent.depth ?? 0) + 1,
      layer_index:       childLayerIndex,
      name:              parsed.data.name ?? null,
      short_description: parsed.data.short_description ?? null,
      agent_instruction: parsed.data.agent_instruction ?? null,
      word_count_target: parsed.data.word_count_target ?? null,
      summary:           parsed.data.summary ?? null,
      prose:             parsed.data.prose ?? null,
      notes:             parsed.data.notes ?? null,
      metadata:          (parsed.data.metadata ?? {}) as never,
      status:            'draft',
      version:           1,
    })
    if (insertError || !inserted) return err.internal()

    return NextResponse.json({ node: inserted }, { status: 201 })
  } catch {
    return err.internal()
  }
}

// ─── GET ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { documentId } = await params
    if (!isValidUuid(documentId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { searchParams } = new URL(request.url)
    for (const key of searchParams.keys()) {
      if (key !== 'category') return err.unknownParam()
    }
    const categoryParam = searchParams.get('category') ?? 'structural'
    if (!VALID_CATEGORIES.has(categoryParam)) return err.unknownParam()

    const { data: doc } = await getDocument(supabase, documentId)
    if (!doc) return err.notFound('document_not_found')

    const { data, error } = await listNodes(
      supabase,
      documentId,
      categoryParam as 'structural' | 'context' | 'all',
    )
    if (error) return err.internal()

    const sorted = depthFirstSort(data ?? [])
    return NextResponse.json({ nodes: sorted })
  } catch {
    return err.internal()
  }
}
