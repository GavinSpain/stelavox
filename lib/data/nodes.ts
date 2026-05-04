// Spec: stelavox_phase2_api_contract_v1_0.md §2.12 (response shape),
//                                              §3.1 (POST),
//                                              §3.2 (GET list),
//                                              §3.3 (GET single),
//                                              §3.4 (PATCH),
//                                              §3.5 (DELETE)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.3 T-3.2
//
// Thin Supabase wrappers for the Phase 2 node API. Mirrors Phase 1's
// lib/data/documents.ts style: typed via Database['public']['Tables']
// ['nodes'], no `user_id` filter (RLS does that at the database layer
// — see policy `org_members_access_nodes` in Migration 002).
//
// listNodes ordering — design note:
//   API Contract §3.2 mandates depth-first traversal in the response,
//   but adds: "Clients that build a tree client-side don't depend on
//   order, but the server-side ordering keeps responses byte-stable
//   for caching." True depth-first requires a recursive CTE or RPC.
//   This wrapper returns rows ordered (depth ASC, order ASC) —
//   deterministic and byte-stable, but breadth-first. T-3.3's GET
//   route applies a depth-first sort over the in-memory array before
//   responding (cheap O(N) using parent_id linkage), so the wire
//   contract is honoured. The wrapper stays simple.
//
// createNode is a plain INSERT — no RPC. There is a theoretical race
// where two concurrent appends compute `order = max(siblings) + 1`
// independently and end up duplicating. Phase 2 is single-user-per-
// document; the race window is sub-millisecond. If it manifests, add
// SELECT ... FOR UPDATE on the parent row in the route or wrap in a
// future create_node RPC.
//
// `"order"` is double-quoted in the SELECT string (reserved SQL
// keyword) but accessed unquoted via the .order() builder method.
// supabase-js / PostgREST handles the SQL emission correctly.

import type {
  PostgrestMaybeSingleResponse,
  PostgrestResponse,
  PostgrestSingleResponse,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client     = SupabaseClient<Database>
type NodeRow    = Database['public']['Tables']['nodes']['Row']
type NodeInsert = Database['public']['Tables']['nodes']['Insert']
type NodeUpdate = Database['public']['Tables']['nodes']['Update']

// ─── Leaf-ness derivation (H-15) ──────────────────────────────────────────
// `is_leaf` is a structural property of the document's layer_stack — a node
// is a leaf iff its layer_index equals the maximum layer index in the stack.
// Never stored on the row; never inferred from child count.
//
// We expose the layer-count fetch as a helper so list endpoints can fetch
// once per document and decorate every row, instead of N queries.

export async function getDocumentMaxLayerIndex(
  supabase: Client,
  documentId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from('layer_stacks')
    .select('layers')
    .eq('document_id', documentId)
    .eq('is_template', false)
    .maybeSingle()
  if (!data?.layers) return null
  const layers = data.layers as Array<{ index?: number }>
  if (!Array.isArray(layers) || layers.length === 0) return null
  // Defensive: layers should be 0-indexed contiguous, so length-1 IS the max.
  // We compute via Math.max for robustness against any future out-of-band
  // insertion / non-contiguity.
  return Math.max(...layers.map(l => l.index ?? 0))
}

export function decorateWithLeaf<T extends NodeRow>(
  node: T,
  maxLayerIndex: number | null,
): T & { is_leaf: boolean } {
  const is_leaf = maxLayerIndex !== null && node.layer_index === maxLayerIndex
  return { ...node, is_leaf }
}

// §2.12: returned fields. Excludes mobile_notes, attachment_count,
// export_*, external_ref, created_by, last_modified_by, locked_at,
// locked_version, scope (Phase 2 doesn't surface them).
const NODE_SELECT = [
  'id', 'document_id', 'project_id', 'organisation_id',
  'parent_id', '"order"', 'depth', 'layer_index',
  'node_type', 'node_category',
  'name', 'short_description', 'tags',
  'summary', 'prose', 'notes', 'metadata',
  'status', 'locked', 'lock_reason',
  'agent_instruction', 'word_count_target', 'word_count_actual',
  'version', 'created_at', 'updated_at',
].join(', ')

export async function createNode(
  supabase: Client,
  fields: NodeInsert,
): Promise<PostgrestSingleResponse<NodeRow>> {
  return supabase
    .from('nodes')
    .insert(fields)
    .select(NODE_SELECT)
    .single() as unknown as PostgrestSingleResponse<NodeRow>
}

export async function listNodes(
  supabase: Client,
  documentId: string,
  category: 'structural' | 'context' | 'all' = 'structural',
) {
  let query = supabase
    .from('nodes')
    .select(NODE_SELECT)
    .eq('document_id', documentId)

  // 'all' applies no category filter (Phase 4 will return both structural
  // and context nodes). 'structural' and 'context' filter to that single
  // category. Phase 2 has no context nodes, so 'context' returns [].
  if (category === 'structural') query = query.eq('node_category', 'structural')
  else if (category === 'context') query = query.eq('node_category', 'context')

  return query
    .order('depth', { ascending: true })
    .order('order', { ascending: true }) as unknown as Promise<PostgrestResponse<NodeRow>>
}

export async function getNode(
  supabase: Client,
  nodeId: string,
): Promise<PostgrestMaybeSingleResponse<NodeRow>> {
  // H-01: zero rows is a valid result (the 404 path); use maybeSingle.
  return supabase
    .from('nodes')
    .select(NODE_SELECT)
    .eq('id', nodeId)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<NodeRow>
}

export async function updateNode(
  supabase: Client,
  nodeId: string,
  fields: NodeUpdate,
): Promise<PostgrestSingleResponse<NodeRow>> {
  return supabase
    .from('nodes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', nodeId)
    .select(NODE_SELECT)
    .single() as unknown as PostgrestSingleResponse<NodeRow>
}

// Phase 3 (T-4.3): atomic optimistic-concurrency UPDATE.
// Adds `version = expectedVersion` to the WHERE clause so the UPDATE only
// fires when the row's version matches. Returns null on mismatch — the
// route re-reads via getNode() to determine 409 vs deleted-race (404).
// This eliminates the read-compare-write race that a sequential check
// would leave open (TC-A-32). Conflict detection lives in the route, not
// here, per Build Checklist T-4.3.
export async function updateNodeOptimistic(
  supabase: Client,
  nodeId: string,
  fields: NodeUpdate,
  expectedVersion: number,
): Promise<PostgrestMaybeSingleResponse<NodeRow>> {
  return supabase
    .from('nodes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', nodeId)
    .eq('version', expectedVersion)
    .select(NODE_SELECT)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<NodeRow>
}

export async function deleteNode(supabase: Client, nodeId: string) {
  return supabase
    .from('nodes')
    .delete()
    .eq('id', nodeId)
}
