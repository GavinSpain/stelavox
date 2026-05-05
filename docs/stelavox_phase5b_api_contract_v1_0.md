# Stelavox — Phase 5b API Contract
## Version 1.1

> **Tier-B per-phase document.** Frozen for Phase 5b build. Defines every API route added or modified in Phase 5b (Director: conversational interface + tool-using agentic loop + plan approval + workflow execution). Companion to `stelavox_phase5b_test_plan_v1_0.md` and `stelavox_phase5b_build_checklist_v1_0.md`. Source of truth for endpoint shape, the Director streaming wire format, the agentic-loop boundaries, the tool registry, the plan approval contract, the workflow execution semantics, and the security pipeline (Defence 4 — `validateToolCall`). Cross-cutting rules unchanged since Phase 1 / 2 / 3 / 4 / 5 are inherited from the earlier phases' API contracts; only the additions are spelled out here.

**Phase:** 5b — Director: conversation thread per document, multi-step planning, tool-using agentic loop, plan-approval gate (PlanCard), workflow execution (calls Phase 5 single-node operations under-the-hood with `triggered_by='workflow_step'`), conversation summarisation, locked-node respect, downstream impact assessment.

**Phase 5b checkpoint criteria** (derived from TA v1.9 §11 Phase 5b row): *"Author can converse with the Director, plan multi-step revisions, approve, and watch execution land cleanly across nodes."* Concretely: (a) the author can open Director Mode for any document, type a goal in natural language, and watch the Director's response stream into the conversation thread; (b) the Director can read the document state via 7 read tools without producing any agent jobs; (c) when the Director proposes changes, a `WorkflowStepProposal` set is rendered as a PlanCard inside the conversation; (d) the author can deselect or remove individual steps before approving; (e) on Approve, the workflow transitions `draft → approved → running`, each step dispatches a Phase 5 agent job with `triggered_by='workflow_step'`, the tree updates live, and the Director posts a final summary message; (f) locked nodes are protected at planning AND execution time; (g) every tool call passes `validateToolCall()`; (h) conversation context is correctly summarised when it exceeds the 60k-token threshold (TA §8.5); (i) cross-organisation and cross-document tool calls are blocked with high-severity audit entries.

**What Phase 5b does NOT ship** (deferred):
- **Research tools** (`web_search`, `web_fetch`, `synthesise_research`) and the Research Intermediary (TA §4.6) — V2. The tool registry leaves room for them but they are not registered in V1 Director.
- **Document operations as Director-callable tools** (`create_document_operation_step`) — Phase 5b registers the tool but `executeStep` for `document_operation` returns a "not implemented" workflow_step error; document operations themselves are post-V1-launch (Phase 3a in the Product Roadmap, not the Build Plan).
- **Workflow scheduling** (running a Director workflow at a future time) — Phase 1's `scheduled_jobs` schema supports `job_type='director_workflow'` but the scheduler-side dispatch for that type is post-V1-launch.
- **Director config V2 lifecycle** (`draft → beta → production → deprecated`, per-org beta opt-in, shadow mode) — V2 per TA §8.6. V1 ships one production config.
- **Multi-conversation per document** — V1 enforces `UNIQUE(document_id)` on `conversations` (Phase 1 Migration 005). One conversation per document, persistent.

**Companion documents:** `stelavox_phase5b_test_plan_v1_0.md`, `stelavox_phase5b_build_checklist_v1_0.md`. Cross-cutting rules unchanged since Phase 5 are inherited from earlier phases' API contracts; only the additions are spelled out here.

---

## 1. Phase Scope

### 1.1 Routes added in Phase 5b

**Conversation (5):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/director/message` | Stream a Director response (SSE) for a user message; create the conversation if absent |
| POST | `/api/director/conversation/[conversationId]/resume` | Resume an interrupted turn (SSE; v1.1 SU-41) |
| GET | `/api/director/conversation/[conversationId]` | Fetch a conversation row + paginated messages |
| GET | `/api/documents/[documentId]/conversation` | Resolve the (single) conversation for a document, creating an empty row if absent |
| POST | `/api/director/conversation/[conversationId]/messages` | Non-streaming message append (admin tooling / replay; not used by the UI) |

**Cron / system (1):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/cron/director-recovery` | Vercel Cron — recovery sweep for orphaned agent_jobs / stalled workflows (v1.1 SU-40) |

**Workflow (8):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/director/workflows/[workflowId]` | Fetch a workflow + its ordered steps |
| POST | `/api/director/workflows/[workflowId]/approve` | Approve a draft workflow (with optional per-step deselection); kicks off execution |
| POST | `/api/director/workflows/[workflowId]/cancel` | Cancel a `draft` or `approved` workflow before execution begins |
| POST | `/api/director/workflows/[workflowId]/pause` | Pause a `running` workflow (any in-flight step finishes; subsequent steps wait) |
| POST | `/api/director/workflows/[workflowId]/resume` | Resume a `paused` workflow |
| POST | `/api/director/workflows/[workflowId]/stop` | Stop a `running` or `paused` workflow; subsequent steps marked `skipped` |
| PATCH | `/api/director/workflows/[workflowId]/steps/[stepOrder]` | Update a single step in a `draft` workflow (deselect via `status='removed'` or edit `parameters`) |
| GET | `/api/documents/[documentId]/workflows` | Paginated workflow history for a document |

**Total: 14 routes added in Phase 5b** (v1.1 — was 12; +1 resume per SU-41, +1 cron-recovery per SU-40).

### 1.2 Routes modified in Phase 5b

None. The Phase 1–5 endpoints carry forward unchanged. Notably:

- The Phase 5 `POST /api/agent/expand` (and the other three single-node routes) are **not** modified to accept a `triggered_by='workflow_step'` parameter — instead, the Phase 5b workflow executor uses an internal helper `dispatchAgentJobForStep()` in `lib/director/workflow-executor.ts` that bypasses the Next.js HTTP boundary and writes directly through the same shared library code (`lib/agents/dispatch.ts`, lifted out in Build Checklist T-3.7) that the Phase 5 user-triggered routes use. This avoids a second auth round-trip and keeps the agentic loop responsive. The resulting `agent_jobs` row carries `triggered_by='workflow_step:<workflow_step_id>'`.
- The Phase 5 `POST /api/agent-jobs/[id]/accept` is **not** called by the workflow executor. Workflow steps run in *auto-accept* mode — the Director has produced the plan, the author has approved the plan, so each step's result is committed automatically when the underlying agent job reaches `completed`. This is implemented via an internal helper `acceptAgentJobForStep()` that reuses Migration 029's `accept_agent_job` RPC. See G-3.

### 1.3 Routes removed in Phase 5b

None.

### 1.4 Database changes

**One migration (031).** Migration count moves from 30 (Phase 5 close-out) to 31. Migration 031 covers eight concerns in a single atomic file (v1.1 expanded — see SU-40 / SU-41 in §5): (1) Director v1.0 system prompt + tool_suite finalisation (G-1), (2) `conversation_messages.author_user_id` column (G-2), (3) `conversation_messages` cost-tracking columns (G-11), (4) `supabase_realtime` publication ADD for `workflows` / `workflow_steps` (G-6), (5) seed of three Phase 5b operational-limit keys into `platform_config` per §2.7, (6) `agent_jobs.last_heartbeat_at` + `workflows.last_heartbeat_at` columns for the liveness signal (SU-40 / I-10), (7) `conversation_messages.turn_state` enum (`interim` | `final` | `interrupted`) for mid-turn persistence (SU-41 / I-12) plus a partial index on `WHERE turn_state='interim'` for cheap interim-turn lookup, (8) seed of four heartbeat / recovery-sweep config keys into `platform_config`. All schema additions are non-breaking (default values supplied).

- **Migration 031 — Director v1.0 production system prompt + tool_suite finalisation.** Phase 1 Migration 013 seeded a placeholder `director_configs` row (`'-- loaded from supabase/seed/director-v1.0.txt --'`). Phase 5b's migration replaces this with the real production prompt loaded from `supabase/seed/director-v1.0.txt` (a new file authored in Build Checklist T-3.3). The `tool_suite` JSONB array is also re-asserted to the canonical Phase 5b list (13 entries — 7 read + 6 write; `create_document_operation_step` is **not** in the Phase 5b tool_suite, see §1 carve-outs). `create_node_reorder_step` IS included to satisfy J5's narrative requirement (chapter scene reorder); not in TA §8.3 enumeration → flagged as SU-37 for absorption at close-out. `model_id` is **not** changed by this migration — it stays at `claude-opus-4-6` per TA §6.3. The migration is idempotent: `UPDATE director_configs SET system_prompt = $1, tool_suite = $2 WHERE version_number = '1.0'` against the unique `('1.0', 'production')` row.

No schema-level table additions. Phase 1 Migration 005 already created `conversations`, `conversation_messages`, `workflows`, `workflow_steps` with the correct shape. Phase 5b consumes them as-is. Tool-call audit and rate-limiting reuse `conversation_messages.tool_calls JSONB` (Migration 005) — no separate `director_tool_calls` table is required. See G-7.

Type regeneration (`supabase gen types typescript --linked > lib/types/database.ts`) is required after Migration 031 because Migration 031's prompt body contains tokens consumed by the runtime executor; types do not actually change for this migration but the regenerate step is in the standard procedure (H-10) and is run regardless.

### 1.5 Runtime architecture (corrects v1.0 — SU-39)

The v1.0 contract used "Edge Function" language (`director-runner`, `workflow-executor`) borrowed from TA §8.2 / §8.4. Phase 5 SU-28 already established that Stelavox runs the agent runner as a Vercel Node.js function via `waitUntil()`, not a Supabase Edge Function. Phase 5b follows the same precedent. **No Supabase Edge Functions are introduced in Phase 5b.**

**The streaming Director path (`/api/director/message`):**
- Vercel Node.js API route with `export const maxDuration = 300` (5 minutes — Vercel Pro)
- Returns `Response` with a `ReadableStream` body for SSE
- Agentic loop runs **inline** in the request handler — no separate runtime
- Canary scan, tool validation, workflow proposal parsing all happen in-process
- The author's browser holds the SSE connection for the duration of the turn

**The workflow execution path (after `/approve`):**
- The `/approve` route validates, writes initial state (`workflow.status='approved'`, deselected steps marked `'removed'`), dispatches the first batch of agent jobs via the Phase 5 dispatch path, and returns 202
- Each agent job runs via Phase 5's existing `waitUntil()` pattern (Vercel Node.js function backgrounded by `@vercel/functions`)
- On terminal status (`completed` or `failed`), the agent runner calls `advanceWorkflow(workflow_id)` from inside its own `waitUntil()` window — **continuation-passing style**:
  - `advanceWorkflow()` reads the workflow + steps, finds the next dispatchable batch (steps whose `depends_on_step_orders` are satisfied), dispatches them via the same Phase 5 dispatch path
  - On `failed` step: workflow → `paused` with `error_message` set; chain stops
  - On no remaining `pending` steps: workflow → `completed`
- No process needs to live for the workflow's full duration. Each "tick" lives within an agent job's `waitUntil()` window. Browser closing has no effect on workflow execution — the chain runs server-side regardless.

**The recovery sweep:**
- A Vercel Cron Job (configured in `vercel.json`) hits `POST /api/cron/director-recovery` every 60 seconds
- Authenticated via `CRON_SECRET` header (Vercel Cron sets this automatically)
- The route runs two SQL UPDATEs:
  - `agent_jobs SET status='failed', error_message='heartbeat_timeout' WHERE status='running' AND last_heartbeat_at < now() - interval 'agent.heartbeat_timeout_ms ms'`
  - `workflows SET status='paused', error_message='heartbeat_timeout' WHERE status='running' AND last_heartbeat_at < now() - interval 'workflow.heartbeat_timeout_ms ms'`
- For each newly-failed agent_job that belongs to a workflow_step, the route calls `advanceWorkflow(workflow_id)` so the workflow transitions to `paused` cleanly
- See I-11 below

**Why not Supabase Edge Functions** (rationale, for the record): Same deployment surface as the Next.js app means single env-var store, single observability surface, no Deno↔Node compat work, no extra latency from Vercel→Supabase hop. Vercel Pro `maxDuration: 300` covers the streaming Director worst case; per-step `waitUntil()` ceilings cover individual agent jobs; the continuation chain handles total workflow duration without any single function spanning it. SU-28 has already validated this pattern works in Stelavox.

### 1.6 Auth surface

Unchanged from Phase 5. All Phase 5b routes require an authenticated session via the cookie-bound Supabase client. RLS enforcement:
- `conversations` (Migration 005) — already in place; org-scoped.
- `conversation_messages` (Migration 005) — already in place; org-scoped via conversation FK.
- `workflows` (Migration 005) — already in place; org-scoped.
- `workflow_steps` (Migration 005) — already in place; org-scoped via workflow FK.
- `director_configs` (Migration 013) — already in place; **service-role only** (no user-session policy). The Director-runner Edge Function uses the service-role client to load the production config; user-session API routes never read `director_configs`.

The `director-runner` and `workflow-executor` Edge Functions both use the service-role client to bypass RLS for cross-table reads inside the agentic loop and the executor. Each Edge Function explicitly re-asserts `organisation_id` and `document_id` against the caller's session at entry (the function receives `{ organisationId, userId, documentId, conversationId }` from the API route) — RLS is the trust boundary; the service-role client downstream of the trust boundary is intentional.

---

## 2. Cross-Cutting Rules

Unchanged from Phase 5 unless noted. The additions:

### 2.1 Authentication

Every route requires an authenticated cookie session. The auth check is the first action in every handler. 401 returned for missing/expired session, 403 for valid session but no membership in the target organisation.

### 2.2 Authorisation

RLS at the database is the trust boundary. API handlers never filter by `user_id` or `organisation_id` directly — they delegate to the database.

For workflow approval / cancel / pause / resume / stop endpoints, the additional check is **author-of-conversation**: only the user who originated the conversation (the user who first sent a message that resulted in the conversation row's creation) may approve or modify workflows arising from it. This is checked by joining `workflows.conversation_id → conversations` and asserting the calling `user_id` matches the conversation's first-message author. See G-2.

### 2.3 Error envelope

```json
{ "error": "kebab-case-error-code", "message": "Human-readable explanation." }
```

Phase 5b adds these error codes:

| Code | HTTP | Cause |
|---|---|---|
| `conversation_not_found` | 404 | `conversationId` does not exist or RLS-hidden |
| `workflow_not_found` | 404 | `workflowId` does not exist or RLS-hidden |
| `workflow_invalid_status` | 409 | Action invalid for current workflow status (e.g. approve a non-draft, cancel a completed) |
| `workflow_locked_nodes` | 423 | One or more locked nodes are required by the workflow and the author has not unlocked them; payload includes `locked_node_ids: string[]` |
| `workflow_step_not_found` | 404 | `stepOrder` does not exist within the workflow |
| `workflow_step_invalid_status` | 409 | Step PATCH attempted on a non-draft workflow |
| `director_token_budget_exceeded` | 402 | Director conversation pre-call estimation exceeded the org's remaining budget; no message row created |
| `director_streaming_aborted` | 200 | Streaming aborted mid-flight (canary leak, tool validation failure, server error); the SSE `error` event carries the cause; the HTTP status is 200 because the response started streaming |
| `director_canary_leak` | (SSE) | Canary token detected in model output mid-stream; loop aborted; no workflow saved |
| `tool_validation_failed` | (tool result) | Returned **as a tool result** to the model when `validateToolCall()` denies a call — the model sees `{ "error": "tool_validation_failed", "reason": "<reason>" }` and may decide to retry, give up, or explain to the user. Not an HTTP error code |
| `tool_rate_limit_exceeded` | (tool result) | Per-conversation tool-call rate exceeded (`§4.5` defence — max 30 calls per 60s); same return-as-tool-result pattern |
| `cross_org_tool_call` | (logged + tool result) | Tool targeted a node outside the caller's org; high-severity audit entry written; tool result returned with `{ "error": "cross_org_access_denied" }` |
| `cross_document_tool_call` | (logged + tool result) | Tool targeted a node outside the active document; high-severity audit entry written; tool result returned with `{ "error": "cross_document_access_denied" }` |

### 2.4 Status codes used in this phase

`200` (sync GET / sync POST), `202` (workflow execution accepted; runs async), `204` (no content, used by stop), `400` (validation), `401`, `402` (token budget), `403`, `404`, `409` (status conflict), `422` (semantic — injection in input), `423` (locked nodes), `429` (HTTP-level rate limit on the SSE endpoint specifically — see §2.7), `500`.

The SSE endpoint (`POST /api/director/message`) uses `200` for the initial response and reports all errors as SSE events (see §2.16).

### 2.5 Validation rules — common

- `Content-Type: application/json` required on all POST/PATCH except `POST /api/director/message` which accepts JSON and responds `text/event-stream`.
- `Accept: text/event-stream` required on `POST /api/director/message`.
- `conversationId`, `workflowId`, `documentId`, `nodeId`: UUID v4 format. `stepOrder`: positive integer, 1-indexed.
- User message content: 1..10_000 chars after trim. Empty messages rejected with 400 `empty_message`.
- `@`-mentions in user messages are rendered client-side from `parameters.mentioned_node_ids: string[]` — the server treats them as plain text, but the client UI substitutes node names. The Director's system prompt sees the raw text plus a `<mentioned_nodes>` block listing the mentioned nodes' names + IDs (see G-4).

### 2.6 Idempotency

Phase 5b endpoints follow the same idempotency rules as Phase 5:
- `POST /api/director/message`: not idempotent. Each call appends a new user-message row + starts a new agentic loop. Clients must guard against double-submit (the DirectorInput component disables itself between send and stream-start).
- `POST /api/director/workflows/[id]/approve`: idempotent on already-approved (returns the same approved workflow + 200, does not re-trigger execution). Returns 409 `workflow_invalid_status` if the workflow is `running`/`paused`/`completed`/`cancelled`.
- `POST /api/director/workflows/[id]/cancel`: idempotent on already-cancelled.
- `POST /api/director/workflows/[id]/pause` / `resume` / `stop`: status-conditional (see §3 for matrix); idempotent on the same terminal status.
- `PATCH /api/director/workflows/[id]/steps/[order]`: idempotent on the same body — the same patch applied twice produces the same row.

### 2.7 Rate limiting and operational limits

Phase 5b inherits Phase 5's rate limiting and adds the following limits. **All are stored in `platform_config` and read via `getConfig()` per H-12 (no hardcoded operational values in TypeScript).** TA §4.5's example code shows a literal `30` for the tool-call rate; that is example code only — the running implementation reads from `platform_config`.

| Config key | Default | Source | Used by |
|---|---|---|---|
| `agent.director_message_rate_limit_per_60s` | 6 | Migration 031 (new) | `/api/director/message` API route — per-user, per-document. Returned as HTTP 429 `director_message_rate_limit` with `retry_after_seconds: N` |
| `agent.director_tool_call_rate_limit_per_60s` | 30 | Migration 031 (new) | `validateToolCall()` per-conversation gate (TA §4.5 Defence 4). Exceeded calls return as a tool result `{ "error": "tool_rate_limit_exceeded" }`; audit log entry written |
| `agent.director_max_tool_iterations` | 20 | TA §3.7 / Migration 014 (existing) | Agentic loop's hard cap (TA §8.2). Exceeding terminates the turn with an `error` SSE event `director_loop_iteration_cap` and a partial assistant message persisted with the accumulated tool-call log |
| `agent.director_session_max_tokens` | 60000 | TA §3.7 / Migration 014 (existing) | Conversation summarisation trigger (TA §8.5). When `total_input_tokens(messages) >= threshold`, an inline summary pass runs |
| `agent.director_max_workflow_steps` | 30 | Migration 031 (new) | Maximum steps the executor accepts in a single workflow (G-5). Excess steps truncated; assistant message notes the cap |
| `agent.heartbeat_interval_ms` | 5000 | Migration 031 v1.1 (SU-40) | Frequency at which the agent runner updates `agent_jobs.last_heartbeat_at` during LLM calls. UI heartbeat indicator updates from real-time fires |
| `agent.heartbeat_timeout_ms` | 120000 | Migration 031 v1.1 (SU-40) | Threshold beyond which a `running` agent_job with no heartbeat is considered orphaned by the recovery sweep — marked `failed` with `error_message='heartbeat_timeout'` |
| `workflow.heartbeat_timeout_ms` | 300000 | Migration 031 v1.1 (SU-40) | Threshold beyond which a `running` workflow with no continuation tick in this window is considered stalled — marked `paused` with `error_message='heartbeat_timeout'`. Larger than the agent-job timeout because workflow ticks happen *between* agent jobs |
| `agent.recovery_sweep_interval_seconds` | 60 | Migration 031 v1.1 (SU-40) | Vercel Cron interval for `/api/cron/director-recovery`. MUST match the schedule in `vercel.json` |

Migration 031 seeds the three new keys (idempotent `INSERT ... ON CONFLICT DO NOTHING`); the iteration cap and summarisation threshold reuse the existing TA §3.7 registry names (Migration 014 already seeds them). Defaults are admin-tunable post-launch via the platform_config admin tooling without a deployment. The `getConfig()` 1-minute in-process cache means a default change propagates within ~60s.

**Why config keys rather than constants:** the rate limits and caps are operational levers — during a security incident or rate-limit breach, the platform admin must be able to tighten them in seconds without a deployment. The `agent.director_max_tool_iterations` key is particularly important — a misbehaving prompt that induces tool-call recursion could otherwise burn through Opus tokens until Vercel's 60s timeout fires.

**Phase 5b inherits unchanged from Phase 5:** the per-org token-budget gate (`/api/director/message` calls `checkTokenBudget()` before the SSE response begins), and the platform-wide rate limit applied at the API boundary by Vercel/CDN.

### 2.8 Pagination

`GET /api/documents/[id]/workflows` and the message-pagination on `GET /api/director/conversation/[id]` use the same Phase 1 pagination convention: `?cursor=<id>&limit=20`. Default 20, max 50. Cursor-paginated by `created_at desc, id desc`.

### 2.9 Timestamps and date formats

ISO 8601 with millisecond precision and `Z` suffix. UTC. Identical to Phase 1–5.

### 2.10 Caller's organisation

Resolved server-side from the session's `auth.uid()` via a single `organisation_members` lookup at request entry. Cached for the lifetime of the request. Never accepted from the client.

### 2.11 Director system invariants

**I-1. Configuration-driven executor.** The Director executor (`lib/director/executor.ts`) contains zero Director-specific values. Model ID, system prompt, tool suite, model parameters, and capability flags are loaded from the singleton `director_configs` row at the start of each `/api/director/message` call (TA §8.1). Code that reads any such value from a constant is invalid — it goes through `loadDirectorConfig()`.

**I-2. Write tools never execute inside the loop (H-08).** Read tools execute and return data. Write tools produce `WorkflowStepProposal` objects accumulated by the executor and saved as a `workflow` record with `status='draft'` at end-of-turn. Nothing is written to nodes / agent_jobs / context_links by a write tool inside the agentic loop. Execution happens only after `POST /api/director/workflows/[id]/approve`.

**I-3. Tool validation precedes every tool call.** `validateToolCall()` runs before every tool, every iteration. If denied, an error tool-result is returned to the model and the loop continues; the model may retry with different parameters or give up. Failure to validate is a hard fail of the loop with HTTP-level abort.

**I-4. Canary scan on every text chunk.** The Director's text output is canary-scanned on every SSE chunk before it's flushed to the client. On detection: loop aborts, the partial text is discarded (not saved as an `assistant` message row), the SSE `error` event fires with `director_canary_leak`, and the canary-leak audit log is written.

**I-5. Token budget gate runs in the API route, before the message is appended (H-07 carry-forward).** `checkTokenBudget()` is called with an *estimated* token count (conversation context + system prompt + 8k output budget) at the start of `/api/director/message`. If the budget check fails, the user message is NOT appended and a 402 is returned. No conversation_messages row is created.

**I-6. Locked-node respect at planning time AND execution time.** The Director's `validateToolCall()` rejects write-tool calls targeting `nodes.locked = true`. If a locked node is in scope of a *plan* the Director composes (e.g. it appears in `assess_downstream_impact`), the plan card surfaces it as a warning — the Director's system prompt instructs it never to propose a step that targets a locked node. At execution time, before each step's agent job is dispatched, `lockChainCheck()` is run; failure marks the step `failed` and pauses the workflow with `workflow_locked_nodes` in `workflows.error`.

**I-7. Cross-org and cross-document tool calls always denied.** `validateToolCall()` checks `node.organisation_id === caller.organisation_id` and `node.document_id === conversation.document_id` for every tool that accepts a `target_node_id`. Either failure produces an audit entry of severity `critical` and `high` respectively, and an error tool result.

**I-8. Auto-accept inside workflow execution.** Workflow step results are committed automatically when the underlying agent job reaches `completed`. The author has already approved the plan; per-step Accept would be friction without value. (For user-triggered single-node operations, Accept remains explicit — Phase 5 contract.) Failed steps do NOT auto-fail-then-accept; failure pauses the workflow at `workflows.status='paused'` per TA §8.4.

**I-9. Conversation summarisation runs inline when needed.** Before each `/api/director/message` call, if `total_input_tokens(messages) > 60_000`, the executor first runs a summarisation pass (a single non-tool LLM call against the oldest half of messages) and persists `conversations.conversation_summary` + `conversations.summary_covers_through`. The actual user-message-handling call then uses the summary + recent messages. See TA §8.5 and G-9.

**I-10. Heartbeats during long-running operations** (v1.1 SU-40). The Director must never go silent for >10 seconds without a liveness signal:

- **Inside the streaming Director route** (`/api/director/message`): SSE comment lines `:heartbeat <iso-timestamp>\n\n` are emitted every 10 seconds during silence (between LLM streaming events; during slow tool execution; during summarisation). The lines are invisible to `EventSource.onmessage` but flush through the connection, telling the browser, Vercel edge, and intermediaries (Cloudflare, etc.) the server is alive. Loss of heartbeats for >30 seconds is a signal to the client that the server has died.
- **Inside the agent runner**: every `agent.heartbeat_interval_ms` (default 5000) the runner UPDATEs `agent_jobs.last_heartbeat_at = now()` while the LLM call is in flight. Real-time fires; the ExecutionCard's heartbeat indicator updates from green-pulse (heartbeat <15s ago) to amber (15–60s) to red (>60s, recovery sweep imminent).
- **Inside the workflow executor**: `advanceWorkflow()` UPDATEs `workflows.last_heartbeat_at = now()` on every continuation tick (every time it dispatches the next batch). The ExecutionCard's overall workflow indicator uses this.

**I-11. Recovery sweep is mandatory** (v1.1 SU-40). A Vercel Cron Job at `/api/cron/director-recovery` runs every `agent.recovery_sweep_interval_seconds` (default 60). The endpoint:

1. Authenticates via `CRON_SECRET` header (Vercel Cron sets this automatically; route returns 401 otherwise).
2. UPDATEs `agent_jobs SET status='failed', error_message='heartbeat_timeout', completed_at=now() WHERE status='running' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval 'agent.heartbeat_timeout_ms ms') AND started_at < now() - interval '2 minutes'` (the started_at clause prevents a fresh job that hasn't yet emitted its first heartbeat from being killed).
3. For each newly-failed agent_job that belongs to a `workflow_steps` row, calls `advanceWorkflow(workflow_id)` so the workflow transitions to `paused` cleanly with `error_message` mirroring the failed step.
4. UPDATEs `workflows SET status='paused', error_message='heartbeat_timeout' WHERE status='running' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval 'workflow.heartbeat_timeout_ms ms')` (catches the case where the continuation chain itself broke — agent jobs aren't running but the workflow is stuck in `running`).

The recovery sweep is the system's heartbeat. Without it, a single Vercel cold-start failure could leave a workflow stuck in `running` indefinitely. With it, the worst case is a 60-second visible delay before the UI shows the failure card.

**I-12. Mid-turn persistence — the Director never wastes work** (v1.1 SU-41). The streaming Director's assistant message row is written **at the start of the turn** with `turn_state='interim'`, NOT at end-of-turn. Each agentic-loop iteration's tool calls land in `tool_calls` JSONB as they execute (incremental UPDATE). Accumulated text is flushed to `content` every iteration boundary. The row's `turn_state` transitions:

- `interim` (created at start of turn; updated incrementally)
- `final` (clean end-of-turn — model emitted `stop_reason: end_turn` and any `<workflow_proposal>` block parsed cleanly)
- `interrupted` (set by the recovery sweep on heartbeat-timeout, OR by the streaming route's flush-failure handler on detected SSE disconnect)

A conversation has **at most one** `interim` row at a time (the agentic loop is single-flight per conversation; a new `/api/director/message` call rejects with 409 `conversation_locked` if an interim row exists).

**Resumption** (new endpoint §3.13): when the conversation has an `interrupted` row, the DirectorPanel shows a "Resume Director" button. Clicking it calls `POST /api/director/conversation/[id]/resume`, which:

1. Loads the interrupted row (text + tool_calls already done)
2. Constructs an agentic-loop initial-state from the interrupted row's accumulated content
3. Continues the loop — feeds the prior user message + the partial assistant output back to the model, which sees its own incomplete response and continues from there
4. Streams the continuation back via SSE, the same way `/api/director/message` does
5. On clean end-of-turn, the interim row transitions `interrupted → final` (the row is updated, not duplicated)

The author preserves the cost of every tool call already paid for. A 90% complete turn that was killed by a Vercel cold-start gets recovered for the cost of one extra LLM call that re-reads the partial output.

### 2.12 Response shape — `conversation` object

```json
{
  "id": "uuid",
  "document_id": "uuid",
  "conversation_summary": null,
  "summary_covers_through": null,
  "message_count": 14,
  "current_workflow_id": "uuid-or-null",
  "created_at": "2026-05-06T10:30:00.000Z",
  "updated_at": "2026-05-06T11:42:13.451Z"
}
```

Field notes:
- `message_count` is computed at response time (cheap — indexed lookup); not stored.
- `current_workflow_id` is the most recent `workflows` row for this conversation with `status IN ('draft','approved','running','paused')`. NULL when no active workflow. Used by the UI to decide whether to render a PlanCard / ExecutionCard inline.
- `organisation_id` is omitted (RLS gate, not interesting to clients).

### 2.13 Response shape — `conversation_message` object

```json
{
  "id": "uuid",
  "conversation_id": "uuid",
  "role": "assistant",
  "content": "I've reviewed Act 1. The pacing issue...",
  "sequence": 7,
  "tool_calls": [
    {
      "id": "toolu_abc",
      "name": "get_node",
      "arguments": { "node_id": "uuid" },
      "validation_result": "allowed",
      "executed_at": "2026-05-06T10:30:14.700Z",
      "result_summary": "Returned node summary, 1142 chars"
    }
  ],
  "workflow_id": "uuid-or-null",
  "created_at": "2026-05-06T10:30:18.123Z"
}
```

Field notes:
- `tool_calls` is the `JSONB` column from Migration 005, populated by the executor at end-of-turn for assistant messages. For user messages `tool_calls` is always `[]`.
- `validation_result` and `executed_at` are added to each tool call's JSON shape by Phase 5b — they are not separate columns. `validation_result` is one of `'allowed' | 'denied:cross_org' | 'denied:cross_document' | 'denied:locked_node' | 'denied:rate_limit' | 'denied:injection' | 'denied:other'`. `result_summary` is a 200-char-truncated description for the audit trail; the full result is NOT persisted (it's reconstructable from the tool's deterministic input).
- `workflow_id` is non-NULL only on `assistant` messages whose end-of-turn produced a workflow proposal. A single message may produce at most one workflow.
- `mentioned_node_ids: string[]` is added to the JSON shape on `user` messages (extracted client-side from `@` mentions). Stored in the `tool_calls` column under a synthetic key (yes, naming is awkward — see G-4) to avoid a schema change.

### 2.14 Response shape — `workflow` object

```json
{
  "id": "uuid",
  "document_id": "uuid",
  "conversation_id": "uuid",
  "title": "Reorder Chapter 3 and refine Scene 2",
  "description": "Address pacing in Act 1 chapters 3-4.",
  "impact_summary": "Will modify Chapter 3 (locked: no) and Chapter 3 Scene 2 (locked: no). Chapter 1 is locked and not affected.",
  "status": "completed",
  "estimated_total_minutes": 2,
  "locked_nodes_requiring_unlock": [],
  "steps": [ /* workflow_step objects, ordered by `order` */ ],
  "created_at": "2026-05-06T10:30:18.123Z",
  "approved_at": "2026-05-06T10:30:45.222Z",
  "completed_at": "2026-05-06T10:32:01.998Z",
  "updated_at": "2026-05-06T10:32:01.998Z"
}
```

Field notes:
- `steps` is included by default; the row count per workflow is bounded (at most 30 steps — see G-5). Individual step PATCH responses also return the full workflow with steps (single round-trip).
- `error_message` is added at the workflow level if the workflow paused due to a step failure (`paused` status). It mirrors the failed step's `error_message`.
- `organisation_id` is omitted from the client shape.

### 2.15 Response shape — `workflow_step` object

```json
{
  "id": "uuid",
  "workflow_id": "uuid",
  "order": 2,
  "operation_type": "refine",
  "target_node_id": "uuid",
  "target_node_label": "Chapter 3 Scene 2",
  "parameters": {
    "target_field": "summary",
    "instruction": "Make the reflection briefer and tied to external action."
  },
  "description": "Refine Chapter 3 Scene 2 summary...",
  "estimated_duration_seconds": 45,
  "depends_on_step_orders": [1],
  "status": "completed",
  "agent_job_id": "uuid-or-null",
  "result_summary": "Generated revised summary (320 chars).",
  "error_message": null,
  "started_at": "2026-05-06T10:31:00.000Z",
  "completed_at": "2026-05-06T10:31:42.119Z"
}
```

Field notes:
- `target_node_label` is a human-readable label (`"<node_type> <node_name>"`) computed at response time from the FK lookup. NOT a column. Used by PlanCard's "target node link".
- `parameters` JSONB shape varies by `operation_type`:
  - `expand` — `{ child_count_target?: number, layer_target?: 'auto' }`
  - `synthesise` — `{}` (no parameters; the operation reads the leaf's existing summary + linked context)
  - `refine` — `{ target_field: 'summary'|'prose'|'notes'|'metadata', instruction: string }`
  - `generate_context` — `{ context_type: string, seed_content?: string }`
  - `comment` — `{ comment_type: 'instruction'|'note', content: string }` (creates a node_comments row, NOT an agent_jobs row)
  - `node_reorder` — `{ new_order: number, parent_id?: string }` (reorders a node within its parent — calls Migration 021's `move_node` RPC; NOT an agent_jobs row)
- `agent_job_id` is non-NULL only for steps whose `operation_type` produces an agent job (`expand` / `synthesise` / `refine` / `generate_context`). NULL for `comment` and `node_reorder` steps which run synchronously via direct DB writes.

### 2.16 SSE wire format — `POST /api/director/message`

The response is `Content-Type: text/event-stream` with `Cache-Control: no-store` and `Connection: keep-alive`. Events are separated by `\n\n`. Every event is a JSON-encoded object on the `data:` line.

| Event | Payload | Meaning |
|---|---|---|
| `start` | `{ "conversation_id": "uuid", "user_message_id": "uuid" }` | Conversation row is ready; the user message is persisted; the agentic loop is starting |
| `text_delta` | `{ "delta": "string-fragment" }` | A streamed fragment of the Director's response. Multiple per turn |
| `tool_use_start` | `{ "tool_call_id": "toolu_*", "name": "get_node", "arguments_partial": {} }` | Director has started a tool call |
| `tool_use_complete` | `{ "tool_call_id": "toolu_*", "validation_result": "allowed" \| "denied:*", "result_summary": "..." }` | Tool call validated and executed (or denied) |
| `workflow_proposal` | `{ "workflow": { ...workflow_object_with_steps }, "assistant_message_id": "uuid" }` | End-of-turn produced a workflow plan; saved as a `draft` workflow |
| `assistant_message_complete` | `{ "assistant_message_id": "uuid", "tokens_input": N, "tokens_output": M, "tokens_cache_read": K, "tokens_cache_write": L, "cost_usd": 0.0732 }` | The assistant message is fully persisted; usage recorded |
| `done` | `{}` | Stream complete; client should close the EventSource |
| `error` | `{ "error": "kebab-case", "message": "human" }` | Aborts the stream. Client should close the EventSource |

**Ordering guarantees:**
1. `start` is always first.
2. `text_delta` and `tool_use_*` events may interleave in the order they occur.
3. `workflow_proposal` (if produced) precedes `assistant_message_complete`.
4. `assistant_message_complete` precedes `done`.
5. An `error` event may fire at any point; once fired, no further events follow.

**Heartbeat** (v1.1 SU-40 / I-10): every 10 seconds during silence (no other event traffic), the server emits an SSE comment line `:heartbeat <iso-timestamp>\n\n`. Comment lines are invisible to `EventSource.onmessage` (they don't fire a `message` event) but flush through the connection. The client's connection-monitor (a 30-second timer that resets on any incoming bytes) treats absence-of-bytes-for-30-seconds as a server death and surfaces "Director connection lost — reconnect" UI.

**Disconnection and resumption** (v1.1 SU-41 / I-12 — supersedes v1.0 G-10): on detected SSE disconnect (browser close, network drop, or Vercel function exit), the streaming route's `ReadableStream` cancellation handler runs. The handler:

1. UPDATEs the in-flight `conversation_messages` row from `turn_state='interim'` → `'interrupted'`
2. Persists whatever text and tool_calls have accumulated up to this point (already happening incrementally, but a final flush ensures consistency)
3. Lets the `waitUntil()` continuation finish if it was already in flight (e.g. the closing tool_use_complete write)

The conversation is now in a **resumable** state. The DirectorPanel re-mounting (e.g. after page reload) sees the `interrupted` row and renders a "Resume Director" button; clicking calls `POST /api/director/conversation/[id]/resume` (§3.12). The interrupted turn's accumulated work is preserved.

**Recovery sweep backstop**: if the disconnect handler itself fails (e.g. process killed mid-cleanup), the sweep at `/api/cron/director-recovery` will catch the row via the `agent_jobs.last_heartbeat_at` timeout and the `conversation_messages.turn_state='interim'` partial index — the row transitions to `interrupted` and the resume path is available the same way.

### 2.17 Real-time subscription contract

In addition to the SSE stream, the client subscribes to two real-time channels:

```ts
// Channel 1: workflows for the active document
supabase.channel(`workflows-${documentId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'workflows',
      filter: `document_id=eq.${documentId}` }, ...)

// Channel 2: workflow_steps for the active workflow (subscribed once a workflow exists)
supabase.channel(`workflow-steps-${workflowId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_steps',
      filter: `workflow_id=eq.${workflowId}` }, ...)
```

Both channels are added to the `supabase_realtime` publication by Migration 030 (Phase 5 SU-30) — wait, that migration only added `agent_jobs` / `node_comments` / `nodes`. **Migration 031 also adds `workflows` and `workflow_steps` to the publication** — see G-6. (The contract counts this as part of Migration 031, not a separate migration.)

H-05 carry-forward: the components that subscribe (DirectorPanel, ExecutionCard) MUST clean up via `supabase.removeChannel(channel)` on unmount.

---

## 3. Endpoint Specifications

Each endpoint follows the Phase 1–5 contract structure: purpose → request → success → failure modes → RLS notes.

### 3.1 `POST /api/director/message` — Stream a Director response (SSE)

**Purpose.** The single ingress for author-to-Director communication. Persists the user message, runs the agentic loop, streams text + tool events back to the client over SSE, persists the assistant message at end-of-turn, and (if produced) saves a draft workflow.

**Request body:**
```json
{
  "document_id": "uuid",
  "conversation_id": "uuid-or-omit",
  "content": "Act 1 feels slow in the middle...",
  "mentioned_node_ids": ["uuid1", "uuid2"]
}
```

**Headers:**
- `Content-Type: application/json`
- `Accept: text/event-stream`

**Response:** `200 text/event-stream`. Events per §2.16.

**Validation order:**
1. Auth (401).
2. `document_id` exists and is in caller's org (404 / 403).
3. If `conversation_id` is provided, it exists and matches `document_id` (404 / 403).
4. Else, resolve-or-create the conversation for `document_id` (UNIQUE constraint enforces single row).
5. `content` is 1..10_000 chars (400 `validation_failed`).
6. Director-message rate limit (429 `director_message_rate_limit`).
7. Token budget gate — estimated input cost (conversation context + 8k output budget). 402 `director_token_budget_exceeded`.
8. Conversation summarisation if `total_input_tokens > 60_000` (TA §8.5; runs as a non-streaming pre-step before SSE response begins).
9. Append user message row.
10. Start SSE response with `start` event.
11. Run agentic loop (max 20 iterations per TA §8.2).

**Failure modes:**

| Cause | HTTP / SSE | Code |
|---|---|---|
| Missing auth | 401 | `unauthenticated` |
| Document not found / RLS-hidden | 404 | `document_not_found` |
| Cross-org conversation_id | 403 | `cross_org_access_denied` |
| Empty / too-long content | 400 | `validation_failed` |
| Rate limit | 429 | `director_message_rate_limit` |
| Token budget exceeded | 402 | `director_token_budget_exceeded` |
| Canary leak mid-stream | SSE `error` | `director_canary_leak` |
| Tool validation failure (hard) | SSE `error` | `tool_validation_failed_terminal` |
| Edge Function timeout (Vercel 30s pre-V1, 60s V1) | SSE `error` | `director_loop_timeout` |
| Anthropic API error | SSE `error` | `provider_error` (with provider-supplied message) |

**RLS notes:** Reads / writes use the service-role client inside `director-runner`. The trust boundary is the `{ organisationId, userId, documentId }` payload composed by the API route after RLS-verified lookups.

### 3.2 `GET /api/director/conversation/[conversationId]` — Fetch a conversation

**Purpose.** Load a conversation + paginated messages.

**Query params:**
- `cursor=<uuid>` — last seen message id; results are messages with `sequence < cursor.sequence`
- `limit=<n>` — default 20, max 50

**Response 200:**
```json
{
  "conversation": { /* conversation object */ },
  "messages": [ /* conversation_message objects, oldest first within page */ ],
  "next_cursor": "uuid-or-null"
}
```

**Failure modes:** 401, 403 (cross-org), 404 (`conversation_not_found`), 400 (`invalid_cursor`).

### 3.3 `GET /api/documents/[documentId]/conversation` — Resolve conversation for a document

**Purpose.** UI mounting endpoint: when the author opens Director Mode, the panel needs the conversation row + recent messages + current workflow. This endpoint resolves all three in one round-trip; creates an empty conversation if absent.

**Response 200:**
```json
{
  "conversation": { /* conversation object */ },
  "recent_messages": [ /* last 20 messages, oldest first */ ],
  "current_workflow": { /* workflow with steps, or null */ }
}
```

**Failure modes:** 401, 403, 404 (`document_not_found`).

### 3.4 `POST /api/director/conversation/[conversationId]/messages` — Append message (non-streaming)

**Purpose.** Admin / replay tooling. Appends a `user` or `assistant` message row to a conversation without running the agentic loop. Not used by the UI in Phase 5b. Reserved for V2 conversation-import features.

**Request body:**
```json
{ "role": "user" | "assistant", "content": "string", "tool_calls": [] }
```

**Response 201:** `{ message: { /* conversation_message */ } }`

**Failure modes:** 401, 403, 404, 400 (`validation_failed`).

**Note:** Service-role-only in V1. Returns 403 for any non-admin caller. (Phase 5b ships the route gated; admin-tooling V2 work will surface it.)

### 3.5 `GET /api/director/workflows/[workflowId]` — Fetch a workflow + steps

**Purpose.** Load full workflow state. Used by the UI to refresh PlanCard / ExecutionCard after real-time updates.

**Response 200:** `{ workflow: { /* workflow object with steps */ } }`

**Failure modes:** 401, 403, 404 (`workflow_not_found`).

### 3.6 `POST /api/director/workflows/[workflowId]/approve` — Approve a draft workflow

**Purpose.** Transitions `draft → approved → running` and kicks off the workflow executor. Optionally accepts a list of `approved_step_orders` — steps not in the list are marked `removed` atomically before approval.

**Request body:**
```json
{
  "approved_step_orders": [1, 2, 4],
  "step_parameter_overrides": {
    "2": { "instruction": "Edited instruction text" }
  }
}
```

Both fields optional. If `approved_step_orders` is omitted, all current `pending` steps remain approved. `step_parameter_overrides` allows per-step `parameters` JSONB merge — used by Component Spec §7.6's "Edit Steps" button.

**Validation order:**
1. Auth, 401.
2. Workflow exists, RLS-visible, 404 / 403.
3. Author-of-conversation match, 403 `not_conversation_author`.
4. `workflow.status === 'draft'`, else 409 `workflow_invalid_status`.
5. `approved_step_orders` (if present) is a subset of existing step orders, else 400 `unknown_step_orders`.
6. Locked-node respect: any step targeting `nodes.locked = true` blocks approval. If `locked_nodes_requiring_unlock` (Migration 005 column) is non-empty after the deselect filter, return 423 `workflow_locked_nodes` with `locked_node_ids`.
7. Atomic transaction:
   a. Update steps not in `approved_step_orders` to `status='removed'`.
   b. Apply `step_parameter_overrides`.
   c. Update workflow: `status='approved'`, `approved_at=NOW()`.
8. Invoke `workflow-executor` Edge Function with `{ workflow_id }`. The Edge Function transitions `approved → running` as it picks up the workflow; the API returns immediately.

**Response 202:**
```json
{ "workflow": { /* updated workflow with status='approved' */ } }
```

**Failure modes:** 401, 403 (cross-org / not author), 404, 409 (`workflow_invalid_status`), 400 (`unknown_step_orders`), 423 (`workflow_locked_nodes`).

**Idempotency:** Re-calling on `status='approved'` returns the workflow + 200 (not 202) without re-invoking the executor.

### 3.7 `POST /api/director/workflows/[workflowId]/cancel` — Cancel before execution

**Purpose.** Cancel a `draft` or `approved` workflow before any step has started. Status-conditional:
- `draft` → `cancelled`. No execution side-effects.
- `approved` (executor not yet running first step) → `cancelled` if no step is `running`; else 409.
- `running` → use `/stop` instead.
- Terminal (`completed`, `cancelled`) → 409.

**Response 200:** `{ workflow: { /* updated */ } }`

**Failure modes:** 401, 403, 404, 409.

### 3.8 `POST /api/director/workflows/[workflowId]/pause` — Pause a running workflow

**Purpose.** Sets `workflows.status = 'paused'`. The executor checks `workflows.status` at each batch boundary; when it sees `paused`, it stops dispatching new steps. Currently in-flight steps complete normally.

**Failure modes:** 401, 403, 404, 409 (`workflow_invalid_status` if not `running`).

### 3.9 `POST /api/director/workflows/[workflowId]/resume` — Resume a paused workflow

**Purpose.** Sets `workflows.status = 'approved'` (executor entry-state) and re-invokes the executor. The executor picks up where it left off — `pending` steps are dispatched in dependency-graph order.

**Failure modes:** 401, 403, 404, 409 (`workflow_invalid_status` if not `paused`).

### 3.10 `POST /api/director/workflows/[workflowId]/stop` — Stop and abandon

**Purpose.** Sets `workflows.status = 'cancelled'`. The executor sees this at the next batch boundary and exits. Any `pending` steps are marked `skipped`.

**Failure modes:** 401, 403, 404, 409 (`workflow_invalid_status` if `completed` or already `cancelled`).

### 3.11 `PATCH /api/director/workflows/[workflowId]/steps/[stepOrder]` — Update a draft step

**Purpose.** Per-step edit before approval. Component Spec §7.6's PlanCard uses this for:
- Deselect a step (set `status='removed'`)
- Re-select a removed step (`status='pending'`)
- Edit a step's `parameters` (e.g. instruction text)
- Edit the step description (UI does not surface this; reserved for tooling)

**Request body:**
```json
{
  "status": "removed" | "pending",
  "parameters": { ... },
  "description": "string"
}
```

All fields optional.

**Validation:**
1. Workflow `status='draft'`, else 409 `workflow_step_invalid_status`.
2. Step exists in workflow, else 404 `workflow_step_not_found`.
3. `status` must be `removed` or `pending` (not `completed`/`failed`/`running`).

**Response 200:** `{ workflow: { /* updated workflow with steps */ } }` — full workflow returned for UI consistency.

### 3.12 `POST /api/director/conversation/[conversationId]/resume` — Resume an interrupted turn

**Purpose** (v1.1 SU-41 / I-12). When a Director conversation has a `conversation_messages` row with `turn_state='interrupted'`, this endpoint resumes the turn — feeds the partial assistant output back to the model and continues the agentic loop. Preserves the cost of all tool calls already paid for.

**Request body:** none. The endpoint locates the interrupted row implicitly (at most one per conversation).

**Headers:**
- `Accept: text/event-stream`

**Response:** `200 text/event-stream`. Same wire format as §3.1 (`POST /api/director/message`) — `start`, `text_delta`, `tool_use_*`, `workflow_proposal`, `assistant_message_complete`, `done`, `error`. The `start` event payload includes `{ resumed: true, recovered_tool_call_count: N }` so the client can show a banner.

**Validation order:**
1. Auth, 401.
2. Conversation exists in caller's org, 404 / 403.
3. **Exactly one** `turn_state='interrupted'` row in the conversation, else 409 `no_interrupted_turn`.
4. Director-message rate limit (a resume counts as a message turn for rate-limit purposes).
5. Token budget gate (the resume call costs LLM tokens for the re-feed).

**Failure modes:**
| Cause | HTTP / SSE | Code |
|---|---|---|
| No interrupted row | 409 | `no_interrupted_turn` |
| Multiple interrupted rows (data integrity violation) | 500 | `multiple_interrupted_turns` (logged; manual recovery required) |
| All other modes | (per §3.1) | (per §3.1) |

**On success:** the interrupted row transitions `interrupted → final` (UPDATE in place; the row's `created_at` is preserved; `tool_calls` and `content` are updated to the new full content; `tokens_*` and `cost_usd` are accumulated across the original + resume LLM calls).

### 3.13 `POST /api/cron/director-recovery` — Recovery sweep (Vercel Cron)

**Purpose** (v1.1 SU-40 / I-11). The mandatory recovery sweep. Runs every 60 seconds via Vercel Cron Job (configured in `vercel.json`). Marks orphaned `running` agent jobs `failed` and stalled workflows `paused`.

**Request body:** none.

**Auth:** `Authorization: Bearer <CRON_SECRET>` header (set by Vercel Cron automatically). Route returns 401 if header is missing or doesn't match `process.env.CRON_SECRET`.

**Response 200:**
```json
{
  "agent_jobs_failed": 0,
  "workflows_paused": 0,
  "ran_at": "2026-05-06T01:23:45.000Z"
}
```

**Failure modes:** 401 only. The route is idempotent on re-runs — concurrent invocations (rare; Vercel Cron is single-flight per schedule) are safe due to the SQL UPDATE's WHERE clause being status-conditional.

**Local development:** Vercel Cron does not run in `npm run dev`. Tests invoke the route manually via `fetch` with the dev `CRON_SECRET`. A `npm run cron:director-recovery` script convenience-wraps the dev invocation.

### 3.14 `GET /api/documents/[documentId]/workflows` — Workflow history

**Purpose.** Per-document workflow history, paginated. Used by the DirectorHeader's "History" button.

**Query params:** `cursor`, `limit` per §2.8.

**Response 200:**
```json
{
  "workflows": [ /* workflow objects WITHOUT steps */ ],
  "next_cursor": "uuid-or-null"
}
```

**Steps are omitted** from the list response for payload size — clients fetch steps on-demand via §3.5. A `step_count` integer is included on each workflow row.

---

## 4. Test Cases

The complete test case matrix lives in `stelavox_phase5b_test_plan_v1_0.md`. Phase 5b uses the same TC- prefix scheme as Phase 5:

- **TC-U** — UI checkpoint tests (Playwright DOM)
- **TC-V** — Visual / styling tests (Playwright DOM + computed styles)
- **TC-M** — Motion / transition tests
- **TC-A** — API integration tests (request / response / status)
- **TC-B** — Cross-org RLS tests
- **TC-D** — Data integrity / Zod validation tests
- **TC-S** — Security tests (validateToolCall, canary, injection)
- **TC-AX** — Accessibility tests (keyboard nav, ARIA)

The Phase 5b Test Plan defines β-scope (must-pass for Phase 5b merge) vs deferred (folded into SU-33's Phase 8 expansion or a new SU-37 if scope-distinct). β-scope targets ~40 cases locally + ~4 cloud smoke cases — all on Haiku 4.5 per the user's Haiku-everywhere standing direction. Production-default in `director_configs` remains Opus (Migration 013).

---

## 5. Specification Gaps Found While Writing This Contract

Items that surfaced during contract drafting; resolved here, flagged for absorption at Phase 5b close-out.

### G-1 — System prompt as Migration data, not platform_config

The Director's system prompt is large (~6-8k tokens) and structured. It belongs in `director_configs.system_prompt` (Migration 013 column), not `platform_config`. This mirrors Phase 5's G-1 for agent profiles. The prompt's source-of-truth is `supabase/seed/director-v1.0.txt` in the repo; Migration 031 reads the file at migration time and writes the row.

**Resolution:** Drafted in Build Checklist T-3.3. Source-of-truth-in-repo via the seed file. V2 will introduce `director_configs` lifecycle (status enum, beta opt-in, doc pin) per TA §8.6 — V1 ships one row.

### G-2 — Author-of-conversation authorisation

V1 uses a single conversation per document. Within an organisation, multiple users may share a document — but who can approve a Director-proposed workflow? The Product Spec doesn't explicitly answer.

**Resolution:** Author-of-conversation = the user who sent the first user message in that conversation. Stored implicitly via `conversation_messages.created_at asc limit 1`'s `triggered_by` would be cleaner — but that column doesn't exist on `conversation_messages`. Phase 5b adds an `author_user_id UUID NOT NULL REFERENCES auth.users(id)` column to `conversation_messages` via... actually, this is a schema change. Reconsidered:

**Resolution (revised):** Use the existing pattern from `agent_jobs.triggered_by` and add `conversation_messages.author_user_id UUID NOT NULL REFERENCES auth.users(id)` in **Migration 031** (alongside the system prompt seed; same migration). Resolved via SQL DEFAULT-then-strip pattern: backfill is empty (Phase 5b is pre-launch; no existing rows). The author-of-conversation is the `author_user_id` of the message with `sequence = 1` (first user message). Workflow approval check: `workflow.conversation_id → conversations → conversation_messages where sequence=1 → author_user_id === auth.uid()`.

Migration 031 therefore does TWO things: seeds the Director system prompt + adds the column. This is recorded in Build Checklist T-3.1 as a single migration with two ALTERs.

### G-3 — Auto-Accept inside the workflow executor

The Phase 5 Accept flow is explicit (the user clicks Accept on a completed agent job). For workflow steps, this would mean a second approval per step — friction the author doesn't want after they've already approved the plan.

**Resolution:** I-8 and §1.2 — auto-accept inside the workflow executor. The executor calls `acceptAgentJobForStep()` which uses Migration 029's `accept_agent_job` RPC directly (with the workflow's user as the `acting_user_id`). The Accept-RPC's optimistic-concurrency check (target_node_version_at_capture) still runs — if the author edited the target node mid-workflow, that step fails, the workflow pauses, and the author sees the failure card. This is correct behaviour: an author edit during execution is a signal to stop and reconcile.

### G-4 — `@`-mentions wire format

Component Spec §7.9 describes `@`-mention as inserting a node-pill into the textarea. The wire format from client to server needs to communicate "this user message references these node IDs" without the server having to re-parse the textarea.

**Resolution:** Two parallel fields in the request body — `content` (the literal text the user typed, with `@nodename` left as-is) and `mentioned_node_ids: string[]`. The server validates that each mentioned ID belongs to the caller's org + document, then injects a `<mentioned_nodes>` block into the system prompt before the user message. The Director sees: literal user text + a structured list of (id, name) pairs. The literal text isn't re-parsed by the server; the client owns the substitution. Stored on the message row in `tool_calls` JSONB under a `_mentioned_node_ids` synthetic key. Naming-awkward but no schema change required.

### G-5 — Maximum steps per workflow

TA §8.4 doesn't bound the step count. A misbehaving Director could propose 200 steps. The PlanCard's "always fully expanded" rule (Component Spec §7.6 Inviolable) makes very large plans unusable.

**Resolution:** Bound at **30 steps maximum per workflow** (config key `agent.director_max_workflow_steps`, default 30). Enforced in the executor when assembling the `WorkflowStepProposal` array — if the model produces >30 proposals, the executor truncates to 30 and appends an explanatory note to the assistant message ("I had more steps in mind but capped at 30; I'll continue after this batch completes."). The Director's system prompt instructs it to keep workflows under 30 steps, splitting larger work across multiple turns.

### G-6 — `workflows` / `workflow_steps` not in `supabase_realtime` publication

Phase 5 Migration 030 added `agent_jobs`, `node_comments`, `nodes` to the publication (SU-30). It did NOT add `workflows` or `workflow_steps` because Phase 5 didn't consume them. Phase 5b must add them.

**Resolution:** Migration 031 includes `ALTER PUBLICATION supabase_realtime ADD TABLE workflows; ALTER PUBLICATION supabase_realtime ADD TABLE workflow_steps;` after the system-prompt seed. Documented in Build Checklist T-3.1.

### G-7 — Tool-call audit trail without a separate table

TA §4.5's Defence 4 requires per-session rate limiting (`countRecentToolCalls(session.id, 60_000)`) and audit logging. A naïve implementation adds a `director_tool_calls` table.

**Resolution:** Reuse `conversation_messages.tool_calls JSONB` (existing Migration 005 column). Each assistant message's tool_calls JSON includes `{ id, name, arguments, validation_result, executed_at, result_summary }` per call. Rate-limiting query: `SELECT count(*) FROM conversation_messages, jsonb_array_elements(tool_calls) AS tc WHERE conversation_id = $1 AND (tc->>'executed_at')::timestamptz > now() - interval '60 seconds'`. Indexed via a partial GIN index on `tool_calls` (added in Migration 031 if performance demands; otherwise the FK index on conversation_id is sufficient at V1 traffic). Audit-log entries (high-severity injection / cross-org) still write to the security audit log via `auditLog()` — that path is not affected by this gap-resolution.

### G-8 — Conversation summarisation timing and cost

TA §8.5 specifies summarising the oldest half when the conversation exceeds 60k tokens. The implementation choice is "when".

**Resolution:** Inline at the start of each `/api/director/message` call. Before SSE response begins, the API route checks `total_input_tokens(messages)`; if >60_000, it runs a single non-tool LLM call against the oldest half, persists the result to `conversations.conversation_summary` and `conversations.summary_covers_through`, then proceeds with the agentic loop using the summary + recent messages. The summarisation call uses the same Director config's `model_id` (Opus) for quality; cost is non-negligible (~$0.30 per summarisation pass) but happens infrequently. Alternative: a separate scheduled job — rejected because it adds eventual-consistency complexity for a V1 feature that needs to feel synchronous.

### G-9 — Workflow execution: HTTP loop vs shared-library dispatch

Phase 5's API routes invoke the `agent-runner` Edge Function via the standard Vercel Edge Function HTTP boundary. The Phase 5b workflow executor needs to dispatch agent jobs for each step — calling the Phase 5 API routes via internal HTTP would add latency, double-auth, and make the executor's per-step error model harder to reason about.

**Resolution:** Lift the "create agent_jobs row + invoke agent-runner" pair out of the Phase 5 API routes into a shared library `lib/agents/dispatch.ts`. Phase 5 API routes are refactored to call `dispatchAgentJob({ ... })`. Phase 5b workflow executor calls the same function with `triggered_by='workflow_step:<step_id>'`. This is the only Phase-5 modification Phase 5b makes (a refactor with no behavioural change); flagged in Build Checklist T-3.7 as the **only** Phase 5 source-tree edit.

### G-10 — SSE disconnection recovery (SUPERSEDED by v1.1 SU-41)

**v1.0 said:** Server discards the in-flight loop on detected disconnect; partial work is lost; user re-sends.

**v1.1 corrects this** per the user's cost-and-progress-recovery requirement (raised at the v1.1 amendment review): the Director must not discard work that's already been paid for. Mid-turn persistence (turn_state='interim'/'interrupted'/'final') is now first-class. The disconnect handler transitions the in-flight row to `interrupted`; a Resume button on the panel re-feeds the partial output back to the model via §3.12. See I-12.

### G-11 — Director cost tracking

Phase 5 Migration 028 added `agent_jobs.cost_usd`. Director conversations don't produce `agent_jobs` rows for the conversation itself (only for workflow steps). Where is the per-conversation-turn cost captured?

**Resolution:** Add `conversation_messages.tokens_input INT`, `tokens_output INT`, `tokens_cache_read INT`, `tokens_cache_write INT`, `cost_usd DECIMAL(10,6)` columns in **Migration 031** (alongside the system prompt + author_user_id changes). Computed at end-of-turn in the executor; written when persisting the assistant message row. The Phase 5 `lib/llm/cost.ts → computeCostUsd()` helper is reused. Total cost per conversation = `SUM(cost_usd) OVER conversation`. Internal-only field; not surfaced in V1 user-facing UI (consistent with Phase 5's cost decision, G-13).

### G-12 — Director Mode tab vs Edit Mode tab

Component Spec §2 establishes the ModeTabBar with three tabs: Edit / Director / Focus. Phase 5b is the first phase to consume Director Mode. Question: does switching to Director Mode change the layout, or does it overlay the right column?

**Resolution:** Per Component Spec §7.1 ("DirectorPanel ... 580px width ... tree must never be compressed below 300px") — Director Mode replaces the NodeDetailPanel in the right column. The tree stays. The detail panel hides. The DirectorPanel mounts. No backdrop, no modal. Switching back to Edit Mode unmounts the DirectorPanel and remounts the detail panel for the currently-selected node. The conversation persists (it's per-document, not per-tab-state).

### G-13 — Streaming behaviour for the LLMProvider interface

Phase 5 defined `LLMProvider.complete()` (implemented), `stream()` (Phase 5c stub), `completeWithTools()` (Phase 5b stub at `lib/llm/providers/anthropic.ts:101`). The Director's agentic loop needs streaming AND tools.

**Resolution:** Phase 5b adds a fourth method `streamWithTools(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk>` to the `LLMProvider` interface. `LLMStreamChunk` is extended with `'tool_use_start'` and `'tool_use_complete'` chunk types. The Director path uses `streamWithTools()` exclusively. The existing `completeWithTools()` stub is **kept** but never called — reserved for non-streaming tool-use scenarios (admin tooling, replay tests, V2 Director batch operations).

### G-14 — Initial conversation loading performance

`GET /api/documents/[documentId]/conversation` returns the conversation + last 20 messages + current workflow (with steps). For long conversations with many workflows, the message-paginate-by-20 design is fine. For the current workflow's steps, 30 steps max (G-5) keeps the payload bounded.

**Resolution (no gap, just confirmation):** Single round-trip endpoint, bounded payload, the Phase 5b UI can mount Director Mode in one fetch. Contract is sufficient.

### G-15 — Director system prompt admits its own model identity

The system prompt instructs the Director on its capabilities; one common mistake is to include "You are powered by Claude Sonnet 4.6" — this contradicts model swaps via `director_configs.model_id` and creates a maintenance pothole.

**Resolution:** The Director system prompt does NOT name its model. It refers to itself as "the Stelavox Director." Model identity is a runtime concern (`director_configs.model_id` resolves the actual API call). Documented in Build Checklist T-3.3.

### G-16 — Runtime architecture: Vercel Node.js, not Supabase Edge Functions (v1.1 SU-39)

The v1.0 contract used "Edge Function" language imported from TA §8.2 / §8.4. Phase 5 SU-28 already established that Stelavox runs the agent runner as a Vercel Node.js function via `@vercel/functions` `waitUntil()`. Phase 5b follows the same precedent.

**Resolution:** §1.5 v1.1 spells out the Vercel-Node-only architecture. The streaming Director uses an inline `ReadableStream` SSE response with `maxDuration: 300`. Workflow execution uses continuation passing (`advanceWorkflow()` called inside each agent runner's `waitUntil()` window). The recovery sweep is a Vercel Cron Job. No Supabase Edge Functions are introduced. SU-39 absorbs into TA v2.0 §8.2 + §8.4 at close-out.

### G-17 — Heartbeats for liveness verification (v1.1 SU-40)

A 60-second silent LLM call is indistinguishable from a crashed Vercel function without an explicit liveness signal. The user flagged that long silences would cause authors to close the browser believing the system has crashed. Phase 5 has the same gap (long synthesise calls were sometimes opaque in T-15 testing).

**Resolution:** I-10 mandates heartbeats at three layers (SSE comment lines every 10s, `agent_jobs.last_heartbeat_at` every 5s during LLM calls, `workflows.last_heartbeat_at` on every continuation tick). Migration 031 v1.1 adds the columns and the four config keys. The ExecutionCard surfaces heartbeat age as a pulsing indicator (Component Spec §7.7 amendment SU-42 at close-out).

### G-18 — Recovery sweep is mandatory, not optional (v1.1 SU-40)

The v1.0 architecture mentioned a recovery sweep as "optional" in passing. The user's cost-and-progress-recovery requirement makes it load-bearing — without it, a single Vercel cold-start failure can leave a workflow stuck in `running` indefinitely.

**Resolution:** I-11 + §3.13 (`/api/cron/director-recovery`) make it mandatory. Vercel Cron at 60s intervals. SQL UPDATEs for orphaned agent_jobs and stalled workflows. SU-40 absorbs into TA at close-out alongside the heartbeat columns.

### G-19 — Mid-turn persistence and resume (v1.1 SU-41)

The v1.0 G-10 said "server discards the in-flight loop on disconnect" — wrong call. If the Director has done 4 read-tool calls (each costing tokens) and the connection drops at iteration 5, throwing away that work and forcing the user to re-send is exactly the cost-waste the user flagged. The fix preserves up to 90% of completed work.

**Resolution:** I-12 + §3.12 (resume endpoint). `conversation_messages.turn_state` enum + partial index (Migration 031 v1.1). Persist tool_calls + accumulated text on every iteration boundary. On disconnect: UPDATE `interim → interrupted`. Resume re-feeds the partial output to the model and continues. The author preserves the cost of every tool call already paid for.

### G-20 — UI heartbeat indicator (v1.1 SU-42)

Component Spec §7.7 ExecutionCard does not currently spec a heartbeat indicator. The v1.1 amendments to the API Contract require one — without it, the heartbeat columns are invisible to the user and the cost-recovery story falls apart.

**Resolution:** Component Spec §7.7 amendment to be authored at Phase 5b close-out. Pulse colour: green (heartbeat <15s ago), amber (15–60s), red (>60s, recovery imminent). The "last heartbeat 3s ago" tooltip on hover. SU-42 absorbs into Component Spec v2.8 at close-out.

---

## 6. Approval

The Phase 5b API Contract is approved by the user before any code is written for Phase 5b. The approval is recorded in this section's commit history.

**Approval status (v1.0):** Drafted by the Phase 5b startup work. Pending user review.

---

## 7. Changelog

**v1.1 — 2026-05-06** Major amendment for runtime architecture, liveness, and mid-turn recovery — raised by the user at the start of T-4 build, captured as SU-39 / SU-40 / SU-41 / SU-42:

- **§1.4** Migration 031 expanded from 5 to 8 concerns: adds heartbeat columns on agent_jobs / workflows (SU-40), `conversation_messages.turn_state` enum + partial index for mid-turn persistence (SU-41), and four heartbeat / recovery-sweep config keys.
- **§1.5 (new)** Runtime architecture section explicitly drops "Edge Function" language. Streaming Director runs as a Vercel Node.js API route with `maxDuration: 300` and `ReadableStream` SSE. Workflow execution uses continuation passing (`advanceWorkflow()` from inside each agent runner's `waitUntil()` window). Recovery sweep is a Vercel Cron Job hitting an API route. No Supabase Edge Functions introduced. Old §1.5 (Auth surface) renumbered to §1.6.
- **§1.1 routes** count moves 12 → 14: adds `POST /api/director/conversation/[id]/resume` (SU-41) and `POST /api/cron/director-recovery` (SU-40).
- **§2.7 config keys** table grows from 5 to 9 rows: adds `agent.heartbeat_interval_ms`, `agent.heartbeat_timeout_ms`, `workflow.heartbeat_timeout_ms`, `agent.recovery_sweep_interval_seconds`.
- **§2.11 invariants** I-10 (heartbeats), I-11 (recovery sweep mandatory), I-12 (mid-turn persistence + resume) added.
- **§2.16 SSE wire format** adds `:heartbeat <iso-timestamp>\n\n` comment-line emission every 10s during silence. Disconnection-and-resumption section rewritten to describe the `interim → interrupted → final` lifecycle (supersedes v1.0 G-10).
- **§3.12 (new)** `POST /api/director/conversation/[id]/resume` — SSE endpoint that re-feeds the interrupted assistant message back to the model and continues the agentic loop. Preserves the cost of every tool call already paid for.
- **§3.13 (new)** `POST /api/cron/director-recovery` — Vercel Cron Job. Marks orphaned agent_jobs `failed` and stalled workflows `paused`. Runs every 60s.
- **§3.14** original `GET /api/documents/[id]/workflows` renumbered from §3.12.
- **§5** new specification gaps documented: G-16 (runtime — SU-39), G-17 (heartbeats — SU-40), G-18 (recovery sweep mandatory — SU-40), G-19 (mid-turn persistence — SU-41), G-20 (UI heartbeat indicator — SU-42). G-10 marked SUPERSEDED.

The amendments preserve every wire-level behaviour from v1.0 except where v1.0 was explicitly wrong (G-10 disconnect = lose work). All v1.0 endpoint shapes carry forward; the two new endpoints are additive. Migration 031 is non-breaking (defaults supplied for the new columns).

**v1.0 — 2026-05-06** Initial Phase 5b API Contract. 12 routes (4 conversation + 8 workflow), 1 migration (031), SSE wire format defined, agentic-loop boundaries established, tool-call audit trail decided (G-7 — reuse `conversation_messages.tool_calls`), workflow auto-accept decided (G-3), conversation summarisation inline (G-8), shared-library dispatch decided (G-9), 12 directors-system invariants enumerated (I-1..I-9 for the executor; tracking 12 in §2.11 covers the broader Director-level invariants), 15 specification gaps surfaced and resolved at draft time (G-1..G-15). Migration 031 covers five concerns: system prompt seed (G-1), `conversation_messages.author_user_id` column (G-2), `conversation_messages` cost columns (G-11), publication add for `workflows` / `workflow_steps` (G-6), and seed of five operational-limit `platform_config` keys per §2.7 (rate limits + agentic-loop iteration cap + summarisation threshold + max workflow steps — H-12-bound, no hardcoded operational values). §2.7 expanded mid-draft to be explicit that ALL operational limits are config-backed, not constants. Phase 5 carve-out items (research tools, document operations as Director tools, workflow scheduling, multi-conversation per document, Director config V2 lifecycle) explicitly listed as deferred. Cross-cutting rules unchanged from Phase 5 except for the new error codes, the new rate-limits (now five config keys), and the SSE wire format. β-scope test target: ~40 cases locally + ~4 cloud smoke — all on Haiku 4.5 per the user's Haiku-everywhere standing direction (reaffirmed 2026-05-06 at Phase 5b startup). Production-default in `director_configs` remains Opus.
