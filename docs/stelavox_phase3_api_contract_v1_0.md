# Stelavox — Phase 3 API Contract
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 3 build. Defines every API route added or modified in Phase 3 (Content Editing). Companion to `stelavox_phase3_test_plan_v1_0.md` and `stelavox_phase3_build_checklist_v1_0.md`. Source of truth for endpoint shape, validation, error codes, autosave concurrency semantics, and the editor invariants that bind the implementation to the schema in `stelavox_technical_architecture_v1_5.md` §3.6 (Migrations 004 / 005 / 023).

**Phase:** 3 — Content Editing: Tiptap (Summary, Prose, Notes), Focus Mode, auto-save with optimistic concurrency, version-history browse and diff preview, metadata forms.
**Phase 3 checkpoint criteria (Technical Architecture v1.5 §11):** "Can write content; versions created (Phase 2 trigger) and **browsable with hover diff** in this phase. Restore is Phase 6."
**Companion documents:** `stelavox_phase3_test_plan_v1_0.md`, `stelavox_phase3_build_checklist_v1_0.md`. Cross-cutting rules unchanged since Phase 1 / 2 are inherited from `stelavox_phase1_api_contract_v1_0.md` §2 and `stelavox_phase2_api_contract_v1_0.md` §2 — those sections below say "unchanged from Phase N."

---

## 1. Phase Scope

### 1.1 Routes added in Phase 3

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/nodes/[nodeId]/versions` | Paginated list of `node_versions` for a node — backs the History tab list |
| GET | `/api/nodes/[nodeId]/versions/[versionNumber]` | Read a single historical version's content fields — backs the hover-diff preview |

### 1.2 Routes modified in Phase 3

| Method | Path | Change |
|---|---|---|
| PATCH | `/api/nodes/[nodeId]` | Adds optional `expected_version: number` field on the request body. When supplied and `expected_version ≠ nodes.version` at the moment of the write, returns **`409 version_conflict`** with the current node body in the response. When omitted, last-write-wins (Phase 2 behaviour preserved for Phase 5 agent jobs and any client that opts out of conflict detection). The version field is server-managed (Migration 023 trigger increments on content changes only); clients still cannot send `version` in the body. |

### 1.3 Routes removed in Phase 3

None. The Phase 2 PATCH endpoint already accepts content fields (`summary`, `prose`, `notes`, `metadata`) and persists them; Phase 3 wires the editors that use it and adds optimistic concurrency on top.

### 1.4 Database changes

**None.** All schema and trigger work needed by Phase 3 was completed in Phase 1 (the `nodes` content columns and `node_versions` table — Migrations 004 / 005) and Phase 2 (the content-only version-bump trigger — Migration 023). Phase 3 is a thin contract layer over the schema that already exists.

The `node_versions` table from Migration 005 stores per-version snapshots. Migration 023's `BEFORE UPDATE` trigger on `nodes` increments `nodes.version` only when at least one of `summary`, `prose`, `notes`, or `metadata` changes (using `IS DISTINCT FROM`); non-content updates leave `version` untouched. **Phase 3 implementations rely on this trigger as the source of truth for version numbering.** Phase 3 does **not** add a separate trigger that inserts into `node_versions` — that mechanism is Phase 5's responsibility (the agent system is the principal author of new versions in V1; manual content edits in Phase 3 *do not* create `node_versions` rows). The history list in Phase 3 reads whatever rows exist; on a fresh document with only manual edits, the list is empty until the first agent operation completes (Phase 5). This is the correct behaviour for V1 — see G-1 below.

### 1.5 Auth surface

Unchanged from Phase 1. All Phase 3 routes require an authenticated session via the cookie-bound Supabase client. RLS on `nodes` (Migration 004) and `node_versions` (Migration 005) is the authoritative cross-tenancy boundary; no new policies are added in Phase 3.

---

## 2. Cross-Cutting Rules

### 2.1 Authentication

Unchanged from Phase 1 §2.1 / Phase 2 §2.1.

### 2.2 Authorisation

Unchanged from Phase 2 §2.2. RLS on `nodes` and `node_versions` admits a row only when the caller is a member of the organisation that owns the row's `project_id` / `organisation_id`. A request for a node or version the caller cannot see returns `404 not_found` — never `403`. The 404 is indistinguishable from a request for a row that does not exist.

### 2.3 Error envelope

Unchanged from Phase 1 §2.3. Phase 3 adds the following codes:

| Code | Status | Where |
|---|---|---|
| `version_conflict` | 409 | PATCH `/api/nodes/[id]` with `expected_version` that does not match `nodes.version` |
| `version_not_found` | 404 | GET `/api/nodes/[id]/versions/[number]` for a `version_number` that has no `node_versions` row |
| `unknown_field` (on `expected_version`) | 400 | (No new code — existing `unknown_field` covers misuse of the field name) |

All Phase 1 / 2 codes carry over unchanged.

The `409 version_conflict` response body has a non-standard shape because the client needs the full current node to render the conflict UI:

```json
{
  "error": "version_conflict",
  "message": "Node was modified by another writer; expected version 4, found 7.",
  "current": { /* full node object per §2.12 */ }
}
```

### 2.4 Status codes used in this phase

`200`, `400`, `401`, `404`, **`409`** (new this phase — version_conflict), `422`, `423`, `500`. `409` follows the standard meaning (conflict with current resource state); the response body's `current` field is the only Phase 3-specific extension. Phase 2's `423` (locked) carries forward unchanged — autosave on a locked node returns 423, not 409.

When both conditions are present (the node is locked **and** the `expected_version` is stale), **`423` wins** — the lock is the higher-priority refusal because it forbids the write entirely; the version mismatch is moot if no write would have been allowed regardless. Test cases verify this ordering (TC-A-30 in the test plan).

### 2.5 Validation rules — common

Unchanged from Phase 2 §2.5 plus:

| Field | Rule |
|---|---|
| `expected_version` | Optional integer ≥ 1 on PATCH. When present, server compares against `nodes.version` *as of read*; mismatch returns 409. When absent, no concurrency check is performed. Forbidden on POST and on `PATCH /move`. |
| `summary` | Optional string, max 100,000 chars. Tiptap clients send the JSON-encoded ProseMirror document as a stringified JSON; the column is `TEXT`. Validation does not parse the JSON — H-06 plain-text extraction happens at LLM-prompt time, not at the API layer. |
| `prose`   | Optional string, max **2,000,000 chars** (~400,000 words — raised from Phase 2's 1,000,000 to give long novels headroom; see G-2). |
| `notes`   | Optional string, max 100,000 chars. |
| `metadata`| Optional JSON object. Free-form in V1; per-node-type schemas arrive in Phase 4 (Context System) and may tighten this. |

`version`, `version_history`, and any field beginning with an underscore are forbidden on PATCH (returns `400 unknown_field`). The Phase 2 forbidden-field list carries over.

### 2.6 Idempotency

Unchanged from Phase 1 §2.6. Note: PATCH with an `expected_version` that already matches the current `nodes.version` after a no-op update (no content fields changed) is a tautology — the row update fires the `before update` trigger, the `IS DISTINCT FROM` checks all return false, the trigger sets `NEW.version := OLD.version`, and the row is "updated" with no observable change. This is treated as a successful 200; no version conflict is reported. The optimistic check happens *before* the trigger runs (the route reads `nodes.version`, compares, then issues the UPDATE), so no race exists.

### 2.7 Rate limiting

Deferred to V2. However, autosave debouncing at 1.5 seconds idle per `editor-store.ts` (Technical Architecture v1.5 §2.7) provides effective per-client rate limiting in normal use. A pathological client that bypasses the debounce and flushes on every keystroke is not blocked at the API layer in V1; Phase 6 may revisit.

### 2.8 Pagination

`GET /api/nodes/[id]/versions` is **paginated** (unlike Phase 2's `GET /api/documents/[id]/nodes` which is bounded by tree size). A heavily-edited node could accumulate hundreds of versions over a project's lifetime — listing all of them on every panel open is wasteful.

Pagination contract:

- Query parameters: `?limit=` (1–100, default **25**) and `?offset=` (≥ 0, default 0).
- Order: **descending by `version` number** (newest first — matches the History tab's "current at top" Component Spec §5.11 layout).
- Response: `{ "versions": [...], "total": <integer>, "has_more": <boolean> }`. `total` is the count of accessible rows (RLS-filtered); `has_more` is `(offset + versions.length) < total`.
- Initial UI render requests `limit=7` (the Component Spec §5.11 "initial 7 shown"); "Show N more versions" loads the next 25.

`GET /api/nodes/[id]/versions/[versionNumber]` returns a single version and is not paginated.

### 2.9 Timestamps and date formats

Unchanged from Phase 1 §2.9.

### 2.10 Caller's organisation

Unchanged from Phase 1 §2.10.

### 2.11 Editor invariants

These are the invariants every Phase 3 editor surface upholds. They are not enforced at the API layer alone; the client is the principal author of correctness here and the contract documents the expected behaviour so that the test plan can verify it end-to-end.

1. **One node editable at a time.** The detail panel is bound to a single `nodeId`. Switching to a different node forces a synchronous flush of any pending autosave on the previous node *before* the new node loads — there is no overlap. This honours `stelavox_ui_design_specification_v1_0.md` line 678. The implementation is a tree-selection handler that awaits `editorStore.flushPending(currentNodeId)` before setting `currentNodeId = newId`.

2. **One inflight PATCH at a time per node.** Autosave is single-flight per node. If a debounce timer fires while a PATCH is already in flight, the new PATCH waits for the in-flight one to complete (and observes its post-trigger `version`); only then does it issue with a fresh `expected_version`. Concurrent PATCHes from the same client to the same node MUST NOT be issued. This prevents the client from racing itself into self-induced 409s.

3. **All three editors share one debounce window.** A single 1.5-second idle timer covers `summary`, `prose`, and `notes` for the active node. When it fires, exactly one PATCH is issued carrying every changed content field. This minimises round trips and keeps `nodes.version` advancing by the smallest possible increment per author burst.

4. **Server-controlled version is authoritative.** The `version` field in PATCH responses is the canonical post-write value. The client *must* update its local `expected_version` from the response before the next autosave; failing to do so produces self-induced 409s. The Migration 023 trigger guarantees `version` increments by exactly 1 per content-bumping UPDATE; a PATCH that touches only non-content fields (e.g. `name`) returns the same `version` it received in the request and does *not* invalidate the editor's `expected_version`.

5. **Optional concurrency check.** A PATCH without `expected_version` skips the conflict check entirely. This is the path for Phase 5 agent jobs (the agent operates on a snapshot and overwrites unconditionally — the agent's writes are themselves the conflict, and the editor's UI reflects them via the standard autosave round trip). A Phase 3 editor client SHOULD always send `expected_version`.

6. **Beforeunload / navigation guard.** When the editor has unflushed changes, the browser-level `beforeunload` listener prompts the user with the standard confirmation dialog. On confirm-leave, the client attempts a final flush via `navigator.sendBeacon()` to the same PATCH endpoint; on success the server processes the write asynchronously. Failure of `sendBeacon()` (browser disabled, network down) results in the local-storage shadow surviving for the next session — the user reconciles via the conflict UI on next load.

7. **Local-storage shadow.** Every keystroke writes to `localStorage` keyed by `stelavox_editor_<nodeId>`. On node load, if the local-storage value's stored `expected_version` is greater than 0 and the server's current `nodes.version` is greater than the stored `expected_version`, the conflict UI surfaces the same way as a 409 response. The shadow is cleared on successful PATCH commit. This survives accidental tab closes, browser crashes, and offline blips.

8. **Lock state observed in real time (Phase 6 hardening).** Phase 3 ships the lock check (a 423 response triggers a read-only banner) but Phase 3 does not subscribe to lock-state changes via real-time. If the Phase 6 lock UI is added later, a node locked while the editor is open will be detected on the next autosave attempt. Phase 6 may add a Supabase Realtime subscription on `nodes.locked` for instant UI feedback; that subscription is not in Phase 3 scope (per H-05 cleanup discipline — every subscription added carries risk and should ship with its consumer).

### 2.12 Response shape — node object

Identical to Phase 2 §2.12. Phase 3 does not add or remove fields; it activates the content fields (`summary`, `prose`, `notes`, `metadata`) that were already present-but-unsurfaced in Phase 2 responses.

### 2.13 Response shape — version object

Returned by the new GET `/api/nodes/[id]/versions` and `/versions/[number]` endpoints:

```json
{
  "id": "uuid",
  "node_id": "uuid",
  "version": 7,
  "summary": "<string|null>",
  "prose": "<string|null>",
  "notes": "<string|null>",
  "metadata": {},
  "changed_by": "user|agent_<profile_slug>|director",
  "change_reason": "<string|null>",
  "created_at": "2026-05-04T10:30:00.000Z"
}
```

`organisation_id` is omitted from the response (server-internal RLS gate, not interesting to clients). The list endpoint (`/versions`) returns the same shape per row, with `summary`, `prose`, `notes`, and `metadata` **omitted** in the list response (size optimisation — the diff preview is fetched on hover via the single-version endpoint). The list response per row is therefore:

```json
{
  "id": "uuid",
  "node_id": "uuid",
  "version": 7,
  "changed_by": "agent_synthesise",
  "change_reason": "Synthesise prose from summary",
  "created_at": "2026-05-04T10:30:00.000Z"
}
```

---

## 3. Endpoint Specifications

Each endpoint follows the Phase 1 / 2 contract structure: purpose → request → success → failure modes → RLS notes.

### 3.1 `PATCH /api/nodes/[nodeId]` — Update node (modified)

**Purpose.** Update mutable fields of a node. Phase 2's behaviour is preserved; Phase 3 adds the optional `expected_version` field for optimistic concurrency on content edits.

**Path parameter:** `nodeId` — UUID of the node. Caller must be a member of the organisation that owns the node's `project_id` (RLS).

**Request body** (Phase 3 example with autosave):

```json
{
  "summary": "{\"type\":\"doc\",\"content\":[…Tiptap JSON…]}",
  "prose": "{\"type\":\"doc\",\"content\":[…Tiptap JSON…]}",
  "notes": null,
  "expected_version": 4
}
```

All fields are optional; the request must contain at least one settable field (else `400 missing_body`). `expected_version` is optional and orthogonal — it can be supplied with or without content fields.

**Validation order** (first failure wins):

1. `nodeId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `Content-Type: application/json` — else `400 invalid_json`.
4. Body parses as JSON object — else `400 invalid_json` or `400 missing_body`.
5. No unknown fields — else `400 unknown_field`.
6. No forbidden fields (Phase 2 list + `version`) — else `400 unknown_field`.
7. Field-level validation (lengths, types) per §2.5 — else `400 invalid_<field>`.
8. Body has at least one settable field — else `400 missing_body`.
9. Node exists and is visible (RLS) — else `404 not_found`.
10. Lock check: `nodes.locked` for the target — else `423 node_locked`. Then ancestor lock check — else `423 parent_locked`. (Lock check beats version check; see §2.4 ordering note.)
11. **`expected_version` check** (only if supplied): `expected_version ≠ nodes.version` (read inside the same transaction) — else `409 version_conflict` with `current` field set to the full current node body.
12. Apply the UPDATE. The Migration 023 trigger fires as part of the UPDATE; if any of `summary`, `prose`, `notes`, `metadata` changed, `nodes.version := OLD.version + 1`. Otherwise `nodes.version` is unchanged.

**Success (200):** The full node object per §2.12, with `version` reflecting the post-trigger value. The client uses this as its new `expected_version` for the next autosave.

**Failure modes:**

| Code | Status | When |
|---|---|---|
| `invalid_uuid` | 400 | `nodeId` is not a valid UUID |
| `invalid_json` | 400 | Content-Type wrong or body not JSON |
| `missing_body` | 400 | Body has no settable fields |
| `unknown_field` | 400 | Body contains a field outside the allowed set |
| `invalid_<field>` | 400 | Field-level validation failed (length, type) |
| `unauthorised` | 401 | No session |
| `not_found` | 404 | Node does not exist or RLS hides it |
| `node_locked` | 423 | Target node has `locked = TRUE` |
| `parent_locked` | 423 | An ancestor of the target has `locked = TRUE` |
| `version_conflict` | 409 | `expected_version` was supplied and does not match `nodes.version` |

**RLS notes:** The route uses the user-session client. The PATCH passes through the `nodes` policy from Migration 004 — a node not owned by the caller's organisation is invisible and the route returns 404. `expected_version` does not alter RLS — a stale version on a node the caller cannot see still returns 404, never 409.

### 3.2 `GET /api/nodes/[nodeId]/versions` — List versions

**Purpose.** Return the version history of a node, paginated, newest first. Backs the History tab list (Component Spec §5.11) — list, current-version star, and "Show N more" pagination ship in this phase. The Restore button ships in Phase 6.

**Path parameter:** `nodeId` — UUID of the node.

**Query parameters:**

| Name | Type | Default | Range |
|---|---|---|---|
| `limit` | integer | 25 | 1–100 |
| `offset` | integer | 0 | ≥ 0 |

**Validation order:**

1. `nodeId` is a valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `limit` and `offset` (if present) are valid integers in range — else `400 invalid_query`.
4. Node exists and is visible — else `404 not_found`. (Existence is verified by selecting the node first; if the node is hidden by RLS the version list is also hidden, returned as 404 to avoid existence leakage.)

**Success (200):**

```json
{
  "versions": [
    {
      "id": "uuid",
      "node_id": "uuid",
      "version": 7,
      "changed_by": "agent_synthesise",
      "change_reason": "Synthesise prose from summary",
      "created_at": "2026-05-04T10:30:00.000Z"
    }
  ],
  "total": 12,
  "has_more": true
}
```

`total` reflects the RLS-filtered count of `node_versions` rows for this node. `has_more` is `(offset + versions.length) < total`.

**Failure modes:** `invalid_uuid` (400), `invalid_query` (400), `unauthorised` (401), `not_found` (404).

**RLS notes:** `node_versions` has its own policy from Migration 005 (`org_members_access_node_versions`). The list query joins implicitly via `node_id`; rows from other organisations are filtered automatically. The 404 path covers both "node does not exist" and "node belongs to another organisation."

### 3.3 `GET /api/nodes/[nodeId]/versions/[versionNumber]` — Read one version

**Purpose.** Return the content of a single historical version for hover-diff preview (Component Spec §5.11 hover preview tooltip).

**Path parameters:** `nodeId` (UUID) and `versionNumber` (integer ≥ 1).

**Validation order:**

1. `nodeId` is a valid UUID — else `400 invalid_uuid`.
2. `versionNumber` is a positive integer — else `400 invalid_version_number`.
3. Session present — else `401 unauthorised`.
4. Node exists and is visible — else `404 not_found`.
5. `node_versions` row with `(node_id, version) = (nodeId, versionNumber)` exists and is visible — else `404 version_not_found`.

**Success (200):** The full version object per §2.13.

**Failure modes:** `invalid_uuid` (400), `invalid_version_number` (400), `unauthorised` (401), `not_found` (404), `version_not_found` (404).

**RLS notes:** Same as `/versions`. The two-step 404 (`not_found` for the node, `version_not_found` for the version) is intentional — once the caller can see the node, the absence of a particular version is not a leakage concern (versions can have been deleted by no one in V1; absence implies "never created").

---

## 4. Test Cases

The Phase 3 Test Plan (`stelavox_phase3_test_plan_v1_0.md`) is the authoritative test-case list. Summary by area:

| Area | Section | Approximate count |
|---|---|---|
| UI checkpoint (TC-U) | §2 | 24 — editor wiring, autosave silence/visibility, conflict UI, focus mode entry/exit, version history list, hover diff preview |
| Visual / opacity state machines (TC-V) | §3 | 12 — WordCount opacity, FocusBreadcrumb opacity, FocusEscHint fade, ProseEditorCursor blink/no-blink |
| Motion / transitions (TC-M) | §4 | 8 — Focus Mode 280ms entry/exit, sentence focus 200ms transition, prefers-reduced-motion |
| API integration (TC-A) | §5 | 32 — PATCH with/without expected_version, 409 conflict, 423-beats-409 ordering, version list pagination, single-version endpoint |
| Authorisation boundary (TC-B) | §6 | 8 — RLS on PATCH, /versions, /versions/[n] |
| Data integrity (TC-D) | §7 | 6 — Migration 023 content-only bump verified end-to-end via PATCH |
| Accessibility (TC-AX) | §8 | 6 — keyboard-only editor flow, Focus Mode aria-hidden, screen-reader announcement of conflict bar |

Approximate total: **96 cases** (vs. Phase 2's 136). The lower count reflects the smaller API surface; the visual/motion categories are new because Phase 3 is the first phase with locked transition timings (Component Spec §6.1 280ms expo-out, §6.5 200ms sentence focus).

---

## 5. Specification Gaps Found While Writing This Contract

These are gaps surfaced during contract drafting. They are recorded here so the build agent does not silently invent behaviour when it encounters them.

### G-1 — `node_versions` rows: who creates them, and when?

**Gap:** Migration 005 defines the `node_versions` table; Migration 023 increments `nodes.version` on content-bumping UPDATEs. **Neither migration inserts into `node_versions`.** The Product Spec implies versions exist for browse, but the trigger that *creates* the version row is unspec'd.

**Resolution for Phase 3:** Phase 3 does **not** add a version-row insert trigger. Manual content edits in Phase 3 advance `nodes.version` (visible in the editor's `expected_version` round trip) but do not create `node_versions` rows. The version row is created by the **agent system** in Phase 5 — when an agent operation completes, it inserts a `node_versions` row capturing the pre-agent state with `changed_by = "agent_<profile>"` and `change_reason = "<operation>"`. The History tab therefore shows agent-driven revisions, which matches the dominant V1 user story ("I want to see what a scene looked like before the last agent edit" — Product Spec §4.12 line 291).

**Phase 3 implication:** On a fresh document with only manual edits, the History tab list is empty. The empty state message reads: *"Versions are recorded when the agent revises this node. Agent operations arrive in Phase 5."* — until Phase 5 ships, then the message becomes: *"No revisions yet. Run an agent operation to create one."*

**SU candidate (Phase 3 → TA v1.6 / Product Spec v1.4):** Add a Phase 5 commitment block to TA §11 / Product Spec §4.12 stating that the agent system inserts `node_versions` rows; document the manual-edit no-snapshot rule.

### G-2 — `prose` field max size

**Gap:** Phase 2 §2.5 set `prose` max at 1,000,000 chars (~200,000 words). A long novel routinely runs 300,000–500,000 words spread across leaves; a single chapter beat would not exceed 5,000 words, so per-node 200,000 is generous. But: a user *could* paste a draft of an entire book into one beat. The limit needs to be a real number that withstands curiosity.

**Resolution for Phase 3:** Raised to **2,000,000 chars** (~400,000 words). A single beat exceeding 5,000 words is suspect; one exceeding 50,000 is misuse; one exceeding 400,000 is non-functional regardless. The 2M cap is a guardrail against accidental megabyte payloads in the autosave path. The PATCH route returns `400 invalid_prose` if exceeded; the editor UI shows a non-blocking warning when the count crosses 100,000 chars on a single node. This SHOULD never trigger in practice.

**SU candidate (Phase 3 → Product Spec v1.4):** Document the 2M-char per-node limit and the editor's 100,000-char warning threshold under §4.5.

### G-3 — Tiptap JSON serialisation in the column

**Gap:** Tiptap stores content as a ProseMirror JSON document. The `nodes.summary` / `nodes.prose` / `nodes.notes` columns are `TEXT`. The contract does not specify *which form* is stored — JSON (stringified) or extracted plain text or both.

**Resolution for Phase 3:** Each column stores **stringified Tiptap JSON** (the editor's `editor.getJSON()` output, JSON-encoded as a string). Plain text is *extracted at LLM-prompt time* via `generateText(json, extensions)` per H-06. Storing JSON preserves bold/italic/lists/links across reads — extracting plain text on the way in would lose formatting irrecoverably. The trade-off is that DB-level full-text search would need a JSON-aware extractor, which is acceptable since search is not in V1 scope. Each column is `TEXT` (not `JSONB`) so PostgreSQL does not impose any schema validation on the stored Tiptap blob.

A new client-side helper `lib/editor/serialise.ts` exports `toStorage(editor)` and `fromStorage(text, extensions)` which centralise the JSON ↔ string conversion. The editor components must not hand-roll `JSON.stringify(editor.getJSON())` calls — every read and write goes through the helper so the storage shape is uniform and one-future-day-revisable.

**SU candidate (Phase 3 → TA v1.6):** Document the storage-shape convention in TA §2.6 (Rich Text Editing).

### G-4 — `metadata` field: free-form vs schema-validated

**Gap:** Phase 2 admits `metadata` as free-form JSON. Phase 4 (Context System) introduces per-node-type metadata schemas (e.g. `character.role`, `location.region`). Phase 3 builds the metadata form UI but the validation layer is unclear.

**Resolution for Phase 3:** Phase 3 ships the **MetadataForm** component (TA §2.4) but its admitted fields are bound to a per-node-type schema *defined client-side* in `lib/editor/metadata-schemas.ts`. The schema for each `node_type` is a list of `{ key, label, type: "text"|"number"|"date"|"select", options?: string[] }` entries. The PATCH route does **not** schema-validate `metadata` in Phase 3 — the field remains free-form JSON server-side; client-side validation is the only enforcement. Phase 4 may add server-side schema validation when context node types arrive with their stricter schemas.

For Phase 3, structural node types (`book`, `act`, `chapter`, `scene`, `beat` — and the equivalents for short-story and series templates) each carry a small `MetadataSchema` (POV character, time, location, mood — **all optional**). The schemas are advisory only.

**SU candidate (Phase 4 → TA v1.6 / Product Spec v1.4):** When Phase 4 introduces the context node metadata schemas, lift the structural-node schemas alongside them and document the unified mechanism.

### G-5 — Version-list ordering when version numbers are non-contiguous

**Gap:** `nodes.version` is incremented by the trigger; `node_versions.version` is set by whoever inserts the row. If Phase 5's agent-system trigger inserts with `version = OLD.version` (capturing the pre-agent state), the `node_versions` table will end up with `1, 2, 3, …` matching `nodes.version` post-edits. But the contract should not assume contiguity — the list endpoint should order by `version DESC`, not by `created_at`, to handle any future case where a version row is inserted out of band.

**Resolution for Phase 3:** GET `/versions` orders by `version DESC` as the primary key, with `created_at DESC` as a tiebreaker. In V1 there is no out-of-band insertion path so the two orderings agree, but the contract is robust against future divergence.

---

## 6. Approval

This API Contract is approved before any Phase 3 implementation begins. Changes after approval are version-bumped on this document. The Build Checklist treats this contract as the source of truth for endpoint shape, validation order, error codes, and the autosave concurrency contract.

The four architectural decisions that shaped Phase 3 (and therefore this contract) were resolved with the human on 2026-05-04:

| # | Decision | Choice |
|---|---|---|
| Q1 | Notes tab in scope? | **Yes** — Tiptap-Inter editor (sibling of SummaryEditor); §5.13 added to Component Spec v2.1 |
| Q2 | VersionHistory in scope? | **Partial** — list, star, hover diff, pagination ship Phase 3; Restore is Phase 6 |
| Q3 | Autosave shape | **Optimistic concurrency** — 1.5s debounce, optional `expected_version` field, 409 on mismatch, single-toast (banner) on conflict, 423 beats 409, last-write-wins when omitted |
| Q4 | TA v1.5 / SU close-out timing | **First** — TA v1.5, Product Spec v1.3, Component Spec v2.1, CLAUDE.md v1.4 landed before this contract was written |

Plus four implementation calls confirmed during contract drafting:

| # | Call | Choice |
|---|---|---|
| 1 | Editor storage shape | Stringified Tiptap JSON in TEXT columns; helper centralises serialisation (G-3) |
| 2 | Manual edits do not create `node_versions` rows | Yes — agent system creates them in Phase 5 (G-1) |
| 3 | `prose` max size raised | 1M → 2M chars (G-2) |
| 4 | `metadata` schema enforcement | Client-side only in Phase 3 (G-4) |

---

## 7. Changelog

**v1.0 — 2026-05-04** Initial Phase 3 API Contract. Two new endpoints (GET `/versions` paginated list; GET `/versions/[n]` single-version read). One modified endpoint (PATCH `/api/nodes/[id]` adds optional `expected_version` field with 409 conflict response). Cross-cutting rules introduce 409 status code, the lock-beats-conflict ordering, the 1.5s debounce + single-flight + shared-debounce autosave invariants, the local-storage shadow, and the beforeunload guard. Five specification gaps documented (G-1 through G-5) with Phase 3 resolutions and downstream SU candidates flagged. Four architectural decisions and four implementation calls recorded for Phase 3 sign-off.
