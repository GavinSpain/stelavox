# Stelavox — Phase 5 API Contract
## Version 1.2

> **Tier-B per-phase document.** Frozen for Phase 5 build. Defines every API route added or modified in Phase 5 (Agent System — single-node operations + editorial comments). Companion to `stelavox_phase5_test_plan_v1_0.md` and `stelavox_phase5_build_checklist_v1_0.md`. Source of truth for endpoint shape, validation order, error codes, the agent-job lifecycle, the Accept/Dismiss/Cancel semantics, the security pipeline, and the editorial-comment CRUD contract. Cross-cutting rules unchanged since Phase 1 / 2 / 3 / 4 are inherited from the earlier phases' API contracts; only the additions are spelled out here.

**Phase:** 5 — Agent System: context assembler, LLM abstraction, four single-node operations (`expand`, `synthesise`, `refine`, `generate_context`), agent-job lifecycle (pending → running → completed → accepted/dismissed; cancelled; failed), agent-job UI (progress + history + Accept/Dismiss), editorial comments CRUD, agent profiles read-side.

**Phase 5 checkpoint criteria** (derived from Technical Architecture v1.8 §11 V1 row 5): *"Full end-to-end: book summary → final prose."* Concretely: (a) the author can run `expand` against a Book root to produce Acts; (b) `expand` against an Act produces Chapters; etc. down to Beats; (c) `synthesise` against any leaf produces prose; (d) all operations are accepted or dismissed via the AgentTab; (e) editorial comments are created, listed, and resolved; (f) agent jobs are visible in real-time on the node tree (via `AgentActivityIndicator`) and in the per-document history list.

**Phase 5b / 5c boundary** (per the Phase 5 startup decision, captured for absorption as SU-23 in Phase 5 close-out — see §5):
- **Phase 5b — Director:** the Director conversational interface, `director-runner` Edge Function, `validateToolCall()`, workflow planning + approval + execution. Phase 5b is a dedicated phase between Phase 5 and Phase 6. Phase 5 ships *the substrate* the Director will later orchestrate; the Director itself is out of Phase 5 scope.
- **Phase 5c — Streaming:** Server-Sent Events for `synthesise` (and any other long-running prose generation). Phase 5 ships `synthesise` as a non-streaming completion. Progress feedback in the `AgentTab` active state comes from the Edge Function writing token counts to `agent_jobs.tokens_output` while the LLM call is in flight, surfaced via Supabase real-time. Streaming as a wire-format concern is deferred.

**Companion documents:** `stelavox_phase5_test_plan_v1_0.md`, `stelavox_phase5_build_checklist_v1_0.md`. Cross-cutting rules unchanged since Phase 4 are inherited from earlier phases' API contracts; only the additions are spelled out here.

---

## 1. Phase Scope

### 1.1 Routes added in Phase 5

**Agent operations (4):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/agent/expand` | Generate child nodes one layer down from the target node |
| POST | `/api/agent/synthesise` | Generate prose at a leaf node from the assembled context |
| POST | `/api/agent/refine` | Rewrite or improve an existing field (`summary` / `prose` / `notes`) |
| POST | `/api/agent/generate-context` | Generate a context node's content from scratch or from a partial seed |

**Agent-job lifecycle (5):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agent-jobs/[jobId]` | Fetch a job's current state (real-time fallback poll) |
| POST | `/api/agent-jobs/[jobId]/cancel` | Mark a `pending` or `running` job `cancelled` |
| POST | `/api/agent-jobs/[jobId]/accept` | Commit a `completed` job's result to the target node as a new version |
| POST | `/api/agent-jobs/[jobId]/dismiss` | Discard a `completed` job's result; mark `dismissed` (audit-preserved) |
| GET | `/api/documents/[documentId]/agent-jobs` | Paginated list of jobs for a document (history view) |

**Editorial comments (5):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/nodes/[nodeId]/comments` | Create a human comment on a node (top-level or reply) |
| GET | `/api/nodes/[nodeId]/comments` | List all comments on a node (resolved + unresolved) |
| PATCH | `/api/comments/[commentId]` | Edit a human comment's `content` (author only) |
| POST | `/api/comments/[commentId]/resolve` | Mark a comment resolved (any org member) |
| DELETE | `/api/comments/[commentId]` | Delete a comment (author or org owner) |

**Agent profiles (1):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agent-profiles` | List system + own-org agent profiles, optionally filtered by `operation_type` and `node_type` |

**Total: 15 routes added in Phase 5.**

### 1.2 Routes modified in Phase 5

None. The Phase 2 / 3 / 4 endpoints carry forward unchanged. Notably:

- The Phase 3 PATCH `/api/nodes/[id]` is **not** extended with a "node has a running agent job" guard — author edits during a running job are allowed and operate independently of the job's `context_snapshot`. The job's context was captured at API-route time; subsequent author edits are not retroactively applied to the in-flight prompt. The Accept flow validates `target_node.version` against the snapshot when committing — see G-3 below.
- The Phase 2 `POST /api/documents/[documentId]/nodes` is **not** extended to create children-from-an-agent-result. Agent expansion writes child nodes via the Accept flow, not through the public POST nodes route.

### 1.3 Routes removed in Phase 5

None.

### 1.4 Database changes

**Four migrations** (025, 026, 027, 028). Migration count moves from 23 (Phase 4 close-out) to 27. (v1.0 specified three; v1.2 adds Migration 028 for cost-tracking — see G-13.)

- **Migration 025 — `agent_profiles` RLS policy.** Phase 1 left `agent_profiles` with RLS enabled and no policy. Phase 5 adds a SELECT policy admitting (a) system profiles (`organisation_id IS NULL`) and (b) own-org profiles. INSERT/UPDATE/DELETE remain admin-only (no policy = no access via user-session client). This unblocks the AgentTab profile picker (Component Spec §5.9).

- **Migration 026 — `agent_jobs` schema extensions.**
  - Status enum extended: `'pending' | 'running' | 'completed' | 'failed'` (Phase 1) plus new states `'accepted' | 'dismissed' | 'cancelled'`. The `CHECK` constraint is dropped and re-added.
  - New nullable columns capturing the agent's proposed result without writing it to `nodes` until Accept:
    - `result_summary TEXT` — the agent's proposed `summary` (refine summary, generate-context).
    - `result_prose TEXT` — the agent's proposed `prose` (synthesise, refine prose).
    - `result_notes TEXT` — the agent's proposed `notes` (refine notes). **Added in v1.1 — see G-11.** Phase 5 v1.0 admitted `target_field='notes'` in the refine route but had no column to store the result; v1.1 closes the gap.
    - `result_metadata JSONB` — proposed metadata changes (refine of metadata, generate-context).
    - `result_child_nodes JSONB` — proposed child nodes for `expand`, as an ordered array of `{ name, summary, metadata, ... }` objects matching the V1 child-node creation schema. Becomes one-to-many `nodes` rows on Accept.
  - New columns capturing concurrency state for Accept:
    - `target_node_version_at_capture INTEGER` — the target node's `version` at the moment the API route created the job. Used by Accept to detect concurrent edits (G-3).

- **Migration 027 — agent profiles seed.** Inserts the four V1 system profiles (one per operation type) into `agent_profiles` with `is_system_profile=TRUE`, `organisation_id=NULL`, the canonical system prompts, and the `model_id` defaults pulled from `platform_config`'s `model.<operation>` keys. The system prompts are long, structured strings; they live in this migration's INSERT statements (and in `supabase/seed.sql` for replay), not in `platform_config`. See G-1.

- **Migration 028 — cost tracking.** Adds the cost-as-first-class plumbing per G-13.
  - New column `agent_jobs.cost_usd DECIMAL(10,6)` — frozen at job-completion time so historical rows show the cost as it was on the day the operation ran (insulated from later Anthropic pricing changes).
  - Six new `platform_config` price keys: `price.anthropic.<model>.input_per_mtok` and `price.anthropic.<model>.output_per_mtok` for each of `claude-haiku-4-5-20251001` / `claude-sonnet-4-6` / `claude-opus-4-6`. Cache-token pricing is derived in code (cache_write = 1.25 × input, cache_read = 0.10 × input — Anthropic's published rates).
  - The Edge Function calls `lib/llm/cost.ts → computeCostUsd()` at job completion and writes `cost_usd` alongside `tokens_*`. Internal-only column — not surfaced in any V1 user-facing UI; consumed by the cost-reporting tool (`scripts/cost-report.ts`) and the Phase 5 Test Report's §10 Cost Analysis.

After Migration 026 the `agent_jobs` row shape is:

```sql
agent_jobs {
  id, organisation_id, node_id, document_id, profile_id,
  operation_type, operation_class, status,
  triggered_by,
  tokens_input, tokens_output, tokens_cache_write, tokens_cache_read,
  model_id, provider,
  context_snapshot, result_summary, result_prose, result_metadata, result_child_nodes,
  target_node_version_at_capture,
  result_summary_text, error_message, batch_id, job_progress,
  created_at, started_at, completed_at,
  -- Migration 026 status enum: pending|running|completed|accepted|dismissed|cancelled|failed
}
```

A `result_summary_text TEXT` column already exists from Phase 1 Migration 006 as `result_summary` (TA v1.8 §3.6 line 817). Migration 026 takes a different name (`result_summary` for the agent's proposed summary content) — this collides with the existing field's name. **Resolution:** rename the Phase 1 field `result_summary` → `result_summary_text` in Migration 026 (it's only used for document-operation's human-readable summary; that path is post-V1-launch, so the rename is safe). The new `result_summary` is the agent-proposed content for single-node operations. Documented in Migration 026's body and cross-referenced from the build checklist.

Type regeneration (`supabase gen types typescript --linked`) runs after Migration 027.

### 1.5 Auth surface

Unchanged from Phase 1. All Phase 5 routes require an authenticated session via the cookie-bound Supabase client. RLS enforcement:
- `agent_jobs` (Migration 006) — already in place.
- `agent_profiles` (Migration 025 — new in Phase 5) — system profiles + own-org profiles readable; no user-session writes.
- `node_comments` (Migration 005) — already in place.

The Edge Function (`agent-runner`) runs with the service-role key — it bypasses RLS and is responsible for its own organisation/visibility checks. The Edge Function only operates on rows passed to it via the `agent_jobs` record, which the API route already validated as in-org and visible to the caller.

---

## 2. Cross-Cutting Rules

### 2.1 Authentication

Unchanged from Phase 1 §2.1. All Phase 5 routes require a valid session cookie. The Edge Function (`agent-runner`) is invoked server-to-server via the Supabase Edge Function endpoint with the service-role key; it does not authenticate via session.

### 2.2 Authorisation

Unchanged from Phase 4 §2.2 plus:

- `agent_jobs` rows are accessible to org members per Migration 006 RLS. The route's pre-checks (job exists, target node exists, job belongs to caller's organisation) execute under the user-session client and return 404 for hidden rows.
- `agent_profiles` rows are accessible per the new Migration 025 RLS policy: system profiles (organisation_id IS NULL) plus own-org profiles. INSERT/UPDATE/DELETE remain admin-only.
- A request for a job, comment, or profile the caller cannot see returns `404 not_found` — never `403`.

### 2.3 Error envelope

Unchanged from Phase 1 §2.3. Phase 5 adds the following codes:

| Code | Status | Where |
|---|---|---|
| `token_budget_exceeded` | 402 | All four POST `/api/agent/<op>` routes when `checkTokenBudget()` returns insufficient budget |
| `injection_blocked` | 422 | All four POST `/api/agent/<op>` routes when `scanContent()` finds a high-severity match in user content |
| `output_schema_invalid` | 422 | The Edge Function's terminal write — the agent's response failed Zod validation. The job is marked `failed` with `error_message='output_schema_invalid'`. Surfaced to the client via real-time, not via the original POST response. |
| `llm_provider_error` | 503 | The Edge Function's LLM provider call failed (network, timeout, 5xx, rate limit). Job marked `failed` with `error_message`. Surfaced via real-time. |
| `canary_leak_detected` | 422 | The Edge Function's canary scan found the canary token in the model output. Job marked `failed`. (TA §4.4) |
| `agent_job_in_progress` | 409 | POST `/api/agent/<op>` when the target node already has a job in `pending` or `running` status |
| `agent_job_not_in_progress` | 409 | POST `/api/agent-jobs/[id]/cancel` when status is not `pending` or `running` |
| `agent_job_already_terminal` | 409 | POST `/api/agent-jobs/[id]/accept` or `/dismiss` when status is not `completed` |
| `not_a_leaf_node` | 400 | POST `/api/agent/synthesise` against a non-leaf target |
| `invalid_target_field` | 400 | POST `/api/agent/refine` with `target_field` not in `{'summary','prose','notes'}` |
| `invalid_operation_for_node_type` | 400 | POST `/api/agent/<op>` against a node whose `node_category` or `node_type` doesn't admit the operation (e.g. `expand` on a context node, `generate_context` on a structural node) |
| `target_version_mismatch` | 409 | POST `/api/agent-jobs/[id]/accept` when the target node's `version` has advanced beyond `target_node_version_at_capture` (concurrent author edit). See G-3. |
| `comment_thread_too_deep` | 400 | POST `/api/nodes/[id]/comments` with a `parent_comment_id` whose own `parent_comment_id` is non-NULL (V1 enforces depth-1 threading; G-5) |
| `comment_not_in_node` | 400 | POST `/api/nodes/[id]/comments` with a `parent_comment_id` referencing a comment on a different node |
| `not_comment_author` | 403 | PATCH `/api/comments/[id]` by a caller who is not the comment's `author_label` (humans only) |
| `cannot_edit_agent_comment` | 400 | PATCH `/api/comments/[id]` against a comment with `author_type='agent'` (immutable audit record) |
| `agent_profile_not_found` | 404 | POST `/api/agent/<op>` with a `profile_id` that doesn't exist or isn't accessible |
| `profile_operation_mismatch` | 400 | POST `/api/agent/<op>` with a `profile_id` whose `operation_type` doesn't match the route |

All Phase 1 / 2 / 3 / 4 codes carry over unchanged.

### 2.4 Status codes used in this phase

`200`, `201` (POST agent op creates a job — the job-creation success), `202` (the same POST returns 202 when the Edge Function has been invoked but no result is available yet — see §2.11 invariant 9), `400`, `401`, `402` (new), `403`, `404`, `409` (existing — `version_conflict` from Phase 3, `link_already_exists` from Phase 4, plus new agent-job concurrency conditions), `422`, `423`, `500`, `503` (new).

The agent operation POST returns **202 Accepted** with a `Location: /api/agent-jobs/[id]` header, the body `{ "jobId": "<uuid>", "status": "pending" }`, and a `created_at` timestamp. The status-code choice (202 over 201) signals to the client: "job created, processing async, watch real-time or poll the Location." When body validation fails before any DB write, the standard 400/401/402/etc. apply.

### 2.5 Validation rules — common

Unchanged from Phase 4 §2.5 plus:

| Field | Rule |
|---|---|
| `node_id` | Required UUID on POST `/api/agent/<op>`. Must reference a node visible to the caller. |
| `profile_id` | Optional UUID. If present, must reference a profile accessible per Migration 025 RLS, with `operation_type` matching the route. If absent, the server selects the system default profile for the route's operation_type and the target node's `node_type` (e.g. expand-on-chapter → `expand_chapter_to_scenes` profile). |
| `agent_instruction` | Optional string, trimmed, max **2000 characters**. Passed to the LLM as additional dynamic context. |
| `expected_version` | Optional integer. If present, the server checks `target_node.version === expected_version` at job-creation time and returns `409 version_conflict` if not. This is an opt-in optimistic-concurrency gate at the *start* of the operation (parallels Phase 3's PATCH gate). The Accept flow has its own concurrency gate via `target_node_version_at_capture`. |
| `target_layer_count` | Optional integer 1–10 on POST `/api/agent/expand`. Number of children to generate. If absent, the server picks the count from the target node's `agent_profile.context_rules.target_layer_count` or the layer-stack's default. |
| `prose_target_words` | Optional integer 100–50000 on POST `/api/agent/synthesise`. Target prose length in words. If absent, taken from the target node's `metadata.word_count_target` if set, else a default (system-profile-defined). |
| `target_field` | Required string on POST `/api/agent/refine`. One of `'summary'`, `'prose'`, `'notes'`. The field the agent rewrites. |
| `refinement_instruction` | Required string on POST `/api/agent/refine` and `/api/agent/generate-context`. The user's instruction for the rewrite. Trimmed, length 1–2000 characters. Subject to injection scan at high severity. |
| `comment_type` | Required string on POST `/api/nodes/[id]/comments`. One of `'instruction'`, `'question'`, `'note'`, `'critique'`, `'approval'` (Migration 005 enum). |
| `content` (comment) | Required string, trimmed, length 1–4000 characters. |
| `parent_comment_id` | Optional UUID on POST `/api/nodes/[id]/comments`. If present: must reference a comment on the same node, with its own `parent_comment_id` NULL (depth-1 enforcement, G-5). |

The Phase 2 / 3 / 4 forbidden-field list carries over. On agent-op POST routes, additionally: `status`, `tokens_*`, `result_*`, `model_id`, `provider`, `context_snapshot` are all forbidden in the body (return `400 unknown_field`) — these are server- or Edge-Function-set fields. On comment POST: `author_type`, `author_label`, `agent_job_id`, `resolved`, `resolved_at`, `resolved_by` are all forbidden — server-set.

### 2.6 Idempotency

Unchanged from Phase 1 §2.6. Notes specific to Phase 5:

- **POST `/api/agent/<op>` is NOT idempotent.** Each call creates a new `agent_jobs` row. If the client retries a failed POST (e.g. network blip) it will potentially create two jobs. The §2.11 invariant 7 rule (one running job per node at a time) gives a 409 on the duplicate, but the race window between two parallel POSTs is real. Clients SHOULD use a client-generated request key + last-known job state to suppress retries.
- **POST `/api/agent-jobs/[id]/cancel`** is idempotent on already-cancelled jobs: returns 200 with the existing state. On a job that has reached a different terminal state (`completed`, `accepted`, `dismissed`, `failed`), returns `409 agent_job_not_in_progress`.
- **POST `/api/agent-jobs/[id]/accept`** is idempotent on already-accepted jobs: returns 200 with the existing accepted-state response. On any other terminal state (`dismissed`, `cancelled`, `failed`), returns `409 agent_job_already_terminal`. On `pending` / `running`, returns `409 agent_job_already_terminal` ("not yet ready" — same code, distinguished by status field in body).
- **POST `/api/agent-jobs/[id]/dismiss`** is idempotent on already-dismissed jobs: returns 200. Other terminal states → 409 same as above.
- **Comment routes** carry over Phase 4 idempotency: `resolve` is idempotent; `delete` is idempotent at resource level (deleting a deleted comment → 404).

### 2.7 Rate limiting

Unchanged from Phase 4 §2.7 (deferred to V2). The token budget gate (§2.11 invariant 1) is the V1 cost-protection mechanism; per-IP / per-user request-rate caps are V2.

### 2.8 Pagination

`GET /api/documents/[documentId]/agent-jobs` is **paginated**. Long-running projects accumulate hundreds or thousands of agent jobs; surfacing them all on every history-panel render is wasteful.

Pagination contract:
- Query parameters: `?limit=` (1–100, default **50**) and `?offset=` (≥ 0, default 0).
- Filter parameters (orthogonal — combine freely):
  - `?status=` (one of the status enum values; repeatable as `?status=completed&status=accepted` for an OR filter — server treats repeated as set membership).
  - `?node_id=<uuid>` — restrict to jobs targeting this structural or context node.
  - `?operation_type=<expand|synthesise|refine|generate_context>` — restrict to one operation.
  - `?since=<ISO-8601>` — return jobs created on or after this timestamp.
- Order: `created_at` DESC (newest first — matches the history panel's reading order).
- Response: `{ "agent_jobs": [...], "total": <integer>, "has_more": <boolean> }`. `total` is the count of accessible rows (RLS-filtered, post-filter); `has_more` is `(offset + agent_jobs.length) < total`.

`GET /api/nodes/[id]/comments`, `GET /api/agent-jobs/[id]`, and `GET /api/agent-profiles` are **not paginated**. A single node's comment list, a single job's state, and the V1 set of agent profiles (≈4 system + per-org overrides) all fit in a single response without size concerns.

### 2.9 Timestamps and date formats

Unchanged from Phase 1 §2.9.

### 2.10 Caller's organisation

Unchanged from Phase 1 §2.10.

### 2.11 Agent system invariants

These are the invariants every Phase 5 surface upholds. The contract documents the expected behaviour so the test plan can verify it end-to-end and the Edge Function's design can rely on the API route's preconditions.

1. **Token budget gate runs in the API route, before the agent-job record is created.** `checkTokenBudget(organisation, estimatedTokens)` is called as the *last* validation step before `INSERT INTO agent_jobs`. Failure returns `402 token_budget_exceeded` and **no `agent_jobs` row is created**. (Hazard H-07.) Estimated tokens is a per-operation conservative estimate from `agent_profile.max_tokens` plus context-assembly headroom; the *actual* tokens used by the Edge Function may be higher or lower and are recorded on the job row when the Edge Function completes.

2. **User-controlled content is XML-escaped and wrapped in `<user_data>` before any LLM prompt.** Applies to `summary`, `prose`, `notes`, `metadata` (per-key string values), `agent_instruction`, `refinement_instruction`, ancestor-chain content, linked context-node content, and unresolved-comment content. `escapeXml()` handles `<`, `>`, `&`, `"`, `'`. The security frame from `wrapContextWithSecurityFrame()` (TA §4.2) is prepended to the stable block. Missing escaping on any field is a security vulnerability.

3. **Injection scanner runs before prompt assembly.** `scanContent()` (TA §4.3) is called on every user-controlled string about to enter the prompt. High-severity matches return `422 injection_blocked` from the API route; medium-severity matches are logged to `audit_log` and the operation continues. The scan runs on `agent_instruction`, `refinement_instruction`, and (in the Edge Function) on the assembled `summary` / `prose` / `notes` / `metadata-string-values` / `comment.content` of every node included in the context. **Scan position:** the API route scans the body fields it received directly; the Edge Function scans the database-loaded content (since RLS-loaded content is the actual prompt material — scanning at the boundary catches data tampered with after the API route scan but before the Edge Function loads it).

4. **Canary token check on every model response.** `injectCanary()` adds the secret to every system prompt; `scanForCanaryLeak()` (TA §4.4) scans `response.content` plus `JSON.stringify(toolCalls)` for the canary substring. A hit marks the job `failed` with `error_message='canary_leak_detected'` and writes a `severity='critical'` audit log entry. The Edge Function does NOT write the result to the database on canary leak.

5. **Output schema validation before any DB write.** Every operation has a Zod schema in `lib/llm/schemas/<operation>.ts`. The Edge Function parses the model response, runs the schema, and writes `result_*` only if validation passes. On validation failure: job marked `failed` with `error_message='output_schema_invalid'`, the schema's failure path appended to `error_message` for diagnostics, and the raw response stored in `agent_jobs.context_snapshot.raw_response` for audit. (TA §4.7.)

6. **Synthesise is leaf-only.** POST `/api/agent/synthesise` validates `node.is_leaf === true` after RLS visibility — same H-15 rule the ProseEditor mounting uses. Non-leaf target → `400 not_a_leaf_node`. The check runs server-side, not just client-side; the AgentTab's leaf-only button-rendering is a UX nicety, not the security boundary.

7. **One running job per node at a time.** POST `/api/agent/<op>` validates that the target node has no `pending` or `running` agent_job. A concurrent job → `409 agent_job_in_progress`. The check is performed atomically alongside the INSERT (via a `SELECT … FOR UPDATE` on the target node row, then INSERT; if a parallel POST raced, the second `FOR UPDATE` sees the first's job in `pending` and 409s). This invariant lifts in Phase 5b for the Director's parallel workflow steps (which use a different concurrency model — workflow-level not node-level).

8. **Job context_snapshot is stored fully and is immutable.** The Edge Function writes the full `AssembledPrompt` (after security frame, after escapeXml, with ancestor IDs and context-node IDs and snapshot metadata) into `agent_jobs.context_snapshot` as the very first thing it does after setting `status='running'`. This is the audit record — every AI-generated result is permanently traceable to the exact context the model saw. Subsequent edge-function steps and the Accept flow MUST NOT re-write `context_snapshot`.

9. **API route vs Edge Function split.** The Next.js API route does: (a) auth check, (b) body validation, (c) injection scan on body fields, (d) target-node visibility + leaf check + concurrent-job check, (e) profile resolution, (f) token-budget gate, (g) `INSERT INTO agent_jobs (status='pending', target_node_version_at_capture=node.version)`, (h) invoke the `agent-runner` Edge Function (fire-and-forget POST), (i) return `202 Accepted` with `{ jobId, status: 'pending' }`. The Edge Function does: (a) `UPDATE agent_jobs SET status='running'`, (b) load profile + node + ancestors + linked context nodes + unresolved comments, (c) extract Tiptap content as plain text (H-06), (d) inject canary, (e) assemble prompt with `<user_data>` wrapping and security frame, (f) write `context_snapshot`, (g) call LLM via `lib/llm/factory.ts`, (h) scan response for canary leak, (i) validate response against Zod schema, (j) write `result_*` columns, (k) `UPDATE agent_jobs SET status='completed'`. Real-time fires at every status change.

10. **Real-time on `agent_jobs` is the primary update path.** The client subscribes to its `agent_jobs` rows via Supabase real-time (filter: `organisation_id=eq.<own>`). UI components (NodeRow's AgentActivityIndicator, AgentTab, document history list) update from real-time events. The `GET /api/agent-jobs/[id]` endpoint exists as a fallback for reconnect / resume; UI does not poll under normal operation.

11. **Tiptap content is extracted as plain text before prompt inclusion.** The Edge Function calls `generateText()` from `@tiptap/core` on every `summary` / `prose` / `notes` field that is stored as Tiptap JSON. (H-06.) Plain-text Tiptap content (legacy nodes with string-shaped fields) is passed through as-is. The plain-text result is what gets escapeXml'd and wrapped in `<user_data>`.

12. **Token-usage telemetry written by the Edge Function.** `agent_jobs.tokens_input`, `tokens_output`, `tokens_cache_write`, `tokens_cache_read`, `model_id`, and `provider` are populated by the Edge Function from the LLM provider's response. The Anthropic native provider populates cache_read/cache_write tokens (per TA §7.3 prompt caching); the Vercel provider always returns 0 for cache fields. `usage_records` (per-billing-period accumulator) is updated by the same Edge Function transaction that completes the job — see Phase 1 §3.3 Migration 008's `usage_records` table.

13. **Operation results are written to `agent_jobs.result_*` fields, never directly to `nodes`.** This is the Accept-gate guarantee. The Edge Function never writes to the target `nodes` row. Accept reads `result_*` and writes to `nodes` + creates a `node_versions` row. Dismiss leaves `result_*` in place on the (now `dismissed`) job — preserving the audit trail of what the agent proposed even when the author rejected it.

14. **Accept = create new node version + update node fields, with plain-text → Tiptap conversion.** `POST /api/agent-jobs/[id]/accept` is transactional: in one transaction it (a) re-reads the target node and verifies `nodes.version === agent_jobs.target_node_version_at_capture`, (b) on mismatch, returns `409 target_version_mismatch` and DOES NOT advance the job state (the user can retry after reviewing the new version), (c) on match, inserts a `node_versions` row with `change_reason='agent_<operation>'` capturing the *pre-agent* state, (d) **converts plain-text `result_summary` / `result_prose` / `result_notes` to Tiptap JSON via `plainTextToTiptap()` from `lib/agent/prose-to-tiptap.ts`** (G-9), (e) updates the target `nodes` row's relevant fields with the converted Tiptap JSON, (f) for `expand`: inserts the proposed children rows into `nodes` with auto-generated `position` values appended after existing children — child-node `summary` fields are also converted via `plainTextToTiptap()`, (g) updates `agent_jobs.status='accepted'` and `completed_at` (re-uses the field). The trigger from Migration 023 (content-only version-bump) bumps `nodes.version` via the UPDATE.

15. **Cancel sets `status='cancelled'`. The Edge Function checks status before the DB write.** The Edge Function reads `agent_jobs.status` immediately before writing `result_*` and immediately before writing `status='completed'`. If it reads `'cancelled'`, it aborts the write and exits cleanly. Tokens already consumed by the LLM call are still written to `tokens_input`/`tokens_output` for billing fidelity. The cancelled job's `result_*` columns remain NULL.

16. **Comment threading depth-1.** A comment may have `parent_comment_id` set to a top-level comment. A comment with `parent_comment_id` set may NOT be a parent itself. Validation: POST `/api/nodes/[id]/comments` rejects with `400 comment_thread_too_deep` if the supplied `parent_comment_id` references a comment whose own `parent_comment_id` is non-NULL. The schema (Migration 005) admits arbitrary depth for V2 forward-compat; the API caps it at 1 in V1 to match Component Spec §5.10's flat thread rendering.

17. **Cross-document agent operations are not allowed.** RLS already prevents cross-organisation; the API route enforces *within-organisation* same-document-tree rule: a target structural node and any explicit context-node references in `metadata.context_node_ids` (none in V1 — context links are inferred from the node's own `node_context_links`) must share `document_id`. This is automatic for the four V1 operations because they operate on the target node only — no cross-document parameter exists.

### 2.12 Response shape — `agent_job` object

Returned by all four agent operation POSTs (the 202 body), `GET /api/agent-jobs/[id]`, the Accept/Dismiss/Cancel responses, the history list, and (as the source) Supabase real-time payloads.

```json
{
  "id": "uuid",
  "organisation_id": "uuid",
  "node_id": "uuid",
  "document_id": "uuid",
  "profile_id": "uuid",
  "operation_type": "expand",
  "operation_class": "single_node",
  "status": "completed",
  "triggered_by": "user-uuid",
  "tokens_input": 4521,
  "tokens_output": 1832,
  "tokens_cache_write": 4500,
  "tokens_cache_read": 0,
  "model_id": "claude-sonnet-4-6",
  "provider": "anthropic",
  "cost_usd": 0.041013,
  "result_summary": "...",
  "result_prose": null,
  "result_metadata": null,
  "result_child_nodes": [ { "name": "Scene 1", "summary": "...", "metadata": {} } ],
  "target_node_version_at_capture": 4,
  "error_message": null,
  "created_at": "2026-05-04T10:30:00.000Z",
  "started_at": "2026-05-04T10:30:01.200Z",
  "completed_at": "2026-05-04T10:30:14.700Z"
}
```

Field notes:
- `context_snapshot` is **not** included in the standard response (it's large and only of interest to admin tooling). A separate `GET /api/agent-jobs/[id]?include=snapshot` query param can request it; the snapshot is returned only to the job's `triggered_by` user or org owner. Out of Phase 5 V1 scope; deferred to V1.x.
- `result_summary_text` (Migration 026 rename) is **not** included in the response shape — it's only meaningful for `operation_class='document_operation'` which is not in V1.
- `result_*` fields are non-NULL only when `status='completed'` (or terminal states downstream of `completed`: `accepted`, `dismissed`). On `cancelled` or `failed` jobs they are NULL.
- `tokens_*` fields are non-NULL once `status` reaches `running` (the Edge Function writes them at LLM-call completion, even before final result write).
- `cost_usd` is non-NULL once `status` reaches `completed` (or terminal states downstream). NULL on `pending` / `running` / `cancelled` (cancelled-mid-call jobs are an exception — `tokens_*` are populated for billing fidelity but `cost_usd` may also be populated since the model already produced output that incurred cost). See G-13. **Internal-only field — not displayed in any V1 user-facing UI.** Platform-paid users see allocation percentage in the AgentTab per Component Spec §5.9 and Product Spec §3.2; BYOK users see raw token counts for their key. Cost-in-USD surfaces only in the Phase 5 Test Report's §10 Cost Analysis and the `scripts/cost-report.ts` tool output.

### 2.13 Response shape — `comment` object

Returned by POST `/api/nodes/[id]/comments`, GET `/api/nodes/[id]/comments` (in array), PATCH `/api/comments/[id]`, POST `/api/comments/[id]/resolve`.

```json
{
  "id": "uuid",
  "node_id": "uuid",
  "parent_comment_id": null,
  "author_type": "human",
  "author_label": "user-uuid-or-display-name",
  "agent_job_id": null,
  "comment_type": "instruction",
  "content": "Make this scene tenser.",
  "resolved": false,
  "resolved_at": null,
  "resolved_by": null,
  "created_at": "2026-05-04T10:30:00.000Z"
}
```

Field notes:
- `author_label` is the user's UUID for human comments (Phase 5 ships UUIDs; display-name resolution is a client concern for V1). For agent comments, `author_label` is the `agent_profiles.name` (e.g. "Critique Agent v1").
- `agent_job_id` is non-NULL only for `author_type='agent'` comments. V1 single-node operations (`expand`, `synthesise`, `refine`, `generate_context`) do **not** create agent comments — those are produced by document operations (post-V1-launch). Phase 5 ships the comment-system substrate; agent-authored comments arrive with the document-operation work.
- `organisation_id` is omitted from the response (server-internal RLS gate, not interesting to clients).

### 2.14 Response shape — `agent_profile` object

Returned by `GET /api/agent-profiles` (in array).

```json
{
  "id": "uuid",
  "organisation_id": null,
  "name": "Expand Chapter to Scenes",
  "description": "Generate 3-5 scene summaries from a chapter summary.",
  "operation_class": "single_node",
  "operation_type": "expand",
  "node_type": "chapter",
  "model_id": "claude-sonnet-4-6",
  "temperature": 0.7,
  "max_tokens": 4096,
  "is_system_profile": true,
  "context_rules": { "include_ancestors": true, "include_linked_contexts": true },
  "node_scope_definition": {}
}
```

Field notes:
- `system_prompt` and `output_format_instructions` are NOT returned — these are server-side prompts, not for client consumption. Surfacing them to the UI would expose the model's reasoning interface to users (low value; security-adjacent).
- `organisation_id` is `null` for system profiles; UUID for own-org profiles.
- `node_type` is `null` on profiles that apply to all node types of a given operation.

### 2.15 Real-time subscription contract

The client subscribes to its organisation's `agent_jobs` channel:

```ts
const channel = supabase
  .channel('agent-jobs')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'agent_jobs',
      filter: `organisation_id=eq.${orgId}` },
    (payload) => { ... }
  )
  .subscribe()
```

Events fired (per Migration 006's enabled real-time on `agent_jobs`):
- INSERT — new job created (after API route's INSERT). Status `pending`.
- UPDATE — status transitions: `pending` → `running` → `completed`, or terminal states (`accepted` / `dismissed` / `cancelled` / `failed`). Token counts updated.
- DELETE — not used in Phase 5. Cleanup of old jobs is V2 (admin tooling).

**RLS on real-time:** Supabase respects the same RLS policies on real-time subscriptions. A user receives only their organisation's events.

**Hazard H-05 carry-forward:** Components subscribing to the channel MUST clean up via `supabase.removeChannel(channel)` on unmount. Phase 1 / 2 / 3 surfaces already follow this; Phase 5's new components (NodeRow's AgentActivityIndicator subscription, AgentTab's per-job subscription, history panel's per-document subscription) inherit the rule.

---

## 3. Endpoint Specifications

Each endpoint follows the Phase 1 / 2 / 3 / 4 contract structure: purpose → request → success → failure modes → RLS notes.

### 3.1 `POST /api/agent/expand` — Generate child nodes

**Purpose.** Generate child nodes one layer down from the target node. Creates an `agent_jobs` row with `operation_type='expand'`. The Edge Function produces an array of proposed child nodes in `result_child_nodes`. Children are inserted into `nodes` only on Accept.

**Request body:**

```json
{
  "node_id": "<uuid>",
  "profile_id": "<uuid>",
  "agent_instruction": "Focus on character interiority.",
  "target_layer_count": 4,
  "expected_version": 7
}
```

All fields except `node_id` are optional. Server picks defaults per §2.5.

**Validation order** (first failure wins):

1. Session present — else `401 unauthorised`.
2. `Content-Type: application/json` — else `400 invalid_json`.
3. Body parses as JSON object — else `400 invalid_json` / `400 missing_body`.
4. No unknown fields — else `400 unknown_field`.
5. `node_id` present, valid UUID — else `400 invalid_uuid`.
6. Target node exists and is visible — else `404 not_found`.
7. Target node is structural (`node_category='structural'`) and not a leaf (`is_leaf === false`) — else `400 invalid_operation_for_node_type`.
8. If `expected_version` present: `node.version === expected_version` — else `409 version_conflict`.
9. If `profile_id` present: profile exists and is visible per Migration 025 RLS — else `404 agent_profile_not_found`.
10. If `profile_id` present: `profile.operation_type='expand'` — else `400 profile_operation_mismatch`. If `profile_id` absent: server selects the system profile matching `(operation_type='expand', node_type=node.node_type)`; if no profile matches, `400 invalid_operation_for_node_type` ("expand on this node type isn't configured").
11. `agent_instruction` (if present) — string, trimmed, max 2000 chars — else `400 invalid_agent_instruction`. Run `scanContent()`; high-severity → `422 injection_blocked`.
12. `target_layer_count` (if present) — integer 1–10 — else `400 invalid_target_layer_count`.
13. **Concurrency check.** Acquire `SELECT … FOR UPDATE` on the target node row. Query for any `agent_jobs` row with `node_id=<id> AND status IN ('pending','running')`. If found, release lock and return `409 agent_job_in_progress`.
14. **Token budget gate.** `checkTokenBudget(organisation, profile.max_tokens + assembly_overhead)`. Failure → `402 token_budget_exceeded`. (No job row created.)
15. INSERT `agent_jobs` with `status='pending'`, `triggered_by=auth.uid()`, `target_node_version_at_capture=node.version`, `operation_type='expand'`, all body fields propagated to the appropriate columns (`agent_instruction` and `target_layer_count` go into `context_snapshot.dynamic` once the Edge Function assembles).
16. POST to the `agent-runner` Edge Function with `{ jobId }` (fire-and-forget).
17. Release the row lock.

**Success (202):**

```json
{
  "jobId": "<uuid>",
  "status": "pending",
  "created_at": "2026-05-04T10:30:00.000Z"
}
```

The full `agent_job` shape is fetched via real-time or by polling §3.5.

**Failure modes:** `unauthorised` (401), `invalid_json` (400), `missing_body` (400), `unknown_field` (400), `invalid_uuid` (400), `not_found` (404), `invalid_operation_for_node_type` (400), `version_conflict` (409), `agent_profile_not_found` (404), `profile_operation_mismatch` (400), `invalid_agent_instruction` (400), `injection_blocked` (422), `invalid_target_layer_count` (400), `agent_job_in_progress` (409), `token_budget_exceeded` (402).

**RLS notes:** The route uses the user-session client for steps 6, 9, 13, and the INSERT. RLS on `nodes`, `agent_profiles`, and `agent_jobs` is the cross-organisation boundary. The Edge Function invocation (step 16) uses the service-role key (Edge Function's own auth); the Edge Function authorises by re-reading the just-created job row and trusting `organisation_id` on it.

### 3.2 `POST /api/agent/synthesise` — Generate prose at a leaf node

**Purpose.** Generate prose at a leaf structural node from the assembled context (ancestor summaries, linked context nodes, unresolved comments, the node's own summary). Creates an `agent_jobs` row with `operation_type='synthesise'`. The Edge Function writes prose to `result_prose`. Accept commits as a new node version.

**Request body:**

```json
{
  "node_id": "<uuid>",
  "profile_id": "<uuid>",
  "agent_instruction": "First-person POV; present tense.",
  "prose_target_words": 1200,
  "expected_version": 3
}
```

All fields except `node_id` are optional.

**Validation order:**

1. Steps 1–6 from §3.1.
2. Target node is structural (`node_category='structural'`) and **is a leaf** (`is_leaf === true`) — else `400 not_a_leaf_node` (when `node_category='structural'` but `is_leaf=false`) or `400 invalid_operation_for_node_type` (when context node).
3. If `expected_version` present: §3.1 step 8.
4. Profile resolution: §3.1 steps 9–10 with `operation_type='synthesise'`. If no system profile matches, fall back to the `synthesise_default` profile (any node_type).
5. `agent_instruction`: §3.1 step 11.
6. `prose_target_words` (if present): integer 100–50000 — else `400 invalid_prose_target_words`.
7. Concurrency: §3.1 step 13.
8. Token budget: §3.1 step 14. Synthesise's token estimate is higher (the prose output is ~8× expand's structural output); the gate may reject calls expand would have admitted.
9. INSERT job, invoke Edge Function: §3.1 steps 15–17.

**Success (202):** As §3.1.

**Failure modes:** As §3.1 plus `not_a_leaf_node` (400), `invalid_prose_target_words` (400). (`invalid_target_layer_count` is removed.)

**RLS notes:** As §3.1.

### 3.3 `POST /api/agent/refine` — Rewrite or improve an existing field

**Purpose.** Rewrite or improve a specific field on the target node. Creates an `agent_jobs` row with `operation_type='refine'`. The Edge Function's result populates `result_summary`, `result_prose`, or `result_metadata` depending on `target_field`. Accept commits as a new node version.

**Request body:**

```json
{
  "node_id": "<uuid>",
  "profile_id": "<uuid>",
  "target_field": "prose",
  "refinement_instruction": "Make the dialogue tenser; cut the third paragraph.",
  "expected_version": 12
}
```

`target_field` and `refinement_instruction` are required. `node_id` is required. Other fields optional.

**Validation order:**

1. Steps 1–6 from §3.1.
2. Target node category check:
   - `target_field='summary'` or `'notes'`: any structural or context node admitted.
   - `target_field='prose'`: structural and leaf only (synthesise's leaf rule applies — refining prose on a non-leaf is meaningless because non-leaves don't have prose).
   - `target_field='metadata'` (admitted in V1 only for context nodes): context node only — refining structural-node metadata is V1.x.
   - Mismatch → `400 invalid_operation_for_node_type` or `400 not_a_leaf_node`.
3. `target_field` present and in `{'summary','prose','notes'}` (V1; v1.1 confirms `'notes'` is fully supported via Migration 026's `result_notes` column — see G-11) — else `400 invalid_target_field`. (`'metadata'` is V1.x; rejected with `invalid_target_field` in V1 for compatibility with the Phase 5 plan's reduced scope.)
4. `refinement_instruction` present, trimmed, length 1–2000 — else `400 invalid_refinement_instruction`. Run `scanContent()`; high-severity → `422 injection_blocked`.
5. The target field has existing content (non-null, non-empty after Tiptap text extraction) — else `400 refine_empty_field` (you cannot refine nothing; use `synthesise` or `generate-context` instead for `prose` or `summary` from scratch).
6. `expected_version` check: §3.1 step 8.
7. Profile resolution: §3.1 steps 9–10 with `operation_type='refine'`. The system profile is selected by `(operation_type='refine', node_type=node.node_type, target_field)` if available, else the generic `refine_default` profile. **Document-type coverage caveat (G-12):** Phase 5 ships agent-profile coverage for the V1 Novel template only (`book / act / chapter / scene / beat`). For Short Story documents (`story` node type) and Series documents (`series` node type), refine returns `400 invalid_operation_for_node_type` because no matching profile exists in `agent_profiles` after Migration 027. `refine_default` is selected only when the target node's `node_type` matches no specific profile AND the operation is admitted by the document-type's layer stack.
8. `agent_instruction`: §3.1 step 11.
9. Concurrency: §3.1 step 13.
10. Token budget: §3.1 step 14.
11. INSERT job, invoke Edge Function: §3.1 steps 15–17.

**Success (202):** As §3.1.

**Failure modes:** As §3.1 plus `invalid_target_field` (400), `invalid_refinement_instruction` (400), `refine_empty_field` (400), `not_a_leaf_node` (400 — when `target_field='prose'` and non-leaf).

**RLS notes:** As §3.1.

### 3.4 `POST /api/agent/generate-context` — Generate a context node's content

**Purpose.** Generate a context node's content from scratch or from a partial seed. Creates an `agent_jobs` row with `operation_type='generate_context'`. The Edge Function writes the result to `result_summary` and `result_metadata`. Accept commits as a new node version on the context node.

**Request body:**

```json
{
  "node_id": "<uuid>",
  "profile_id": "<uuid>",
  "agent_instruction": "Build out from the existing notes; emphasise backstory.",
  "expected_version": 1
}
```

Required: `node_id`. The "from a partial seed" mode is automatic — the Edge Function reads the current `summary` / `notes` / `metadata` of the context node and treats them as the seed; if all are empty, it generates from scratch.

**Validation order:**

1. Steps 1–6 from §3.1.
2. Target node is a context node (`node_category='context'`) — else `400 invalid_operation_for_node_type`.
3. `expected_version` check: §3.1 step 8.
4. Profile resolution: §3.1 steps 9–10 with `operation_type='generate_context'`. The system profile is selected by `(operation_type='generate_context', node_type=node.node_type)`. The six V1 context types each have their own profile (TA §11 / Phase 4 G-4 / library doc §2.12–§2.17). The agent's emitted `metadata` shape is the spec for the V1 metadata schemas in `lib/context/metadata-schemas.ts` — see G-10.
5. `agent_instruction`: §3.1 step 11.
6. Concurrency: §3.1 step 13.
7. Token budget: §3.1 step 14.
8. INSERT job, invoke Edge Function: §3.1 steps 15–17.

**Success (202):** As §3.1.

**Failure modes:** As §3.1.

**RLS notes:** As §3.1. The agent profile for `generate_context` is keyed on `node_type` — Phase 4's six-core-type whitelist (`character`, `location`, `organisation`, `theme`, `plot_thread`, `world`) is the matching set. A request for a context node of an unrecognised type → `400 invalid_operation_for_node_type` at step 4.

### 3.5 `GET /api/agent-jobs/[jobId]` — Fetch job state

**Purpose.** Return the current state of an agent job. The primary update path for the client is Supabase real-time on `agent_jobs`; this endpoint is the fallback for reconnect, resume, or initial render.

**Path parameter:** `jobId` — UUID of the agent job.

**Validation order:**

1. `jobId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Job exists and is visible (RLS) — else `404 not_found`.

**Success (200):** The full `agent_job` object per §2.12.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404).

**RLS notes:** RLS on `agent_jobs` (Migration 006) is the boundary. A job in another organisation returns 404.

### 3.6 `POST /api/agent-jobs/[jobId]/cancel` — Cancel a running job

**Purpose.** Mark a `pending` or `running` job `cancelled`. The Edge Function checks status before its terminal write and aborts the result write if the job is cancelled. Tokens consumed by the LLM call up to the cancellation point are still recorded.

**Path parameter:** `jobId` — UUID.

**Request body:** None.

**Validation order:**

1. `jobId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Job exists and is visible — else `404 not_found`.
4. Job's `status` is `pending` or `running` — else `409 agent_job_not_in_progress`. (Already-cancelled job → return 200 with current state — idempotent per §2.6.)
5. UPDATE `agent_jobs SET status='cancelled', completed_at=NOW()`. The Edge Function's status-check before result write picks this up and aborts cleanly.

**Success (200):** The full `agent_job` object per §2.12.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `agent_job_not_in_progress` (409).

**RLS notes:** RLS on `agent_jobs` is the boundary. The UPDATE happens via the user-session client — the cancelling user must be in the job's organisation. Phase 5 does not restrict cancellation to the `triggered_by` user; any org member can cancel any job in their org. (V2 may tighten this.)

### 3.7 `POST /api/agent-jobs/[jobId]/accept` — Commit a completed job's result

**Purpose.** Atomically apply a `completed` job's `result_*` to the target node, creating a new `node_versions` row capturing the pre-agent state and updating `nodes` with the agent's content. For `expand`, also inserts the proposed child nodes.

**Path parameter:** `jobId` — UUID.

**Request body:** None. (Optional `expected_version` may be added in V1.x; V1 uses the snapshot's `target_node_version_at_capture` as the implicit guard.)

**Validation order:**

1. `jobId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Job exists and is visible — else `404 not_found`.
4. Job's `status` is `completed` — else `409 agent_job_already_terminal`. (Already-accepted → return 200 idempotent. `dismissed` / `cancelled` / `failed` / `pending` / `running` → 409 with a status field in the body indicating the actual current state, so the client can render an explanatory toast.)
5. **In a single transaction:**
   - `SELECT … FOR UPDATE` on the target node row. Verify `node.version === job.target_node_version_at_capture` — else **abort and return** `409 target_version_mismatch` with body `{ "current_version": <node.version>, "captured_version": <job.target_node_version_at_capture> }`. The job remains `completed`; the client re-fetches the node and presents a "node has changed since the agent ran — review the diff?" UI.
   - INSERT a `node_versions` row capturing the *pre-agent* state of the target node (the trigger from Migration 023 will fire on the subsequent UPDATE, so manual insertion of the pre-state is not needed — but the API explicitly INSERTs to set `change_reason='agent_<operation>'` for audit; the Migration 023 trigger's auto-INSERT would have generic `change_reason='content_change'`).
   - For `expand`: INSERT each `result_child_nodes[i]` as a new `nodes` row, with `parent_id=target.id`, `position` appended after the last existing child (Phase 2 sibling-renumber semantics carry over), `node_category='structural'`, `node_type` from the layer-stack's next layer below `target.layer_index`, `version=1`, `status='draft'`. The INSERT order matches the array order in `result_child_nodes` — the agent-proposed sequence is the surfaced sequence.
   - For `synthesise`: UPDATE `target_node` SET `prose=job.result_prose`, `version=version+1` (the trigger handles the bump).
   - For `refine`: UPDATE `target_node` SET `<target_field>=job.result_<field>`, `version=version+1`.
   - For `generate-context`: UPDATE `target_node` SET `summary=job.result_summary`, `metadata=job.result_metadata` (merge — the agent's metadata replaces only the keys it returns; existing keys not in `result_metadata` are preserved).
   - UPDATE `agent_jobs SET status='accepted', completed_at=NOW()` (re-uses the existing column — semantically "terminal_at"; the literal name `completed_at` is preserved for schema-compat).
6. Return the updated `agent_job` plus a summary of what was written.

**Success (200):**

```json
{
  "agent_job": { /* full §2.12 with status='accepted' */ },
  "applied": {
    "node_id": "<uuid>",
    "new_version": 8,
    "child_nodes_created": [ "<uuid>", "<uuid>" ]
  }
}
```

`child_nodes_created` is an empty array for non-expand operations.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `agent_job_already_terminal` (409), `target_version_mismatch` (409).

**RLS notes:** All writes happen via the user-session client. RLS on `nodes`, `node_versions`, and `agent_jobs` enforce cross-organisation safety. The transaction is atomic: a failure in any step rolls back all writes (no partial Accept).

### 3.8 `POST /api/agent-jobs/[jobId]/dismiss` — Discard a completed result

**Purpose.** Mark a `completed` job `dismissed`. The job's `result_*` columns remain populated (audit trail of what was proposed); no writes to `nodes` or `node_versions` occur.

**Path parameter:** `jobId` — UUID.

**Request body:** None.

**Validation order:**

1–4. As §3.7. (Idempotent on already-dismissed.)
5. UPDATE `agent_jobs SET status='dismissed', completed_at=NOW()`.

**Success (200):** The full `agent_job` object per §2.12 with `status='dismissed'`.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `agent_job_already_terminal` (409).

**RLS notes:** RLS on `agent_jobs`.

### 3.9 `GET /api/documents/[documentId]/agent-jobs` — Document history list

**Purpose.** Paginated list of agent jobs for a document. Backs the document-level history panel (Component Spec — to be specified in §5.9 in a future Component Spec amendment, since the existing AgentTab spec is per-node).

**Path parameter:** `documentId` — UUID.

**Query parameters:** Per §2.8 — `limit`, `offset`, `status`, `node_id`, `operation_type`, `since`.

**Validation order:**

1. `documentId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Query parameters valid — else `400 invalid_query`.
4. Document exists and is visible — else `404 document_not_found`.

**Success (200):**

```json
{
  "agent_jobs": [ /* §2.12 objects */ ],
  "total": 47,
  "has_more": true
}
```

**Failure modes:** `invalid_uuid` (400), `invalid_query` (400), `unauthorised` (401), `document_not_found` (404).

**RLS notes:** RLS on `agent_jobs` (filtered by `document_id` query) is the boundary.

### 3.10 `POST /api/nodes/[nodeId]/comments` — Create a comment

**Purpose.** Create a top-level or one-level-deep reply comment on a node. Human comments only — agent-authored comments are produced by document operations (post-V1) and write directly via service-role.

**Path parameter:** `nodeId` — UUID of any node (structural or context).

**Request body:**

```json
{
  "comment_type": "instruction",
  "content": "Make this scene tenser.",
  "parent_comment_id": null
}
```

**Validation order:**

1. `nodeId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. `Content-Type` and JSON parse — else `400 invalid_json`.
4. No unknown fields — else `400 unknown_field` (forbidden body fields per §2.5).
5. `comment_type` present and in `{'instruction','question','note','critique','approval'}` — else `400 invalid_comment_type`.
6. `content` present, trimmed, length 1–4000 — else `400 invalid_content`. Run `scanContent()`; high-severity → `422 injection_blocked`. (Comments are surfaced to the LLM as context per the assembler — they ARE prompt material.)
7. `parent_comment_id` (if present): valid UUID — else `400 invalid_uuid`.
8. Target node exists and is visible — else `404 not_found`.
9. If `parent_comment_id` present:
   - The parent comment exists, is visible, and `parent_comment.node_id === nodeId` — else `400 comment_not_in_node`.
   - The parent comment's `parent_comment_id` is NULL (depth-1 enforcement) — else `400 comment_thread_too_deep`.
10. Lock check on the target node (parents and self) — else `423 node_locked` / `parent_locked`. (Comments are content writes per the broader product semantics; locked nodes don't admit new comments.)
11. INSERT `node_comments` with `author_type='human'`, `author_label=auth.uid()`, `agent_job_id=null`, `resolved=false`. Server sets `id`, `created_at`.

**Success (201):** The full comment object per §2.13.

**Failure modes:** `invalid_uuid` (400), `invalid_json` (400), `unknown_field` (400), `invalid_comment_type` (400), `invalid_content` (400), `injection_blocked` (422), `unauthorised` (401), `not_found` (404), `comment_not_in_node` (400), `comment_thread_too_deep` (400), `node_locked` (423), `parent_locked` (423).

**RLS notes:** RLS on `node_comments` (Migration 005). The route's pre-checks (parent comment existence, parent's parent_comment_id NULL) execute via the user-session client.

### 3.11 `GET /api/nodes/[nodeId]/comments` — List comments on a node

**Purpose.** Return all comments on a node — resolved and unresolved, top-level and replies. Backs the CommentThread component (Component Spec §5.10).

**Path parameter:** `nodeId` — UUID.

**Validation order:**

1. `nodeId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Target node exists and is visible — else `404 not_found`.

**Success (200):**

```json
{
  "comments": [ /* §2.13 objects */ ],
  "total": 8
}
```

**Order:** Top-level comments first by `created_at` ASC; replies follow their parent in `created_at` ASC. The client is responsible for the visual nesting; the server returns a flat array with `parent_comment_id` populated for replies.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404).

**RLS notes:** RLS on `node_comments`.

### 3.12 `PATCH /api/comments/[commentId]` — Edit a comment

**Purpose.** Edit a human-authored comment's `content`. Author-only. Agent comments are immutable.

**Path parameter:** `commentId` — UUID.

**Request body:**

```json
{ "content": "Updated text." }
```

**Validation order:**

1. `commentId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Body parse, no unknown fields (only `content` admitted) — else `400 invalid_json` / `400 unknown_field`.
4. `content` present, trimmed, length 1–4000 — else `400 invalid_content`. Run `scanContent()`; high-severity → `422 injection_blocked`.
5. Comment exists and is visible — else `404 not_found`.
6. Comment is human-authored (`author_type='human'`) — else `400 cannot_edit_agent_comment`.
7. Caller is the author (`comment.author_label === auth.uid()`) — else `403 not_comment_author`.
8. Lock check on the comment's node (parents and self) — else `423`.
9. UPDATE `node_comments SET content=?, ...`. (No `updated_at` column in Migration 005 — the edit is silent re: timestamp; the original `created_at` is preserved. This matches Migration 005's shape; if a future phase adds `updated_at`, this contract amends.)

**Success (200):** The full comment object per §2.13.

**Failure modes:** `invalid_uuid` (400), `invalid_json` (400), `unknown_field` (400), `invalid_content` (400), `injection_blocked` (422), `unauthorised` (401), `not_found` (404), `cannot_edit_agent_comment` (400), `not_comment_author` (403), `node_locked` (423), `parent_locked` (423).

**RLS notes:** RLS on `node_comments` admits org members. The author check (step 7) is *within-org* — RLS allows org members to see each other's comments, but the API restricts editing to the author.

### 3.13 `POST /api/comments/[commentId]/resolve` — Mark a comment resolved

**Purpose.** Mark a comment `resolved=true`, capturing `resolved_at` and `resolved_by`. Any org member can resolve any comment (including agent-authored comments). Already-resolved comments return 200 idempotently.

**Path parameter:** `commentId` — UUID.

**Request body:** None.

**Validation order:**

1. `commentId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Comment exists and is visible — else `404 not_found`.
4. Comment is currently `resolved=false` (else 200 with current state — idempotent).
5. Lock check on the comment's node — else `423`. (Resolution is a write that affects how the comment surfaces in agent context — locked nodes don't admit it.)
6. UPDATE `node_comments SET resolved=true, resolved_at=NOW(), resolved_by=auth.uid()`.

**Success (200):** The full comment object per §2.13.

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `node_locked` (423), `parent_locked` (423).

**RLS notes:** RLS on `node_comments`.

### 3.14 `DELETE /api/comments/[commentId]` — Delete a comment

**Purpose.** Delete a comment. Author-only OR org owner (organisation_members.role='owner') with no other restrictions. Deletes child replies via the schema's FK cascade.

**Path parameter:** `commentId` — UUID.

**Validation order:**

1. `commentId` valid UUID — else `400 invalid_uuid`.
2. Session present — else `401 unauthorised`.
3. Comment exists and is visible — else `404 not_found`.
4. Caller is the author OR is an org owner — else `403 not_comment_author` (label slightly misleading on the owner path; the API still uses this code for consistency).
5. Lock check on the comment's node — else `423`.
6. DELETE `node_comments`. The schema's `parent_comment_id REFERENCES node_comments(id)` does NOT cascade by default (Migration 005's FK has no ON DELETE clause). **Resolution:** add `ON DELETE CASCADE` to the FK in Migration 026 (this is a small addition to the migration's scope; documented in the build checklist alongside the status-enum and result_* changes). Without cascade, deleting a parent comment with replies would orphan the replies.

**Success (200):**

```json
{ "deleted": true, "comment_id": "<uuid>", "child_comments_deleted": 2 }
```

**Failure modes:** `invalid_uuid` (400), `unauthorised` (401), `not_found` (404), `not_comment_author` (403), `node_locked` (423), `parent_locked` (423).

**RLS notes:** RLS on `node_comments`. Owner-role check via `organisation_members` query.

### 3.15 `GET /api/agent-profiles` — List agent profiles

**Purpose.** Return system + own-org agent profiles. Backs the AgentTab profile picker (Component Spec §5.9). Migration 025's RLS policy is the cross-organisation boundary.

**Query parameters:**

| Name | Type | Default | Description |
|---|---|---|---|
| `operation_type` | string | (all) | Filter by `expand` / `synthesise` / `refine` / `generate_context`. |
| `node_type` | string | (all) | Filter by node_type. Profiles with `node_type=null` (cross-type) are always included. |
| `operation_class` | string | `single_node` | Filter by `single_node` / `document_operation`. Default `single_node` since V1 only ships single-node ops. |

**Validation order:**

1. Session present — else `401 unauthorised`.
2. Query parameters valid — else `400 invalid_query`.

**Success (200):**

```json
{
  "agent_profiles": [ /* §2.14 objects */ ],
  "total": 12
}
```

Order: own-org profiles first (alphabetical by `name`), then system profiles (alphabetical). UI shows own-org overrides at top.

**Failure modes:** `invalid_query` (400), `unauthorised` (401).

**RLS notes:** Migration 025's policy admits system profiles (organisation_id=null) and own-org profiles. No 404 path — invisible profiles are filtered out silently.

---

## 4. Test Cases

The Phase 5 Test Plan (`stelavox_phase5_test_plan_v1_0.md`) is the authoritative test-case list. Summary by area:

| Area | Section | Approximate count |
|---|---|---|
| API integration (TC-A) | §5 | 60 — POST/GET/cancel/accept/dismiss for each of the four operations; concurrency (one-running-job-per-node); version_conflict on Accept; idempotency on Accept/Dismiss/Cancel; profile resolution; agent profile list filters; comment CRUD + resolve + delete |
| Authorisation boundary (TC-B) | §6 | 14 — RLS on agent_jobs / agent_profiles / node_comments; cross-org rejection; cross-document rejection; non-author edit rejection; non-org-owner delete rejection |
| Data integrity (TC-D) | §7 | 16 — agent_jobs status transitions; result_* columns NULL outside completed/accepted/dismissed; tokens_* populated post-running; context_snapshot immutable; Accept transactionality (rollback on partial failure); Migration 026 result_summary rename safety; comment depth-1 enforcement; cascade delete of replies |
| Security (TC-S — new in Phase 5) | §8 | 14 — escapeXml on every user field; injection scan blocks high-severity; injection scan logs medium-severity; canary leak detection; output schema validation rejects malformed responses; canary token never present in normal output; CSP headers on agent responses |
| UI checkpoint (TC-U) | §9 | 24 — AgentTab profile picker, instruction textarea, operation buttons, leaf-only Synthesise rendering, active state progress bar, Accept button (verdigris use #7), Dismiss flow, history list rendering, AgentActivityIndicator on tree, real-time subscription cleanup, comment thread rendering, resolve toggle, delete confirmation, depth-1 reply UI |
| Visual / state (TC-V) | §10 | 8 — agent-running colour matches `--color-agent-running`, comment type colours, accept button verdigris, progress bar geometry, ◆ icon for agent comments |
| Motion / transitions (TC-M) | §11 | 6 — AgentActivityIndicator opacity 1→0.4→1 over 2s ease-in-out, prefers-reduced-motion collapse, progress bar fill smoothness, accept-button hover transition |
| Accessibility (TC-AX) | §12 | 8 — keyboard navigation through AgentTab; ARIA on operation buttons; screen-reader announcement of status changes; comment thread reading order; resolve button label |

Approximate total: **150 cases** (vs. Phase 4's 90). The higher count reflects four operations × five lifecycle endpoints, the new security pipeline coverage, and the comment system breadth.

---

## 5. Specification Gaps Found While Writing This Contract

These are gaps surfaced during contract drafting. They are recorded here so the build agent does not silently invent behaviour when it encounters them.

### G-1 — System prompts live in `agent_profiles` rows, not in `platform_config`

**Gap:** TA §3.7.4 lists `model.<operation>` keys in `platform_config` (the model IDs) but no `system_prompt.<operation>` key. H-12 says "any value an admin might want to change without a deployment goes in `platform_config`." System prompts are unambiguously such values — copywriting iterations on the prompts are a frequent admin task. Should the prompts live in `platform_config` or in `agent_profiles.system_prompt`?

**Resolution for Phase 5:** `agent_profiles.system_prompt` (Migration 004's existing column). Reasons:
1. The schema already has the column. Adding `platform_config.system_prompt.expand` (and three more) duplicates the storage.
2. Per-organisation overrides are a V2 feature; `agent_profiles.organisation_id` is the natural carrier (NULL = system; UUID = org override). `platform_config` is per-platform with no per-org dimension.
3. Per-`node_type` variation (Phase 4's six context types each get their own profile for `generate_context`) is naturally expressed as multiple `agent_profiles` rows. `platform_config` would need a composite key.
4. H-12's spirit is "admin can change without a code deploy" — Migration 027's seed populates the system prompts; admin updates via SQL UPDATE on `agent_profiles` (no code change, no deploy). H-12 is satisfied.

**Test verification:** Migration 027 inserts the four system profiles. TC-D-04 verifies that `agent_profiles.system_prompt` is non-NULL on all four V1 system profiles after seed.

**SU candidate (none).** The decision is consistent with §3.7.4's intent and the existing schema; no upstream-spec change.

### G-2 — `agent_profiles` system prompt content for V1

**Gap:** Migration 027 inserts four V1 system profiles but the *content* of the system prompts is not specified anywhere. Without authored prompts the build can't ship — the four POST endpoints will produce gibberish.

**Resolution for Phase 5:** The Phase 5 Build Checklist §2.X (to be authored) includes prompt-authoring as an explicit deliverable, with a section listing the canonical V1 system prompts for `expand_chapter_to_scenes`, `synthesise_default`, `refine_default`, and `generate_context_<type>` (six profiles for the six context types — that's actually nine profiles total, not four). The prompts are authored on Opus during Tier-B authoring time (per the model advisory) and reviewed against TA §6.2's context-assembler design and TA §4.4's canary-injection rule.

**SU candidate (Phase 5 → Product Spec or TA, deferred to close-out):** The V1 prompts may surface design questions (e.g., should `synthesise` always include unresolved comments, or only `comment_type='instruction'`?). Any such gaps surface during prompt authoring and are absorbed at close-out.

### G-3 — Concurrent author edits during a running agent job

**Gap:** While an agent job is `running`, the author can still edit the target node's `summary` / `prose` / `notes` via the Phase 3 PATCH route. When the job completes and the author tries to Accept, the proposed `result_*` was based on a snapshot of the node's content at job-creation time; the author has since changed it. What happens?

**Resolution for Phase 5:** The Accept route (§3.7) checks `nodes.version === agent_jobs.target_node_version_at_capture` in a `SELECT … FOR UPDATE` transaction. On mismatch, returns `409 target_version_mismatch` with the current and captured versions. The job remains `completed` — the author can re-fetch the node, view the diff between captured and current, and decide whether to (a) Dismiss the agent's now-stale result, (b) re-trigger the operation against the new version, or (c) manually merge.

**Test verification:** TC-A-21 issues a PATCH between job creation and Accept; verifies the Accept returns 409 with both version numbers in the body.

**SU candidate (none).** Phase 3's optimistic-concurrency model already handles this pattern; Phase 5 inherits and extends it via `target_node_version_at_capture`.

### G-4 — `expand` child-node `node_type` resolution

**Gap:** When `expand` produces children for a Chapter, the children should be Scenes (one layer deeper in the layer-stack). The proposed children in `result_child_nodes` are agent-generated and contain `name`, `summary`, etc., but the `node_type` is not in the agent's response shape — it's a structural property of the layer-stack. Where does the Accept flow get `node_type` for the new children?

**Resolution for Phase 5:** The Accept flow reads the target node's `document_id`, joins `documents.layer_stack_id` → `layer_stacks.layers`, and reads the layer at `target.layer_index + 1`. That layer's `node_type` is the `node_type` for all children inserted by Accept. If `target.layer_index + 1` exceeds the stack's last layer index (i.e. target is a leaf), `expand` should never have been admitted — the §3.1 step 7 leaf check is the gate. Belt-and-braces: if Accept finds the target unexpectedly leaf, return `400 invalid_operation_for_node_type` with `error_message='target_became_leaf_post_capture'` (extraordinarily rare; admin tooling could re-shape a stack mid-operation in V2).

**Test verification:** TC-A-04 expands a Chapter with a Series template (six layers); verifies the children are inserted with `node_type='scene'`.

**SU candidate (none).** Phase 4's layer-stack semantics handle this naturally; the resolution surfaces in the Accept code path.

### G-5 — Comment threading depth-1 enforced at API, not DB

**Gap:** Migration 005's `parent_comment_id` admits arbitrary depth at the schema level. V1 wants depth-1 (a top-level comment may have replies; replies cannot have replies). Where is the enforcement?

**Resolution for Phase 5:** API-layer enforcement in POST `/api/nodes/[id]/comments` (§3.10 step 9). The schema is forward-compatible with deeper threading (V2 may lift the V1 cap if user research suggests deeper threads are useful), but the V1 API rejects with `400 comment_thread_too_deep`. Per H-12's architectural-vs-operational distinction, this is architectural (not admin-tunable), so an API enum-like check is correct; no `platform_config` key.

**SU candidate (none).** This matches the Phase 4 G-1 / G-4 pattern (API enforces architectural rules without a DB CHECK).

### G-6 — Streaming for `synthesise` deferred to Phase 5c

**Gap:** TA §7.1 defines `provider.stream()`. Synthesise produces prose (often >1000 tokens) and is the obvious streaming candidate. Should Phase 5 ship streaming?

**Resolution for Phase 5:** **No.** Phase 5 ships `synthesise` as a non-streaming completion. The AgentTab's progress bar shows token-count progression via Supabase real-time updates on `agent_jobs.tokens_output` (the Edge Function writes a periodic update mid-LLM-call — once per N tokens). The full prose result is written to `result_prose` in one DB write at job completion. Streaming as a wire-format concern — Server-Sent Events from the API route to the client, partial Tiptap rendering, mid-stream cancellation, and reconnect semantics — is **deferred to Phase 5c**.

**Rationale:** Phase 5 is already 15 endpoints with a substantial security pipeline. SSE streaming compounds the complexity (different cancel semantics, partial Tiptap rendering, client buffering, reconnect-with-resume) without enabling a new V1 user journey — J4 (writing prose at a leaf) works equivalently well with a final-write-only model and a 5-30s wait, since prose is a one-shot generation. Streaming is a UX optimisation appropriate for a focused phase.

**SU candidate (Phase 5 → TA v1.9 / Product Spec v1.5 close-out):** SU-23 (Phase 5b/5c slotting) carries this. TA v1.9's §11 amendment introduces Phase 5c as a dedicated streaming phase between Phase 5b (Director) and Phase 6 (Locking + Restore).

### G-7 — Migration 026 `result_summary` field name collision with Phase 1's existing column

**Gap:** Migration 006 already has a `result_summary TEXT` column intended for document-operations' human-readable report summary. Phase 5's Migration 026 wants to add `result_summary` for the agent's proposed summary content. Same field name; different semantic.

**Resolution for Phase 5:** Migration 026 renames the existing `agent_jobs.result_summary` to `agent_jobs.result_summary_text`. The renamed field is used only by document operations (post-V1-launch); no production code path in V1 reads or writes it. Migration 026 then adds the new `agent_jobs.result_summary` for the single-node agent's proposed content. Type regeneration runs after Migration 026; downstream code that referenced the Phase 1 `result_summary` (none in V1) is updated in the same commit as Migration 026.

**Test verification:** TC-D-09 verifies that no code path in `lib/` or `app/api/` references the renamed column without the rename (a grep test).

**SU candidate (Phase 5 → TA v1.9 / Component Spec close-out):** TA v1.8 §3.6 Migration 006's column documentation needs to track the rename; this lands in TA v1.9's Migration 026 block.

### G-8 — `cannot_delete_with_back_links` on context nodes when agent jobs reference them

**Gap:** Phase 4's DELETE `/api/nodes/[id]` (context node) returns `409 cannot_delete_with_back_links` if `node_context_links` rows reference the context node, with `?force=true` to cascade. Phase 5 adds `agent_jobs` rows that may reference context nodes via `context_snapshot.dynamic.contextNodes` (the assembled prompt's record of which context nodes were assembled). Should DELETE on a context node be guarded by agent_jobs references too?

**Resolution for Phase 5:** **No.** `agent_jobs.context_snapshot` is an audit record — a snapshot of the prompt at a moment in time. Deleting the source context node doesn't invalidate the snapshot (the snapshot is text content, not a live FK). The Phase 4 `cannot_delete_with_back_links` guard is about *active* references (links surfacing the context node into the structural tree); historical records (agent_jobs that have already run) are not active references. The DELETE proceeds; agent_jobs.context_snapshot retains the historical content reference by ID for audit but the live reference is gone — exactly the desired behaviour.

**SU candidate (none).** Documented for completeness; no behaviour change.

### G-9 — Plain-text-to-Tiptap conversion path on Accept

**Gap (raised in v1.1):** Migration 026 stores `result_summary`, `result_prose`, and `result_notes` as plain text (TEXT). The SummaryEditor, ProseEditor, and NotesEditor (Phase 3) all read `nodes.summary` / `nodes.prose` / `nodes.notes` as Tiptap document JSON. The agent profile prompts (`stelavox_agent_profile_library_v1_0.md` §2.5, §2.6, §2.7, §2.8, §2.9, §2.10, §2.11, §2.18) instruct the model to emit plain text without Markdown. Where does the plain-text-to-Tiptap conversion happen?

**Resolution for Phase 5:** **At the Accept route, via a pure converter in `lib/agent/prose-to-tiptap.ts`.** The function takes a plain-text string and returns a Tiptap document JSON object:

```typescript
// lib/agent/prose-to-tiptap.ts
export function plainTextToTiptap(plainText: string): TiptapDocument {
  if (!plainText || !plainText.trim()) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }
  const paragraphs = plainText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  return {
    type: 'doc',
    content: paragraphs.map(text => ({
      type: 'paragraph',
      content: [{ type: 'text', text }]
    }))
  }
}
```

The Accept route (§3.7) calls `plainTextToTiptap()` before writing to `nodes.summary` / `nodes.prose` / `nodes.notes`. For `expand`, the same converter runs on each `result_child_nodes[i].summary` value before INSERTing the child node's `summary` column.

**Why Accept-route conversion (not Edge Function or editor-side):**
- **Audit trail clarity.** `result_*` columns hold what the model actually returned (character-for-character plain text). Converting at the Accept boundary keeps the database audit-faithful — `agent_jobs.result_prose` is exactly what came back from the LLM.
- **Edge Function simplicity.** Edge Functions are constrained execution environments; importing a Tiptap-shape converter there couples the Edge Function to the editor's document schema.
- **Decoupling.** If the ProseEditor's Tiptap extension set changes (Phase 6+ adds a footnote extension, say), only this single converter file changes.
- **Unit-testable.** The converter is pure: `string → object`. No dependencies, no side effects.

**Markdown handling:** The agent profiles in §2 explicitly instruct the model "no Markdown" — paragraphs separated by blank lines only. The converter therefore does NOT parse Markdown (`**bold**`, `*italic*`, `# headers`). If a model violation produces Markdown anyway, those characters end up as literal text in the Tiptap document. The author can edit/clean post-Accept; this is acceptable for V1 and avoids a Markdown-parser dependency.

**Test verification:** TC-A-22 verifies `synthesise_beat` Accept produces well-formed Tiptap JSON in `nodes.prose` from a plain-text result. TC-D-15 verifies the converter handles edge cases (empty string, single paragraph, multiple blank lines, leading/trailing whitespace).

**SU candidate (none).** This is a Phase 5 implementation detail; no upstream-spec change.

### G-10 — V1 metadata schemas pinned in Phase 5

**Gap (raised in v1.1):** Phase 4 G-2 deferred server-side metadata-schema validation to V2 with the rationale that client-side schemas in `lib/context/metadata-schemas.ts` are sufficient for V1 UX. But Phase 4 did not pin the *content* of those V1 schemas. Phase 5's `generate_context_*` profiles (library doc §2.12–§2.17) emit metadata with specific field shapes — the MetadataForm must render the same shapes for the Accept-applied result to be visible in the form.

**Resolution for Phase 5:** The Phase 5 Build Checklist includes a deliverable to pin the V1 metadata schemas in `lib/context/metadata-schemas.ts` to match what the V1 `generate_context` profiles emit. The library doc §2.12–§2.17 is the source of truth for each schema:

| Context type | Metadata fields (V1 schema) |
|---|---|
| `character` | `full_name`, `age`, `role`, `wound`, `lie`, `want`, `need`, `ghost`, `arc_type`, `voice_notes`, `physical_description`, `key_relationships[]` |
| `location` | `location_type`, `physical_description`, `atmosphere`, `sensory_notes`, `historical_significance`, `thematic_resonance`, `character_relationships[]`, `time_of_day_variations` |
| `organisation` | `organisation_type`, `founded`, `stated_purpose`, `actual_function`, `internal_culture`, `power_structure`, `internal_conflicts`, `external_relationships`, `key_members[]`, `thematic_function` |
| `world` | `physical_reality`, `political_reality`, `social_cultural_reality`, `economic_reality`, `historical_weight`, `thematic_resonance`, `internal_conflicts`, `tone_and_register` |
| `theme` | `theme_statement`, `false_version`, `central_question`, `character_vehicles[]`, `plot_vehicles[]`, `imagery_and_motif`, `resolution` |
| `plot_thread` | `thread_name`, `thread_type` (enum), `dramatic_question`, `opening_condition`, `key_escalation_points[]`, `intersection_points[]`, `resolution`, `thematic_function`, `characters_involved[]` |

`arc_type` (character) and `thread_type` (plot_thread) are enum-like in the agent prompt but stored as free-form strings in V1 (server-side enforcement is V2). The MetadataForm renders them as `<select>` controls with the documented values; user-typed values still round-trip.

**Per Phase 4 G-2:** Server-side validation remains V2. The API accepts any JSON object that fits Phase 2's metadata size limits. Unknown keys round-trip through `metadata` but are not displayed by the form. This forward-compatibility allows V2 enrichment (research-derived metadata, sub-type-specific fields) without breaking V1 rows.

**Test verification:** TC-A-23..TC-A-28 verify the Accept of each `generate_context_<type>` profile populates `nodes.metadata` with the documented field set. TC-U-25 verifies the MetadataForm renders the documented fields for each context type.

**SU candidate (none beyond what Phase 4 G-2 already deferred to V2).** The V1 schema pinning is an internal Phase 5 deliverable.

### G-11 — Migration 026 adds `result_notes TEXT`

**Gap (raised in v1.1):** Phase 5 v1.0's API Contract §2.5 admits `target_field='notes'` for the refine route, but Migration 026's column list omitted `result_notes`. The Edge Function would have nowhere to write a notes-refinement result. Real spec gap.

**Resolution for Phase 5:** Migration 026 adds `result_notes TEXT` alongside the other `result_*` columns. The refine route's `target_field='notes'` validates fully and the Edge Function writes `result_notes`. The Accept route applies `plainTextToTiptap()` to `result_notes` before writing `nodes.notes` (the Notes editor reads Tiptap JSON, same as Summary and Prose).

**Schema delta from v1.0:** `agent_jobs.result_notes TEXT` (nullable, defaults to NULL). Type regeneration after Migration 026 picks up the new column.

**Test verification:** TC-A-29 verifies refine with `target_field='notes'` populates `result_notes` and Accept commits to `nodes.notes`. TC-D-12 verifies `result_notes` is NULL outside `completed`/`accepted`/`dismissed` statuses.

**SU candidate (none).** This is a v1.1 self-correction; the v1.0 contract was internally inconsistent. Documented in §1.4 and the v1.1 changelog.

### G-12 — Phase 5 agent-profile coverage is Novel-only

**Gap (raised in v1.1):** The seed file `supabase/seed.sql` defines three V1 system templates (Novel, Short Story, Series). Phase 5's library doc (`stelavox_agent_profile_library_v1_0.md` §2) seeds 18 system profiles, all of which target Novel-template node types (`book / act / chapter / scene / beat`). Short Story (`story / scene / beat`) and Series (`series / book / ...`) have no top-layer expand or refine profiles — `expand_story_into_scenes`, `refine_story_summary`, `expand_series_into_books`, `refine_series_summary` do not exist.

**Resolution for Phase 5:** **Phase 5 ships agent-profile coverage for the V1 Novel template only.** Short Story and Series documents remain creatable, editable, and renderable; their leaf-level `synthesise_beat` operates correctly because beats are universal across the three templates. Upper-layer agent operations on `story` or `series` node types return `400 invalid_operation_for_node_type` because the profile-resolution step (§3.1 step 10) finds no matching `agent_profiles` row.

**What still works for Short Story and Series in Phase 5:**
- All Phase 1–4 endpoints (CRUD, tree, content editing, context).
- `synthesise_beat` on any leaf beat (works via the universal beat profile, library doc §2.5).
- `generate_context_*` for the six core context types (works for all three document types — context nodes are scope-shared across the project).
- Manual node creation via the Phase 2 POST endpoint (the author can build the structural tree by hand).
- `refine_default` (library doc §2.18) **does not** apply for `story` or `series` node types — those are document-type-distinguishing types, not generic structural types. The `refine_default` fallback selects only when the operation is admitted by the document-type's layer stack and no specific profile matches; Phase 5's profile-resolution rule treats unmapped top-layer node types as not admitted.

**What does not work for Short Story and Series in Phase 5:**
- `expand` against `story` or `series` (no scene-expansion or book-expansion profile).
- `refine` against `story.summary` or `series.summary` (no refine profile for those node types).

**Resolution path:**
- **V1.x or Phase 5b/c absorption:** the four missing profiles (`expand_story_into_scenes`, `refine_story_summary`, `expand_series_into_books`, `refine_series_summary`) are Tier-B authoring deliverables for a focused expansion phase. They are mechanical adaptations of `expand_chapter_into_scenes` (§2.3) and `refine_book_synopsis` (§2.6) but each requires craft-faithful rewriting (a story is not a chapter; a series is not a book).
- **Until then:** the AgentTab's profile picker shows no profiles for `story`/`series` top-layer nodes; the operation buttons render disabled with a tooltip ("No agent profile for this node type — manual editing only").

**Test verification:** TC-A-30 verifies expand on a `story` node returns `400 invalid_operation_for_node_type`. TC-A-31 verifies the same for `series`. TC-U-26 verifies the AgentTab disabled-state rendering for unmapped node types.

**SU candidate (Phase 5 → close-out absorption as part of SU-23 / Phase 5b-or-V1.x scope notes):** The "agent profile coverage" subsection of TA v1.9's Phase 5 row should explicitly note the Novel-only V1 launch shape, with Short Story and Series profiles flagged for V1.x.

### G-13 — Cost as a first-class metric

**Gap (raised in v1.2):** Cost transparency is a business-case requirement, not just a technical one. The build agent needs cost-per-test-phase telemetry; the operator needs the per-operation cost trail to inform pricing decisions; the Phase 5 Test Report needs a Cost Analysis section that quantifies Phase 5's run cost and projects production economics. None of this was captured in v1.0/v1.1 — token counts existed in `agent_jobs.tokens_*` but the USD-cost computation, the price configuration, and the reporting plumbing did not.

**Resolution for Phase 5 (v1.2):** Add Migration 028 with three artefacts:

1. **`agent_jobs.cost_usd DECIMAL(10,6)`** — internal-only column populated by the Edge Function at job completion. Frozen at that point so historical rows show the cost as it was on the day the operation ran. Computed from the row's `tokens_*` and `model_id` against the `platform_config` price keys at completion time.

2. **Six `platform_config` price keys** (per H-12 — admin-tunable when Anthropic adjusts pricing):
   ```
   price.anthropic.claude-haiku-4-5-20251001.input_per_mtok    (default 1.00 USD)
   price.anthropic.claude-haiku-4-5-20251001.output_per_mtok   (default 5.00)
   price.anthropic.claude-sonnet-4-6.input_per_mtok            (default 3.00)
   price.anthropic.claude-sonnet-4-6.output_per_mtok           (default 15.00)
   price.anthropic.claude-opus-4-6.input_per_mtok              (default 15.00)
   price.anthropic.claude-opus-4-6.output_per_mtok             (default 75.00)
   ```
   Cache-token pricing is derived in code as multipliers of input price (cache_write = 1.25×, cache_read = 0.10×) per Anthropic's published rates. These multipliers are constants in `lib/llm/cost.ts`, not config — they're Anthropic platform behaviour, not Stelavox tunables.

3. **`lib/llm/cost.ts` cost-computation module** — pure function `computeCostUsd(tokenUsage, modelId): Promise<number>` reading the price keys via `getConfig()`. Called by every Edge Function operation module immediately after the LLM response, before writing `result_*` and setting `status='completed'`.

**UI implications — none.** The AgentTab's existing Component Spec §5.9 display (allocation percentage for platform-paid users; raw token usage for BYOK users) is unchanged. `cost_usd` is internal-only. This matches Product Spec §3.2 (in-app token usage feedback is %, not $) and the BYOK behaviour where authors see their own provider's usage.

**Reporting tool:** `scripts/cost-report.ts` queries `agent_jobs` for a date range or test-run window, aggregates by operation type and model, computes totals/averages/cache-hit rates, and emits Markdown. Used after each test chunk in T-16.1 and after the Phase B cloud smoke. Output files land in `test-reports/cost/<phase>-<timestamp>.md` and feed into the Test Report's §10 Cost Analysis section.

**Efficiency metrics tracked:**
- Token efficiency (output / input ratio) — lower is more compressed prompting
- Cache hit rate (`cache_read / (cache_read + cache_write)`) — higher means more reuse
- Cost per operation type — running average over the test phase
- Cost ratio Haiku vs Sonnet vs Opus — the multiplier when moving from build-test models to production-default models (informs the business-case projection)
- Latency (`completed_at − started_at`) — already in the schema

**Test verification:** TC-D-17 (every completed `agent_jobs` row has non-null `cost_usd`). TC-D-18 (cost computation matches expected formula given fixed token counts and known prices). The Phase 5 Test Plan v1.1 §10 documents the per-test-phase cost expectations.

**SU candidate (Phase 5 → TA v1.9 close-out):** Add a §3.7.4-cross-reference in TA v1.9 to document the price keys alongside the existing `model.<operation>` keys; document the H-12-architectural distinction (model IDs and prices are operationally tunable; cache multipliers are platform constants). No new hazard.

---

## 6. Approval

This API Contract is approved before any Phase 5 implementation begins. Changes after approval are version-bumped on this document. The Build Checklist treats this contract as the source of truth for endpoint shape, validation order, error codes, the agent-job lifecycle, the security pipeline, and the comment-system contract.

The architectural decisions that shaped Phase 5 (and therefore this contract) are recorded here for sign-off:

| # | Decision | Choice |
|---|---|---|
| Q1 | One endpoint per operation, or one shared `POST /api/agent`? | **One per operation** — `/api/agent/expand`, `/api/agent/synthesise`, `/api/agent/refine`, `/api/agent/generate-context`. Each Zod schema is crisp; per-operation profile resolution and validation are clean. |
| Q2 | One Edge Function or one per operation? | **One shared Edge Function `agent-runner`** that branches on `operation_type` from the job record. ~80% of code path is shared. Internal-only decision; doesn't affect public API. |
| Q3 | Streaming for `synthesise` in V1? | **Deferred to Phase 5c.** Phase 5 ships non-streaming; progress feedback comes from real-time updates on `agent_jobs.tokens_output`. (G-6.) |
| Q4 | `agent_profiles` access pattern? | **Migration 025 RLS policy.** SELECT for system profiles (organisation_id IS NULL) + own-org. INSERT/UPDATE/DELETE remain admin-only. AgentTab profile picker reads via user-session client. |
| Q5 | Accept/Dismiss workflow specifics? | **Extend Migration 006 enum + result_* columns.** New status values: `accepted`, `dismissed`, `cancelled`. New columns: `result_summary`, `result_prose`, `result_metadata`, `result_child_nodes`, `target_node_version_at_capture`. Rename Phase 1's `result_summary` to `result_summary_text` (G-7). |
| Q6 | Concurrency: one running job per node at a time? | **Yes.** POST returns `409 agent_job_in_progress` if a `pending` or `running` job exists for the target node. Director (Phase 5b) lifts this for workflow steps. |
| Q7 | Cancellation semantics? | Cancel sets `status='cancelled'`. Edge Function checks status before write and aborts cleanly. **Tokens consumed by the LLM call are still billed** (model already produced output). If Edge Function has completed before cancel arrives → `409 agent_job_not_in_progress`. |
| Q8 | Comment threading depth? | **Depth-1.** A top-level comment may have replies; replies cannot have replies. API-enforced (G-5). Schema admits arbitrary depth for V2 forward-compat. |
| Q9 | Migrations introduced in Phase 5? | **025 (agent_profiles RLS), 026 (agent_jobs status enum + result_summary/prose/notes/metadata/child_nodes columns + target_node_version_at_capture + result_summary rename + node_comments parent_comment_id ON DELETE CASCADE), 027 (agent_profiles seed for V1 Novel-only).** Three migrations; migration count moves from 23 to 26. v1.1 amendment: Migration 026 also adds `result_notes TEXT` (G-11). |
| Q10 | Plain-text-to-Tiptap conversion path on Accept? | **Accept-route conversion via `lib/agent/prose-to-tiptap.ts`.** Pure converter; preserves `result_*` audit-faithfulness; decouples editor schema changes from Edge Function. (G-9, v1.1.) |
| Q11 | V1 metadata schema pinning? | **Library doc §2.12–§2.17 is the source of truth; Phase 5 Build Checklist pins `lib/context/metadata-schemas.ts` to match.** Server-side validation remains V2 per Phase 4 G-2. (G-10, v1.1.) |
| Q12 | Phase 5 document-type coverage? | **Novel only.** Short Story and Series documents are creatable and editable; leaf-level synthesise works; upper-layer expand/refine on `story`/`series` returns 400 until V1.x adds the missing profiles. (G-12, v1.1.) |
| Q13 | Cost-as-first-class metric? | **Yes — internal capture, no UI surfacing.** Migration 028 adds `agent_jobs.cost_usd` (frozen at completion) + six `platform_config` price keys for Haiku/Sonnet/Opus input+output. `lib/llm/cost.ts` computes cost; Edge Function writes it. UI behaviour unchanged from Component Spec §5.9 (allocation % for platform users, raw tokens for BYOK). Reporting via `scripts/cost-report.ts` and Test Report §10. (G-13, v1.2.) |

Plus four implementation calls confirmed during contract drafting:

| # | Call | Choice |
|---|---|---|
| 1 | System prompt storage location | `agent_profiles.system_prompt` rows; not `platform_config` (G-1). |
| 2 | Concurrent author edit during running job | Allowed; Accept gates on `target_node_version_at_capture` and returns `409 target_version_mismatch` on stale (G-3). |
| 3 | Tokens billed on cancellation | Yes — tokens already consumed by the LLM call up to the cancellation point are recorded (Q7 / §2.11 invariant 15). |
| 4 | DELETE context node when agent_jobs reference it via `context_snapshot` | DELETE proceeds; `context_snapshot` is an audit record, not an active reference (G-8). |

---

## 7. Changelog

**v1.2 — 2026-05-05** Cost-as-first-class amendment. Migration 028 added: `agent_jobs.cost_usd DECIMAL(10,6)` column populated by the Edge Function at completion (frozen-at-completion semantics for audit and business-case stability against future Anthropic pricing changes), plus six `platform_config` price keys (`price.anthropic.<model>.input_per_mtok` and `output_per_mtok` for Haiku/Sonnet/Opus). `lib/llm/cost.ts` does the pure-function cost computation; cache-token pricing derived as Anthropic-published multipliers (1.25× input for cache_write, 0.10× input for cache_read) — multipliers are code constants, base prices are config. Migration count moves from 26 to 27. UI behaviour unchanged: per Product Spec §3.2 and Component Spec §5.9, platform-paid users see allocation percentage, BYOK users see raw token usage, no dollar amounts in any V1 user-facing surface. Cost surfaces only in the `scripts/cost-report.ts` operator tool and the Phase 5 Test Report's §10 Cost Analysis section. New §6 Approval row Q13 captures the decision; new §5 G-13 documents the design and the test-verification path (TC-D-17, TC-D-18 in Test Plan v1.1). Build Checklist v1.1 adds task cards T-1.6 (Migration 028), T-2.6 (cost.ts), T-7.4 (Edge Function cost write), T-16.1.5 (post-chunk cost reports), T-16.2.5 (post-cloud-smoke cost report), T-16.6 (Test Report cost analysis hand-off). Test Plan v1.1 adds §1.8 cost-capture tooling, §10 cost-analysis verdict requirement, and TC-D-17 / TC-D-18.

**v1.1 — 2026-05-05** Four amendments raised during agent profile library v1.0 authoring. (a) **G-9** — plain-text-to-Tiptap conversion at Accept-route via `lib/agent/prose-to-tiptap.ts`; agent profiles emit plain text; Accept route converts to Tiptap JSON before writing to `nodes.summary` / `prose` / `notes` and to expand-result child-node summaries. §2.11 invariant 14 amended; §3.7 Accept flow detailed. (b) **G-10** — V1 metadata schemas pinned in `lib/context/metadata-schemas.ts` to match the agent profile library §2.12–§2.17 emitted shapes for the six V1 context types; client-side schema enforcement only (server-side remains V2 per Phase 4 G-2). §3.4 generate-context route references G-10. (c) **G-11** — Migration 026 adds `result_notes TEXT` column. v1.0's API admitted `target_field='notes'` for refine but had no column to store the result; v1.1 closes the gap. §1.4 and §3.3 updated. (d) **G-12** — Phase 5's agent-profile coverage is **Novel only**. Short Story (`story` node type) and Series (`series` node type) documents have no upper-layer expand/refine profiles in V1 launch; the missing four profiles (`expand_story_into_scenes`, `refine_story_summary`, `expand_series_into_books`, `refine_series_summary`) are V1.x scope. Leaf-level synthesise still works for all three document types because beats are universal. §3.3 refine route notes the document-type coverage caveat; AgentTab disables operation buttons for unmapped node types. The §6 Approval table gains rows Q10–Q12 capturing these decisions for sign-off. No new routes; no v1.0 routes removed; migration count unchanged at 3 (025 / 026 / 027).

**v1.0 — 2026-05-04** Initial Phase 5 API Contract. Frozen for Phase 5 build. Phase 5 scope: agent system substrate (single-node operations, context assembler via Edge Function, LLM abstraction, agent-job lifecycle, editorial comments, agent-profile read-side). Director (Phase 5b) and streaming (Phase 5c) are explicitly out of scope. 15 routes added; 3 migrations (025 RLS, 026 schema extensions, 027 seed); ~150 test cases planned. Specification gaps G-1..G-8 raised for resolution at close-out (mostly absorbed in V1.0 — only G-2 system-prompt-content authoring and G-7 column-rename verification remain as build-time concerns).
