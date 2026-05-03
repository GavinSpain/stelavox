# Stelavox — Phase 2 API Contract
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 2 build. Defines every API route added or modified in Phase 2 (Node Tree). Companion to `stelavox_phase2_test_plan_v1_0.md` and `stelavox_phase2_build_checklist_v1_0.md`. Source of truth for endpoint shape, validation, error codes, and the tree-integrity invariants that bind the implementation to the schema in `stelavox_technical_architecture_v1_4.md` §3.6 (Migration 004 — `nodes`).

**Phase:** 2 — Node Tree: structural CRUD, react-arborist, status badges, reordering.
**Phase 2 checkpoint criteria (Technical Architecture v1.4 §11):** "Can build a manual node tree; drag-and-drop works."
**Companion documents:** `stelavox_phase2_test_plan_v1_0.md`, `stelavox_phase2_build_checklist_v1_0.md`. Cross-cutting rules that did not change since Phase 1 are inherited from `stelavox_phase1_api_contract_v1_0.md` §2 — those sections below say "unchanged from Phase 1."

---

## 1. Phase Scope

### 1.1 Routes added in Phase 2

| Method | Path | Purpose |
|---|---|---|
| POST   | `/api/documents/[documentId]/nodes`         | Create a structural node under a parent in the document |
| GET    | `/api/documents/[documentId]/nodes`         | List all nodes in the document (flat array, client builds tree) |
| GET    | `/api/nodes/[nodeId]`                       | Read a single node |
| PATCH  | `/api/nodes/[nodeId]`                       | Update mutable fields (name, status, content, etc.) |
| DELETE | `/api/nodes/[nodeId]`                       | Delete a node and all descendants (sibling renumber) |
| PATCH  | `/api/nodes/[nodeId]/move`                  | Move node to a new parent and/or position (atomic renumber, H-04) |

### 1.2 Routes modified in Phase 2

| Method | Path | Change |
|---|---|---|
| POST   | `/api/projects/[projectId]/documents`       | Response body now includes a `root_node` field alongside `document` and `layer_stack` (additive — no existing caller breaks). Underlying RPC `create_document_with_layer_stack` is extended in Migration 020 to insert the root node and back-fill `documents.root_node_id`. |

### 1.3 Routes removed in Phase 2

None.

### 1.4 Database changes

Three new migrations. No schema-level changes to existing tables — the `nodes` table from Migration 004 is the canonical store.

| Migration | Purpose |
|---|---|
| 020 | `CREATE OR REPLACE FUNCTION create_document_with_layer_stack` — adds root-node insert and `documents.root_node_id` back-fill. Supersedes Migration 015's function definition while leaving 015–019 intact in history for replay. |
| 021 | `CREATE OR REPLACE FUNCTION move_node` — atomic move + sibling renumber + cycle detection + layer validation + descendant depth recalculation. Backs `PATCH /api/nodes/[nodeId]/move`. |
| 023 | `BEFORE UPDATE` trigger on `nodes` that increments `version` only when a content field (`summary`, `prose`, `notes`, `metadata`) changes. Non-content updates (rename, status, target, instruction) do not bump version. |

Functions 020 and 021 are `SECURITY DEFINER SET search_path = public` and grant EXECUTE to `authenticated` and `service_role` (matching the Phase 1 pattern after Migration 019). See H-13.

No legacy-data backfill is required: clean-slate assumption holds until production launch (no Migration 022). Migration numbering preserves the gap so the production migration history matches the source-controlled file order if a backfill is needed post-launch.

### 1.5 Auth surface

Unchanged from Phase 1. All Phase 2 routes require an authenticated session via the cookie-bound Supabase client. RLS on `nodes` is established by Migration 004; no new policies are added in Phase 2.

---

## 2. Cross-Cutting Rules

### 2.1 Authentication

Unchanged from Phase 1 §2.1. Every endpoint calls `await supabase.auth.getUser()`; missing or invalid session returns `401 unauthorised`.

### 2.2 Authorisation

Unchanged from Phase 1 §2.2. RLS at the database level is the authoritative cross-tenancy boundary. API routes never filter by `user_id`. The `nodes` policy from Migration 004 admits a row only when its `project_id` belongs to a project owned by an organisation the caller is a member of:

```sql
project_id IN (
  SELECT p.id FROM projects p
  JOIN organisation_members om ON om.organisation_id = p.organisation_id
  WHERE om.user_id = auth.uid()
)
```

A request for a node the caller cannot see returns `404 not_found`, never `403`. The 404 is indistinguishable from a request for a node that does not exist — leakage of existence is not permitted.

### 2.3 Error envelope

Unchanged from Phase 1 §2.3:

```json
{ "error": "<code>", "message": "<optional human-readable detail>" }
```

Phase 2 adds the following codes to the registry (full registry below in §2.5):

| Code | Status | Where |
|---|---|---|
| `cannot_delete_root` | 422 | DELETE on a node whose `id` equals `documents.root_node_id` |
| `cycle_detected` | 422 | move_node would put a node inside its own subtree |
| `layer_violation` | 422 | create or move places a node where its `node_type` does not match the parent's layer + 1 |
| `max_depth_exceeded` | 422 | create under a leaf layer (parent is at the deepest layer in the stack) |
| `invalid_parent` | 422 | parent does not exist, is in a different document, is a context node, or is locked |
| `invalid_position` | 400 | `position` is negative or greater than current sibling count |
| `invalid_category` | 400 | request specifies `node_category = "context"` (Phase 4 feature) |
| `invalid_node_type` | 400 | `node_type` is not a string in the document's layer-stack vocabulary |
| `node_locked` | 423 | target node is `locked = TRUE` and operation requires write access |
| `parent_locked` | 423 | requested parent has any ancestor with `locked = TRUE` |

All other Phase 1 codes (`invalid_uuid`, `invalid_json`, `missing_body`, `unauthorised`, etc.) carry over unchanged.

### 2.4 Status codes used in this phase

`200`, `201`, `400`, `401`, `404`, `422`, `423`, `500`. New since Phase 1: `422` (semantic violation — well-formed body but tree integrity rejection) and `423` (resource locked — node or ancestor has `locked = TRUE`). Both follow the standard meanings; neither requires special client handling beyond surfacing the message.

### 2.5 Validation rules — common

Unchanged from Phase 1 §2.5 plus:

| Field | Rule |
|---|---|
| `parent_id`         | Required UUID on POST. Must reference a node in the same `documentId`. NULL not permitted on POST (the root is created by the document-creation RPC). |
| `node_type`         | Required string on POST. Must equal the `node_type` of the layer at index `(parent.layer_index + 1)` in the document's `layer_stacks.layers`. |
| `node_category`     | Optional on POST; defaults to `'structural'`. `'context'` returns `400 invalid_category` in Phase 2. |
| `name`              | Optional on POST and PATCH. Trimmed; max 200 chars; empty after trim → 400 `invalid_name`. |
| `short_description` | Optional. Trimmed; max 1000 chars. |
| `status`            | On PATCH, must be one of `draft`, `in_review`, `approved`, `locked`. Free transition (no state-machine restriction in Phase 2; locking semantics arrive in Phase 6). |
| `agent_instruction` | Optional string; max 5000 chars. |
| `word_count_target` | Optional integer ≥ 0. |
| `position`          | Required integer ≥ 0 on PATCH /move. Position 0 is "first child"; position N where N = current sibling count means "last". |

Content fields (`summary`, `prose`, `notes`, `metadata`) are settable via PATCH but not surfaced in Phase 2 UI; Phase 3 wires the editors. Validation:
- `summary`: optional string, max 100,000 chars.
- `prose`: optional string, max 1,000,000 chars (~200,000 words).
- `notes`: optional string, max 100,000 chars.
- `metadata`: optional object (free-form JSON in Phase 2).

Forbidden fields on POST and PATCH (returns `400 unknown_field`): `id`, `organisation_id`, `project_id`, `document_id`, `version`, `created_at`, `updated_at`, `created_by`, `last_modified_by`, `depth`, `order`, `layer_index`, `mobile_notes`, `attachment_count`. These are server-managed or moved through dedicated endpoints (`/move`).

`parent_id` is forbidden on PATCH (use `/move`).
`node_type` and `node_category` are forbidden on PATCH (immutable after creation).

### 2.6 Idempotency

Unchanged from Phase 1 §2.6.

### 2.7 Rate limiting

Deferred to V2. Same as Phase 1 §2.7.

### 2.8 Pagination

`GET /api/documents/[documentId]/nodes` returns the **entire** node array unpaginated. Phase 2's expected node count per document is in the low thousands (a novel may have 50–200 chapters × 5–15 scenes × 3–8 beats ≈ 1,000–5,000 leaves). The client builds the tree from the flat array; the wire size at 5,000 nodes × ~600 bytes/row ≈ 3 MB pre-gzip, ~600 KB on the wire. Adequate for V1.

If a document grows past 10,000 nodes a paginated or chunked endpoint will be added; this is not expected in V1.

### 2.9 Timestamps and date formats

Unchanged from Phase 1 §2.9.

### 2.10 Caller's organisation

Unchanged from Phase 1 §2.10.

### 2.11 Tree integrity rules

These are the invariants every endpoint upholds. Any operation that would break one of them is rejected with the corresponding `422` code.

1. **Root uniqueness.** Every document has exactly one node with `parent_id IS NULL` and `id = documents.root_node_id`. The root is created by Migration 020 at document creation. POST `/api/documents/[id]/nodes` cannot create another root (it requires `parent_id`). DELETE on the root returns `422 cannot_delete_root`.

2. **Same-document containment.** A node's `parent_id`, if not NULL, must reference a node with the same `document_id`. Cross-document parenting is rejected (`422 invalid_parent`). The `move_node` RPC enforces this on every move.

3. **Acyclic.** A node's parent chain must terminate at the root. `move_node` performs a recursive-CTE descendant scan before update; if the requested `parent_id` is the moved node or any of its descendants, the call returns `422 cycle_detected`. The check runs before any write so failure leaves the tree unchanged.

4. **Layer hierarchy.** A node's `node_type` must equal the `node_type` of the layer at `parent.layer_index + 1` in the document's `layer_stacks.layers` JSONB. The root is at `layer_index = 0`; its children are at `layer_index = 1`; and so on. POST and `move_node` both validate this. Mismatch returns `422 layer_violation`. The deepest layer (highest `index` in `layer_stacks.layers`) admits no children — POST under a leaf-layer parent returns `422 max_depth_exceeded`.

5. **Dense, 1-indexed sibling order.** Among children of the same parent, `order` is `1, 2, 3, …` with no gaps. Every operation that adds, removes, or reorders siblings rewrites all affected `order` values in one transaction (H-04). Sparse or 0-indexed orderings are server bugs; the API never returns them and tests assert density.

6. **Depth = parent.depth + 1.** Root has `depth = 0`. Every other node has `depth = (parent.depth + 1)`. `move_node` recomputes `depth` for the moved node and all its descendants (recursive UPDATE) when the parent changes. Depth drift is a server bug.

7. **Lock propagation.** A node with any ancestor where `locked = TRUE` cannot be modified, moved, deleted, or have children added/removed. The check walks the parent chain from the target up to the root; if any ancestor has `locked = TRUE`, the operation returns `423 parent_locked`. The target itself returning `locked = TRUE` returns `423 node_locked`. Reading (GET) is always permitted regardless of lock state.

   Phase 2 ships the lock *check* but not the lock-acquisition UI. The `locked` column is set only via PATCH `/api/nodes/[nodeId]` with `{ "status": "locked", "locked": true }` (admin/test path); the soft and hard locking semantics from Product Spec §4.5 arrive in Phase 6.

8. **Category restriction (Phase 2 only).** All Phase 2 nodes have `node_category = 'structural'`. The `nodes` table also admits `'context'` rows but no Phase 2 endpoint creates, lists, or updates them; `GET /api/documents/[id]/nodes` filters to `category = 'structural'` by default. Phase 4 lifts the restriction.

### 2.12 Response shape — node object

Every endpoint that returns a node returns the same shape (the `nodes` row with omitted server-internal fields):

```json
{
  "id": "uuid",
  "document_id": "uuid",
  "project_id": "uuid",
  "organisation_id": "uuid",
  "parent_id": "uuid|null",
  "order": 3,
  "depth": 2,
  "layer_index": 2,
  "node_type": "chapter",
  "node_category": "structural",
  "name": "Chapter 3",
  "short_description": "The first encounter",
  "tags": [],
  "summary": null,
  "prose": null,
  "notes": null,
  "metadata": {},
  "status": "draft",
  "locked": false,
  "lock_reason": null,
  "agent_instruction": null,
  "word_count_target": null,
  "word_count_actual": 0,
  "version": 1,
  "created_at": "2026-05-04T10:30:00.000Z",
  "updated_at": "2026-05-04T10:30:00.000Z"
}
```

Fields not returned by Phase 2 endpoints (present in DB but not exposed): `mobile_notes`, `attachment_count`, `export_include`, `export_heading_override`, `export_page_break_before`, `external_ref`, `created_by`, `last_modified_by`, `locked_at`, `locked_version`, `scope`. They are returned in later phases when their UI lands.

---

## 3. Endpoint Specifications

Each endpoint section follows the Phase 1 contract structure: purpose → request → success → failure modes → RLS notes.

### 3.1 `POST /api/documents/[documentId]/nodes` — Create node

**Purpose.** Create a structural node as a child of an existing node in the document. The new node is appended at the end of its parent's child list (server assigns `order = max(existing) + 1`). To insert at a specific position, follow with `PATCH /api/nodes/[newId]/move`.

**Path parameter:** `documentId` — UUID of the parent document. Caller must be a member of the organisation that owns the document (RLS).

**Request body:**

```json
{
  "parent_id": "<uuid>",
  "node_type": "chapter",
  "name": "Chapter 3",
  "short_description": "The first encounter",
  "agent_instruction": "Make the protagonist hesitant.",
  "word_count_target": 3500
}
```

`parent_id` and `node_type` are required; everything else is optional. `node_category` may be specified as `"structural"` but defaults to that; `"context"` returns 400.

**Validation order** (first failure wins):
1. `documentId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `Content-Type: application/json` — else `400 invalid_json`.
4. Body parses as JSON object — else `400 invalid_json` or `400 missing_body`.
5. No unknown fields — else `400 unknown_field` with `message: "Unknown field: <name>"`.
6. `parent_id` present and a valid UUID — else `400 missing_parent_id` or `400 invalid_uuid`.
7. `node_type` present and a non-empty string — else `400 invalid_node_type`.
8. `node_category`, if present, equals `"structural"` — else `400 invalid_category`.
9. Document exists and caller has access — else `404 not_found` (`message: "document_not_found"`).
10. Parent node exists, is in this document, and is structural — else `422 invalid_parent`.
11. Parent and all ancestors are not locked — else `423 parent_locked`.
12. Parent is not at the deepest layer — else `422 max_depth_exceeded`.
13. `node_type` matches the layer at `parent.layer_index + 1` — else `422 layer_violation`.
14. Other body fields (name, short_description, agent_instruction, word_count_target, content fields) pass §2.5 length and type checks — else the corresponding 400 code.

**Success response (`201 Created`):**

```json
{ "node": { /* the full node object per §2.12 */ } }
```

**Server actions on success:**
- Insert into `nodes` with `id = gen_random_uuid()`, `document_id`, `project_id`, `organisation_id` derived from the parent, `layer_index = parent.layer_index + 1`, `depth = parent.depth + 1`, `order = max(sibling.order) + 1` (or `1` if no siblings), `status = 'draft'`, `version = 1`.
- No sibling renumber required (append is order-additive).
- Single transaction.

**Failure modes** (most relevant):

| Status | Code | Trigger |
|---|---|---|
| 400 | `invalid_uuid` | `documentId` is not a UUID |
| 400 | `invalid_json` | Body unparseable |
| 400 | `missing_body` | Empty body |
| 400 | `unknown_field` | Forbidden field present |
| 400 | `missing_parent_id` | `parent_id` not in body |
| 400 | `invalid_node_type` | Empty / non-string |
| 400 | `invalid_category` | `node_category = "context"` |
| 400 | `invalid_name` | name fails length / trim |
| 401 | `unauthorised` | No session |
| 404 | `not_found` | Document absent or RLS-hidden |
| 422 | `invalid_parent` | parent does not exist / is in another document / is a context node |
| 422 | `max_depth_exceeded` | parent is at the deepest layer |
| 422 | `layer_violation` | `node_type` does not match parent's child layer |
| 423 | `parent_locked` | Any ancestor has `locked = TRUE` |
| 500 | `internal_error` | Anything unexpected |

### 3.2 `GET /api/documents/[documentId]/nodes` — List nodes

**Purpose.** Return every node in the document as a flat array. The client builds the tree by indexing on `parent_id`. This is the single endpoint Phase 2's tree UI calls on document open.

**Query parameters:**

| Name | Type | Default | Notes |
|---|---|---|---|
| `category` | `structural` \| `context` \| `all` | `structural` | Phase 2: only `structural` is meaningful; `context` and `all` are accepted but return only structural rows. Phase 4 lifts. |

Unknown query parameters return `400 unknown_param`.

**Success response (`200 OK`):**

```json
{ "nodes": [ /* array of node objects per §2.12, ordered by depth then order */ ] }
```

The ordering guarantee is depth-first traversal: root first, then root's children in `order`, then each child's subtree. Clients that build a tree client-side don't depend on order, but the server-side ordering keeps responses byte-stable for caching.

**Failure modes:** `400 invalid_uuid`, `400 unknown_param`, `401 unauthorised`, `404 not_found`, `500 internal_error`.

### 3.3 `GET /api/nodes/[nodeId]` — Read node

**Purpose.** Return a single node.

**Path parameter:** `nodeId`.

**Success response (`200 OK`):** `{ "node": { /* node object */ } }`

**Failure modes:** `400 invalid_uuid`, `401 unauthorised`, `404 not_found` (RLS-blocked or absent), `500 internal_error`.

### 3.4 `PATCH /api/nodes/[nodeId]` — Update node

**Purpose.** Update mutable fields. Cannot change `parent_id`, `order`, or `depth` (use `/move`). Cannot change `node_type` or `node_category` (immutable after create). Cannot change server-managed fields (`id`, `created_at`, etc.).

**Request body** (all optional; at least one mutable field required):

```json
{
  "name": "Chapter 3 — Revised",
  "short_description": "The second encounter",
  "status": "in_review",
  "agent_instruction": "Make tension clearer.",
  "word_count_target": 4000,
  "summary": "Long-form chapter summary…",
  "prose": "…",
  "notes": "Author notes…",
  "metadata": {}
}
```

Empty body returns `400 empty_update`.

**Validation order:**
1. `nodeId` is a valid UUID.
2. Session present.
3. Body parses; not empty; no unknown / forbidden fields (per §2.5).
4. Field-level validation (length, type).
5. Node exists and caller has access — else `404 not_found`.
6. Node is not locked AND no ancestor is locked — else `423 node_locked` or `423 parent_locked`.
7. UPDATE in single transaction; bumps `updated_at` and `version` (the version-bump trigger from a future migration handles versioning).

**Success response (`200 OK`):** `{ "node": { /* updated node */ } }`

**Failure modes:** `400 invalid_uuid`, `400 invalid_json`, `400 missing_body`, `400 empty_update`, `400 unknown_field`, `400 invalid_name` / `invalid_status` / `invalid_word_count_target` / etc., `401 unauthorised`, `404 not_found`, `423 node_locked`, `423 parent_locked`, `500 internal_error`.

### 3.5 `DELETE /api/nodes/[nodeId]` — Delete node

**Purpose.** Delete a node and all its descendants. Renumber the remaining siblings of the deleted node so order stays dense.

**Body:** must be empty — else `400 unexpected_body`.

**Validation order:**
1. `nodeId` is a valid UUID.
2. Session present.
3. Body empty.
4. Node exists and caller has access.
5. Node is not the document's root — else `422 cannot_delete_root`.
6. Node is not locked AND no ancestor is locked — else `423`.
7. Cascade DELETE (Migration 004's `ON DELETE CASCADE` on `parent_id`) removes all descendants.
8. Renumber remaining siblings: among children of the deleted node's parent with `order > (deleted.order)`, decrement each by 1. Single transaction.

**Success response (`200 OK`):**

```json
{ "deleted": true, "node_id": "<uuid>", "descendants_deleted": 17 }
```

`descendants_deleted` is the count of descendant rows removed (excluding the target itself), useful for client confirmation messaging.

**Failure modes:** `400 invalid_uuid`, `400 unexpected_body`, `401`, `404`, `422 cannot_delete_root`, `423 node_locked`, `423 parent_locked`, `500`.

### 3.6 `PATCH /api/nodes/[nodeId]/move` — Move and reorder

**Purpose.** Move a node to a new parent and/or position. The server-side RPC `move_node` (Migration 021) handles the entire operation atomically: cycle detection → layer validation → renumber old siblings → renumber new siblings → reparent → recompute depth for the node and all descendants. This is the H-04 endpoint.

**Request body:**

```json
{ "parent_id": "<uuid>", "position": 2 }
```

Both fields required. `parent_id` may equal the node's current `parent_id` (within-parent reorder). `position` is the 0-indexed target position among the new parent's children **after** the move:
- `0` = first child
- `N` where `N = new_parent.child_count` = last child (the maximum legal position; `N+1` is rejected)
- A within-parent move where `position` equals the node's current `order - 1` is a no-op (still returns 200).

**Validation order:**
1. `nodeId` is a valid UUID.
2. Session present.
3. Body parses; both `parent_id` and `position` present and valid types.
4. Node exists and caller has access.
5. New parent exists, is in the same document, and is structural.
6. Cycle check: `parent_id` is not the moved node and is not a descendant of the moved node — else `422 cycle_detected`.
7. Lock check: moved node is not locked; no ancestor of the moved node is locked; new parent has no locked ancestor — else `423`.
8. Layer check: moved node's `node_type` matches the layer at `(new_parent.layer_index + 1)` — else `422 layer_violation`. (Within-parent moves trivially pass this.)
9. `position` is in `[0, new_parent.child_count]` (when moving within the same parent, the count includes the moved node so `position` is in `[0, child_count - 1]`) — else `400 invalid_position`.
10. RPC executes:
    - If old parent ≠ new parent: decrement `order` for old siblings with `order > moved.order`.
    - Increment `order` for new siblings with `order >= position + 1`.
    - Update moved node's `parent_id`, `order = position + 1`, `depth = new_parent.depth + 1`.
    - If parent changed, recursively update `depth` for all descendants.
    - All within one PL/pgSQL function (one transaction).

**Success response (`200 OK`):**

```json
{
  "node": { /* moved node, post-move */ },
  "renumbered_count": 8
}
```

`renumbered_count` is the total number of sibling rows whose `order` changed (plus the moved node itself). Useful for test assertions.

**Failure modes:** `400 invalid_uuid`, `400 invalid_json`, `400 missing_body`, `400 missing_parent_id`, `400 invalid_position`, `401`, `404`, `422 invalid_parent`, `422 cycle_detected`, `422 layer_violation`, `423 node_locked`, `423 parent_locked`, `500`.

### 3.7 `POST /api/projects/[projectId]/documents` — Create document (modified)

**Change in Phase 2.** Response body gains a `root_node` field. Underlying RPC `create_document_with_layer_stack` is updated by Migration 020 to insert the root node and back-fill `documents.root_node_id`. Request body unchanged. All other Phase 1 behaviour unchanged.

**Modified success response (`201 Created`):**

```json
{
  "document":    { /* document row */ },
  "layer_stack": { /* layer_stack row */ },
  "root_node":   { /* root node, depth=0, parent_id=null, order=1, status='draft' */ }
}
```

**Root node properties on creation:**
- `node_type` = the `node_type` of `layer_stacks.layers[0]` (e.g. `"book"` for Novel, `"story"` for Short Story, `"series"` for Series).
- `name` = the document's `name` (the user can rename the root node afterwards via `PATCH /api/nodes/[nodeId]`).
- `node_category` = `"structural"`.
- `parent_id` = `null`. `order` = `1`. `depth` = `0`. `layer_index` = `0`.
- `status` = `"draft"`.

**No new failure modes** in Phase 2. The RPC's existing `missing_template` exception (returned as `500 missing_template` per Phase 1 §3.6) covers the case where the template is missing or the layers array is empty.

---

## 4. Test Cases

The Phase 2 Test Plan (`stelavox_phase2_test_plan_v1_0.md`) is the authoritative test register. Every endpoint above produces these test groups:

| Endpoint | Test groups |
|---|---|
| POST `/api/documents/[id]/nodes`     | happy paths × 3 (root child, mid-tree, leaf parent + max depth); validation × ~12; auth × 2; tree integrity × 5 (cycle impossible at create, but invalid_parent / layer_violation / max_depth / lock cases × 2 each); RLS × 2 |
| GET `/api/documents/[id]/nodes`      | happy × 3 (empty doc except root, small tree, deeper tree); validation × 3; auth × 2; RLS × 2 |
| GET `/api/nodes/[id]`                | happy × 1; validation × 2; auth × 2; RLS × 1 |
| PATCH `/api/nodes/[id]`              | happy × 5 (rename, status, target, instruction, content); forbidden-field × 7; validation × 6; locks × 2; auth × 2; RLS × 2 |
| DELETE `/api/nodes/[id]`             | happy × 2 (leaf, mid-tree with descendants); cannot_delete_root × 1; locks × 2; renumber correctness × 2; auth × 2; RLS × 2 |
| PATCH `/api/nodes/[id]/move`         | happy × 4 (within parent, to new parent, to first position, to last position); cycle × 2 (self, descendant); layer_violation × 2; invalid_position × 3; locks × 3; renumber correctness × 3; depth recalc × 2; auth × 2; RLS × 2 |
| POST `/api/projects/[id]/documents` (modified) | response shape × 1 (verify root_node present, correct node_type per template, root_node.name = document.name); root_node_id back-fill × 1; idempotency unchanged from Phase 1 |

Tree-integrity invariants from §2.11 each have at least one direct test case:

| Invariant | Test |
|---|---|
| Root uniqueness | TC-D-XX: GET `/nodes` after document creation returns exactly one node with `parent_id = null`. |
| Same-document containment | TC-A-XX: POST with `parent_id` from another document returns 422. |
| Acyclic | TC-A-XX: move node to its own descendant returns 422 cycle_detected. |
| Layer hierarchy | TC-A-XX: POST `chapter` under root (layer 0 = book) — fail unless `chapter` is layer 1; POST `scene` under root — always fail. |
| Dense sibling order | TC-D-XX: after delete + insert + move, `SELECT order FROM nodes WHERE parent_id = X ORDER BY order` is a contiguous 1..N. |
| Depth = parent.depth + 1 | TC-D-XX: cross-parent move correctly recomputes descendants' depth. |
| Lock propagation | TC-A-XX: PATCH a node whose grandparent is locked returns 423 parent_locked. |
| Category restriction | TC-A-XX: POST with `node_category = "context"` returns 400 invalid_category. |

The exact case ID assignments (`TC-U-NN`, `TC-A-NN`, `TC-B-NN`, `TC-D-NN`) are in the Phase 2 Test Plan.

---

## 5. Specification Gaps Found While Writing This Contract

Items raised during contract authoring that imply a TA or Product Spec update.

### G-1 — `nodes.scope` semantics for structural nodes

`nodes.scope` (Migration 004) admits `'project'` or `'document'`. This is meaningful for context nodes (Product Spec §4.7: "Project vs document scope") but not for structural nodes — a chapter is always document-scoped. The contract will treat `scope` as `NULL` for all Phase 2 (structural) creates and not return it in the node response. **Action:** TA v1.5 should clarify that `scope` is non-NULL only for `node_category = 'context'`.

### G-2 — Layer stack template for the root node's `name`

Migration 020 sets the root node's `name` to the document's `name`. Some authors might prefer the root to default to the layer label (e.g. "Untitled Novel" → root name "Book") and rename the root explicitly. Either choice is defensible; the contract picks **document name** as the default because it preserves the user's most recent naming intention. The user can immediately rename via PATCH if desired. **Action:** Product Spec §4.5 should document this default in v1.3.

### G-3 — `nodes.version` bump on PATCH

The contract says PATCH "bumps `version`." Migration 003 (Phase 1 RLS) does not include a version-bump trigger; the column has `DEFAULT 1` but no automatic increment. **Resolution:** Phase 2 adds a Migration 023 with a `BEFORE UPDATE` trigger that increments `version` on any row update where a content field (`summary`, `prose`, `notes`, `metadata`) changed. Non-content updates (e.g. `name`, `status`) do **not** bump version — they are not user-content changes. The trigger logic is documented in the Phase 2 Build Checklist.

### G-4 — Error code `parent_locked` versus `node_locked`

The contract distinguishes `node_locked` (target is `locked = TRUE`) from `parent_locked` (target is unlocked but an ancestor is locked). The product specification does not yet make this distinction; it just describes "node locking" as preventing changes. The two-code split is useful for client UX: `node_locked` lets the user see "this chapter is locked"; `parent_locked` lets the client say "Act 1 is locked — unlock it to edit Chapter 3". **Action:** TA v1.5 §5 should add a one-line note to the locking discussion, or this is documented in Phase 6's contract when locking UI ships.

---

## 6. Approval

This contract is frozen for Phase 2 build when the human reviewer approves it in writing or in the commit message that merges it into `master`. Any change after freeze requires a version bump and a changelog entry below.

The three architectural questions that shaped this contract were resolved before drafting:

| # | Question | Choice | Rationale |
|---|---|---|---|
| Q1 | Endpoint shape | Hybrid REST (Phase 1 pattern): document-scoped POST and list, top-level GET/PATCH/DELETE/move | Consistency with Phase 1; RLS provides cross-tenancy safety regardless of URL nesting; matches react-arborist's call-site context. |
| Q2 | Reorder shape | `PATCH /api/nodes/[id]/move` with `{parent_id, position}` | Matches react-arborist `onMove` event shape; cross-parent moves stay atomic in one call; layer-hierarchy validation has one place to live. |
| Q3 | Root-node creation timing | Atomic with document creation (extend `create_document_with_layer_stack`) | No partial-state surface; no concurrent-tab race; layer template is already in scope; structurally same pattern as the existing two-table RPC. |

---

## 7. Changelog

**v1.0 — 2026-05-04** Initial frozen contract for Phase 2 build. Defines six new routes (`POST/GET /api/documents/[id]/nodes`, `GET/PATCH/DELETE /api/nodes/[id]`, `PATCH /api/nodes/[id]/move`) and one modified route (`POST /api/projects/[id]/documents` response shape gains `root_node`). Three new migrations (020 — extend `create_document_with_layer_stack` to insert root node; 021 — `move_node` RPC for atomic move + renumber + cycle/layer/lock checks; 023 — version-bump trigger on content-field UPDATE). Migration number 022 is intentionally skipped — no legacy-data backfill is required while we remain pre-launch (clean-slate assumption per human direction). Cross-cutting tree-integrity rules in §2.11 codify the eight invariants every endpoint upholds. Four specification gaps (G-1 to G-4) raised for absorption into TA v1.5 or Product Spec v1.3.
