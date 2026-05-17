/**
 * Director — read-tool executors.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §1 (carve-out + tool list).
 *         stelavox_technical_architecture_v1_9.md §8.3 read tools.
 * Build Checklist: T-4.
 *
 * All read tools use the service-role client (the agentic loop runs
 * server-side). Each query MUST scope to session.organisation_id and
 * session.document_id — RLS is the trust boundary at the API ingress;
 * inside the loop the service-role client is a deliberate bypass that
 * relies on these scoping clauses for cross-org / cross-document
 * protection.
 *
 * Defence in depth: lib/security/tool-validator.ts also runs cross-org
 * + cross-document checks before each call (TA §4.5 Defence 4). Any
 * read-tool result that *could* leak a foreign-org node is impossible
 * by construction — the validator checks target_node_id and the
 * executors filter by organisation_id / document_id.
 */

import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'
import type {
  DirectorSession,
  ReadToolResult,
  ToolErrorResult,
} from '@/lib/director/types'

type ReadToolReturn = ReadToolResult | ToolErrorResult

// ---------------------------------------------------------------------------
// get_project_profile (V1.x-A.1) — persistent identity of the document.
// ---------------------------------------------------------------------------

export async function execGetProjectProfile(
  _args: Record<string, unknown>,
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('profile_id, organisation_id')
    .eq('id', session.document_id)
    .maybeSingle()

  if (docErr || !doc) return { ok: false, error: 'document_not_found' }
  if (doc.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'cross_org_access_denied' }
  }
  if (!doc.profile_id) return { ok: false, error: 'profile_not_found' }

  const { getProjectProfile } = await import('@/lib/profile/getProjectProfile')
  const payload = await getProjectProfile(supabase, doc.profile_id)
  if (!payload) return { ok: false, error: 'profile_not_found' }

  return { ok: true, data: payload as unknown as Record<string, unknown> }
}

// ---------------------------------------------------------------------------
// get_brief_state (V1.x-A.1) — currently-active operation Brief, or null.
// ---------------------------------------------------------------------------

export async function execGetBriefState(
  _args: Record<string, unknown>,
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  // V1.x-B.1.1 — return {active, queue} shape. `active` is the full
  // BriefStatePayload (with stages); `queue` is the ordered list of
  // approved-but-waiting Briefs as lite shapes.
  const { getBriefQueueStateForDocument } = await import('@/lib/brief/getBriefState')
  const state = await getBriefQueueStateForDocument(supabase, session.document_id)

  return {
    ok: true,
    data: {
      active: state.active,
      queue: state.queue,
      // active_brief retained as alias for any in-flight V1.x-A.1 callers
      // that read this field directly. Safe to drop after V1.x-B.1.1
      // shipment confirms no caller depends on it.
      active_brief: state.active,
    } as Record<string, unknown>,
  }
}

// ---------------------------------------------------------------------------
// get_document_state
// ---------------------------------------------------------------------------

export async function execGetDocumentState(
  _args: Record<string, unknown>,
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('id, document_type, root_node_id, layer_stack_id, name')
    .eq('id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .maybeSingle()

  if (docErr || !doc) {
    return { ok: false, error: 'document_not_found' }
  }

  const [nodes, lockedNodes, layerStack, canonical] = await Promise.all([
    supabase
      .from('nodes')
      .select('id, node_type, node_category, layer_index')
      .eq('document_id', session.document_id)
      .eq('organisation_id', session.organisation_id),
    // Phase 6: locks moved from nodes.locked to node_author_locks.
    supabase
      .from('node_author_locks')
      .select('node_id')
      .eq('organisation_id', session.organisation_id),
    doc.layer_stack_id
      ? supabase
          .from('layer_stacks')
          .select('layers')
          .eq('id', doc.layer_stack_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // V1.x-LB B3: canonical-ordered node list used to derive progress.by_layer
    // (next un-expanded / un-synthesised canonical position per structural
    // layer). Sourced from Migration 047's nodes_canonical VIEW. The walk
    // is depth-first in canonical order, so per-layer counters tick 1, 2,
    // 3 in canonical sequence and the first node without children at each
    // layer is the authoritative batch continuation point.
    supabase
      .from('nodes_canonical')
      .select('id, name, parent_id, layer_index, prose, canonical_position')
      .eq('document_id', session.document_id)
      .eq('organisation_id', session.organisation_id)
      .order('ordinal_path'),
  ])

  const nodeRows = nodes.data ?? []
  const counts: Record<string, number> = {}
  let totalWordCount = 0
  for (const n of nodeRows) {
    const nt = n.node_type as string
    counts[nt] = (counts[nt] ?? 0) + 1
  }

  // Word-count from prose+summary text — sum tokenised approximation
  const { data: wordRows } = await supabase
    .from('nodes')
    .select('summary, prose')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
  for (const r of wordRows ?? []) {
    totalWordCount += approxWords((r as { summary: unknown; prose: unknown }).summary)
    totalWordCount += approxWords((r as { summary: unknown; prose: unknown }).prose)
  }

  return {
    ok: true,
    data: {
      document_id: session.document_id,
      document_type: doc.document_type,
      document_name: doc.name,
      root_node_id: doc.root_node_id,
      layer_stack: layerStack.data?.layers ?? null,
      node_counts_by_type: counts,
      total_node_count: nodeRows.length,
      locked_node_ids: (lockedNodes.data ?? []).map((n) => (n as { node_id: string }).node_id),
      total_word_count_approx: totalWordCount,
      progress: buildProgress(
        (canonical.data ?? []) as ProgressRow[],
        (layerStack.data?.layers ?? null) as LayerStackEntry[] | null,
      ),
    },
  }
}

// ---------------------------------------------------------------------------
// Progress ledger (B3) — per-layer batch-continuation primitive.
// ---------------------------------------------------------------------------

interface ProgressRow {
  id: string
  name: string | null
  parent_id: string | null
  layer_index: number | null
  prose: unknown
  canonical_position: number | null
}

interface LayerStackEntry {
  index?: number
  is_leaf?: boolean
}

interface LayerProgress {
  layer_index: number
  total_nodes: number
  is_leaf_layer: boolean
  nodes_with_children: number
  next_unexpanded: {
    layer_rank: number
    canonical_position: number | null
    node_id: string
    node_name: string | null
  } | null
  nodes_with_prose: number
  next_unsynthesised: {
    layer_rank: number
    canonical_position: number | null
    node_id: string
    node_name: string | null
  } | null
}

function buildProgress(
  rows: ProgressRow[],
  layerStack: LayerStackEntry[] | null,
): { by_layer: LayerProgress[] } {
  // Map layer_index → is_leaf from the layer_stack metadata (TA H-15: leaf
  // is a layer-stack property, not inferred from child count).
  const leafByIndex = new Map<number, boolean>()
  for (const layer of layerStack ?? []) {
    if (typeof layer.index === 'number' && typeof layer.is_leaf === 'boolean') {
      leafByIndex.set(layer.index, layer.is_leaf)
    }
  }

  // Child counts per parent.
  const childCountByParent = new Map<string, number>()
  for (const r of rows) {
    if (r.parent_id) {
      childCountByParent.set(r.parent_id, (childCountByParent.get(r.parent_id) ?? 0) + 1)
    }
  }

  // Walk in canonical order accumulating per-layer ledger.
  const byIndex = new Map<number, LayerProgress>()
  const layerRank = new Map<number, number>()
  for (const r of rows) {
    if (r.layer_index == null) continue // skip context nodes
    const idx = r.layer_index

    let ledger = byIndex.get(idx)
    if (!ledger) {
      ledger = {
        layer_index: idx,
        total_nodes: 0,
        is_leaf_layer: leafByIndex.get(idx) ?? false,
        nodes_with_children: 0,
        next_unexpanded: null,
        nodes_with_prose: 0,
        next_unsynthesised: null,
      }
      byIndex.set(idx, ledger)
    }

    const rank = (layerRank.get(idx) ?? 0) + 1
    layerRank.set(idx, rank)
    ledger.total_nodes += 1

    const hasChildren = (childCountByParent.get(r.id) ?? 0) > 0
    if (hasChildren) {
      ledger.nodes_with_children += 1
    } else if (!ledger.is_leaf_layer && ledger.next_unexpanded == null) {
      ledger.next_unexpanded = {
        layer_rank: rank,
        canonical_position: r.canonical_position,
        node_id: r.id,
        node_name: r.name,
      }
    }

    const hasProse = proseIsFilled(r.prose)
    if (hasProse) {
      ledger.nodes_with_prose += 1
    } else if (ledger.is_leaf_layer && ledger.next_unsynthesised == null) {
      ledger.next_unsynthesised = {
        layer_rank: rank,
        canonical_position: r.canonical_position,
        node_id: r.id,
        node_name: r.name,
      }
    }
  }

  return { by_layer: Array.from(byIndex.values()).sort((a, b) => a.layer_index - b.layer_index) }
}

function proseIsFilled(value: unknown): boolean {
  if (!value) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (typeof value === 'object') {
    return extractText(value).trim().length > 0
  }
  return false
}

// ---------------------------------------------------------------------------
// get_node
// ---------------------------------------------------------------------------

export async function execGetNode(
  args: { node_id: string },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  const { data: node, error } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', args.node_id)
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .maybeSingle()

  if (error || !node) {
    return { ok: false, error: 'node_not_found' }
  }

  // Linked context node IDs
  const { data: links } = await supabase
    .from('context_links')
    .select('context_node_id')
    .eq('structural_node_id', args.node_id)

  // Child count
  const { count: childCount } = await supabase
    .from('nodes')
    .select('*', { count: 'exact', head: true })
    .eq('parent_id', args.node_id)

  // Phase 6: locked derived from node_author_locks.
  const { data: lockRow } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('node_id', args.node_id)
    .maybeSingle()
  const isLocked = !!lockRow

  return {
    ok: true,
    data: {
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      node_category: node.node_category,
      layer_index: node.layer_index,
      depth: node.depth,
      order: node.order,
      parent_id: node.parent_id,
      locked: isLocked,
      status: node.status,
      summary_text: extractText(node.summary),
      prose_text: extractText(node.prose),
      notes_text: extractText(node.notes),
      metadata: node.metadata,
      word_count_target: node.word_count_target,
      linked_context_node_ids: (links ?? []).map((l) => l.context_node_id),
      child_count: childCount ?? 0,
      version: node.version,
    },
  }
}

// ---------------------------------------------------------------------------
// get_nodes_by_layer
// ---------------------------------------------------------------------------

export async function execGetNodesByLayer(
  args: { layer_index: number; parent_node_id?: string },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  // Source: nodes_canonical VIEW (Migration 047). Ordering by ordinal_path
  // gives canonical depth-first order across ancestors — fixes the
  // launch-test bug where "next 10 scenes" returned scattered canonical
  // positions because PostgreSQL had no cross-parent tiebreak on "order".
  // Director Architecture v2.0 §7.1.
  //
  // 2026-05-17 extension: include has_prose / has_summary / status /
  // word_count_actual / word_count_target on each row. Without these
  // flags, questions like "do all beats in chapter 1 have prose?"
  // forced the Director into one get_node call per node — observed in
  // testing as a 25-iteration walk that exhausted the iteration cap.
  // The flags are cheap (already on the row) and the Director system
  // prompt already says this tool returns summary, so adding them is
  // additive — no config bump required.
  let query = supabase
    .from('nodes_canonical')
    .select('id, name, node_type, layer_index, parent_id, "order", summary, prose, status, word_count_actual, word_count_target')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .eq('layer_index', args.layer_index)

  if (args.parent_node_id) {
    query = query.eq('parent_id', args.parent_node_id)
  }

  const { data, error } = await query.order('ordinal_path')
  if (error) {
    return { ok: false, error: 'query_failed', reason: error.message }
  }

  // Phase 6: derive `locked` from node_author_locks (nodes.locked dropped).
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map(r => (r as { node_id: string }).node_id))

  return {
    ok: true,
    data: {
      nodes: (data ?? []).map((n) => {
        const summaryText = extractText(n.summary)
        const proseText = extractText(n.prose)
        return {
          id: n.id,
          name: n.name,
          node_type: n.node_type,
          layer_index: n.layer_index,
          parent_id: n.parent_id,
          order: (n as { order: number }).order,
          locked: lockedSet.has(n.id as string),
          summary_text: summaryText,
          has_summary: summaryText.trim().length > 0,
          has_prose: proseText.trim().length > 0,
          status: (n as { status: string | null }).status,
          word_count_actual: (n as { word_count_actual: number | null }).word_count_actual,
          word_count_target: (n as { word_count_target: number | null }).word_count_target,
        }
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// find_node_by_name — case-insensitive name search across all layers.
// ---------------------------------------------------------------------------
//
// Added 2026-05-17 after user testing showed the Director hallucinating
// node ids when forced to find a user-named node without a resolved
// @-mention id. With only get_nodes_by_layer + get_node available, the
// Director had to:
//   1. Guess which layer the name lived in (scene? beat? chapter?)
//   2. List all nodes at that layer (53 rows for scenes in Shadow Protocol)
//   3. Visually pick a match — which is where Haiku hallucinated.
//
// find_node_by_name does the search server-side and returns each match
// with its FULL ancestor path so the Director can disambiguate
// definitively without having to read or hallucinate.
//
// Ranking:
//   1. Exact case-insensitive name match
//   2. Prefix match (name starts with query)
//   3. Substring match
// Capped at 20 results.

export async function execFindNodeByName(
  args: { query: string; node_type?: string; layer_index?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const q = (args.query ?? '').trim()
  if (q.length === 0) {
    return { ok: false, error: 'invalid_input', reason: 'query is required' }
  }

  // Load all candidate nodes (project-scoped — we want context nodes too).
  // For a typical document (≤200 nodes) this is one fast query.
  let query = supabase
    .from('nodes_canonical')
    .select('id, name, node_type, node_category, layer_index, parent_id, document_id, "order"')
    .eq('organisation_id', session.organisation_id)
    .or(`document_id.eq.${session.document_id},document_id.is.null`)
    .ilike('name', `%${q}%`)

  if (args.node_type) query = query.eq('node_type', args.node_type)
  if (typeof args.layer_index === 'number') query = query.eq('layer_index', args.layer_index)

  const { data: matches, error } = await query.limit(50)
  if (error) {
    return { ok: false, error: 'query_failed', reason: error.message }
  }
  if (!matches || matches.length === 0) {
    return { ok: true, data: { matches: [], total: 0, query: q } }
  }

  // Load every node in the document so we can walk parent chains for
  // path computation. Single query keeps this O(N) in document size.
  const { data: allNodes } = await supabase
    .from('nodes_canonical')
    .select('id, name, node_type, parent_id')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)

  const idMap = new Map<string, { id: string; name: string | null; node_type: string; parent_id: string | null }>()
  for (const n of allNodes ?? []) {
    idMap.set(n.id as string, n as unknown as { id: string; name: string | null; node_type: string; parent_id: string | null })
  }

  function buildPath(nodeId: string): string {
    const parts: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = nodeId
    let safety = 10
    while (cursor && !seen.has(cursor) && safety-- > 0) {
      seen.add(cursor)
      const node = idMap.get(cursor)
      if (!node) break
      const label = node.name ?? `(${node.node_type})`
      parts.unshift(label)
      cursor = node.parent_id
    }
    return parts.join(' > ')
  }

  // Rank by match quality.
  const qLower = q.toLowerCase()
  const ranked = matches.map((n) => {
    const nameLower = (n.name as string | null)?.toLowerCase() ?? ''
    let rank = 3 // substring (default)
    if (nameLower === qLower) rank = 1 // exact
    else if (nameLower.startsWith(qLower)) rank = 2 // prefix
    return { node: n, rank }
  }).sort((a, b) => a.rank - b.rank || ((a.node.name as string) ?? '').localeCompare((b.node.name as string) ?? ''))

  const top = ranked.slice(0, 20)

  // Phase 6 lock state.
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map(r => (r as { node_id: string }).node_id))

  return {
    ok: true,
    data: {
      matches: top.map(({ node }) => ({
        id: node.id,
        name: node.name,
        node_type: node.node_type,
        node_category: node.node_category,
        layer_index: node.layer_index,
        parent_id: node.parent_id,
        path: buildPath(node.id as string),
        locked: lockedSet.has(node.id as string),
      })),
      total: matches.length,
      truncated: matches.length > top.length,
      query: q,
    },
  }
}

// ---------------------------------------------------------------------------
// get_node_tree (recursive, capped)
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string
  name: string
  node_type: string
  layer_index: number | null
  locked: boolean
  children: TreeNode[]
}

export async function execGetNodeTree(
  args: { root_node_id: string; max_depth?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const maxDepth = args.max_depth ?? 5

  // Verify root belongs to caller's org/document
  const { data: root } = await supabase
    .from('nodes')
    .select('id, name, node_type, layer_index')
    .eq('id', args.root_node_id)
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .maybeSingle()

  if (!root) {
    return { ok: false, error: 'node_not_found' }
  }

  // Load all descendants in one batched query (cheaper than N recursive calls)
  const { data: allDescendants } = await supabase
    .from('nodes')
    .select('id, name, node_type, layer_index, parent_id, "order", depth')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .order('order')

  // Phase 6: lock state derived from node_author_locks.
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map(r => (r as { node_id: string }).node_id))

  const byParent = new Map<string | null, typeof allDescendants>()
  for (const n of allDescendants ?? []) {
    const p = n.parent_id
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  }

  function build(nodeId: string, depth: number): TreeNode {
    const node = (allDescendants ?? []).find((n) => n.id === nodeId)!
    const children =
      depth < maxDepth
        ? (byParent.get(nodeId) ?? []).map((c) => build(c.id, depth + 1))
        : []
    return {
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      layer_index: node.layer_index,
      locked: lockedSet.has(node.id),
      children,
    }
  }

  return { ok: true, data: { tree: build(args.root_node_id, 0) } }
}

// ---------------------------------------------------------------------------
// get_subtree_content — bulk prose / summary read across a subtree.
// ---------------------------------------------------------------------------
//
// 2026-05-17. Added after testing surfaced a 25-iteration walk where the
// Director was asked "do all beats in chapter 1 have prose?" — get_node
// is heavyweight (full body + links + child_count + version per node)
// and the model was forced to call it once per beat.
//
// get_subtree_content returns every descendant of root_node_id (plus the
// root itself) with content fields in a single call. Capped at
// max_nodes (default 50, ceiling 200) with `truncated:true` when the
// cap is hit. Use this whenever the question is "read / summarise /
// audit N nodes in a subtree".
//
// vs get_node_tree: tree returns shape only (no content). Use tree when
// you only need the hierarchy.
// vs get_node: single-node deep read with linked context, comments
// surface in future, child_count, version. Use get_node for one node.

export async function execGetSubtreeContent(
  args: {
    root_node_id: string
    max_nodes?: number
    include_prose?: boolean
    include_summary?: boolean
    layer_index?: number
  },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const maxNodes = Math.min(args.max_nodes ?? 50, 200)
  const includeProse = args.include_prose ?? true
  const includeSummary = args.include_summary ?? true

  // Verify the root belongs to the session.
  const { data: root } = await supabase
    .from('nodes')
    .select('id')
    .eq('id', args.root_node_id)
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .maybeSingle()
  if (!root) return { ok: false, error: 'node_not_found' }

  // One query for the whole document tree. Cheaper than N recursive calls;
  // mirrors get_node_tree's pattern. nodes_canonical so we get ordinal_path
  // ordering for stable traversal.
  const { data: allNodes, error } = await supabase
    .from('nodes_canonical')
    .select(
      'id, name, node_type, layer_index, parent_id, "order", depth, summary, prose, status, word_count_actual, word_count_target',
    )
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .order('ordinal_path')
  if (error) return { ok: false, error: 'query_failed', reason: error.message }

  const byParent = new Map<string | null, typeof allNodes>()
  for (const n of allNodes ?? []) {
    const p = n.parent_id as string | null
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  }

  // DFS from the root, in ordinal_path order — already sorted by the
  // query but the parent->children map preserves it.
  const subtree: NonNullable<typeof allNodes> = []
  const stack: string[] = [args.root_node_id]
  while (stack.length > 0 && subtree.length < maxNodes + 1) {
    const id = stack.shift()!
    const node = (allNodes ?? []).find((n) => n.id === id)
    if (!node) continue
    subtree.push(node)
    const children = byParent.get(id) ?? []
    // Push in reverse so the next shift hits them in canonical order.
    for (let i = children.length - 1; i >= 0; i--) {
      stack.unshift(children[i].id as string)
    }
  }

  const truncated = subtree.length > maxNodes
  const capped = subtree.slice(0, maxNodes)

  // Phase 6 lock state — one query for the document.
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map((r) => (r as { node_id: string }).node_id))

  // Optional layer_index filter applied AFTER the subtree walk so the
  // caller can still get e.g. all beats under chapter 1.
  const filtered =
    typeof args.layer_index === 'number'
      ? capped.filter((n) => n.layer_index === args.layer_index)
      : capped

  return {
    ok: true,
    data: {
      nodes: filtered.map((n) => {
        const summaryText = extractText(n.summary)
        const proseText = extractText(n.prose)
        return {
          id: n.id,
          name: n.name,
          node_type: n.node_type,
          layer_index: n.layer_index,
          parent_id: n.parent_id,
          order: (n as { order: number }).order,
          depth: (n as { depth: number | null }).depth,
          locked: lockedSet.has(n.id as string),
          status: (n as { status: string | null }).status,
          has_summary: summaryText.trim().length > 0,
          has_prose: proseText.trim().length > 0,
          summary_text: includeSummary ? summaryText : null,
          prose_text: includeProse ? proseText : null,
          word_count_actual: (n as { word_count_actual: number | null }).word_count_actual,
          word_count_target: (n as { word_count_target: number | null }).word_count_target,
        }
      }),
      total: filtered.length,
      truncated,
      max_nodes: maxNodes,
    },
  }
}

// ---------------------------------------------------------------------------
// assess_downstream_impact
// ---------------------------------------------------------------------------

export async function execAssessDownstreamImpact(
  args: { node_id: string; change_description: string },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()

  const { data: target } = await supabase
    .from('nodes')
    .select('id, document_id, organisation_id, layer_index')
    .eq('id', args.node_id)
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .maybeSingle()

  if (!target) {
    return { ok: false, error: 'node_not_found' }
  }

  // Phase 5b V1: descendants are "affected" by any change to an ancestor.
  // V2 will use semantic context-link analysis.
  const { data: tree } = await supabase
    .from('nodes')
    .select('id, name, node_type, parent_id, depth')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)

  // Phase 6: lock state derived from node_author_locks.
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map(r => (r as { node_id: string }).node_id))

  const byParent = new Map<string | null, NonNullable<typeof tree>>()
  for (const n of tree ?? []) {
    const p = n.parent_id
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  }
  const collected: { id: string; name: string; node_type: string; locked: boolean }[] = []
  function collect(parentId: string) {
    for (const c of byParent.get(parentId) ?? []) {
      collected.push({
        id: c.id, name: c.name, node_type: c.node_type,
        locked: lockedSet.has(c.id),
      })
      collect(c.id)
    }
  }
  collect(args.node_id)

  return {
    ok: true,
    data: {
      target_node_id: args.node_id,
      change_description: args.change_description,
      affected_node_ids: collected.map((c) => c.id),
      affected_nodes: collected,
      locked_node_ids_in_scope: collected.filter((c) => c.locked).map((c) => c.id),
      impact_summary: `${collected.length} descendant node(s) potentially affected. ${collected.filter((c) => c.locked).length} are locked and will not be modified.`,
    },
  }
}

// ---------------------------------------------------------------------------
// get_conversation_history
// ---------------------------------------------------------------------------

export async function execGetConversationHistory(
  args: { before_sequence?: number; limit?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const limit = Math.min(args.limit ?? 20, 50)

  let q = supabase
    .from('conversation_messages')
    .select('id, role, content, sequence, created_at')
    .eq('conversation_id', session.conversation_id)
    .order('sequence', { ascending: false })
    .limit(limit)

  if (args.before_sequence != null) {
    q = q.lt('sequence', args.before_sequence)
  }

  const { data, error } = await q
  if (error) return { ok: false, error: 'query_failed', reason: error.message }

  // Return oldest-first within the page for natural reading.
  return {
    ok: true,
    data: { messages: (data ?? []).reverse() },
  }
}

// ---------------------------------------------------------------------------
// get_workflow_history
// ---------------------------------------------------------------------------

export async function execGetWorkflowHistory(
  args: { status_filter?: string; limit?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const limit = Math.min(args.limit ?? 10, 20)

  let q = supabase
    .from('workflows')
    .select(
      'id, title, description, status, created_at, completed_at, estimated_total_minutes',
    )
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (args.status_filter) {
    q = q.eq('status', args.status_filter)
  }

  const { data, error } = await q
  if (error) return { ok: false, error: 'query_failed', reason: error.message }

  return { ok: true, data: { workflows: data ?? [] } }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxWords(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'string') {
    return value.trim().split(/\s+/).filter(Boolean).length
  }
  // Tiptap JSON — extract text nodes.
  return extractText(value).trim().split(/\s+/).filter(Boolean).length
}

function extractText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return ''
  // Walk Tiptap doc tree collecting text nodes.
  const out: string[] = []
  function walk(n: unknown): void {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; content?: unknown[] }
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(value)
  return out.join(' ')
}
