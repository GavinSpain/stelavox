# Stelavox — Phase 4 API Contract
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 4 build. Defines every API route added or modified in Phase 4 (Context System). Companion to `stelavox_phase4_test_plan_v1_0.md` and `stelavox_phase4_build_checklist_v1_0.md`. Source of truth for endpoint shape, validation, error codes, the structural↔context linking rules, project- vs document-scope semantics, and the metadata-schema convention. Cross-cutting rules unchanged since Phase 1 / 2 / 3 are inherited from `stelavox_phase1_api_contract_v1_0.md` §2, `stelavox_phase2_api_contract_v1_0.md` §2, and `stelavox_phase3_api_contract_v1_0.md` §2 — those sections below say "unchanged from Phase N."

**Phase:** 4 — Context System: context node CRUD, project- vs document-scope, structural↔context linking, per-type metadata schemas (six core context types), Sidebar context library, Detail-panel Context tab.
**Phase 4 checkpoint criteria (Technical Architecture v1.7 §11):** "Can create characters/locations; link them to scenes."
**Companion documents:** `stelavox_phase4_test_plan_v1_0.md`, `stelavox_phase4_build_checklist_v1_0.md`. Cross-cutting rules unchanged since Phase 3 are inherited from earlier phases' API contracts; only the additions are spelled out here.

---

## 1. Phase Scope

### 1.1 Routes added in Phase 4

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects/[projectId]/context-nodes` | Create a project- or document-scoped context node |
| GET | `/api/projects/[projectId]/context-nodes` | Paginated list of context nodes for a project (filterable by scope, document_id, node_type) |
| POST | `/api/nodes/[nodeId]/context-links` | Link a structural node to a context node (creates one row in `node_context_links`) |
| DELETE | `/api/nodes/[nodeId]/context-links/[contextNodeId]` | Remove a single structural↔context link |
| GET | `/api/nodes/[nodeId]/context-links` | List direct and ancestor-inherited context links for a structural node |
| GET | `/api/nodes/[nodeId]/back-links` | List structural nodes that link to a context node (powers the delete-confirmation flow) |

### 1.2 Routes modified in Phase 4

None. The Phase 2 PATCH/GET/DELETE endpoints on `/api/nodes/[id]` carry forward unchanged for context nodes — a context node is still a row in the `nodes` table, just with `node_category = 'context'`. The Phase 3 optimistic-concurrency contract (`expected_version`, 409 `version_conflict`) applies to context-node PATCHes identically to structural-node PATCHes.

The existing `POST /api/documents/[documentId]/nodes` route is **deliberately not extended** to admit context nodes. Its validation schema's `NODE_CATEGORY_V2 = ['structural']` is left intact. All context-node creation goes through the new project-level POST in §1.1 — a single creation endpoint avoids the "two routes do almost the same thing" failure mode that the Phase 3 build flagged for autosave (TC-A-32 race).

### 1.3 Routes removed in Phase 4

None.

### 1.4 Database changes

**None.** All schema needed by Phase 4 was completed in Phase 1 (Migrations 004 and 005):

- `nodes.node_category` (CHECK constraint includes `'context'`).
- `nodes.scope` (CHECK constraint admits `'project' | 'document'`; non-NULL only when `node_category = 'context'` — the conditional NOT NULL is enforced at the API layer per TA v1.5 §3.6 SU-1 / G-1 below).
- `nodes.metadata` (JSONB, free-form).
- `node_context_links` (junction table; UNIQUE on `(source_node_id, target_node_id)`; ON DELETE CASCADE on both sides).
- RLS policies on both tables (`org_members_access_nodes`, `org_members_access_context_links`).

Phase 4 is a thin contract layer over the schema that already exists, in the same shape as Phase 3 was. No `lib/types/database.ts` regeneration is expected.

### 1.5 Auth surface

Unchanged from Phase 1. All Phase 4 routes require an authenticated session via the cookie-bound Supabase client. RLS on `nodes` (Migration 004) and `node_context_links` (Migration 005) is the authoritative cross-tenancy boundary; no new policies are added in Phase 4.

---

## 2. Cross-Cutting Rules

### 2.1 Authentication

Unchanged from Phase 1 §2.1 / Phase 2 §2.1 / Phase 3 §2.1.

### 2.2 Authorisation

Unchanged from Phase 2 §2.2. RLS on `nodes` admits a row only when the caller is a member of the organisation that owns the row's `project_id`. RLS on `node_context_links` admits a row only when the caller is a member of the link's `organisation_id`. A request for a node, link, or context node the caller cannot see returns `404 not_found` — never `403`. The 404 is indistinguishable from a request for a row that does not exist.

### 2.3 Error envelope

Unchanged from Phase 1 §2.3. Phase 4 adds the following codes:

| Code | Status | Where |
|---|---|---|
| `invalid_scope` | 400 | POST `/projects/[id]/context-nodes` body `scope` not in `{'project','document'}` |
| `invalid_node_type` | 400 | POST `/projects/[id]/context-nodes` body `node_type` not in the V1 context-type whitelist |
| `scope_document_mismatch` | 400 | `scope='document'` with no `document_id`, or `scope='project'` with a `document_id` set |
| `document_not_in_project` | 400 | `document_id` references a document not in this project |
| `invalid_link_target` | 400 | POST `/nodes/[id]/context-links` body `context_node_id` references a node with `node_category != 'context'` |
| `invalid_link_source` | 400 | POST `/nodes/[id]/context-links`: `[id]` is a context node (V1 forbids context↔context links) |
| `link_already_exists` | 409 | POST `/nodes/[id]/context-links` for a `(source, target)` pair already in `node_context_links` |
| `link_cross_project` | 400 | Source and target nodes belong to different projects |
| `link_cross_document` | 400 | Source is a structural node in document A, target has `scope='document'` and `document_id = B` |
| `cannot_delete_with_back_links` | 409 | DELETE `/api/nodes/[id]` for a context node that still has rows in `node_context_links.target_node_id`. Optional via `?force=true` query param to cascade. |

All Phase 1 / 2 / 3 codes carry over unchanged.

The `409 link_already_exists` response body has a non-standard shape because the client may want to render the existing link rather than re-create:

```json
{
  "error": "link_already_exists",
  "message": "Link from <source_node_id> to <target_node_id> already exists.",
  "link": { /* full link object per §2.13 */ }
}
```

The `409 cannot_delete_with_back_links` response body includes a `back_links_count` so the client can render a confirmation dialog without a separate round-trip:

```json
{
  "error": "cannot_delete_with_back_links",
  "message": "Context node has 5 incoming links. Pass ?force=true to cascade.",
  "back_links_count": 5
}
```

### 2.4 Status codes used in this phase

`200`, `201` (POST creates), `400`, `401`, `404`, `409` (existing — `version_conflict` from Phase 3, plus new `link_already_exists` and `cannot_delete_with_back_links`), `422`, `423`, `500`. No new codes introduced; the existing 409 carries Phase 4's two new conditions in addition to Phase 3's `version_conflict`.

When both `link_already_exists` (409) and any 4xx body-validation error apply on the same request, **body validation wins**: the contract is "validate, then check uniqueness." This ordering matches Phase 2's POST `/api/documents/[documentId]/nodes` (validate body, then check parent existence and lock state). Test cases verify this ordering (TC-A-12).

### 2.5 Validation rules — common

Unchanged from Phase 3 §2.5 plus:

| Field | Rule |
|---|---|
| `scope` | Required string on POST `/projects/[id]/context-nodes`. Must be `'project'` or `'document'`. Forbidden on PATCH (immutable after creation — see G-1). |
| `document_id` | Optional UUID on POST. Required when `scope='document'`; forbidden when `scope='project'`. The referenced document must belong to the path `projectId`. |
| `node_type` (context) | Required string on POST `/projects/[id]/context-nodes`. **V1 whitelist:** `'character'`, `'location'`, `'organisation'`, `'theme'`, `'plot_thread'`, `'world'`. Any other value → `400 invalid_node_type`. (See G-4.) |
| `name` | Required, max 200 chars (carries from Phase 2 — but **mandatory** here, not optional, because a context node without a name is unusable in the Sidebar and Picker UIs). Trimmed; empty-after-trim → `400 invalid_name`. |
| `metadata` | Optional JSON object. Free-form server-side per G-2; client-side validated against the per-type schema in `lib/context/metadata-schemas.ts`. Same 100-key / 100-character-key / 64KB-value limits inherited from Phase 2. |
| `context_node_id` | Required UUID on POST `/api/nodes/[id]/context-links`. Must reference a row with `node_category='context'` (else `400 invalid_link_target`). |
| `position` (links list) | Not used. Inherited links and direct links are surfaced in two separate ordered groups; no client-controlled link ordering in V1. |

The Phase 2 / 3 forbidden-field list carries over. On PATCH of a context node, additionally: `scope`, `document_id`, `parent_id`, `node_category`, `node_type` are forbidden (return `400 unknown_field`). The Phase 2 `/move` endpoint is **forbidden on context nodes** and returns `400 invalid_move_target` if called against one (G-5 below). Context nodes have no parent and cannot be moved.

### 2.6 Idempotency

Unchanged from Phase 1 §2.6. Note: POST `/api/nodes/[id]/context-links` is **not idempotent** — a duplicate POST returns `409 link_already_exists` rather than a fresh 201. This matches the table's `UNIQUE(source_node_id, target_node_id)` constraint; the contract surfaces the constraint rather than masking it.

Clients that want idempotent linking SHOULD GET the link list first and skip the POST when the pair already exists. The 409 path remains the safety net for the race window.

### 2.7 Rate limiting

Unchanged from Phase 3 §2.7 (deferred to V2).

### 2.8 Pagination

`GET /api/projects/[projectId]/context-nodes` is **paginated**. A trilogy with a deep character library can accumulate hundreds of context nodes; listing all on every Sidebar render is wasteful.

Pagination contract:

- Query parameters: `?limit=` (1–200, default **100**) and `?offset=` (≥ 0, default 0). The cap is higher than Phase 3's version-list (100) because the Sidebar normally wants every context node visible; 100 covers most projects in one call, 200 covers very large libraries.
- Filter parameters (orthogonal — combine freely):
  - `?scope=project` or `?scope=document` — restrict to one scope.
  - `?document_id=<uuid>` — restrict to context nodes whose `document_id` equals this. Implies `scope='document'` plus the project-scoped nodes that are inherited (decision: G-3 below).
  - `?node_type=character` — restrict to one of the V1 whitelist types.
- Order: ascending by `node_type`, then by `name` (case-insensitive). Sidebar groups by type; alphabetical within group is the natural reading order.
- Response: `{ "context_nodes": [...], "total": <integer>, "has_more": <boolean> }`. `total` is the count of accessible rows (RLS-filtered, post-filter); `has_more` is `(offset + context_nodes.length) < total`.

`GET /api/nodes/[id]/context-links` and `GET /api/nodes/[id]/back-links` are **not paginated**. A single structural node has tens of links at most; the Picker UI flow does not need pagination here. If V2 surfaces a structural node with >500 links the contract may revisit.

### 2.9 Timestamps and date formats

Unchanged from Phase 1 §2.9.

### 2.10 Caller's organisation

Unchanged from Phase 1 §2.10.

### 2.11 Context-system invariants

These are the invariants every Phase 4 surface upholds. The client is the principal author of correctness for some; the contract documents the expected behaviour so the test plan can verify it end-to-end.

1. **Context node `scope` is immutable after creation.** Once a node is created with `scope='project'` it never becomes document-scoped, and vice versa. PATCH rejects `scope` as an unknown field. Change of mind = delete + recreate. (Rationale: scope changes the eligibility of every existing link; the migration path is non-trivial and not in V1 scope.)

2. **Context node `document_id` is immutable after creation.** Same rationale as scope. A document-scoped context node is stuck in its document.

3. **Context nodes have no parent.** `nodes.parent_id` is always NULL for context nodes. The structural node tree (`react-arborist`) does not show context nodes; the Sidebar's Context library is the only UI surface that lists them.

4. **Context-to-context linking is forbidden in V1.** `node_context_links.link_type = 'context_to_context'` is in the schema (Migration 005 enum) but no Phase 4 endpoint emits it. POST `/api/nodes/[id]/context-links` rejects with `invalid_link_source` if `[id]` is a context node. Per Product Spec §4.7 row 4, context↔context is Phase 3a (Roadmap) work.

5. **A document-scoped context node can only be linked from structural nodes in its own document.** A `scope='document'` context node with `document_id = D` cannot be linked from a structural node in document `D'` (≠ D). Enforced at link-creation; returns `400 link_cross_document`.

6. **A project-scoped context node can be linked from any document in the project.** The cross-document allowance is the entire point of project-scope (Product Spec §4.7 row 3 — "shared across all documents").

7. **The structural link source must be in the same project as the context target.** Enforced at link-creation; returns `400 link_cross_project`. RLS would already block cross-org access; the same-project check is a within-org guard against accidental cross-project linking when a user has access to multiple projects in the same organisation.

8. **Inherited-link surfacing is purely a read-side concern.** The client's "inherited from ancestor" UI in `ContextLinker` and the `/api/nodes/[id]/context-links` response are computed by walking the structural ancestor chain at read time. There is no `inherited` flag stored in `node_context_links` — the table records direct links only. (Rationale: ancestors can be re-parented via the Phase 2 `/move` RPC; recomputing inheritance on read is cheaper and safer than maintaining a denormalised list.)

9. **Closest ancestor wins when an inherited link is duplicated up the tree.** If an ancestor at depth 1 and another at depth 3 both link the same context node, the inherited-link entry surfaces `inherited_from = <depth-3 ancestor>` (the closer one). The depth-1 link is suppressed in the response — the user sees one entry per context node, attributed to the closest ancestor. (G-3 below.)

10. **A direct link supersedes an inherited link.** If structural node N directly links context node C, *and* an ancestor of N also directly links C, the response surfaces only the direct link on N; the ancestor's link does not appear as "inherited" (it would be redundant). The ancestor's `/context-links` response still shows its own link as direct.

11. **A context node delete with active back-links requires `?force=true`.** The default DELETE returns `409 cannot_delete_with_back_links` with the count. This is a soft guard, not a hard one — `?force=true` cascades the deletion of all `node_context_links` rows targeting the node (FK `ON DELETE CASCADE` already does this at the DB level; the API guard is for UX confirmation). Structural nodes have no equivalent guard — the structural cascade is owned by the document tree's own delete semantics.

12. **Metadata is free-form server-side; per-type schemas are client-side.** Phase 4 ships per-type schemas for the six core context types in `lib/context/metadata-schemas.ts`. The MetadataForm renders the schema; the API does not validate `metadata` against it. The PATCH route accepts any JSON object that fits the size limits inherited from Phase 2 / 3. (G-2 below.)

### 2.12 Response shape — context node object

A context node's response shape extends the node shape from Phase 3 §2.12 with the following always-present fields:

| Field | Type | Source | Notes |
|---|---|---|---|
| `node_category` | `'context'` | column | Always `'context'` for context-node responses. |
| `scope` | `'project' \| 'document'` | column | Always non-NULL for context nodes (G-1). |
| `document_id` | `uuid \| null` | column | NULL when `scope='project'`; non-NULL when `scope='document'`. |
| `parent_id` | `null` | column | Always NULL for context nodes. Surfaced in the response so type narrowing works the same way as for structural nodes. |
| `is_leaf` | `false` | server-derived | Always `false` for context nodes — they are not in any layer-stack and `layer_index` is NULL. The `false` value is a convention (the field cannot be "true" for a non-structural node); it preserves the Phase 3 §2.12 invariant that every node response has `is_leaf`. |
| `metadata` | object | column | Free-form per G-2. Defaults to `{}` on creation. |

All other Phase 2 / 3 node fields carry over (`id`, `name`, `summary`, `prose`, `notes`, `tags`, `status`, `version`, timestamps, etc.). Context-specific fields irrelevant in V1 (e.g. `word_count_target`) remain on the row but are not surfaced.

### 2.13 Response shape — context link object

Returned by POST `/api/nodes/[id]/context-links`, `GET /context-links`, and (as a sub-object) `GET /back-links`:

```json
{
  "id": "uuid",
  "source_node_id": "uuid",
  "target_node_id": "uuid",
  "link_type": "structural_to_context",
  "created_at": "2026-05-04T10:30:00.000Z"
}
```

`organisation_id` is omitted from the response (server-internal RLS gate, not interesting to clients). `link_type` is always `'structural_to_context'` in V1 — the field is present so V2's `'context_to_context'` path can ship without a wire change.

### 2.14 Response shape — `/context-links` (list)

The list endpoint groups direct and inherited entries:

```json
{
  "direct": [
    {
      "link": { /* link object per §2.13 */ },
      "context_node": { /* context node object per §2.12 */ }
    }
  ],
  "inherited": [
    {
      "link": { /* link object — its source is an ancestor */ },
      "context_node": { /* context node object */ },
      "inherited_from": {
        "id": "uuid",
        "name": "Chapter 3",
        "node_type": "chapter",
        "depth": 2
      }
    }
  ]
}
```

`direct` is ordered by link `created_at` ASC (oldest first — UI shows them in order added). `inherited` is ordered by ancestor depth DESC (closest ancestor first). Per §2.11 invariant 9, an inherited entry duplicated up the chain only appears once (closest); per invariant 10, an inherited entry whose context node is also directly linked is suppressed.

### 2.15 Response shape — `/back-links`

```json
{
  "back_links": [
    {
      "structural_node": {
        "id": "uuid",
        "name": "Chapter 3, Scene 2",
        "node_type": "scene",
        "depth": 3,
        "document_id": "uuid",
        "document_name": "The Northern Light"
      },
      "link": { /* link object per §2.13 */ }
    }
  ],
  "total": 5
}
```

Ordered by `document_name` ASC, then `depth` ASC, then `name` ASC — gives the user a stable, document-grouped reading order for the delete-confirmation modal. `total` reflects all back-links (no pagination — see §2.8 rationale).

---

## 3. Endpoint Specifications

Each endpoint follows the Phase 1 / 2 / 3 contract structure: purpose → request → success → failure modes → RLS notes.

### 3.1 `POST /api/projects/[projectId]/context-nodes` — Create context node

**Purpose.** Create a project- or document-scoped context node. Single creation endpoint for both scopes; the body's `scope` field selects which.

**Path parameter:** `projectId` — UUID of the project. Caller must be a member of the organisation that owns the project (RLS).

**Request body:**

```json
{
  "scope": "project",
  "node_type": "character",
  "name": "Elena Vasquez",
  "short_description": "Protagonist; lawyer in her early 40s",
  "summary": "<optional Tiptap JSON string>",
  "notes": "<optional Tiptap JSON string>",
  "metadata": { "role": "protagonist", "age": 42, "want": "...", "fear": "..." },
  "tags": ["pov-character"]
}
```

For `scope='document'` a `document_id` field is required:

```json
{
  "scope": "document",
  "document_id": "<uuid>",
  "node_type": "location",
  "name": "The North Tower",
  "metadata": { "region": "Northern City", "climate": "subarctic" }
}
```

**Validation order** (first failure wins):

1. `projectId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `Content-Type: application/json` — else `400 invalid_json`.
4. Body parses as JSON object — else `400 invalid_json` or `400 missing_body`.
5. No unknown fields — else `400 unknown_field`.
6. `scope` present and in `{'project','document'}` — else `400 invalid_scope`.
7. `node_type` present and in V1 whitelist — else `400 invalid_node_type`.
8. `name` present, string, length 1–200 after trim — else `400 invalid_name`.
9. Other fields validated per §2.5 / Phase 2 §2.5 — else `400 invalid_<field>`.
10. Scope/document_id consistency:
    - `scope='document'` AND no `document_id` → `400 scope_document_mismatch`.
    - `scope='project'` AND `document_id` set → `400 scope_document_mismatch`.
11. Project exists and is visible (RLS) — else `404 project_not_found`.
12. If `scope='document'`: document exists, is visible, and `document.project_id === projectId` — else `400 document_not_in_project` (when document exists in another project) or `404 document_not_found` (when document does not exist).
13. Insert the row. Server sets `node_category='context'`, `parent_id=null`, `depth=null`, `layer_index=null`, `version=1`, `status='draft'`, `created_at`, `updated_at`. Inherited from project: `organisation_id`. Inherited from document if `scope='document'`: `document_id`.

**Success (201):** The full context node object per §2.12.

**Failure modes:**

| Code | Status | When |
|---|---|---|
| `invalid_uuid` | 400 | `projectId` not a valid UUID |
| `invalid_json` | 400 | Content-Type wrong or body not JSON |
| `missing_body` | 400 | Body has no fields |
| `unknown_field` | 400 | Body contains a field outside the allowed set |
| `invalid_scope` | 400 | `scope` not in `{'project','document'}` |
| `invalid_node_type` | 400 | `node_type` not in the V1 whitelist |
| `invalid_<field>` | 400 | Field-level validation failed (length, type) |
| `scope_document_mismatch` | 400 | `scope`/`document_id` pair inconsistent |
| `document_not_in_project` | 400 | `document_id` references a document in a different project |
| `unauthorised` | 401 | No session |
| `project_not_found` | 404 | Project does not exist or RLS hides it |
| `document_not_found` | 404 | `scope='document'` and document does not exist or RLS hides it |

**RLS notes:** The route uses the user-session client. The INSERT passes through the `nodes` policy from Migration 004 — a row inserted with a `project_id` not in the caller's organisation membership would be rejected by RLS. Belt-and-braces: the route also checks `getProject(supabase, projectId)` returns a row before insertion (a hidden project would 404 here, never leaking the project's existence).

### 3.2 `GET /api/projects/[projectId]/context-nodes` — List context nodes

**Purpose.** Return the project's context nodes, paginated, with optional scope/document/type filters. Backs the Sidebar context library, the Picker dropdown, and the document-level Context library.

**Path parameter:** `projectId` — UUID of the project.

**Query parameters:**

| Name | Type | Default | Range |
|---|---|---|---|
| `limit` | integer | 100 | 1–200 |
| `offset` | integer | 0 | ≥ 0 |
| `scope` | string | (all) | `project` \| `document` |
| `document_id` | uuid | (none) | Any UUID. **See G-3 for inheritance semantics.** |
| `node_type` | string | (all) | Any string in the V1 whitelist |

**Validation order:**

1. `projectId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `limit`, `offset` (if present) are valid integers in range — else `400 invalid_query`.
4. `scope` (if present) is a valid value — else `400 invalid_query`.
5. `document_id` (if present) is a valid UUID and references a document in this project — else `400 invalid_query` (UUID malformed) or `404 document_not_found` (document does not exist or is in another project).
6. `node_type` (if present) is in the V1 whitelist — else `400 invalid_query`.
7. Project exists and is visible — else `404 project_not_found`.

**Success (200):**

```json
{
  "context_nodes": [ /* §2.12 objects */ ],
  "total": 12,
  "has_more": false
}
```

**Behaviour notes (G-3):** When `document_id` is supplied, the response includes:
- All context nodes with `scope='document' AND document_id=<param>` (the document's own private context library).
- All context nodes with `scope='project'` for the path `projectId` (project-scoped context is shared across all the project's documents — Product Spec §4.7 row 3).

When `document_id` is omitted, the response includes every context node in the project (all scopes, all documents). When `scope='project'` is supplied without `document_id`, only project-scoped nodes are returned. When `scope='document'` is supplied without `document_id`, every document-scoped node in the project is returned (rare; mainly an admin path).

**Failure modes:** `invalid_uuid` (400), `invalid_query` (400), `unauthorised` (401), `project_not_found` (404), `document_not_found` (404).

**RLS notes:** Same as Phase 2 list endpoints. RLS filters per-organisation; the route's project-existence and document-in-project checks are within-organisation guards.

### 3.3 `POST /api/nodes/[nodeId]/context-links` — Create link

**Purpose.** Link a structural node to a context node. Inserts one row in `node_context_links` with `link_type='structural_to_context'`.

**Path parameter:** `nodeId` — UUID of the **structural** source node.

**Request body:**

```json
{ "context_node_id": "<uuid>" }
```

**Validation order:**

1. `nodeId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `Content-Type: application/json` — else `400 invalid_json`.
4. Body parses, has `context_node_id` (UUID), no other fields — else `400 invalid_json` / `unknown_field` / `invalid_uuid`.
5. Source node exists and is visible — else `404 not_found`.
6. Source node is structural (`node_category='structural'`) — else `400 invalid_link_source`.
7. Target context node exists and is visible — else `404 context_node_not_found`.
8. Target node is a context node (`node_category='context'`) — else `400 invalid_link_target`.
9. Source and target belong to the same project — else `400 link_cross_project`.
10. If target's `scope='document'`: target's `document_id` equals source's `document_id` — else `400 link_cross_document`.
11. Source node lock check: `nodes.locked` for source — else `423 node_locked`. Then ancestor lock check — else `423 parent_locked`. (Linking is a write to the link table that semantically modifies the source node's context state; we treat lock-state on the source the same way Phase 3 treats lock on the editable node.)
12. Insert. The UNIQUE(source_node_id, target_node_id) constraint catches duplicates — on conflict, fetch the existing row and return `409 link_already_exists`.

**Success (201):** The full link object per §2.13.

**Failure modes:**

| Code | Status | When |
|---|---|---|
| `invalid_uuid` | 400 | `nodeId` or `context_node_id` not a valid UUID |
| `invalid_json` | 400 | Body not JSON |
| `unknown_field` | 400 | Unknown field in body |
| `invalid_link_source` | 400 | Source is a context node |
| `invalid_link_target` | 400 | Target is a structural node |
| `link_cross_project` | 400 | Source and target are in different projects |
| `link_cross_document` | 400 | Target is `scope='document'` and source is in a different document |
| `unauthorised` | 401 | No session |
| `not_found` | 404 | Source node does not exist or RLS hides it |
| `context_node_not_found` | 404 | Target node does not exist or RLS hides it |
| `node_locked` | 423 | Source node is locked |
| `parent_locked` | 423 | A source ancestor is locked |
| `link_already_exists` | 409 | UNIQUE constraint hit on `(source, target)` |

**RLS notes:** Both `nodes` and `node_context_links` enforce RLS at the database. The route's pre-checks (existence, category, scope) execute under the user-session client and return 404 for hidden rows. The INSERT itself relies on RLS to enforce that both nodes are accessible — a stale token couldn't insert a row referencing rows it can't see. The 409 path's `existing_link` is fetched via the user-session client; if the existing link is RLS-hidden (which it cannot be in V1, since linking requires both endpoints visible to the same caller) the route returns 404 instead.

### 3.4 `DELETE /api/nodes/[nodeId]/context-links/[contextNodeId]` — Delete link

**Purpose.** Remove a single structural↔context link. Idempotent at the resource level — deleting a non-existent link returns 404.

**Path parameters:** `nodeId` (source UUID) and `contextNodeId` (target UUID).

**Validation order:**

1. Both UUIDs valid — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Source node exists and is visible — else `404 not_found`.
4. Target context node exists and is visible — else `404 context_node_not_found`.
5. Lock check on source (same as POST, per §3.3 step 11) — else `423`.
6. Delete the row matching `(source_node_id, target_node_id)`. If no row matched, `404 link_not_found`.

**Success (200):**

```json
{ "deleted": true, "source_node_id": "<uuid>", "target_node_id": "<uuid>" }
```

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `context_node_not_found` (404), `link_not_found` (404), `node_locked` (423), `parent_locked` (423).

**RLS notes:** Same as §3.3.

### 3.5 `GET /api/nodes/[nodeId]/context-links` — List links

**Purpose.** Return the structural node's direct links plus its ancestor-inherited links, formatted per §2.14. Backs the `ContextLinker` component (Component Spec §5.12).

**Path parameter:** `nodeId` — UUID of the structural node.

**Validation order:**

1. `nodeId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Source node exists, is visible, is structural — else `404 not_found` (RLS-hidden) or `400 invalid_link_source` (visible but is a context node — V1 forbids the GET on context sources too, since context nodes have no ancestors).

**Algorithm:**

1. Fetch the structural node and its ancestor chain (walk `parent_id` to the root). The chain is at most 6 hops in V1 (Series template = 6 layers).
2. Single query: `SELECT … FROM node_context_links JOIN nodes ON … WHERE source_node_id IN (<node_id>, <ancestor_ids…>)`.
3. Bucket the rows: rows where `source_node_id == nodeId` are "direct". The rest are candidates for "inherited".
4. For inherited candidates, dedupe by `target_node_id`: keep the one whose source has the greatest depth (closest ancestor — invariant 9). Suppress any candidate whose `target_node_id` already appears in `direct` (invariant 10).
5. Return per §2.14.

**Success (200):** Per §2.14.

**Failure modes:** `invalid_uuid` (400), `invalid_link_source` (400 — when called on a context node), `unauthorised` (401), `not_found` (404).

**RLS notes:** The IN-list query is RLS-filtered automatically. If an ancestor is in another organisation (impossible in V1, since the structural tree is per-project) its links are silently dropped from the response.

### 3.6 `GET /api/nodes/[nodeId]/back-links` — List back-links to a context node

**Purpose.** Return all structural nodes that link to a given context node. Backs the delete-confirmation flow ("This character is linked from 5 chapters — proceed?").

**Path parameter:** `nodeId` — UUID of the **context** node.

**Validation order:**

1. `nodeId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Node exists and is visible — else `404 not_found`.
4. Node is a context node (`node_category='context'`) — else `400 invalid_link_target` (context-node back-links only — calling this on a structural node is meaningless in V1).

**Success (200):** Per §2.15.

**Failure modes:** `invalid_uuid` (400), `invalid_link_target` (400), `unauthorised` (401), `not_found` (404).

**RLS notes:** The implicit JOIN on `nodes` (for the structural node and its document) is RLS-filtered. Back-links to nodes in another organisation are dropped. (Cross-org back-links are impossible in V1 because both link endpoints share `organisation_id`.)

---

## 4. Test Cases

The Phase 4 Test Plan (`stelavox_phase4_test_plan_v1_0.md`) is the authoritative test-case list. Summary by area:

| Area | Section | Approximate count |
|---|---|---|
| UI checkpoint (TC-U) | §2 | 22 — Sidebar library renders, type icons, [+] flow, ContextLinker direct + inherited, NodePicker filter, MetadataForm per-type, ContextCreateModal, scope toggle, delete-confirmation |
| Visual / state (TC-V) | §3 | 6 — Sidebar collapsible state, inherited 0.7 opacity tint, context icon colours, type-icon size 14px |
| Motion / transitions (TC-M) | §4 | 4 — Modal entry/exit, Picker dropdown 200ms, prefers-reduced-motion |
| API integration (TC-A) | §5 | 36 — POST/GET/PATCH/DELETE for context nodes; POST/DELETE/GET for links; back-links; pagination; filters |
| Authorisation boundary (TC-B) | §6 | 8 — RLS on context-node CRUD, link CRUD, cross-org rejection, cross-project rejection |
| Data integrity (TC-D) | §7 | 8 — UNIQUE on (source, target), cascade delete on either endpoint, scope/document_id consistency invariants, V1 whitelist, immutable scope/document_id |
| Accessibility (TC-AX) | §8 | 6 — keyboard navigation through Picker, ARIA on Sidebar collapsible, screen-reader announcement of link/unlink |

Approximate total: **90 cases** (vs. Phase 3's 99). The lower count reflects no transition timings as central as Phase 3's Focus Mode 280ms / Sentence Focus 200ms; Phase 4 has fewer locked motion timings.

---

## 5. Specification Gaps Found While Writing This Contract

These are gaps surfaced during contract drafting. They are recorded here so the build agent does not silently invent behaviour when it encounters them.

### G-1 — `nodes.scope` conditional NOT NULL is API-enforced, not DB-enforced

**Gap:** Migration 004 declares `nodes.scope TEXT CHECK (scope IN ('project','document'))` — value domain only. The check is on values, not nullability. Per TA v1.5 §3.6 SU-1, the rule "non-NULL only when `node_category='context'`; NULL when `'structural'`" is enforced at the API layer. Phase 4 is the first phase that actually creates context nodes, so the rule transitions from "documented future invariant" to "actively enforced contract."

**Resolution for Phase 4:** The POST `/projects/[id]/context-nodes` route always sets `scope` to the validated body value (never NULL for context). The PATCH route forbids `scope` and `document_id` (per invariants 1 and 2). The Phase 2 POST `/documents/[id]/nodes` route is unchanged — its inserts set `scope=null` for structural nodes.

**Test verification:** TC-D-01 verifies an `INSERT` via the user-session client with `node_category='context' AND scope IS NULL` is impossible through the public API (the only way to insert a context node is the new POST, which always sets scope). TC-D-02 verifies that direct service-role inserts that violate the rule are not produced by any production code path (a grep across `lib/data/`).

**SU candidate (Phase 4 → TA v1.8):** Add a PostgreSQL CHECK constraint to enforce the conditional NOT NULL at the DB layer. This is straightforward (`CHECK ((node_category != 'context') OR (scope IS NOT NULL))`) but requires a migration; deferred to post-merge to avoid expanding Phase 4 scope.

### G-2 — Server-side metadata schema validation deferred (continues Phase 3 G-4)

**Gap:** Product Spec §4.7 lists "metadata schemas (character, location, evidence, theme, etc.)" as Phase 1 (V1) work. Phase 3's G-4 deferred schema enforcement to "Phase 4 may add server-side schema validation." Phase 4 actually arrives with the schemas — should the API enforce them?

**Resolution for Phase 4:** **No.** Server-side schema validation is deferred to V2.

Rationale:
1. The six core context types each have 4–8 metadata fields; schemas are short and stable. Client-side validation is sufficient for UX (the form rejects invalid input before submission).
2. Schema mismatches today degrade gracefully — an unknown metadata key just isn't rendered by the form; a typed-string-where-number-expected is shown as text. No data loss.
3. The Director (Phase 5+) and Roadmap-Phase-3a operations may want to write `metadata` with extended keys that aren't in the V1 schemas (e.g., a research operation appending a `sources: [...]` array to a Character). A strict server-side schema would block these legitimate writes; relaxing later is harder than tightening.
4. V2's BYOK + multi-tenancy work introduces a `metadata_schemas` config table (per organisation, per type) that supersedes the hardcoded V1 schemas. Validation will live there.

The Phase 4 PATCH route accepts `metadata` per Phase 2 / 3 rules (size, key count). The MetadataForm component reads the per-type schema from `lib/context/metadata-schemas.ts` and renders fields accordingly. Free-form keys not in the schema are preserved on save (they round-trip through `metadata`) but not displayed in the form.

**SU candidate (V2 → TA + Product Spec):** Document the `metadata_schemas` table when V2 begins. Phase 4 lays the groundwork; V2 finishes it.

### G-3 — Inherited-link ordering and the `?document_id=` filter

**Gap:** Two related questions:

(a) When an ancestor at depth 1 and an ancestor at depth 3 both link the same context node, which one is surfaced as `inherited_from`?

(b) When the Sidebar requests `GET /context-nodes?document_id=D`, should it receive document-scoped nodes for D **only**, or document-scoped + project-scoped (since project-scoped are inherited into every document)?

**Resolution for Phase 4:**

(a) **Closest ancestor wins.** The `ContextLinker` UI shows one entry per inherited context node, attributed to the closest ancestor (highest depth). The depth-1 ancestor's link is suppressed in the response. The reasoning surfaces in Component Spec §5.12 — "Inherited from ancestors (4)" reads naturally when each entry has one source. This is invariant 9 in §2.11 and is verified by TC-A-19.

(b) **Document-scoped for D plus project-scoped for the project.** Project-scoped context nodes are visible from every document in the project (Product Spec §4.7 row 3). The Sidebar's "Context library" section is a per-project surface, but the document-level Context library (Component Spec §5.12 "linked context section") shows what's linkable in that document, which includes both. The contract returns both when `document_id` is supplied; the client renders them together.

**SU candidate (none).** This is a contract clarification, not an upstream-spec change.

### G-4 — Context node `node_type` whitelist

**Gap:** Product Spec §4.7 row 1 says "Character, Location, Organisation, Theme, Plot Thread, World, and 30+ other sub-types — Phase: 1 (core types); 2+ (extended)." Which six are V1 exactly? The schema is `nodes.node_type TEXT NOT NULL` — no enum. If Phase 4 ships without an explicit whitelist, the agent could create context nodes of any string and the UI would have no idea how to render them.

**Resolution for Phase 4:** The V1 whitelist is exactly the six types named in §4.7 row 1: `'character'`, `'location'`, `'organisation'`, `'theme'`, `'plot_thread'`, `'world'`. The POST route validates against this list and returns `400 invalid_node_type` for anything else. The whitelist lives in `lib/context/types.ts` as an exported `const CONTEXT_NODE_TYPES_V1` array; the Zod schema imports it.

Each type gets:
- A 14px Lucide icon mapping (`lib/context/icons.ts`).
- A metadata schema (`lib/context/metadata-schemas.ts`).
- A label and pluralised label (`lib/context/labels.ts` — "Character" / "Characters", etc.).

When V2 (or a roadmap phase) adds extended types, the whitelist expands and one migration / config-table update follows. Until then, the V1 set is hardcoded — per H-12 this is acceptable because the whitelist is an architectural enum, not an operational value (it changes with code, not with admin runtime configuration).

**SU candidate (Phase 4 → TA v1.8 / Product Spec v1.4):** Document the V1 whitelist authoritatively in Product Spec §4.7 (currently it lists the names in prose; pin the underscored slugs). Cross-reference TA H-12 to clarify the architectural-vs-operational distinction.

### G-5 — Move on a context node is forbidden

**Gap:** Phase 2's `POST /api/nodes/[id]/move` accepts any node and reparents it. A context node has `parent_id=null` and `depth=null`; moving it makes no sense. The route currently doesn't reject this — it would `move_node` RPC which would error on the layer-stack check (the context node has `layer_index=null`).

**Resolution for Phase 4:** The `POST /api/nodes/[id]/move` route is amended in Phase 4 to reject context-node sources at validation step 5 (between "node exists" and "lock check") with `400 invalid_move_target`. The error is added to the Phase 2 codes list.

**Test verification:** TC-A-32 verifies move on a context node returns 400; the existing Phase 2 move tests are unaffected.

**SU candidate (Phase 4 → Phase 2 contract amendment, applied at merge time):** No upstream spec change — a Phase 2 contract row is added to the phase-2 amendment log retroactively, same way Phase 3 amended the PATCH endpoint.

---

## 6. Approval

This API Contract is approved before any Phase 4 implementation begins. Changes after approval are version-bumped on this document. The Build Checklist treats this contract as the source of truth for endpoint shape, validation order, error codes, and the linking + scope contract.

The architectural decisions that shaped Phase 4 (and therefore this contract) are recorded here for sign-off:

| # | Decision | Choice |
|---|---|---|
| Q1 | Single context-creation endpoint or two? | **One** — `POST /projects/[id]/context-nodes` handles both scopes; `scope` field selects |
| Q2 | Extend existing POST `/documents/[id]/nodes` for context? | **No** — leave structural-only; cleaner separation of concerns |
| Q3 | Server-side metadata schema validation in V1? | **No** — client-side only; deferred to V2 (G-2) |
| Q4 | Context-to-context linking in V1? | **No** — Phase 3a roadmap (Product Spec §4.7 row 4) |
| Q5 | Closest-ancestor or all-ancestors for inherited links? | **Closest** — one entry per context node per response (G-3a) |
| Q6 | Six core types as a hardcoded enum? | **Yes** — V1 architectural whitelist; V2 migrates to config (G-4) |
| Q7 | Delete with active back-links: hard error or `?force=true`? | **`?force=true`** — soft guard returning a count; client renders confirmation |

Plus four implementation calls confirmed during contract drafting:

| # | Call | Choice |
|---|---|---|
| 1 | Move on context nodes | Forbidden — `400 invalid_move_target` (G-5) |
| 2 | Scope and document_id immutable after creation | Yes — PATCH rejects both as `unknown_field` (invariants 1 + 2) |
| 3 | Direct link supersedes inherited | Yes — invariant 10; verified by TC-A-20 |
| 4 | Cross-project / cross-document link rejection | Yes — invariants 5–7; codes `link_cross_project` / `link_cross_document` |

---

## 7. Changelog

**v1.0 — 2026-05-04** Initial Phase 4 API Contract. Six new endpoints (POST + GET on `/projects/[id]/context-nodes`; POST + DELETE + GET on `/nodes/[id]/context-links`; GET on `/nodes/[id]/back-links`). One Phase 2 endpoint amended (POST `/nodes/[id]/move` rejects context-node sources). Cross-cutting rules introduce nine new error codes, the structural↔context invariants, the project- vs document-scope semantics, the closest-ancestor inherited-link rule, and the V1 six-core-types whitelist. Five specification gaps documented (G-1 through G-5) with Phase 4 resolutions and downstream SU candidates flagged. Seven architectural decisions and four implementation calls recorded for Phase 4 sign-off.
