// Spec: stelavox_phase4_api_contract_v1_0.md §3.3 (POST link),
//                                            §3.4 (DELETE link),
//                                            §3.5 (GET links),
//                                            §3.6 (GET back-links),
//                                            §2.13 (link object shape),
//                                            §2.14 (list shape — direct + inherited),
//                                            §2.15 (back-links shape).
//       stelavox_phase4_build_checklist_v1_0.md §3.2 T-2.3
//
// Thin Supabase wrappers for the Phase 4 link API. Mirrors lib/data/nodes.ts
// style (typed via Database['public']['Tables']['node_context_links'], no
// user_id filter — RLS does that at the database layer per Migration 005's
// `org_members_access_context_links` policy).

import type {
  PostgrestMaybeSingleResponse,
  PostgrestSingleResponse,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client      = SupabaseClient<Database>
type LinkRow     = Database['public']['Tables']['node_context_links']['Row']
type LinkInsert  = Database['public']['Tables']['node_context_links']['Insert']
type NodeRow     = Database['public']['Tables']['nodes']['Row']
type DocumentRow = Database['public']['Tables']['documents']['Row']

// §2.13: returned fields for a link object. Excludes organisation_id
// (server-internal RLS gate, not interesting to clients).
const LINK_SELECT = [
  'id', 'source_node_id', 'target_node_id', 'link_type', 'created_at',
].join(', ')

// ─── createContextLink ───────────────────────────────────────────────────

// INSERT a structural→context link. Returns the inserted row.
//
// On UNIQUE constraint violation the wrapper returns the PostgREST error
// (code '23505') in the `error` field, NOT data:null — UNIQUE violation
// is an error, not a zero-row return, regardless of whether the terminal
// is .single() or .maybeSingle(). The route catches the 23505 error and
// then issues a follow-up findExistingLink() SELECT to fetch the existing
// row for the 409 `link_already_exists` response per §2.3.
//
// Round-3 audit F-163: the prior comment described non-existent
// `.maybeSingle()` zero-row semantics for the UNIQUE-violation case;
// the actual mechanism is the 23505 error path described above.
export async function createContextLink(
  supabase: Client,
  sourceNodeId:   string,
  targetNodeId:   string,
  organisationId: string,
): Promise<PostgrestSingleResponse<LinkRow>> {
  const insert: LinkInsert = {
    source_node_id:  sourceNodeId,
    target_node_id:  targetNodeId,
    organisation_id: organisationId,
    link_type:       'structural_to_context',
  }
  // eslint-disable-next-line no-restricted-syntax -- INSERT validation: 0 rows is genuinely an error here. UNIQUE-violation surfaces via the 23505 error path (route catches and issues findExistingLink).
  return supabase
    .from('node_context_links')
    .insert(insert)
    .select(LINK_SELECT)
    .single() as unknown as PostgrestSingleResponse<LinkRow>
}

// ─── findExistingLink ────────────────────────────────────────────────────

// Returns the existing (source, target) link row, or null. Used by the
// route after a UNIQUE-violation INSERT to populate the 409's `link` field.
export async function findExistingLink(
  supabase: Client,
  sourceNodeId: string,
  targetNodeId: string,
): Promise<PostgrestMaybeSingleResponse<LinkRow>> {
  // H-01: zero rows is a valid result.
  return supabase
    .from('node_context_links')
    .select(LINK_SELECT)
    .eq('source_node_id', sourceNodeId)
    .eq('target_node_id', targetNodeId)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<LinkRow>
}

// ─── deleteContextLink ───────────────────────────────────────────────────

// DELETE the matching (source, target) row. Returns the number of rows
// affected — 0 means no link existed (the route maps that to 404
// link_not_found).
export async function deleteContextLink(
  supabase: Client,
  sourceNodeId: string,
  targetNodeId: string,
): Promise<{ deletedCount: number; error: unknown }> {
  const { data, error } = await supabase
    .from('node_context_links')
    .delete()
    .eq('source_node_id', sourceNodeId)
    .eq('target_node_id', targetNodeId)
    .select('id')
  return { deletedCount: data?.length ?? 0, error }
}

// ─── listDirectLinks ─────────────────────────────────────────────────────

// Direct links from a structural node — the link rows where source = nodeId,
// joined to the target context node. Order: link.created_at ASC (oldest
// first — UI shows them in order added per §2.14).
//
// Joining via the supabase-js implicit-join syntax: `target:nodes!target_node_id(...)`
// pulls the related node row inline. The select string uses the FK name
// declared in Migration 005.
export async function listDirectLinks(
  supabase: Client,
  sourceNodeId: string,
): Promise<{ rows: Array<LinkRow & { target: NodeRow | null }>; error: unknown }> {
  const { data, error } = await supabase
    .from('node_context_links')
    .select(`
      id, source_node_id, target_node_id, link_type, created_at,
      target:nodes!target_node_id (
        id, document_id, project_id, organisation_id,
        parent_id, "order", depth, layer_index,
        node_type, node_category, scope,
        name, short_description, tags,
        summary, prose, notes, metadata,
        status,
        agent_instruction, word_count_target, word_count_actual,
        version, created_at, updated_at
      )
    `)
    .eq('source_node_id', sourceNodeId)
    .order('created_at', { ascending: true })
  return { rows: (data ?? []) as never, error }
}

// ─── listAncestorLinksForNode ────────────────────────────────────────────

// Walks `parent_id` upward from `sourceNodeId` to the root, collects the
// ancestor IDs (NOT including sourceNodeId itself), then runs ONE SELECT
// against node_context_links WHERE source_node_id IN (<ancestors>) joining
// to the target context node and the source ancestor node.
//
// The route is responsible for the closest-ancestor / direct-supersedes
// dedupe per §2.11 invariants 9–10; this wrapper just returns the raw rows
// tagged with their source's depth so the route can choose.
export async function listAncestorLinksForNode(
  supabase: Client,
  sourceNodeId: string,
): Promise<{
  rows: Array<{
    link:    LinkRow
    target:  NodeRow
    source:  Pick<NodeRow, 'id' | 'name' | 'node_type' | 'depth'>
  }>
  error: unknown
}> {
  // Fetch the chain by walking parent_id up. Phase 2 max depth is 5 (Series
  // template = 6 layers, indices 0..5); at most 5 round trips. We could
  // express this as a recursive CTE but supabase-js can't emit one without
  // an RPC; the per-hop walk is fine for V1's depth ceiling.
  const ancestorIds: string[] = []
  let currentId: string | null = sourceNodeId
  // Walk up one hop to start with the *parent*; sourceNodeId's own links
  // are "direct", not "inherited".
  // (We need the source node first to discover its parent.)
  {
    const { data: srcRow } = await supabase
      .from('nodes')
      .select('parent_id')
      .eq('id', currentId)
      .maybeSingle()
    currentId = srcRow?.parent_id ?? null
  }
  while (currentId !== null) {
    ancestorIds.push(currentId)
    const { data: row } = await supabase
      .from('nodes')
      .select('parent_id')
      .eq('id', currentId)
      .maybeSingle()
    currentId = row?.parent_id ?? null
    // Defensive: cap at 10 hops in case of pathological data (would
    // indicate a cycle, which Migration 021 prevents).
    if (ancestorIds.length > 10) break
  }

  if (ancestorIds.length === 0) {
    return { rows: [], error: null }
  }

  const { data, error } = await supabase
    .from('node_context_links')
    .select(`
      id, source_node_id, target_node_id, link_type, created_at,
      target:nodes!target_node_id (
        id, document_id, project_id, organisation_id,
        parent_id, "order", depth, layer_index,
        node_type, node_category, scope,
        name, short_description, tags,
        summary, prose, notes, metadata,
        status,
        agent_instruction, word_count_target, word_count_actual,
        version, created_at, updated_at
      ),
      source:nodes!source_node_id ( id, name, node_type, depth )
    `)
    .in('source_node_id', ancestorIds)

  if (error || !data) return { rows: [], error }

  // Re-shape into the documented return type.
  const rows = (data as unknown as Array<{
    id: string; source_node_id: string; target_node_id: string;
    link_type: string; created_at: string;
    target: NodeRow;
    source: { id: string; name: string | null; node_type: string; depth: number | null };
  }>).map(r => ({
    link: {
      id: r.id, source_node_id: r.source_node_id, target_node_id: r.target_node_id,
      link_type: r.link_type, created_at: r.created_at,
    } as unknown as LinkRow,
    target: r.target,
    source: r.source as Pick<NodeRow, 'id' | 'name' | 'node_type' | 'depth'>,
  }))

  return { rows, error: null }
}

// ─── listBackLinks ───────────────────────────────────────────────────────

// All structural sources that link to the given context node. Joined to
// the source's document for §2.15's `document_name` field. Order:
// document_name ASC, depth ASC, name ASC.
export async function listBackLinks(
  supabase: Client,
  contextNodeId: string,
): Promise<{
  rows: Array<{
    link: LinkRow
    structural: Pick<NodeRow, 'id' | 'name' | 'node_type' | 'depth' | 'document_id'> & {
      document: Pick<DocumentRow, 'id' | 'name'> | null
    }
  }>
  total: number
  error: unknown
}> {
  const { data, error, count } = await supabase
    .from('node_context_links')
    .select(`
      id, source_node_id, target_node_id, link_type, created_at,
      structural:nodes!source_node_id (
        id, name, node_type, depth, document_id,
        document:documents ( id, name )
      )
    `, { count: 'exact' })
    .eq('target_node_id', contextNodeId)
    .order('created_at', { ascending: true })

  if (error || !data) return { rows: [], total: 0, error }

  type RawRow = {
    id: string; source_node_id: string; target_node_id: string;
    link_type: string; created_at: string;
    structural: {
      id: string; name: string | null; node_type: string; depth: number | null;
      document_id: string | null;
      document: { id: string; name: string } | null;
    };
  }
  const raw = data as unknown as RawRow[]
  const rows = raw.map(r => ({
    link: {
      id: r.id, source_node_id: r.source_node_id, target_node_id: r.target_node_id,
      link_type: r.link_type, created_at: r.created_at,
    } as unknown as LinkRow,
    structural: r.structural as Pick<NodeRow, 'id' | 'name' | 'node_type' | 'depth' | 'document_id'> & {
      document: Pick<DocumentRow, 'id' | 'name'> | null
    },
  }))

  // Sort in JS — PostgREST can't order by a referenced-table column
  // through the implicit-join select syntax. The sort here is the §2.15
  // contract: document_name ASC, depth ASC, name ASC.
  rows.sort((a, b) => {
    const aDoc = a.structural.document?.name ?? ''
    const bDoc = b.structural.document?.name ?? ''
    if (aDoc !== bDoc) return aDoc.localeCompare(bDoc)
    const aDepth = a.structural.depth ?? 0
    const bDepth = b.structural.depth ?? 0
    if (aDepth !== bDepth) return aDepth - bDepth
    const aName = a.structural.name ?? ''
    const bName = b.structural.name ?? ''
    return aName.localeCompare(bName)
  })

  return { rows, total: count ?? 0, error: null }
}

// ─── countBackLinks ──────────────────────────────────────────────────────

// Fast count for the §2.3 `cannot_delete_with_back_links` 409 response
// body and the §2.15 `total` field. RLS-filtered.
export async function countBackLinks(
  supabase: Client,
  contextNodeId: string,
): Promise<number> {
  const { count } = await supabase
    .from('node_context_links')
    .select('id', { count: 'exact', head: true })
    .eq('target_node_id', contextNodeId)
  return count ?? 0
}
