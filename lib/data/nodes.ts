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
//
// Round-3 audit F-152 + F-160: the function previously returned `null` on
// every data-integrity failure (no layer_stacks row, empty layers array,
// missing or non-numeric `index` field). decorateWithLeaf turned every
// such null into is_leaf=false silently — leaf-only UI affordances
// disappeared with no error to the user. The fix throws clearly at this
// layer instead. Per TA H-14, every document MUST have a non-template
// layer_stacks row; not finding one is a data integrity violation worth
// surfacing as 500 at the route layer.
//
// Route callers that pass document_id=null for context nodes never call
// this function; they pass null directly to decorateWithLeaf. That path
// is unchanged and still legitimate.

export async function getDocumentMaxLayerIndex(
  supabase: Client,
  documentId: string,
): Promise<number> {
  const { data } = await supabase
    .from('layer_stacks')
    .select('layers')
    .eq('document_id', documentId)
    .eq('is_template', false)
    .maybeSingle()
  if (!data?.layers) {
    throw new Error(
      `getDocumentMaxLayerIndex: no non-template layer_stacks row for document '${documentId}' (data integrity / H-14 violation)`,
    )
  }
  const layers = data.layers as Array<{ index?: unknown }>
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error(
      `getDocumentMaxLayerIndex: layer_stacks.layers is empty or non-array for document '${documentId}'`,
    )
  }
  // F-160: validate every layer has a numeric `index` field. The previous
  // implementation used `l.index ?? 0` which silently masked malformed
  // data as a 0 max-index, making every non-root node appear non-leaf.
  const indices = layers.map((l, i) => {
    if (typeof l.index !== 'number' || !Number.isFinite(l.index)) {
      throw new Error(
        `getDocumentMaxLayerIndex: layer at position ${i} for document '${documentId}' has invalid 'index' field (got ${typeof l.index})`,
      )
    }
    return l.index
  })
  return Math.max(...indices)
}

export function decorateWithLeaf<T extends NodeRow>(
  node: T,
  maxLayerIndex: number | null,
): T & { is_leaf: boolean } {
  // null is the legitimate context-node path — route callers that pass
  // document_id=null skip the lookup and pass null here. Context nodes
  // have no leaf-ness in the structural sense; is_leaf=false is correct.
  const is_leaf = maxLayerIndex !== null && node.layer_index === maxLayerIndex
  return { ...node, is_leaf }
}

// §2.12: returned fields. Excludes mobile_notes, attachment_count,
// export_*, external_ref, created_by, last_modified_by, locked_at,
// locked_version (Phase 2 doesn't surface them).
//
// Phase 4: `scope` is now in the projection. It is NULL for structural
// nodes (Phase 2 invariant) and one of 'project'|'document' for context
// nodes (Phase 4 API Contract §2.11 invariant 1 + G-1). Adding it is
// purely additive — clients ignoring unknown fields are unaffected.
const NODE_SELECT = [
  'id', 'document_id', 'project_id', 'organisation_id',
  'parent_id', '"order"', 'depth', 'layer_index',
  'node_type', 'node_category', 'scope',
  'name', 'short_description', 'tags',
  'summary', 'prose', 'notes', 'metadata',
  'status', 'locked', 'lock_reason',
  'agent_instruction', 'word_count_target', 'word_count_actual',
  'version', 'content_revision', 'created_at', 'updated_at',
].join(', ')

export async function createNode(
  supabase: Client,
  fields: NodeInsert,
): Promise<PostgrestSingleResponse<NodeRow>> {
  // eslint-disable-next-line no-restricted-syntax -- INSERT validation: 0 rows is genuinely an error here (RLS denial / FK violation).
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

// H-01 (round-3 audit F-155): .maybeSingle() — zero rows is a valid
// outcome here (concurrent delete between the route's pre-check and
// this UPDATE). Caller MUST treat data === null as not_found. The
// `updateNodeOptimistic` and `updateNodeOptimisticByContentRevision`
// variants below already use `.maybeSingle()` for the same reason —
// this aligns the non-optimistic path with the rest of the file.
export async function updateNode(
  supabase: Client,
  nodeId: string,
  fields: NodeUpdate,
): Promise<PostgrestMaybeSingleResponse<NodeRow>> {
  return supabase
    .from('nodes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', nodeId)
    .select(NODE_SELECT)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<NodeRow>
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

// SU-J14-1: autosave concurrency uses content_revision (the always-current
// durability anchor) instead of version. The conflict semantics are the
// same — 0-row return = mismatch — but the field reflects every content
// change, including ones that don't bump version.
export async function updateNodeOptimisticByContentRevision(
  supabase: Client,
  nodeId: string,
  fields: NodeUpdate,
  expectedContentRevision: number,
): Promise<PostgrestMaybeSingleResponse<NodeRow>> {
  return supabase
    .from('nodes')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', nodeId)
    .eq('content_revision', expectedContentRevision)
    .select(NODE_SELECT)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<NodeRow>
}

export async function deleteNode(supabase: Client, nodeId: string) {
  return supabase
    .from('nodes')
    .delete()
    .eq('id', nodeId)
}

// ─── Phase 4: context-node wrappers ──────────────────────────────────────
// Spec: stelavox_phase4_api_contract_v1_0.md §3.1 (POST), §3.2 (list),
//                                            §2.11 invariants 1–3 (no parent,
//                                            scope+document_id immutable).
//       stelavox_phase4_build_checklist_v1_0.md §3.2 T-2.1, T-2.2

export interface ContextNodePostFields {
  organisation_id:    string
  project_id:         string
  scope:              'project' | 'document'
  document_id:        string | null
  node_type:          string         // narrowed at the validation layer
  name:               string
  short_description?: string | null
  summary?:           string | null
  notes?:             string | null
  metadata?:          Record<string, unknown>
  tags?:              string[]
}

// Insert a context node. The route is responsible for validating scope /
// document_id consistency and the V1 type whitelist; this wrapper is the
// thin INSERT.
export async function createContextNode(
  supabase: Client,
  fields: ContextNodePostFields,
): Promise<PostgrestSingleResponse<NodeRow>> {
  const insert: NodeInsert = {
    organisation_id:   fields.organisation_id,
    project_id:        fields.project_id,
    document_id:       fields.document_id,
    node_category:     'context',
    node_type:         fields.node_type,
    parent_id:         null,
    // depth / layer_index / order are NOT NULL with defaults at the
    // schema level (depth DEFAULT 0, order DEFAULT 1) per Migration 004
    // — context nodes use the defaults; the values are meaningless for
    // them but the columns are non-null.
    scope:             fields.scope,
    name:              fields.name,
    short_description: fields.short_description ?? null,
    summary:           fields.summary ?? null,
    notes:             fields.notes ?? null,
    metadata:          (fields.metadata ?? {}) as never,
    tags:              fields.tags ?? [],
    status:            'draft',
    version:           1,
  }
  // eslint-disable-next-line no-restricted-syntax -- INSERT validation: 0 rows is genuinely an error here (RLS denial / FK violation / scope-document_id consistency).
  return supabase
    .from('nodes')
    .insert(insert)
    .select(NODE_SELECT)
    .single() as unknown as PostgrestSingleResponse<NodeRow>
}

export interface ListContextNodesFilters {
  scope?:      'project' | 'document'
  documentId?: string
  nodeType?:   string
  limit:       number
  offset:      number
}

// List context nodes for a project per §3.2 + G-3 inheritance semantics.
// When `documentId` is supplied: returns scope='project' for the project
// PLUS scope='document' AND document_id=<param>. Other scope filters
// behave as documented in §2.8.
export async function listContextNodesByProject(
  supabase: Client,
  projectId: string,
  f: ListContextNodesFilters,
): Promise<{ rows: NodeRow[]; total: number; error: unknown }> {
  // Build the base filter shared across head-count and rows queries.
  const baseQuery = () =>
    supabase
      .from('nodes')
      .select(NODE_SELECT, { count: 'exact' })
      .eq('project_id',    projectId)
      .eq('node_category', 'context')

  let query = baseQuery()

  if (f.nodeType !== undefined) query = query.eq('node_type', f.nodeType)

  // Scope + documentId filter logic per G-3:
  //
  //   scope undefined,        documentId undefined  → all rows in project
  //   scope = 'project',      documentId undefined  → scope='project' only
  //   scope = 'document',     documentId undefined  → scope='document' only
  //   scope undefined,        documentId set        → scope='project' OR (scope='document' AND document_id=X)
  //   scope = 'project',      documentId set        → contradictory, but we honour scope=project (G-3 prose)
  //   scope = 'document',     documentId set        → scope='document' AND document_id=X
  if (f.scope === 'project') {
    query = query.eq('scope', 'project')
  } else if (f.scope === 'document') {
    query = query.eq('scope', 'document')
    if (f.documentId !== undefined) {
      query = query.eq('document_id', f.documentId)
    }
  } else if (f.documentId !== undefined) {
    // No scope filter; document_id supplied → return project-scoped + this
    // document's document-scoped (the inheritance-aware default per G-3).
    //
    // F-156 (round-3 audit): assert UUID format before the string-
    // interpolated PostgREST .or() filter. Today the route layer's
    // isValidUuid() is the only guard; defence-in-depth at the wrapper
    // ensures a non-UUID documentId can never reach the .or()
    // expression where it could break the filter parser or alter
    // matching semantics.
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(f.documentId)) {
      throw new Error(`listContextNodesByProject: documentId is not a valid UUID: ${f.documentId}`)
    }
    query = query.or(`scope.eq.project,and(scope.eq.document,document_id.eq.${f.documentId})`)
  }

  // Order: node_type ASC, then case-insensitive name ASC. PostgREST
  // does case-insensitive ordering by lower(name) — supabase-js exposes
  // the `referencedTable`-free .order() builder; `lower(name)` is not
  // directly supported, so we use `name ASC` and document the case
  // sensitivity in the contract.
  const { data, error, count } = await query
    .order('node_type', { ascending: true })
    .order('name',      { ascending: true, nullsFirst: false })
    .range(f.offset, f.offset + f.limit - 1)

  return {
    rows:  (data ?? []) as unknown as NodeRow[],
    total: count ?? 0,
    error,
  }
}

