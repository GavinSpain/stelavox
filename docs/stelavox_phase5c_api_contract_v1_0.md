# Stelavox — Phase 5c API Contract
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5c build. Defines the one new API route added in Phase 5c (synthesise streaming), the SSE wire format, the dual agent-job lifecycle, and the runner refactor that splits foreground-streaming from background-batch. Companion to `stelavox_phase5c_test_plan_v1_0.md` and `stelavox_phase5c_build_checklist_v1_0.md`. Source of truth for the SSE event shape, cancellation semantics, the job-lifecycle factoring (`lib/agent/job-lifecycle.ts`), and the workflow-vs-direct dispatch contract. Cross-cutting rules unchanged since Phase 5 / 5b are inherited from the earlier phases' API contracts; only the additions are spelled out here.

**Phase:** 5c — synthesise streaming. The synthesise agent operation gains a streaming wire format: when the user clicks Synthesise in the AgentTab on a leaf node, prose appears progressively in the Tab during generation rather than only at completion. Workflow-dispatched synthesise (steps inside a Director-approved workflow) continues to run as a Phase 5 background job — those jobs do not stream.

**Phase 5c checkpoint criterion** (derived from TA v2.1 §11 Phase 5c row): *"Synthesise prose appears progressively in the AgentTab during generation, not only at completion."* Concretely: (a) the user clicks Synthesise on a leaf node in AgentTab; (b) the AgentTab opens an SSE connection to the new `/api/agent/synthesise/stream` endpoint; (c) the Anthropic stream's text deltas arrive in the AgentTab as they're emitted (typewriter feel); (d) the user can cancel the in-flight stream via the existing AgentTab cancel UI; (e) on stream completion, `agent_jobs.result_prose` and the rest of the result fields are persisted; the existing accept / dismiss UI takes over for review; (f) workflow-dispatched synthesise (the same operation invoked by a Director-approved workflow step) continues to run in the existing background path — unchanged from Phase 5.

**What Phase 5c does NOT ship** (deferred):
- **Streaming for refine, expand, generate-context** — V1.x candidate. The `provider.stream()` primitive added in Phase 5c is operation-agnostic; once V1 is stable, refine prose streaming is the most likely follow-up because long prose refines have similar UX value. Expand and generate-context emit structured JSON (not flowing text), where streaming has lower UX value — those are V2 candidates if at all.
- **Streaming on workflow-dispatched synthesise** — explicitly out of scope. The user is watching the workflow's ExecutionCard, not individual scene prose. Streaming would add wire-shape complexity to the Director's workflow_executor without surfacing in any UI the user is actively reading. V1.x candidate; reuses the same primitive.
- **Mid-stream prompt edits / regeneration** — the user can cancel and re-run, but cannot edit the prompt mid-stream. V2 candidate.
- **Partial-Tiptap rendering** — the streaming UI displays a plain-text typewriter view; the result transitions to full Tiptap rendering only at end-of-stream. V1 simplification — incremental Tiptap ProseMirror operations during streaming are non-trivial and unnecessary for the typewriter UX.
- **Reconnect-with-resume after disconnect** — if the SSE connection drops mid-stream, the client treats it as cancellation. The agent_job row is left in 'running' state until the heartbeat sweep marks it stalled (Phase 5b SU-40 carries forward). Reconnect-with-resume is a V1.x candidate.

**Companion documents:** `stelavox_phase5c_test_plan_v1_0.md`, `stelavox_phase5c_build_checklist_v1_0.md`. Cross-cutting rules unchanged since Phase 5b are inherited from earlier phases' API contracts; only the additions are spelled out here.

---

## 1. Phase Scope

### 1.1 Routes added in Phase 5c

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/agent/synthesise/stream` | Inline-execution SSE endpoint: creates the `agent_jobs` row, opens an Anthropic stream, pipes text deltas to the SSE response, persists the final result at end-of-stream, transitions the job to `completed`. |

**Total: 1 route added in Phase 5c.**

### 1.2 Routes modified in Phase 5c

None. The Phase 1–5b endpoints carry forward unchanged. Notably:

- The Phase 5 `POST /api/agent/jobs` continues to accept synthesise jobs and processes them in the background via `waitUntil(runAgentJob())` exactly as today. This path is what the Director's workflow executor uses for synthesise steps inside an approved workflow. The two paths share the same `lib/agent/job-lifecycle.ts` module (factored out in Build Checklist T-2) but diverge at the LLM-call site.
- The Phase 5 accept / dismiss / cancel endpoints (`/api/agent/jobs/[id]/accept`, `/dismiss`, `/cancel`) are unchanged. A streaming synthesise that completes is reviewed and accepted via the same UI as a background-completed synthesise.

### 1.3 Schema changes in Phase 5c

**None.** Phase 5c is purely a code change. No new tables, no new columns, no new platform_config keys, no realtime publication adds. Migration count remains at 31 (last is Phase 5b's Migration 031).

The streaming wire surface is HTTP/SSE end-to-end — no DB intermediary. Cancellation, heartbeat, and final-state persistence all reuse the existing `agent_jobs` lifecycle.

---

## 2. Cross-cutting rules (Phase 5c additions)

### 2.1 Auth + RLS

Identical to Phase 5. The streaming endpoint runs under the user-bound Supabase client; RLS at the database level enforces org isolation. The endpoint must NOT use service-role to read or modify nodes the caller doesn't own.

The endpoint creates an `agent_jobs` row before opening the stream (Step 1 of §3.1's flow). This INSERT is RLS-checked; an unauthorised user gets a 403 before any LLM call.

### 2.2 SSE wire format — `POST /api/agent/synthesise/stream`

The response is `Content-Type: text/event-stream` with `Cache-Control: no-store` and `Connection: keep-alive`. Events are separated by `\n\n`. Every event is a JSON-encoded object on the `data:` line. The wire shape mirrors the Phase 5b Director SSE format (§2.16 of the Phase 5b API contract) where applicable, with synthesise-specific event types.

**Event types (in chronological order):**

```
event: agent_job_created
data: {
  "agent_job_id": "uuid",
  "operation_type": "synthesise",
  "target_node_id": "uuid",
  "model_id": "claude-sonnet-4-6",
  "started_at": "2026-05-08T12:34:56.789Z"
}
```
Emitted exactly once, immediately after the `agent_jobs` row is INSERTed and the upstream Anthropic `messages.stream()` call is opened. Carries the IDs the client needs to subscribe to subsequent realtime updates (e.g. status transitions) on the same job row.

```
event: text_delta
data: { "delta": "Voss takes the steps to the Calder" }
```
Emitted once per Anthropic SDK text-delta event. Relayed verbatim — no batching, no buffering. The client appends each delta to a local accumulator and renders the typewriter surface.

```
event: heartbeat
data: { "ts": "2026-05-08T12:35:01.234Z" }
```
Emitted every 10 seconds during silence (no `text_delta` in 10s). Defends against intermediate proxies dropping idle connections. Mirrors the Phase 5b Director heartbeat. The client may ignore heartbeats for rendering purposes; their only purpose is keeping the connection alive.

```
event: usage
data: {
  "tokens_input": 1234,
  "tokens_output": 5678,
  "tokens_cache_read": 0,
  "tokens_cache_write": 1234,
  "cost_usd": 0.0234
}
```
Emitted exactly once after the upstream stream completes successfully, immediately before `agent_job_complete`. Surfaces token counts and computed cost.

```
event: agent_job_complete
data: {
  "agent_job_id": "uuid",
  "status": "completed",
  "result_prose": "The full assembled prose body, Tiptap-JSON-stringified.",
  "completed_at": "2026-05-08T12:35:23.456Z"
}
```
Emitted exactly once at end-of-stream. The `result_prose` field is the Tiptap-JSON-stringified body (matches what the existing background runner writes). The client uses this to populate the AgentTab final-result view; subsequent agent-job realtime updates carry the same data on the persisted row.

```
event: error
data: { "error": "<error_code>", "message": "Human-readable message." }
```
Emitted at most once, terminating the stream. Possible error codes:
- `provider_error` — upstream Anthropic SDK error (rate limit, quota, model unavailable).
- `canary_violation` — the canary scanner detected a leak in the model output (see Phase 5 §4.4). The agent_job is marked `failed` with `error_message='canary_leak'` before the event fires.
- `cancelled` — the user cancelled mid-stream (see §2.3); the agent_job is marked `cancelled`.
- `internal_error` — unexpected runtime error; agent_job marked `failed`.

After an `error` event the connection closes. No further events.

```
event: done
data: {}
```
Emitted as the final event of every successful stream, after `agent_job_complete`. The client uses this as a definitive signal that the SSE stream is closing cleanly. No data payload. Mirrors the Phase 5b `done` event.

**Order invariants:**
- `agent_job_created` is always the first event.
- `text_delta` events arrive in the order Anthropic emits them.
- `usage` precedes `agent_job_complete`.
- `agent_job_complete` precedes `done`.
- `heartbeat` may be interleaved between any other events.
- `error` may appear at any point and terminates the stream.

### 2.3 Cancellation semantics

Cancellation is detected via `request.signal.aborted`. The Next.js Edge / Node runtime exposes this when the client closes the SSE connection (browser navigation, `EventSource.close()`, network drop).

On detected abort:
1. The route handler calls `stream.abort()` on the Anthropic SDK stream — this halts further token billing.
2. The route handler UPDATEs `agent_jobs.status='cancelled'`, `error_message='client_disconnect'`, `completed_at=now()`. Whatever partial prose was accumulated is discarded — `result_prose` is left NULL on cancelled jobs.
3. The SSE response is allowed to close naturally (no further events emitted; the client has already disconnected).

The client UI (AgentTab) MUST also support an explicit cancel button. The cancel button calls `EventSource.close()` to trigger the abort path — there is no separate cancel API call. (The existing `POST /api/agent/jobs/[id]/cancel` is for non-streaming jobs and remains available for those.)

**Idempotency:** if the client closes the SSE connection AND immediately POSTs `/api/agent/jobs/[id]/cancel`, the `cancelled` status update is idempotent; the second request returns 200 with the already-cancelled body.

### 2.4 Heartbeat (carry-forward from Phase 5b SU-40)

The agent_job row's `last_heartbeat_at` is updated:
- Once on `agent_job_created` event emission.
- Every 5 seconds during the stream (timer in the route handler; cleared on stream close).
- Once on `agent_job_complete`.

The existing `/api/cron/director-recovery` recovery sweep covers stalled streaming synthesise jobs the same way it covers Phase 5b workflows — if `agent_jobs.last_heartbeat_at` exceeds `agent.heartbeat_timeout_ms` (default 120s) and the row is still in `running`, the sweep marks it `failed` with `error_message='heartbeat_timeout'`.

### 2.5 Errors not surfaced as SSE events

Some errors prevent the SSE stream from opening at all. These return as ordinary HTTP errors with a JSON body:

| Status | Error code | Notes |
|---|---|---|
| 401 | `unauthenticated` | No auth cookie or invalid session. |
| 403 | `forbidden` | RLS denies access to the target node (cross-org / wrong document). |
| 404 | `node_not_found` | Target node not visible to the caller. |
| 409 | `agent_job_in_progress` | Another running agent_job exists for the target node. Same constraint as Phase 5 `POST /api/agent/jobs`. |
| 422 | `validation_failed` | Request body fails Zod validation. |
| 423 | `node_locked` | Target node is locked. (Synthesise is a write op; locked nodes reject writes.) |
| 429 | `rate_limit_exceeded` | The user hit the agent rate limit. |
| 500 | `internal_error` | Server-side exception before the stream opens. |

Once the stream is open, errors flow through the SSE `error` event per §2.2.

### 2.6 Cost tracking

Phase 5's per-job cost tracking carries forward unchanged. The route writes `tokens_input`, `tokens_output`, `tokens_cache_read`, `tokens_cache_write`, and `cost_usd` to the `agent_jobs` row at end-of-stream. The cost is computed via the existing `lib/cost/compute-agent-job-cost.ts` helper using `platform_config.price.anthropic.<model>.*` keys.

Cancelled streams write the partial token counts captured at cancellation time. (Anthropic SDK exposes the running token count via the stream's events.)

---

## 3. Endpoint Specifications

### 3.1 `POST /api/agent/synthesise/stream` — Stream a synthesise (SSE)

**Purpose.** Inline execution of a synthesise agent operation with progressive prose delivery to the caller. Creates the `agent_jobs` row, runs the operation in the request handler, streams text deltas as they arrive from the Anthropic SDK, and persists the final result before closing the stream.

**Request body:**
```json
{
  "node_id": "uuid",
  "profile_id": "uuid?",
  "agent_instruction": "string?"
}
```

| Field | Type | Notes |
|---|---|---|
| `node_id` | UUID, required | The target node. Must be a leaf (per layer-stack — H-15) and unlocked. |
| `profile_id` | UUID, optional | If absent, the system synthesise profile for the node's layer is resolved at dispatch time (same logic as Phase 5b workflow_executor). |
| `agent_instruction` | string, optional, max 2000 chars | Per-job instruction prepended to the agent profile's system prompt. Same shape as Phase 5 `POST /api/agent/jobs`. |

**Headers:**
- `Content-Type: application/json`
- `Accept: text/event-stream`

**Response:** `200 text/event-stream`. Events per §2.2.

**Validation order:**
1. Auth (401).
2. Body parse + Zod validation (422 / 400).
3. Target node exists and is visible (404 / 403 via RLS).
4. Target node is a leaf (422 `not_a_leaf`) and unlocked (423 `node_locked`).
5. No conflicting agent_job for the same node (409 `agent_job_in_progress`).
6. Token-budget gate (Phase 5 H-07) — runs in the route, before the agent_job row is created.
7. agent_jobs INSERT (RLS-checked; service-role used after this point only for non-RLS-relevant updates like cost tracking).
8. Open SSE response and the upstream Anthropic stream concurrently.

**Streaming flow (after validation):**

1. INSERT `agent_jobs` with `status='running'`, `triggered_by='user'`, `started_at=now()`, `target_node_version_at_capture=node.version` (G-3 concurrency gate carry-forward).
2. Emit `agent_job_created` SSE event.
3. Open `provider.stream({...})` against the Anthropic SDK.
4. For each Anthropic `text-delta` event, emit a `text_delta` SSE event verbatim.
5. Maintain a 10-second heartbeat timer; emit `heartbeat` if no `text_delta` has fired in 10s. Reset on every `text_delta`.
6. Maintain a 5-second `last_heartbeat_at` UPDATE timer on the agent_jobs row.
7. Run the canary scanner on every accumulated text-delta buffer; on detection, abort the upstream stream, mark the agent_job `failed` with `error_message='canary_leak'`, emit an `error` SSE event with code `canary_violation`, close.
8. On Anthropic `message_stop`, capture final usage; UPDATE the agent_jobs row with `result_prose` (Tiptap-JSON-stringified), `tokens_*`, `cost_usd`, `status='completed'`, `completed_at=now()`.
9. Emit `usage` SSE event.
10. Emit `agent_job_complete` SSE event.
11. Emit `done` SSE event.
12. Close the SSE response.

**Failure modes inside the stream:**

| Trigger | agent_job final state | SSE event |
|---|---|---|
| Anthropic SDK error | `status='failed'`, `error_message='<provider_error>'` | `error` with code `provider_error` |
| Canary detection | `status='failed'`, `error_message='canary_leak'` | `error` with code `canary_violation` |
| Client disconnect (abort signal) | `status='cancelled'`, `error_message='client_disconnect'` | (none — connection already closed) |
| Heartbeat timeout (recovery sweep) | `status='failed'`, `error_message='heartbeat_timeout'` | (none — out-of-band, after connection drops) |
| Internal exception | `status='failed'`, `error_message='<exception_message>'` | `error` with code `internal_error` |

**Idempotency.** Not idempotent: each POST creates a new agent_job and runs a new LLM call. The `agent_job_in_progress` 409 (validation step 5) prevents duplicate concurrent runs for the same node.

---

## 4. Runner Architecture

### 4.1 Dual lifecycle

Phase 5 had one agent-job lifecycle: `POST /api/agent/jobs` → INSERT → `waitUntil(runAgentJob(jobId))` → background processing → realtime updates surface progress to the UI. The runner ran in the background after the request returned.

Phase 5c introduces a second lifecycle for synthesise specifically: `POST /api/agent/synthesise/stream` → INSERT → run in the request handler → stream deltas → persist at end → close. The synthesise path runs in the foreground.

**Both lifecycles are first-class:**

| Lifecycle | Triggered by | Runs in | Streaming | Surfaces progress via |
|---|---|---|---|---|
| Background (existing) | `POST /api/agent/jobs`, workflow_executor | `waitUntil()` after request returns | No | Realtime on `agent_jobs` (status, tokens, completed_at) |
| Foreground (new) | `POST /api/agent/synthesise/stream` | Request handler (foreground) | Yes (SSE) | SSE events |

The two lifecycles share most of their internal logic — auth, profile resolution, prompt assembly, agent_jobs persistence, accept_agent_job invocation, notifyWorkflowIfStep continuation hook. The fork is at the LLM call site.

### 4.2 Shared module — `lib/agent/job-lifecycle.ts`

The shared logic factored out for both lifecycles:

```typescript
// Pseudocode shape; exact API in Build Checklist T-2.
export async function loadJobContext(jobId: string): Promise<JobContext>
export async function persistFinalResult(jobId: string, result: AgentResult): Promise<void>
export async function notifyWorkflowIfStep(jobId: string): Promise<void>  // existing helper, moved here
```

`runAgentJob` (background, existing) and `runAgentJobInline` (foreground, new) both compose from these. `runAgentJob` retains its current behaviour byte-for-byte after the refactor.

### 4.3 `provider.stream()` — fully implementing the V1 stub

The `LLMProvider.stream()` method has been an unimplemented stub at `lib/llm/providers/anthropic.ts:96` since Phase 5. Phase 5c implements it. Shape:

```typescript
stream(prompt: AssembledPrompt): AsyncIterable<LLMStreamChunk>
```

The returned async iterable yields `LLMStreamChunk` values of types `text`, `usage`, and `message_stop` (no `tool_use_*` types — those are exclusive to `streamWithTools`). The implementation mirrors `streamWithTools` minus the tool-call branch:
- Inject canary token in system prompt
- Apply cache_control: ephemeral on stable system blocks
- Skip `temperature` for Opus 4.7+ (SU-46 carry-forward)
- Scan for canary leak on every text delta
- Emit `text` chunks for each delta
- Emit final `message_stop` chunk with usage

### 4.4 Workflow integration — synthesise-from-workflow stays non-streaming

The Director's workflow_executor at `lib/director/workflow-executor.ts:dispatchAgentJobForStep` is **not modified in Phase 5c**. Workflow-dispatched synthesise steps continue to flow through the existing background path (`runAgentJob` via `waitUntil`). The user is watching the workflow's ExecutionCard, not individual scene prose; streaming would not surface in any UI.

The `lib/agent/runner.ts:runAgentJob` retains its current call to `provider.complete()` for synthesise. When V1.x adds streaming for workflow-dispatched synthesise, the runner can be updated to detect the dispatch path (via `triggered_by`) and choose the call site — but that's not Phase 5c's scope.

### 4.5 SU-48 compatibility

The Phase 5b SU-48 fix (workflow_executor catch-up for async steps) is fully compatible with Phase 5c. The catch-up reads `agent_jobs.status` and applies the result via `accept_agent_job` regardless of whether the job was background or foreground. A foreground-streaming synthesise that completes with `status='completed'` is treated identically to a background-completed one — the catch-up is wire-shape-agnostic.

The only subtlety: a foreground-streaming synthesise dispatched directly by the user (not by a workflow_step) has `triggered_by='user'`. The `notifyWorkflowIfStep` continuation hook detects this and is a no-op. No workflow advance happens. Correct behaviour.

---

## 5. Component Spec amendment pointer

`stelavox_component_specification_v2_8.md` §5.9 (AgentTab) describes the active-state UI for a running agent_job: indeterminate sliding-stripe progress, no token count, completion-only summary. Phase 5c amends §5.9 to add a streaming subsection for synthesise:

- During `running` state for a streaming synthesise, the AgentTab shows a typewriter prose surface in place of the indeterminate progress stripe.
- The surface is read-only Tiptap (or plain-text equivalent — V1 simplification: plain text).
- A small cancel button and "streaming…" indicator appear in the upper-right of the surface.
- On `agent_job_complete`, the surface transitions to the existing accept / dismiss view with the full prose rendered.
- On stream error or cancellation, the surface clears and the AgentTab shows the standard error state.

Component Spec v2.8 → v2.9 absorbs this in Phase 5c close-out.

---

## 6. Resolved gaps + design decisions

### G-1 — Wire format: SSE vs. realtime + chunks table

**Resolution:** SSE.

**Rationale:** SSE is the industry-standard pattern for streaming LLM text (OpenAI, Anthropic, Cursor, Claude.ai, Vercel AI SDK). We already use SSE for the Director (Phase 5b's `/api/director/message`). Reusing the SSE pattern keeps the codebase to one streaming wire shape. The realtime + chunks-table alternative was a Stelavox-specific shortcut that would have introduced a second streaming pattern and a buffer-table architecture that adds no production value once the synthesise completes.

### G-2 — Where does the synthesise actually run: foreground or background?

**Resolution:** Foreground (in the request handler) for direct user-clicks-Synthesise; background (waitUntil) for workflow-dispatched synthesise. Dual lifecycle.

**Rationale:** The user-clicks path needs the LLM call to be in the same process as the SSE response so deltas can be relayed without a buffer intermediary. The workflow path doesn't need streaming — keeping it as today minimises change to the Phase 5b workflow_executor.

### G-3 — How do we cancel the upstream Anthropic stream?

**Resolution:** Listen for the request's abort signal; on abort, call `stream.abort()` on the Anthropic SDK stream object.

**Rationale:** Anthropic's SDK exposes an `.abort()` method on the stream object (the same primitive used internally by `streamWithTools`). The Next.js Node.js runtime fires an abort on the request signal when the client closes the SSE connection. This is the canonical Web Fetch / Streams API pattern.

### G-4 — What about partial-Tiptap rendering during stream?

**Resolution:** V1 ships a plain-text typewriter surface. Tiptap renders only at end-of-stream when the full Tiptap-JSON body lands.

**Rationale:** Incremental Tiptap edits during streaming would require translating each text delta into a ProseMirror transaction, which is non-trivial (paragraph boundaries, character entities, the editor's internal selection state). Plain-text typewriter delivers ~95% of the UX value with a fraction of the complexity. The transition to Tiptap at end-of-stream takes a single render.

### G-5 — Reconnect-with-resume after disconnect?

**Resolution:** No reconnect. If the SSE connection drops mid-stream, the client treats it as cancellation. The agent_job is left in `running` until the heartbeat sweep marks it stalled.

**Rationale:** True resume-from-position would require either (a) buffering deltas server-side until the client reconnects (memory pressure, stale-connection handling) or (b) restarting the LLM call from scratch and replaying earlier deltas (token cost + non-determinism). Neither is worth V1 cost. Cancel-and-restart on disconnect is the V1 default.

### G-6 — Should background-dispatched synthesise stream too?

**Resolution:** No, V1.x candidate. Workflow-dispatched synthesise stays non-streaming. Carved out per §1.3.

### G-7 — Refine prose streaming?

**Resolution:** V1.x candidate. The `provider.stream()` primitive added in Phase 5c is operation-agnostic; once V1 is stable and the streaming UX is validated for synthesise, refine prose streaming can ride on the same primitive.

---

## 7. Open Questions

None at the time of v1.0. All architectural decisions are locked above.

---

## 8. Changelog

**v1.0 — 2026-05-08** Initial Phase 5c API Contract. Covers the synthesise streaming wire format (SSE), the dual agent-job lifecycle (foreground for user-dispatched synthesise; background for everything else), the runner refactor (shared `lib/agent/job-lifecycle.ts` module), the `provider.stream()` implementation that fills the V1 stub, and the cancellation / heartbeat / error semantics. No schema changes, no migrations, no new platform_config keys. One new endpoint: `POST /api/agent/synthesise/stream`. Resolves seven gaps (G-1 through G-7) — the most important being the SSE-vs-realtime wire choice (locked: SSE) and the foreground-vs-background lifecycle split (locked: dual). Out of scope for V1: refine streaming, expand streaming, generate-context streaming, workflow-dispatched synthesise streaming, mid-stream prompt edits, partial-Tiptap rendering, reconnect-with-resume.
