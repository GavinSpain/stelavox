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
  // Reject sentinel UUIDs that the model commonly hallucinates as
  // placeholders (all-zeros, all-fs, repeated digits). The runtime
  // surfacing here is a teaching signal — the error reason names the
  // right next move so the model doesn't have to re-derive it.
  // 2026-05-18 — added after testing showed the model passing
  // ffffffff-ffff-ffff-ffff-ffffffffffff when it should have called
  // find_node_by_name.
  if (isPlaceholderUuid(args.node_id)) {
    return {
      ok: false,
      error: 'placeholder_uuid_rejected',
      reason:
        'You passed a sentinel/placeholder UUID. Never invent a node_id. Call find_node_by_name({ query: "<name>" }) to resolve a name to an id, then call get_node with the id from THAT result.',
    }
  }

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

  // Linked context node IDs. Bug fix 2026-05-17: this previously queried
  // a non-existent `context_links` table with the wrong column names;
  // Supabase swallowed the error and returned an empty array, so
  // every get_node return claimed the node had zero context links.
  // Real table is node_context_links(source_node_id → target_node_id).
  const { data: links } = await supabase
    .from('node_context_links')
    .select('target_node_id')
    .eq('source_node_id', args.node_id)

  // Child count
  const { count: childCount } = await supabase
    .from('nodes')
    .select('*', { count: 'exact', head: true })
    .eq('parent_id', args.node_id)

  // Phase 6: locked derived from node_author_locks. Full row so callers
  // can see who locked it, when, and why — not just a boolean.
  const { data: lockRow } = await supabase
    .from('node_author_locks')
    .select('locked_by_user_id, locked_at, lock_reason')
    .eq('node_id', args.node_id)
    .maybeSingle()

  // Ancestor path. The user prompt's grounding rule cares about
  // "where am I in the tree" disambiguation — find_node_by_name
  // already returns this for name lookups; surfacing it on get_node
  // too means the Director doesn't need a second call when it
  // already has the id.
  const path = await buildAncestorPath(supabase, args.node_id, session)

  // Leaf-layer + aggregate word count (2026-05-18). Non-leaf nodes
  // have word_count_actual=0 because prose only lives at the leaf
  // layer; word_count_aggregate sums descendant actuals so the
  // Director can compare against word_count_target meaningfully.
  const leafLayerIndex = await getLeafLayerIndex(supabase, session.document_id)
  const isLeaf =
    leafLayerIndex !== null && node.layer_index === leafLayerIndex
  const { data: allNodes } = await supabase
    .from('nodes')
    .select('id, parent_id, word_count_actual, node_category')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
  const aggregateMap = buildWordCountAggregateMap(allNodes ?? [])

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
      path,
      locked: !!lockRow,
      lock_info: lockRow
        ? {
            locked_by_user_id: lockRow.locked_by_user_id,
            locked_at: lockRow.locked_at,
            lock_reason: lockRow.lock_reason,
          }
        : null,
      status: node.status,
      summary_text: extractText(node.summary),
      prose_text: extractText(node.prose),
      notes_text: extractText(node.notes),
      metadata: node.metadata,
      is_leaf: isLeaf,
      word_count_actual: node.word_count_actual,
      word_count_aggregate: aggregateMap.get(node.id) ?? node.word_count_actual ?? 0,
      word_count_target: node.word_count_target,
      linked_context_node_ids: (links ?? []).map((l) => l.target_node_id),
      child_count: childCount ?? 0,
      version: node.version,
      updated_at: node.updated_at,
      last_modified_by: node.last_modified_by,
    },
  }
}

// Build a "Book > Act > Chapter > Scene > Beat" path string by walking
// parent_id. Single document-scope fetch + client-side walk; matches
// find_node_by_name's pattern.
async function buildAncestorPath(
  supabase: ReturnType<typeof createServiceRoleClient>,
  nodeId: string,
  session: DirectorSession,
): Promise<string> {
  const { data: allNodes } = await supabase
    .from('nodes')
    .select('id, name, node_type, parent_id')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
  if (!allNodes) return ''
  const byId = new Map<string, { id: string; name: string | null; node_type: string; parent_id: string | null }>()
  for (const n of allNodes) byId.set(n.id as string, n as unknown as { id: string; name: string | null; node_type: string; parent_id: string | null })
  const parts: string[] = []
  const seen = new Set<string>()
  let cursor: string | null = nodeId
  let safety = 12
  while (cursor && !seen.has(cursor) && safety-- > 0) {
    seen.add(cursor)
    const n = byId.get(cursor)
    if (!n) break
    parts.unshift(n.name ?? `(${n.node_type})`)
    cursor = n.parent_id
  }
  return parts.join(' > ')
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

  // Leaf-layer detection + word-count aggregates over the whole document
  // (one extra query — needed because we aggregate descendants whose
  // layer_index is below the requested one).
  const leafLayerIndex = await getLeafLayerIndex(supabase, session.document_id)
  const { data: allNodes } = await supabase
    .from('nodes')
    .select('id, parent_id, word_count_actual, node_category')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
  const aggregateMap = buildWordCountAggregateMap(allNodes ?? [])

  return {
    ok: true,
    data: {
      nodes: (data ?? []).map((n) => {
        const summaryText = extractText(n.summary)
        const proseText = extractText(n.prose)
        const wcActual = (n as { word_count_actual: number | null }).word_count_actual
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
          is_leaf: leafLayerIndex !== null && n.layer_index === leafLayerIndex,
          word_count_actual: wcActual,
          word_count_aggregate: aggregateMap.get(n.id as string) ?? wcActual ?? 0,
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
  // Strip a leading `@` so the model can pass the raw @-mention text
  // (e.g. "@the ghost burns dark") without first parsing it. 2026-05-18
  // — added after testing showed the model getting confused by `@`
  // prefix and hallucinating an id instead of calling this tool.
  const q = (args.query ?? '').trim().replace(/^@/, '').trim()
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
    return {
      ok: true,
      data: { matches: [], total: 0, query: q, ambiguous: false, ambiguity_reason: null },
    }
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

  // 2026-05-18 — ambiguity signal. When the top quality bucket has
  // more than one match, the model has no quality-based way to choose
  // and should consult conversation context or ask the user. See
  // computeFindNodeAmbiguity below for the rule.
  const ambiguity = computeFindNodeAmbiguity(top.map((t) => t.rank))

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
      ambiguous: ambiguity.ambiguous,
      ambiguity_reason: ambiguity.reason,
    },
  }
}

// Pure helper for the ambiguity signal on find_node_by_name. Exported
// for layer-1 testing. Input is the rank of each returned match
// (1=exact, 2=prefix, 3=substring). Ambiguous when the top quality
// bucket has 2+ matches.
export function computeFindNodeAmbiguity(
  ranks: number[],
): { ambiguous: boolean; reason: string | null } {
  if (ranks.length < 2) return { ambiguous: false, reason: null }
  const topRank = Math.min(...ranks)
  const countAtTop = ranks.filter((r) => r === topRank).length
  if (countAtTop < 2) return { ambiguous: false, reason: null }
  const reason =
    topRank === 1
      ? 'multiple_exact_matches'
      : topRank === 2
        ? 'multiple_prefix_matches'
        : 'multiple_substring_matches'
  return { ambiguous: true, reason }
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
  is_leaf: boolean
  child_count: number
  word_count_actual: number | null
  word_count_aggregate: number
  word_count_target: number | null
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

  // Load all descendants in one batched query (cheaper than N recursive
  // calls). Now also pulls word_count_actual + word_count_target so
  // "total word count of chapter 3" and "scenes with no beats" become
  // single-tool-call answers.
  const { data: allDescendants } = await supabase
    .from('nodes')
    .select('id, name, node_type, layer_index, parent_id, "order", depth, word_count_actual, word_count_target')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .order('order')

  // Phase 6: lock state derived from node_author_locks.
  const { data: lockRows } = await supabase
    .from('node_author_locks')
    .select('node_id')
    .eq('organisation_id', session.organisation_id)
  const lockedSet = new Set((lockRows ?? []).map(r => (r as { node_id: string }).node_id))

  // Leaf-layer + aggregate map. Aggregate is computed over the full
  // document tree so even max_depth-truncated subtrees report their
  // full descendant sum.
  const leafLayerIndex = await getLeafLayerIndex(supabase, session.document_id)
  const aggregateMap = buildWordCountAggregateMap(
    (allDescendants ?? []).map((n) => ({
      id: n.id as string,
      parent_id: (n as { parent_id: string | null }).parent_id,
      word_count_actual: (n as { word_count_actual: number | null }).word_count_actual,
    })),
  )

  const byParent = new Map<string | null, typeof allDescendants>()
  for (const n of allDescendants ?? []) {
    const p = n.parent_id
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  }

  function build(nodeId: string, depth: number): TreeNode {
    const node = (allDescendants ?? []).find((n) => n.id === nodeId)!
    const directChildren = byParent.get(nodeId) ?? []
    const children =
      depth < maxDepth
        ? directChildren.map((c) => build(c.id, depth + 1))
        : []
    const wcActual = (node as { word_count_actual: number | null }).word_count_actual
    return {
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      layer_index: node.layer_index,
      locked: lockedSet.has(node.id),
      is_leaf: leafLayerIndex !== null && node.layer_index === leafLayerIndex,
      child_count: directChildren.length,
      word_count_actual: wcActual,
      word_count_aggregate: aggregateMap.get(node.id) ?? wcActual ?? 0,
      word_count_target: (node as { word_count_target: number | null }).word_count_target,
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

  // Leaf-layer detection + aggregate map — the aggregate is computed
  // over allNodes (not just the capped subtree) so a non-leaf returned
  // at the cap boundary still reports a correct descendant sum.
  const leafLayerIndex = await getLeafLayerIndex(supabase, session.document_id)
  const aggregateMap = buildWordCountAggregateMap(
    (allNodes ?? []).map((n) => ({
      id: n.id as string,
      parent_id: (n as { parent_id: string | null }).parent_id,
      word_count_actual: (n as { word_count_actual: number | null }).word_count_actual,
    })),
  )

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
        const wcActual = (n as { word_count_actual: number | null }).word_count_actual
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
          is_leaf: leafLayerIndex !== null && n.layer_index === leafLayerIndex,
          has_summary: summaryText.trim().length > 0,
          has_prose: proseText.trim().length > 0,
          summary_text: includeSummary ? summaryText : null,
          prose_text: includeProse ? proseText : null,
          word_count_actual: wcActual,
          word_count_aggregate: aggregateMap.get(n.id as string) ?? wcActual ?? 0,
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
// find_context_references — reverse lookup on node_context_links.
// ---------------------------------------------------------------------------
//
// Given a context node id, return every structural node in the document
// that references it. Closes the "where does Bracket appear?" /
// "show me all scenes that reference the World setting" gap. Authors
// think in characters and themes; without this tool the Director can't
// answer those questions at all.

export async function execFindContextReferences(
  args: { context_node_id: string; max_results?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const maxResults = Math.min(args.max_results ?? 50, 200)

  // Verify the context node exists in this org (cross-document OK because
  // context nodes can be project-scoped — document_id may be NULL).
  const { data: target } = await supabase
    .from('nodes')
    .select('id, name, node_type, node_category')
    .eq('id', args.context_node_id)
    .eq('organisation_id', session.organisation_id)
    .maybeSingle()
  if (!target) return { ok: false, error: 'node_not_found' }

  // Reverse lookup: links where target_node_id is the context node.
  const { data: links, error } = await supabase
    .from('node_context_links')
    .select('source_node_id, link_type, created_at')
    .eq('organisation_id', session.organisation_id)
    .eq('target_node_id', args.context_node_id)
    .limit(maxResults + 1)
  if (error) return { ok: false, error: 'query_failed', reason: error.message }

  const truncated = (links?.length ?? 0) > maxResults
  const capped = (links ?? []).slice(0, maxResults)
  if (capped.length === 0) {
    return { ok: true, data: { target, references: [], total: 0 } }
  }

  // Pull source-node details + ancestor path so each reference is
  // self-describing (the path is the key disambiguator).
  const sourceIds = capped.map((l) => l.source_node_id)
  const { data: sources } = await supabase
    .from('nodes')
    .select('id, name, node_type, layer_index, parent_id, document_id')
    .in('id', sourceIds)
    .eq('organisation_id', session.organisation_id)

  // For path computation, load the full node set per document. Most
  // refs probably live in one document; build the map once.
  const docIds = Array.from(new Set((sources ?? []).map((s) => s.document_id).filter((d): d is string => !!d)))
  const pathsByNodeId = new Map<string, string>()
  for (const docId of docIds) {
    const { data: docNodes } = await supabase
      .from('nodes')
      .select('id, name, node_type, parent_id')
      .eq('organisation_id', session.organisation_id)
      .eq('document_id', docId)
    if (!docNodes) continue
    const byId = new Map<string, { id: string; name: string | null; node_type: string; parent_id: string | null }>()
    for (const n of docNodes) byId.set(n.id as string, n as unknown as { id: string; name: string | null; node_type: string; parent_id: string | null })
    for (const sourceId of sourceIds) {
      if (pathsByNodeId.has(sourceId)) continue
      const parts: string[] = []
      const seen = new Set<string>()
      let cursor: string | null = sourceId
      let safety = 12
      while (cursor && !seen.has(cursor) && safety-- > 0) {
        seen.add(cursor)
        const n = byId.get(cursor)
        if (!n) break
        parts.unshift(n.name ?? `(${n.node_type})`)
        cursor = n.parent_id
      }
      if (parts.length > 0) pathsByNodeId.set(sourceId, parts.join(' > '))
    }
  }

  const sourceById = new Map<string, { id: string; name: string | null; node_type: string; layer_index: number | null }>()
  for (const s of sources ?? []) sourceById.set(s.id as string, s as unknown as { id: string; name: string | null; node_type: string; layer_index: number | null })

  return {
    ok: true,
    data: {
      target,
      references: capped.map((l) => {
        const s = sourceById.get(l.source_node_id)
        return {
          source_node_id: l.source_node_id,
          name: s?.name ?? null,
          node_type: s?.node_type ?? null,
          layer_index: s?.layer_index ?? null,
          path: pathsByNodeId.get(l.source_node_id) ?? null,
          link_type: l.link_type,
          created_at: l.created_at,
        }
      }),
      total: capped.length,
      truncated,
    },
  }
}

// ---------------------------------------------------------------------------
// get_subtree_stats — lightweight structural-summary tool.
// ---------------------------------------------------------------------------
//
// 2026-05-18. Added after testing showed the Director defaulting to
// content-heavy tools for shape questions (e.g. "which chapters in
// Act A don't have prose yet"), then misinterpreting per-node fields
// when the result truncated. The fix is progressive zoom: get shape
// first, drill into content only on the subtrees that need it.
//
// Returns a tree mirroring get_node_tree's shape but each node carries
// counts (not content):
//   is_leaf — whether this node sits at the leaf layer
//   direct_child_count — immediate children
//   leaf_descendant_count — leaves in subtree (excluding self)
//   leaf_descendants_with_prose — leaves with word_count_actual > 0
//   subtree_counts_by_layer — per-layer count + with_prose at leaf layer
//   children — recursive (capped by max_depth)
//
// Aggregates are ALWAYS computed full-depth; max_depth only controls
// whether children appear in the response. With max_depth=1 you get
// root + immediate children's stats; max_depth=null (default) returns
// the whole tree.

interface SubtreeStatsLayerEntry {
  layer_index: number
  node_type: string
  count: number
  with_prose?: number
}

interface SubtreeStatsNode {
  id: string
  name: string | null
  node_type: string
  layer_index: number | null
  is_leaf: boolean
  direct_child_count: number
  leaf_descendant_count: number
  leaf_descendants_with_prose: number
  subtree_counts_by_layer: SubtreeStatsLayerEntry[]
  children: SubtreeStatsNode[]
}

interface NodeForStats {
  id: string
  name: string | null
  node_type: string
  layer_index: number | null
  parent_id: string | null
  node_category: string | null
  word_count_actual: number | null
}

export async function execGetSubtreeStats(
  args: { root_node_id: string; max_depth?: number },
  session: DirectorSession,
): Promise<ReadToolReturn> {
  const supabase = createServiceRoleClient()
  const maxDepth = args.max_depth ?? null

  // Validate root.
  const { data: root } = await supabase
    .from('nodes')
    .select('id')
    .eq('id', args.root_node_id)
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .maybeSingle()
  if (!root) return { ok: false, error: 'node_not_found' }

  const leafLayerIndex = await getLeafLayerIndex(supabase, session.document_id)

  // Load structural nodes only (no prose/summary — this is a shape tool).
  // word_count_actual is the cheap signal for "has prose" (M-172 trigger
  // maintains it; no need to fetch the prose JSONB).
  const { data: allNodes, error } = await supabase
    .from('nodes')
    .select('id, name, node_type, layer_index, parent_id, node_category, word_count_actual')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
  if (error) return { ok: false, error: 'query_failed', reason: error.message }

  // Build parent → children index, structural only. Context nodes live
  // in their own trees and shouldn't roll up into chapter aggregates.
  const byParent = new Map<string | null, NodeForStats[]>()
  const byId = new Map<string, NodeForStats>()
  for (const n of allNodes ?? []) {
    const cat = (n.node_category as string | null) ?? 'structural'
    if (cat !== 'structural') continue
    const node: NodeForStats = {
      id: n.id as string,
      name: (n.name as string | null) ?? null,
      node_type: n.node_type as string,
      layer_index: (n.layer_index as number | null) ?? null,
      parent_id: (n.parent_id as string | null) ?? null,
      node_category: cat,
      word_count_actual: (n.word_count_actual as number | null) ?? null,
    }
    byId.set(node.id, node)
    const arr = byParent.get(node.parent_id) ?? []
    arr.push(node)
    byParent.set(node.parent_id, arr)
  }

  function isLeafNode(n: NodeForStats): boolean {
    return leafLayerIndex !== null && n.layer_index === leafLayerIndex
  }

  // Recursive build. Aggregates are computed full-depth regardless of
  // max_depth; children inclusion is the only thing max_depth controls.
  function build(nodeId: string, depth: number): SubtreeStatsNode {
    const node = byId.get(nodeId)!
    const directChildren = byParent.get(nodeId) ?? []

    // Walk all descendants to compute aggregates. Leaf counts EXCLUDE
    // self per the contract (is_leaf tells the caller if self is a
    // leaf; the counts describe what's below).
    let leafDescendantCount = 0
    let leafDescendantsWithProse = 0
    const layerMap = new Map<number, { node_type: string; count: number; with_prose: number; is_leaf: boolean }>()
    function walk(currentId: string) {
      for (const c of byParent.get(currentId) ?? []) {
        const cIsLeaf = isLeafNode(c)
        const layerKey = c.layer_index ?? -1
        const entry =
          layerMap.get(layerKey) ?? { node_type: c.node_type, count: 0, with_prose: 0, is_leaf: cIsLeaf }
        entry.count += 1
        if (cIsLeaf && (c.word_count_actual ?? 0) > 0) entry.with_prose += 1
        layerMap.set(layerKey, entry)

        if (cIsLeaf) {
          leafDescendantCount += 1
          if ((c.word_count_actual ?? 0) > 0) leafDescendantsWithProse += 1
        }
        walk(c.id)
      }
    }
    walk(nodeId)

    const subtreeCountsByLayer: SubtreeStatsLayerEntry[] = Array.from(layerMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([layer_index, v]) => ({
        layer_index,
        node_type: v.node_type,
        count: v.count,
        ...(v.is_leaf ? { with_prose: v.with_prose } : {}),
      }))

    const includeChildren = maxDepth === null || depth < maxDepth
    const childrenStats = includeChildren
      ? directChildren.map((c) => build(c.id, depth + 1))
      : []

    return {
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      layer_index: node.layer_index,
      is_leaf: isLeafNode(node),
      direct_child_count: directChildren.length,
      leaf_descendant_count: leafDescendantCount,
      leaf_descendants_with_prose: leafDescendantsWithProse,
      subtree_counts_by_layer: subtreeCountsByLayer,
      children: childrenStats,
    }
  }

  return { ok: true, data: build(args.root_node_id, 0) as unknown as Record<string, unknown> }
}

// Pure-function variant for layer-1 tests. Operates on an already-loaded
// NodeForStats list rather than hitting the DB. The leaf layer must be
// passed in.
export function buildSubtreeStats(
  rootNodeId: string,
  allNodes: NodeForStats[],
  leafLayerIndex: number | null,
  maxDepth: number | null = null,
): SubtreeStatsNode | null {
  const byParent = new Map<string | null, NodeForStats[]>()
  const byId = new Map<string, NodeForStats>()
  for (const n of allNodes) {
    if ((n.node_category ?? 'structural') !== 'structural') continue
    byId.set(n.id, n)
    const arr = byParent.get(n.parent_id) ?? []
    arr.push(n)
    byParent.set(n.parent_id, arr)
  }
  if (!byId.has(rootNodeId)) return null

  function isLeafNode(n: NodeForStats): boolean {
    return leafLayerIndex !== null && n.layer_index === leafLayerIndex
  }

  function build(nodeId: string, depth: number): SubtreeStatsNode {
    const node = byId.get(nodeId)!
    const directChildren = byParent.get(nodeId) ?? []
    let leafDescendantCount = 0
    let leafDescendantsWithProse = 0
    const layerMap = new Map<number, { node_type: string; count: number; with_prose: number; is_leaf: boolean }>()
    function walk(currentId: string) {
      for (const c of byParent.get(currentId) ?? []) {
        const cIsLeaf = isLeafNode(c)
        const layerKey = c.layer_index ?? -1
        const entry =
          layerMap.get(layerKey) ?? { node_type: c.node_type, count: 0, with_prose: 0, is_leaf: cIsLeaf }
        entry.count += 1
        if (cIsLeaf && (c.word_count_actual ?? 0) > 0) entry.with_prose += 1
        layerMap.set(layerKey, entry)
        if (cIsLeaf) {
          leafDescendantCount += 1
          if ((c.word_count_actual ?? 0) > 0) leafDescendantsWithProse += 1
        }
        walk(c.id)
      }
    }
    walk(nodeId)
    const subtreeCountsByLayer: SubtreeStatsLayerEntry[] = Array.from(layerMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([layer_index, v]) => ({
        layer_index,
        node_type: v.node_type,
        count: v.count,
        ...(v.is_leaf ? { with_prose: v.with_prose } : {}),
      }))
    const includeChildren = maxDepth === null || depth < maxDepth
    const childrenStats = includeChildren
      ? directChildren.map((c) => build(c.id, depth + 1))
      : []
    return {
      id: node.id,
      name: node.name,
      node_type: node.node_type,
      layer_index: node.layer_index,
      is_leaf: isLeafNode(node),
      direct_child_count: directChildren.length,
      leaf_descendant_count: leafDescendantCount,
      leaf_descendants_with_prose: leafDescendantsWithProse,
      subtree_counts_by_layer: subtreeCountsByLayer,
      children: childrenStats,
    }
  }
  return build(rootNodeId, 0)
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

// ---------------------------------------------------------------------------
// Placeholder-UUID detection.
// ---------------------------------------------------------------------------
//
// Catches the "model invents an id" anti-pattern at the get_node entry
// point. The model historically reaches for all-zeros or all-fs UUIDs
// when it can't find a real id; we surface a teaching error instead
// of running the query and returning generic node_not_found.

const PLACEHOLDER_UUID_PATTERNS = new Set<string>([
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '11111111-1111-1111-1111-111111111111',
])

export function isPlaceholderUuid(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  if (PLACEHOLDER_UUID_PATTERNS.has(v)) return true
  // Catch single-character repeats — any UUID whose hex chars are all
  // the same is almost certainly a placeholder.
  const hex = v.replace(/-/g, '')
  if (hex.length === 32 && /^([0-9a-f])\1{31}$/.test(hex)) return true
  return false
}

// ---------------------------------------------------------------------------
// Leaf-layer + aggregate helpers (2026-05-18, leaf-only-prose clarity fix).
// ---------------------------------------------------------------------------
//
// Prose lives only at the leaf layer (per H-15 and the leaf-only-mounting
// design). A chapter or scene has word_count_actual=0 because it has no
// direct prose of its own; the meaningful number for an author asking
// "what's the chapter 1 word count?" is the sum of descendant beat
// word counts.
//
// These helpers expose:
//   is_leaf — whether the node sits at the leaf layer of its document
//   word_count_aggregate — sum of word_count_actual over the subtree
//     rooted at the node (including the node itself; equals
//     word_count_actual for leaves).

interface NodeForAggregate {
  id: string
  parent_id: string | null
  word_count_actual: number | null
  node_category?: string | null
}

// Build an O(N) post-order aggregate map. Each node's aggregate is its
// own word_count_actual plus the sum of all descendants'. Structural
// nodes only — context-node trees are independent and shouldn't roll up
// into chapter totals.
export function buildWordCountAggregateMap(
  allNodes: NodeForAggregate[],
): Map<string, number> {
  const byParent = new Map<string | null, NodeForAggregate[]>()
  for (const n of allNodes) {
    if ((n.node_category ?? 'structural') !== 'structural') continue
    const arr = byParent.get(n.parent_id) ?? []
    arr.push(n)
    byParent.set(n.parent_id, arr)
  }

  const out = new Map<string, number>()
  const stack: Array<{ id: string; state: 'enter' | 'exit' }> = []

  // Seed with all roots (parent_id IS NULL within the structural set).
  for (const r of byParent.get(null) ?? []) {
    stack.push({ id: r.id, state: 'enter' })
  }

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.state === 'enter') {
      // Push exit marker first so we process children before summing.
      stack.push({ id: frame.id, state: 'exit' })
      for (const c of byParent.get(frame.id) ?? []) {
        stack.push({ id: c.id, state: 'enter' })
      }
    } else {
      const node = allNodes.find((n) => n.id === frame.id)
      if (!node) continue
      let sum = node.word_count_actual ?? 0
      for (const c of byParent.get(frame.id) ?? []) {
        sum += out.get(c.id) ?? 0
      }
      out.set(frame.id, sum)
    }
  }

  // Defensive fallback for any orphaned structural node (parent missing).
  for (const n of allNodes) {
    if ((n.node_category ?? 'structural') !== 'structural') continue
    if (!out.has(n.id)) out.set(n.id, n.word_count_actual ?? 0)
  }

  return out
}

// Determine the leaf-layer index for a document by reading its layer
// stack. Leaf = max(layer.index). Single round-trip; tools that already
// hold the document_id can call this once per request.
export async function getLeafLayerIndex(
  supabase: ReturnType<typeof createServiceRoleClient>,
  documentId: string,
): Promise<number | null> {
  const { data: doc } = await supabase
    .from('documents')
    .select('layer_stack_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc?.layer_stack_id) return null
  const { data: stack } = await supabase
    .from('layer_stacks')
    .select('layers')
    .eq('id', doc.layer_stack_id)
    .maybeSingle()
  const layers = stack?.layers as Array<{ index: number }> | null
  if (!layers || layers.length === 0) return null
  return Math.max(...layers.map((l) => l.index))
}

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
