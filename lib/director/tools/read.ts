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
    supabase
      .from('nodes')
      .select('id')
      .eq('document_id', session.document_id)
      .eq('organisation_id', session.organisation_id)
      .eq('locked', true),
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
      locked_node_ids: (lockedNodes.data ?? []).map((n) => n.id),
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
      locked: node.locked,
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
  let query = supabase
    .from('nodes_canonical')
    .select('id, name, node_type, layer_index, parent_id, "order", locked, summary')
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

  return {
    ok: true,
    data: {
      nodes: (data ?? []).map((n) => ({
        id: n.id,
        name: n.name,
        node_type: n.node_type,
        layer_index: n.layer_index,
        parent_id: n.parent_id,
        order: (n as { order: number }).order,
        locked: n.locked,
        summary_text: extractText(n.summary),
      })),
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
    .select('id, name, node_type, layer_index, locked')
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
    .select('id, name, node_type, layer_index, parent_id, "order", locked, depth')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .order('order')

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
      locked: node.locked,
      children,
    }
  }

  return { ok: true, data: { tree: build(args.root_node_id, 0) } }
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
  const { data: descendants } = await supabase
    .from('nodes')
    .select('id, name, node_type, locked, layer_index, depth')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)

  const affected: typeof descendants = []
  if (descendants) {
    const visit = (parentId: string) => {
      for (const n of descendants) {
        if (n['id'] === parentId) continue
        // we don't have parent_id in the projection — re-fetch with parent_id
      }
    }
    void visit
  }

  // Simpler implementation: re-query descendants of node_id via parent_id chain.
  const { data: tree } = await supabase
    .from('nodes')
    .select('id, name, node_type, locked, parent_id, depth')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)

  const byParent = new Map<string | null, NonNullable<typeof tree>>()
  for (const n of tree ?? []) {
    const p = n.parent_id
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(n)
  }
  const collected: { id: string; name: string; node_type: string; locked: boolean }[] = []
  function collect(parentId: string) {
    for (const c of byParent.get(parentId) ?? []) {
      collected.push({ id: c.id, name: c.name, node_type: c.node_type, locked: c.locked })
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
