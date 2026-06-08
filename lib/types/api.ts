// Phase 8.5b B.1 — Public API response type contracts.
//
// Single source of truth for the shapes returned by the document-load
// architecture's endpoints (Tier-A spec §2.5). Endpoints and consumers
// import from this file rather than re-declaring shapes inline; any
// projection-vs-type mismatch shows up at type-check.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §2.5
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 work item 1

// ─── Node status ────────────────────────────────────────────────────────

/**
 * Author-driven editorial label per M-149.
 * Reduced from 4 to 2 values in Phase 6; live state lives in the
 * lock + agent_jobs substrate, not in this enum.
 */
export type NodeStatus = 'draft' | 'approved'

// ─── Node row shapes ────────────────────────────────────────────────────

/**
 * Tiptap-JSON document shape carried by `summary`, `prose`, `notes`.
 *
 * Loosely typed at the boundary — the editor mounts validate shape.
 */
export type TiptapDoc = {
  type: 'doc'
  content?: unknown[]
} & Record<string, unknown>

/**
 * Structural columns returned by the default (un-`?include=`'d) projected
 * `GET /api/documents/[id]/nodes` response. Sized to what the tree needs
 * to render: identity, position, name, lifecycle, word counts, derived
 * leaf-ness. No content fields.
 */
export interface StructuralNodeRow {
  id: string
  parent_id: string | null
  order: number
  node_category: 'structural'
  node_type: string
  layer_index: number
  name: string
  status: NodeStatus
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  created_at: string
  /** Server-derived per H-15 — `layer_index === MAX(layer_index)` for the document. */
  is_leaf: boolean
  /** Server-derived — distance from root. */
  depth: number
}

/**
 * Full node row including content fields. Returned by `GET /api/nodes/[id]`
 * (the per-node hydration surface) and by `/api/documents/[id]/nodes`
 * when explicit `?include=...` opt-ins are present.
 */
export interface FullNodeRow extends StructuralNodeRow {
  summary?: TiptapDoc | null
  prose?: TiptapDoc | null
  notes?: TiptapDoc | null
  metadata?: Record<string, unknown> | null
}

/**
 * Allowed `?include=` values for `GET /api/documents/[id]/nodes`.
 * `*` is the explicit escape-hatch added in B.2a and preserved through
 * B.2b's default flip; not exported here because callers should use
 * specific opt-ins rather than the wildcard.
 */
export type NodeIncludeField = 'summary' | 'prose' | 'metadata' | 'notes'

/**
 * Canonical structural column list used by the route handler to build
 * the SELECT projection. Single source of truth — projection logic and
 * `StructuralNodeRow` reference the same list, so a drift between them
 * fails type-check.
 *
 * Note: `is_leaf` and `depth` are derived server-side per H-15 and not
 * raw columns; they're present on `StructuralNodeRow` but not in this
 * list (the route handler computes them after the SELECT).
 */
export const STRUCTURAL_COLUMNS = [
  'id',
  'parent_id',
  'order',
  'node_category',
  'node_type',
  'layer_index',
  'name',
  'status',
  'word_count_actual',
  'word_count_target',
  'updated_at',
  'created_at',
] as const

/**
 * Allow-list for the `?include=` query parameter. Single source of truth;
 * the route handler validates against this and rejects unknowns with 400.
 */
export const ALLOWED_INCLUDES: readonly NodeIncludeField[] = [
  'summary',
  'prose',
  'metadata',
  'notes',
] as const

// ─── Rollup response shapes ─────────────────────────────────────────────

/**
 * Aggregate counts for one document. Returned by
 * `GET /api/documents/[id]/rollup` and backed by the Postgres RPC
 * `get_document_rollup(p_document_id UUID)` (M-212).
 */
export interface DocumentRollup {
  document_id: string
  /** Sum of `word_count_actual` across leaf nodes. */
  words_drafted: number
  /**
   * Authored target for the document. Uses the root node's
   * `word_count_target` when it's > 0; otherwise falls back to the sum
   * of leaf targets (mirrors projectAggregates.ts pre-B.1 logic).
   */
  words_target: number
  /** Count of structural nodes in the document. */
  node_count: number
  /** Count of leaf structural nodes (`layer_index === max`). */
  leaf_count: number
  /** Distribution of `status` across structural nodes. Empty object on empty doc. */
  status_counts: Partial<Record<NodeStatus, number>>
  /** `MAX(updated_at)` across structural nodes; `null` on empty doc. */
  last_updated_at: string | null
}

/**
 * Aggregate counts for one project (summed across its documents).
 * Returned by `GET /api/projects/[id]/rollup` and backed by the Postgres
 * RPC `get_project_rollup(p_project_id UUID)` (M-212).
 */
export interface ProjectRollup {
  project_id: string
  /** Number of documents in the project. */
  document_count: number
  /** Sum of `words_drafted` across the project's documents. */
  words_drafted: number
  /** Sum of effective `words_target` (root-fallback-leaf) across the project's documents. */
  words_target: number
  /** Sum of `node_count` across the project's documents. */
  node_count: number
  /** Sum of `leaf_count` across the project's documents. */
  leaf_count: number
  /** `MAX(updated_at)` across the project's documents; `null` if no nodes exist. */
  last_updated_at: string | null
}
