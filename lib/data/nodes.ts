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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client     = SupabaseClient<Database>
type NodeInsert = Database['public']['Tables']['nodes']['Insert']
type NodeUpdate = Database['public']['Tables']['nodes']['Update']

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

export async function createNode(supabase: Client, fields: NodeInsert) {
  return supabase
    .from('nodes')
    .insert(fields)
    .select(NODE_SELECT)
    .single()
}

export async function listNodes(
  supabase: Client,
  documentId: string,
  // Phase 2 always returns structural rows; param accepted for forward
  // compatibility (Phase 4 lifts the restriction).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _category: 'structural' | 'context' | 'all' = 'structural',
) {
  return supabase
    .from('nodes')
    .select(NODE_SELECT)
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .order('depth', { ascending: true })
    .order('order', { ascending: true })
}

export async function getNode(supabase: Client, nodeId: string) {
  // H-01: zero rows is a valid result (the 404 path); use maybeSingle.
  return supabase
    .from('nodes')
    .select(NODE_SELECT)
    .eq('id', nodeId)
    .maybeSingle()
}

export async function updateNode(supabase: Client, nodeId: string, fields: NodeUpdate) {
  return supabase
    .from('nodes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', nodeId)
    .select(NODE_SELECT)
    .single()
}

export async function deleteNode(supabase: Client, nodeId: string) {
  return supabase
    .from('nodes')
    .delete()
    .eq('id', nodeId)
}
