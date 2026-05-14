# Stelavox V1.x-B.2 — Tier-B Build Checklist
## Traffic engineering + executor refactor + push-model triggers + agent runner BYOK + Tier-A consolidation
## Version 1.0

> **Status: DRAFT for kickoff.** Locked at outline approval 2026-05-15. Body authored against the design decisions captured in `docs/sessions/v1x_b_2_design_decisions_2026-05-15.md` (companion session record) and the locked architectural answers to the four design questions (Q1 four-way split, Q2 push-model = Postgres completion-trigger cascade, Q3 per-user buckets = database-backed lazy-refill, Q4 Tier-A consolidation in single pass at end).

---

## §1 — Scope and goals

V1.x-B.2 is the largest single phase of the V1.x roadmap. It closes out the Director execution-model rework that began with V1.x-A (Brief substrate) and V1.x-B.1.1 (scheduler primitives) by bringing the four locked traffic-engineering subsystems into production:

1. **Per-iteration Director-turn decomposition** — every individual LLM call the Director makes during a conversation becomes a scheduler-dispatched `agent_jobs` row. The current 943-line `lib/director/executor.ts` (which holds a multi-iteration agentic loop in one long-lived function) is rewritten so each iteration is a self-contained job with its own dispatch, capacity check, runner invocation, and crash-recovery boundary.
2. **Weighted Fair Queueing (Virtual Finish Time variant)** across the four traffic classes (1 interactive, 2 author-foreground, 3 background batch, 4 scheduled+parked) with per-user token buckets and Class 1 reserved concurrent-connection slots.
3. **batched_24h execution intent** routing eligible jobs through Anthropic's Batch API (50% discount, ≤24h SLA) as a user-elected option.
4. **Push-model stage triggers** so the completion of one Brief stage's workflow auto-fires a `director_iteration` job to plan the next stage's workflow — replacing V1.x-B.1.1's pull-model (user re-engagement required).

Three additional scope items ride along because they are entangled with the executor refactor:

5. **Agent runner BYOK routing** — `lib/agent/runner.ts` is extended to use `ByokProvider` when the user has a BYOK key, mirroring the Director-route changes shipped in V1.x-B.1.2.
6. **Stop button** — first-class user action surfaced in `DirectorPanel` and `SchedulerPanel` that halts an in-flight Director turn or workflow with proper cascade semantics.
7. **Tier-A spec consolidation** — single-pass bumps of Director Architecture (v2.0 → v2.2), Technical Architecture (v2.3 → v2.4), Component Spec (v2.10 → v2.11), Product Spec (v1.9 → v1.10), Agent Profile Library (v1.3 → v1.4), and CLAUDE.md (v1.28 → v1.29) absorbing all changes from V1.x-B.1.1, V1.x-B.1.2, and V1.x-B.2 in lockstep.

A cross-cutting metrics-collection layer is woven through sub-phases B.2.1, B.2.2, and B.2.3 so V1.x-E (admin dashboard) ships against pre-existing data instead of needing backend retrofits.

### What V1.x-B.2 does **not** ship

- **BYOK plan-based admission gating** — V1.x-C delivers per-org plan-gated BYOK per the locked Option A decision (`project_v1x_c_byok_option_a.md`). V1.x-B.2 leaves the per-user `user_anthropic_keys` table in place (deprecation in V1.x-C).
- **Cost meter and pre-pay hard cap** — V1.x-C.
- **Admin dashboard visualisation surfaces** — V1.x-E. (B.2 ships the data; E ships the views.)
- **Multi-document Director, per-model prompts, supervisory agent, MCP, rollback** — all V2 backlog.

### Sequencing within the V1.x roadmap

Locked 2026-05-14: V1.x-B.2 → B.3 → C → D → E → F → user-driven launch test. B.2 is the largest remaining single phase; realistic estimate is **5–7 sessions** including the Tier-A consolidation pass.

---

## §2 — Sub-phase split

Four sub-phases. Each has its own commit point, but **B.2.4 holds the merge to master** — the sub-phases ship in sequence on the V1.x-B.2 worktree branch, and only the consolidated whole merges out. This is by design: the executor refactor (B.2.1) and the WFQ dispatcher (B.2.2) are deeply coupled, and intermediate states are not deployable.

| Sub-phase | Scope | Sessions | Dependencies |
|---|---|---|---|
| **B.2.1** | Executor refactor (per-iteration decomposition); `lib/scheduler/dispatcher.ts`; `director_iteration` operation type wiring; Stop button (cascade + UI); failure taxonomy classifier; metrics column additions on `agent_jobs`. | 2 | None (V1.x-B.1.1 substrate sufficient) |
| **B.2.2** | WFQ (VFT algorithm); `user_throttle_buckets` table + lazy refill; `wfq_state` table; Class 1 reserved-slot counter; reservation TTL sweep; `dispatcher_tick_samples` + `route_capacity_samples` tables. | 1–2 | B.2.1 (dispatcher exists) |
| **B.2.3** | `agent_jobs.execution_intent` ('immediate' \| 'batched_24h') + Batch API integration + batch-poller cron; agent runner BYOK routing extension; push-model stage triggers (completion-trigger cascade SQL); `failure_taxonomy_samples` table. | 1–2 | B.2.1 + B.2.2 (full dispatcher) |
| **B.2.4** | Tier-A spec consolidation (six docs); `metrics_minute_buckets` rollup pg_cron; end-to-end integration test (multi-Brief, multi-class, BYOK + platform mixed, batched + immediate mixed, push-model end-to-end); Test Report; merge to master. | 1 | B.2.1 + B.2.2 + B.2.3 complete |

The ordering matters: B.2.1 builds the dispatcher with naive single-class semantics first (dispatcher claims any eligible ticket regardless of class) so the executor refactor can be tested end-to-end without WFQ complexity in the way. B.2.2 then layers the fairness mechanism on top of a known-working dispatcher.

---

## §3 — B.2.1 — Executor refactor + dispatcher + Stop

### §3.1 — Goals

Rewrite `lib/director/executor.ts` (943 lines) so each iteration of the agentic loop is a self-contained `agent_jobs` row of `operation_type='director_iteration'`. Build the dispatcher as a real piece of software (`lib/scheduler/dispatcher.ts`) that picks tickets, checks dependencies, hands off to the appropriate runner, and writes lifecycle stamps. Land the Stop button as a first-class user action with proper cascade semantics. Add the per-ticket lifecycle metric columns to `agent_jobs`.

This sub-phase is the highest-risk single change of V1.x because it rewrites the heart of the Director system. Quality is enforced by extensive test coverage (§10) rather than by a parallel-build/cutover-flag pattern (we are pre-launch with git backups).

### §3.2 — Tasks

#### 3.2.1 — Migrations (105–110)

- **M-105 — `agent_jobs_metric_columns_and_director_iteration_type`**:
  Add columns to `agent_jobs`:
  - `queued_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `dispatched_at TIMESTAMPTZ NULL`
  - `completed_at TIMESTAMPTZ NULL`
  - `crashed_at TIMESTAMPTZ NULL`
  - `actual_input_tokens INTEGER NULL`
  - `actual_output_tokens INTEGER NULL`
  - `cost_credits NUMERIC(20,8) NULL`
  - `dispatcher_skips_count INTEGER NOT NULL DEFAULT 0`
  - `dependency_wait_ms INTEGER NULL`
  - `bucket_wait_ms INTEGER NULL`
  - `route TEXT NULL` (e.g., `'platform'`, `'byok:<user_id>'`)
  - `traffic_class SMALLINT NOT NULL DEFAULT 3` (defaults to background; explicit at insert for everything else)
  - `wfq_vft_at_dispatch NUMERIC(20,6) NULL` (populated by B.2.2; nullable at B.2.1)
  - `failure_class CHAR(1) NULL` (A/B/C/D/E per V2 §10; populated on completion if status='failed')
  - `iteration_number INTEGER NULL` (for `director_iteration`: 1-based ordinal within a Director turn)
  - `director_turn_id UUID NULL` (groups consecutive `director_iteration` rows belonging to one user-facing Director turn)
  - `parent_iteration_id UUID NULL REFERENCES agent_jobs(id)` (back-pointer to the previous iteration in this turn; NULL for iteration 1)

  Extend the `operation_type` enum / check constraint with `'director_iteration'`.

  Indexes: `(traffic_class, queued_at)`, `(director_turn_id, iteration_number)`, `(queue_status, queued_at) WHERE queue_status = 'queued'`.

- **M-106 — `agent_jobs_status_machine_v2`**:
  Replace the existing `queue_status` enum with the V1.x-B.2 set:
  `'queued'` → `'dispatched'` → `'running'` → `'completed'` | `'failed'` | `'crashed'` | `'cancelled'` | `'skipped'`.
  Old `'skipped_no_capacity'` collapses into `'queued'` with `dispatcher_skips_count++` (skipped tickets remain queued for the next tick, not removed). Migrate any in-flight rows (none expected; V1.x-B.1.1 leaves the queue empty post-deploy).

- **M-107 — `director_iterations_to_agent_jobs_migration`**:
  Drop the V1.x-B.1.1 `director_iterations` standalone table (its rows were a holding pattern for the iteration-state-store before the executor refactor landed). The executor's iteration state moves entirely to `agent_jobs` (status + parent_iteration_id + iteration_state JSONB column).
  Add `agent_jobs.iteration_state JSONB NULL` for `director_iteration` rows (carries assistant message accumulator, tool_use blocks pending tool_result, partial text per V2 §8.1a).

- **M-108 — `stop_requests_table`**:
  ```sql
  CREATE TABLE stop_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('director_turn', 'workflow', 'brief')),
    target_id UUID NOT NULL,
    reason TEXT NULL,
    cascade_count INTEGER NULL,
    completed_at TIMESTAMPTZ NULL
  );
  CREATE INDEX stop_requests_active_idx ON stop_requests(target_kind, target_id) WHERE completed_at IS NULL;
  ```
  A Stop request is a durable record. The dispatcher consults it at every tick (cheap predicate join) and refuses to dispatch any ticket whose ancestry includes a still-active stop_request. In-flight tickets are signalled to abort cooperatively (runner checks the stop predicate before each LLM call and on response receipt).

- **M-109 — `agent_jobs_completion_trigger_v2`**:
  Replace the V1.x-B.1.1 step→workflow→stage→brief completion trigger with the V1.x-B.2 version. Two semantic changes:
  1. The trigger now fires on `agent_jobs.queue_status = 'completed'` (was `agent_jobs.status = 'completed'`); status reflects business outcome, queue_status reflects queue lifecycle.
  2. The trigger emits a `pg_notify('scheduler_completion', json_payload)` so the dispatcher can react in <100ms instead of waiting for the next pg_cron tick. (B.2.1 wires the LISTEN; B.2.3 push-model wires the auto-insert of the next director_iteration into the same trigger function.)

- **M-110 — `failure_taxonomy_helpers`**:
  Add `classify_failure(operation_type TEXT, error_code TEXT, http_status INTEGER, retry_count INTEGER) RETURNS CHAR(1)` SECURITY DEFINER function. Encodes the V2 §10 five-class taxonomy:
  - **A (transient)**: HTTP 429, 502, 503, 504, network reset, body-parse failure with idempotent op → auto-retry up to N times (N = `agent.failure_class_a_max_retries`, default 3).
  - **B (interrupted)**: process crash mid-call (recovery sweep finds expired reservation), Stop request, manual cancellation → resumable; surface to user.
  - **C (capacity)**: Anthropic concurrent-connections limit, our own bucket exhaustion that exceeds requeue patience → throttled; the dispatcher self-rejects and re-queues, no user surface unless wait exceeds threshold.
  - **D (validation)**: tool input invalid, model returned malformed JSON, canary leak detected, injection-scanner trip → fail hard, surface to user with diagnostic.
  - **E (hard system)**: missing config, broken DB constraint, missing migration, missing agent profile → fail hard, requires operator intervention.

#### 3.2.2 — `lib/scheduler/dispatcher.ts` (new)

Core dispatcher loop. Single source of truth for "which ticket runs next."

```typescript
export interface DispatcherTick {
  tickId: string;
  startedAt: Date;
  ticketsConsidered: number;
  ticketsDispatched: number;
  ticketsSkippedNoCapacity: number;
  ticketsSkippedNoDependency: number;
  ticketsSkippedWrongRoute: number;
  ticketsSkippedStopRequested: number;
  durationMs: number;
}

export async function runDispatcherTick(): Promise<DispatcherTick> {
  // 1. Begin transaction.
  // 2. SELECT candidate tickets via WFQ pick (B.2.1: naive FIFO over class 1 first then 2 then 3 then 4; B.2.2 replaces with VFT).
  // 3. For each candidate, check in order:
  //    a. dependencyResolved(ticket) — depends_on_step_id is 'completed'?
  //    b. notStopRequested(ticket) — no active stop_request covers this ticket's ancestry?
  //    c. capacityAvailable(ticket) — bucket has tokens (B.2.2); class 1 reserved slot free if class=1; concurrent-connections under cap.
  //    d. routeAvailable(ticket) — BYOK Edge Function reachable for BYOK route?
  // 4. First candidate that passes all four → claim it (UPDATE queue_status='dispatched', dispatched_at=now, route=...).
  // 5. Hand off to runRunner(ticket) (async, fire-and-forget; runner writes back its own completion).
  // 6. Continue picking until either no more eligible candidates or per-tick cap reached.
  // 7. Commit.
  // 8. INSERT INTO dispatcher_tick_samples (...) for the operational dashboard.
}
```

Trigger for the tick: pg_cron every 1 second (configurable via `agent.dispatcher_tick_interval_ms`, default 1000) **plus** `LISTEN scheduler_completion` channel (instant reaction to completions). The two paths are idempotent — if both fire concurrently, the FOR UPDATE SKIP LOCKED claim ensures no double-dispatch.

#### 3.2.3 — `lib/director/executor.ts` rewrite

Full rewrite. The current 943-line monolith holds the agentic loop in one long-lived async function. The new version is a per-iteration runner — each invocation handles exactly one iteration:

- **Entry**: receives an `agent_jobs` row of `operation_type='director_iteration'`. Loads `iteration_state` from the row.
- **Build messages array**: from `iteration_state.assistant_messages` + the tool_results from `iteration_state.pending_tool_results`.
- **One LLM call** through `getProvider(...)`.
- **Parse response**: text, tool_use blocks, optional `<workflow_proposal>` / `<brief_proposal>` / `<profile_amendment_proposal>` / `<brief_cancellation_proposal>` end-of-turn blocks.
- **Persist iteration outcome**: write text to `conversation_messages`, write `iteration_state` updated with this iteration's assistant message + parsed tool_use list.
- **Decide what's next**:
  - If model returned `tool_use` → execute the read tools synchronously inside this runner (cheap, no LLM); for write tools, build the proposal artifact and emit; then **insert the next director_iteration row** with `parent_iteration_id = current.id`, `iteration_number = current + 1`, `iteration_state` carrying the tool_results-pending list. The completion trigger and dispatcher pick it up automatically.
  - If model returned a final response (no tool_use) → mark the turn complete, set `agent_jobs.queue_status='completed'`, mark the parent `director_turns` row complete (new lightweight table or a status column on conversations? — see §3.2.4).
  - If max iterations reached (`agent.director_max_iterations_per_turn`, default 30) → mark failed Class D with diagnostic.
- **Stop check**: at every iteration boundary (entry and exit), check if a stop_request covers this turn. If so, gracefully complete with `queue_status='cancelled'` and write a final `[SYSTEM EVENT: turn cancelled by user]` message to the conversation.

Iteration state JSONB shape (versioned with a `__schema_version` field for forward compatibility):
```json
{
  "__schema_version": 1,
  "assistant_messages": [
    {"role": "assistant", "content": [{"type": "text", "text": "..."}, {"type": "tool_use", "id": "...", "name": "...", "input": {...}}]}
  ],
  "pending_tool_results": [
    {"tool_use_id": "...", "content": "..."}
  ],
  "user_message": {...},
  "system_prompt_version": "v1.8",
  "model": "claude-opus-4-7"
}
```

#### 3.2.4 — `director_turns` table (new in M-105 or split)

A Director turn is the unit of user-perceived interaction (one message in, response out). Today it's implicit (a `conversation_messages` row pair). Post-B.2.1 it's an explicit row that owns the Director's iteration sequence.

```sql
CREATE TABLE director_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES director_conversations(id),
  user_message_id UUID NULL REFERENCES conversation_messages(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled', 'failed')),
  iteration_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_credits NUMERIC(20,8) NOT NULL DEFAULT 0
);
```

Each `director_iteration` agent_job has `director_turn_id` referring here. On final iteration completion, the runner rolls up totals and marks the turn completed.

#### 3.2.5 — Stop button UI

- **`components/director/StopButton.tsx` (new)** — surfaces in `DirectorPanel` header when an in-progress turn is active. Click → confirm dialog (one click; "Stop the Director?") → POST `/api/director/turns/[turnId]/stop`. Button uses destructive token (NOT verdigris — Stop is destructive, matches Delete from BYOK panel).
- **`components/scheduler/SchedulerPanel.tsx` extension** — Stop control on each in-flight workflow / Brief / Director turn. Same destructive token. Shows cascade preview ("Stopping this workflow will cancel 7 queued steps").
- **API route `app/api/director/turns/[turnId]/stop/route.ts` (new)** — inserts into `stop_requests`, returns cascade count.
- **API route `app/api/scheduler/stop/route.ts` (new)** — generic stop endpoint accepting `{target_kind, target_id, reason}`.

The dispatcher handles the actual cascade: at the next tick, any ticket whose ancestry includes an active stop_request is marked `cancelled` (queued tickets) or signalled to abort cooperatively (running tickets). Runner checks `stopRequestCovers(ticket)` immediately before its LLM call.

#### 3.2.6 — Failure-class classifier

`lib/scheduler/failure-classifier.ts` (new) — wraps the M-110 SQL function in TypeScript. Every runner that catches an error calls `classifyFailure(...)` and writes the result to `agent_jobs.failure_class`. The metrics layer (B.2.3) reads this column for the failure-taxonomy samples table.

### §3.3 — Files modified or created

- **NEW** `lib/scheduler/dispatcher.ts`
- **NEW** `lib/scheduler/failure-classifier.ts`
- **NEW** `lib/scheduler/listener.ts` (LISTEN/NOTIFY pg_notify wiring)
- **REWRITE** `lib/director/executor.ts` (943 → ~400 lines per-iteration form)
- **NEW** `lib/director/iteration-runner.ts` (extracted from executor; the per-iteration runtime)
- **MODIFY** `lib/director/conversation-context.ts` (now reads `director_turns` for grouping; emits per-turn rolling-window slice)
- **NEW** `components/director/StopButton.tsx`
- **MODIFY** `components/director/DirectorPanel.tsx` (mount StopButton when turn in progress)
- **MODIFY** `components/scheduler/SchedulerPanel.tsx` (add Stop controls per row)
- **NEW** `app/api/director/turns/[turnId]/stop/route.ts`
- **NEW** `app/api/scheduler/stop/route.ts`
- **MODIFY** `lib/director/types.ts` (DirectorTurn, IterationState types)
- **MIGRATIONS** 105–110

### §3.4 — Acceptance criteria

- All existing V1.x-A.1 + V1.x-B.1.1 Playwright tests still pass (no regressions in Brief / Profile / single-stage flows).
- A new Director turn with 3 model-driven iterations creates exactly 3 `agent_jobs` rows of `operation_type='director_iteration'` with sequential `iteration_number` and chained `parent_iteration_id`.
- Stopping a turn mid-iteration sets `agent_jobs.queue_status='cancelled'` on the in-flight iteration, cancels any queued descendants, and writes a `[SYSTEM EVENT: turn cancelled]` message.
- Killing the dev server mid-iteration leaves the iteration in `queue_status='dispatched'`; recovery sweep (already in V1.x-B.1.1) reclassifies it to `crashed` after TTL; classifier marks it Class B; user sees "Director was interrupted; resume?" surface (deferred to B.2.4 polish — for B.2.1 a console message is sufficient).
- Dispatcher tick samples populate `dispatcher_tick_samples` table on every tick.
- All five failure classes have been triggered in test and correctly classified.

---

## §4 — B.2.2 — WFQ (Virtual Finish Time) + per-user buckets + Class 1 reserved slots

### §4.1 — Goals

Replace the B.2.1 naive class-priority dispatcher with a true Weighted Fair Queueing implementation using the Virtual Finish Time algorithm. Add per-user (and 'platform') token buckets with lazy refill. Add a Class 1 reserved-slot counter so interactive Director iterations never starve behind a flood of background work. Add metrics tables for dispatcher ticks and route capacity.

### §4.2 — Tasks

#### 4.2.1 — Migrations (111–116)

- **M-111 — `wfq_state_table`**:
  ```sql
  CREATE TABLE wfq_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
    virtual_clock NUMERIC(20,6) NOT NULL DEFAULT 0,
    class_1_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
    class_2_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
    class_3_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
    class_4_last_vft NUMERIC(20,6) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  INSERT INTO wfq_state (id) VALUES (1);
  ```
  Single-row table holding the global VFT state. FOR UPDATE on every dispatcher tick that changes class state. Concurrency safe.

- **M-112 — `user_throttle_buckets_table`**:
  ```sql
  CREATE TABLE user_throttle_buckets (
    pool_key TEXT PRIMARY KEY,  -- 'platform' OR 'byok:<user_id>'
    bucket_size INTEGER NOT NULL,
    refill_rate NUMERIC(20,6) NOT NULL,  -- tokens per second
    current_tokens NUMERIC(20,6) NOT NULL,
    last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
  Default 'platform' row inserted by M-112 with bucket_size + refill_rate sourced from new platform_config keys (next migration). BYOK rows are inserted on first dispatch for that user (UPSERT in the dispatcher).

- **M-113 — `class_1_reserved_slots_counter`**:
  ```sql
  CREATE TABLE class_1_reserved_slots (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    total_slots INTEGER NOT NULL,
    in_use INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO class_1_reserved_slots (id, total_slots) VALUES (1, 3);  -- default; configurable
  ```
  Connection-counter (concurrent calls), distinct from token-bucket. Class 1 tickets dispatch only if `(in_use < total_slots)` OR `(non-class-1-concurrent-cap not exhausted)`. The reserved slot is incremented at dispatch and decremented at completion or crash recovery.

- **M-114 — `platform_config_v1xb2_keys`**:
  Insert the configuration knobs:
  - `agent.wfq_class_weights` = `{"1": 50, "2": 25, "3": 20, "4": 5}` (JSONB)
  - `agent.platform_bucket_size_tokens` = `200000` (integer; tune per Anthropic tier)
  - `agent.platform_bucket_refill_per_sec` = `666.67` (numeric; ≈40k tokens/min default)
  - `agent.byok_bucket_size_tokens` = `100000` (per-user default; user can have per-user override row)
  - `agent.byok_bucket_refill_per_sec` = `333.33` (≈20k/min default)
  - `agent.class_1_reserved_slots_total` = `3`
  - `agent.class_1_max_concurrent_total` = `5` (reserved + extra grab if non-class-1 hasn't taken everything)
  - `agent.dispatcher_tick_interval_ms` = `1000`
  - `agent.dispatcher_max_per_tick` = `20` (max claims per tick to keep transactions short)
  - `agent.failure_class_a_max_retries` = `3`
  - `agent.reservation_ttl_seconds` = `300` (5 min; carries over from V1.x-B.1.1)
  - `agent.aging_promotion_ms` = `60000` (a queued ticket waiting longer than this gets a one-class promotion; prevents class-4 starvation in pathological loads)

  All new keys land with `value_type` populated.

- **M-115 — `dispatcher_tick_samples_table`**:
  ```sql
  CREATE TABLE dispatcher_tick_samples (
    id BIGSERIAL PRIMARY KEY,
    tick_started_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL,
    tickets_considered INTEGER NOT NULL,
    tickets_dispatched INTEGER NOT NULL,
    tickets_skipped_no_capacity INTEGER NOT NULL,
    tickets_skipped_no_dependency INTEGER NOT NULL,
    tickets_skipped_wrong_route INTEGER NOT NULL,
    tickets_skipped_stop_requested INTEGER NOT NULL,
    queue_depth_class_1 INTEGER NOT NULL,
    queue_depth_class_2 INTEGER NOT NULL,
    queue_depth_class_3 INTEGER NOT NULL,
    queue_depth_class_4 INTEGER NOT NULL,
    virtual_clock NUMERIC(20,6) NOT NULL,
    class_1_reserved_slots_in_use INTEGER NOT NULL,
    active_throttle_reservations_count INTEGER NOT NULL
  );
  CREATE INDEX dispatcher_tick_samples_time_idx ON dispatcher_tick_samples(tick_started_at DESC);
  ```
  Dispatcher writes one row per tick. Retention: 7 days raw (purge cron job in B.2.4); rolled into `metrics_minute_buckets` by B.2.4's pg_cron rollup.

- **M-116 — `route_capacity_samples_table`**:
  ```sql
  CREATE TABLE route_capacity_samples (
    id BIGSERIAL PRIMARY KEY,
    sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    pool_key TEXT NOT NULL,
    current_tokens NUMERIC(20,6) NOT NULL,
    bucket_size INTEGER NOT NULL,
    refill_rate NUMERIC(20,6) NOT NULL,
    active_concurrent_calls INTEGER NOT NULL
  );
  CREATE INDEX route_capacity_samples_pool_time_idx ON route_capacity_samples(pool_key, sampled_at DESC);
  ```
  pg_cron writes one row per pool per minute (or on bucket exhaustion event, whichever comes first).

#### 4.2.2 — VFT algorithm (`lib/scheduler/wfq.ts` new)

```typescript
/**
 * Pick the next eligible ticket using Virtual Finish Time.
 *
 * For each non-empty class, compute the VFT of the head-of-queue ticket:
 *   ticketCost = ticket.estimated_input_tokens + ticket.estimated_output_tokens
 *   classWeight = config.wfq_class_weights[ticket.traffic_class]
 *   classLastVft = wfq_state.class_N_last_vft
 *   ticketVft = max(classLastVft, virtual_clock) + (ticketCost / classWeight)
 *
 * Pick the ticket with the smallest ticketVft. Update wfq_state:
 *   wfq_state.class_N_last_vft = ticketVft
 *   wfq_state.virtual_clock = ticketVft  (advance to the dispatched ticket's finish)
 *
 * Aging promotion: any ticket queued > agent.aging_promotion_ms gets effective
 * traffic_class = max(1, traffic_class - 1) for the VFT calc. (Persistent class
 * does not change; promotion is dynamic per-tick.)
 */
export async function pickNextTicket(tx: Transaction): Promise<AgentJob | null> { ... }
```

Class 1 reserved slot integration: if the picked ticket is Class 1, atomically claim a reserved slot (or decrement non-class-1 concurrent budget if reserved is full). If neither has room, skip and try the next-smallest VFT.

#### 4.2.3 — Per-user bucket interaction (`lib/scheduler/buckets.ts` new)

Implements the claim → reserve → consume → reconcile → recover lifecycle:

```typescript
// Called by dispatcher, inside the SELECT FOR UPDATE on the bucket row.
export async function checkAndReserve(
  tx: Transaction,
  poolKey: string,
  estimatedTokens: number,
  agentJobId: string,
): Promise<{ reserved: true } | { reserved: false; reason: 'insufficient_tokens' }> {
  const bucket = await tx.selectForUpdate('user_throttle_buckets', { pool_key: poolKey });
  if (!bucket) await upsertDefaultBucket(tx, poolKey); // auto-create on first use

  const refilled = lazyRefill(bucket);
  if (refilled < estimatedTokens) return { reserved: false, reason: 'insufficient_tokens' };

  await tx.update('user_throttle_buckets', { pool_key: poolKey }, {
    current_tokens: refilled - estimatedTokens,
    last_refill_at: new Date(),
  });
  await tx.insert('throttle_reservations', {
    pool_key: poolKey,
    agent_job_id: agentJobId,
    estimated_tokens: estimatedTokens,
    expires_at: new Date(Date.now() + reservationTtlMs),
  });
  return { reserved: true };
}

// Called by runner after LLM call returns.
export async function reconcile(
  poolKey: string,
  agentJobId: string,
  actualTokens: number,
): Promise<void> {
  // delta = estimated - actual; refund (or further deduct) the difference.
  // Delete the reservation row.
}

// Called by recovery sweep (inherits from V1.x-B.1.1).
export async function refundExpired(): Promise<number> {
  // Find expired reservations, refund their estimated_tokens to the bucket.
}
```

Lazy refill formula:
```typescript
function lazyRefill(bucket: UserThrottleBucket): number {
  const elapsedSec = (Date.now() - bucket.last_refill_at.getTime()) / 1000;
  return Math.min(bucket.bucket_size, bucket.current_tokens + elapsedSec * bucket.refill_rate);
}
```

#### 4.2.4 — Dispatcher integration

`dispatcher.ts` (built in B.2.1) now calls `wfq.pickNextTicket(tx)` instead of FIFO. After picking, it calls `buckets.checkAndReserve(tx, ticket.pool_key, ticket.estimated_tokens, ticket.id)`. If reservation fails, the ticket gets `dispatcher_skips_count++` and the dispatcher tries the next-smallest VFT. If reservation succeeds, the dispatcher writes `wfq_vft_at_dispatch` to the ticket and proceeds with handoff.

#### 4.2.5 — Class 1 reserved slot management

Helper `lib/scheduler/reserved-slots.ts`:
```typescript
export async function claimClass1Slot(tx: Transaction): Promise<'reserved' | 'overflow' | 'denied'> {
  const row = await tx.selectForUpdate('class_1_reserved_slots', { id: 1 });
  if (row.in_use < row.total_slots) {
    await tx.update('class_1_reserved_slots', { id: 1 }, { in_use: row.in_use + 1 });
    return 'reserved';
  }
  // Try overflow (use a non-class-1 slot if non-class-1 hasn't filled its cap)
  const totalConcurrent = await countActiveCalls(tx);
  if (totalConcurrent < class1MaxConcurrentTotal) {
    return 'overflow';
  }
  return 'denied';
}

export async function releaseClass1Slot(tx: Transaction, was: 'reserved' | 'overflow'): Promise<void> { ... }
```

Release happens at runner completion or recovery sweep.

### §4.3 — Files modified or created

- **NEW** `lib/scheduler/wfq.ts`
- **NEW** `lib/scheduler/buckets.ts`
- **NEW** `lib/scheduler/reserved-slots.ts`
- **NEW** `lib/scheduler/metrics-samplers.ts` (writes dispatcher_tick_samples + route_capacity_samples)
- **MODIFY** `lib/scheduler/dispatcher.ts` (B.2.1's naive picker → calls wfq.pickNextTicket)
- **MIGRATIONS** 111–116

### §4.4 — Acceptance criteria

- VFT picks correctly under synthetic load: 100 tickets each at class 1/2/3/4 with uniform size → dispatch ratio approximates 50/25/20/5 within 5% over a 1-minute window.
- VFT picks correctly under non-uniform load: class 1 has 30k-token tickets, class 3 has 3k-token tickets → consumed-token ratio approximates configured weights, not dispatch-count ratio.
- Bucket exhaustion: when a user's BYOK bucket hits zero, their tickets are skipped (not failed) and re-dispatched on next tick after refill.
- Reservation TTL sweep refunds tokens within 1 minute of TTL expiry.
- Class 1 reserved slots are honoured: with 3 slots configured and 5 class-1 tickets queued, exactly 3 dispatch immediately; 4th and 5th wait for completion (overflow only if non-class-1 has not consumed its cap).
- Aging promotion: a class 4 ticket queued > 60s gets promoted to class 3 priority and dispatches before fresh class-4 tickets.
- Dispatcher tick samples populate continuously; route capacity samples populate once per minute per active pool.
- No double-spend: 100 concurrent dispatcher invocations attempting to reserve from the same bucket converge on bucket_size, never overdraw beyond 1 reservation's worth.

---

## §5 — B.2.3 — batched_24h + agent runner BYOK + push-model triggers

### §5.1 — Goals

Three independent capabilities that share the same release sub-phase because each is small and they're all entangled with the dispatcher work from B.2.1/B.2.2:

1. **batched_24h**: route eligible jobs through Anthropic's Batch API for the 50% discount.
2. **Agent runner BYOK**: extend `lib/agent/runner.ts` to use `ByokProvider` (mirrors V1.x-B.1.2's Director-route changes).
3. **Push-model stage triggers**: the completion-trigger cascade SQL that auto-fires the next stage's planning Director iteration without user re-engagement.

### §5.2 — Tasks

#### 5.2.1 — Migrations (117–122)

- **M-117 — `agent_jobs_execution_intent_column`**:
  ```sql
  ALTER TABLE agent_jobs ADD COLUMN execution_intent TEXT NOT NULL DEFAULT 'immediate'
    CHECK (execution_intent IN ('immediate', 'batched_24h'));
  ALTER TABLE agent_jobs ADD COLUMN batch_id TEXT NULL;
  ALTER TABLE agent_jobs ADD COLUMN batch_submitted_at TIMESTAMPTZ NULL;
  ALTER TABLE agent_jobs ADD COLUMN batch_polled_at TIMESTAMPTZ NULL;
  CREATE INDEX agent_jobs_batched_pending_idx ON agent_jobs(batch_id) WHERE execution_intent = 'batched_24h' AND queue_status IN ('queued', 'dispatched');
  ```

- **M-118 — `anthropic_batches_table`**:
  ```sql
  CREATE TABLE anthropic_batches (
    id TEXT PRIMARY KEY,  -- Anthropic-returned batch ID
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL,
    polled_at TIMESTAMPTZ NULL,
    poll_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',  -- 'in_progress' | 'completed' | 'failed' | 'cancelled'
    request_count INTEGER NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0,
    pool_key TEXT NOT NULL  -- 'platform' OR 'byok:<user_id>' (Batch API works on the calling key)
  );
  ```

- **M-119 — `failure_taxonomy_samples_table`**:
  ```sql
  CREATE TABLE failure_taxonomy_samples (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    failure_class CHAR(1) NOT NULL CHECK (failure_class IN ('A','B','C','D','E')),
    operation_type TEXT NOT NULL,
    pool_key TEXT NOT NULL,
    agent_job_id UUID NOT NULL REFERENCES agent_jobs(id),
    auto_recovered BOOLEAN NOT NULL DEFAULT FALSE,
    requires_user_action BOOLEAN NOT NULL DEFAULT FALSE,
    error_summary TEXT NULL
  );
  CREATE INDEX failure_taxonomy_samples_class_time_idx ON failure_taxonomy_samples(failure_class, occurred_at DESC);
  ```

- **M-120 — `push_model_completion_trigger`**:
  Replace M-109's notify-only trigger with the full push-model version. When a workflow completes (last step's `agent_jobs.queue_status = 'completed'` cascades up):
  1. Mark workflow completed.
  2. Mark brief_stage completed.
  3. SELECT next stage (next `order` value) for same brief WHERE trigger evaluates true.
  4. If found: insert a `director_iteration` row of `traffic_class=1, operation_type='director_iteration'` with iteration_state pre-populated to invoke the Director with a synthesised user message of the form `[SYSTEM EVENT: Stage N complete; plan workflow for Stage N+1]`. The Director picks this up at its next dispatcher tick.
  5. If no next stage: mark brief completed.
  6. pg_notify('scheduler_completion', payload) so the dispatcher reacts immediately.

  All changes happen in one trigger transaction — atomic.

- **M-121 — `platform_config_batched_24h_keys`**:
  - `agent.batched_24h_eligible_operations` = `["expand_layer","synthesise_beat","refine_summary","generate_context"]` (JSONB array; only these op types may be batched; Director iterations and interactive operations are excluded by definition)
  - `agent.batched_24h_min_batch_size` = `5` (Batch API requires ≥1; we wait until 5 are queued before submitting to amortise overhead)
  - `agent.batched_24h_max_wait_minutes` = `30` (if fewer than min_batch_size accumulate after this wait, submit anyway)
  - `agent.batched_24h_poll_interval_minutes` = `5`

- **M-122 — `pg_cron_jobs_v1xb2`**:
  Three new cron jobs:
  - `dispatcher_tick` — every 1 second (calls dispatcher endpoint via pg_net)
  - `batch_poller` — every 5 minutes (polls Anthropic Batch API for in_progress batches, writes results back to agent_jobs)
  - `route_capacity_sampler` — every 1 minute (writes route_capacity_samples row per active pool)
  - `reservation_sweep` — every 1 minute (refunds expired throttle_reservations) — already from V1.x-B.1.1, retained
  - `metrics_minute_rollup` — every 1 minute (defined in B.2.4)

#### 5.2.2 — Anthropic Batch API integration (`lib/scheduler/batch-submitter.ts` + `lib/scheduler/batch-poller.ts`)

Submitter: when the dispatcher claims a `batched_24h` ticket, instead of handoff to a runner, it adds the ticket to a pending-batch buffer. When buffer reaches `min_batch_size` (or `max_wait_minutes` elapses), it builds the Anthropic Batch request body and submits, recording the returned batch ID on each ticket and the `anthropic_batches` row.

Poller: pg_cron calls `POST /api/cron/poll-batches`. For each in-progress `anthropic_batches` row, fetch its status from Anthropic. On batch completion, parse the per-request results and update each `agent_jobs` row with the LLM response (writing through the standard runner result path so completion triggers fire normally).

#### 5.2.3 — Agent runner BYOK extension (`lib/agent/runner.ts`)

Today the agent runner uses `getProvider(userId?)` to route to BYOK if the user has a key (already wired in V1.x-B.1.2 for Director-only). B.2.3 extends:

1. The agent runner's `runAgentJob(job)` reads `job.user_id`, calls `getProvider({ userId: job.user_id })`, and the factory routes via ByokProvider when applicable.
2. The agent runner records `route` on `agent_jobs` ('platform' | 'byok:<user_id>') so metrics + bucket selection use the right pool key.
3. The completion path records `actual_input_tokens`, `actual_output_tokens`, and `cost_credits` (computed from the time-versioned `pricing_rates` table — V1.x-C lands the pricing table; B.2.3 leaves `cost_credits` NULL when V1.x-C is absent and V1.x-C backfills).

Implementation is small (~30 lines diff in `lib/agent/runner.ts`) but the test surface is large because every operation type must be exercised through both routes.

#### 5.2.4 — Push-model trigger end-to-end

The completion trigger from M-120 is the wire. The Director system prompt v1.8 (already shipped in B.1.1) handles `[SYSTEM EVENT: Stage N complete; plan workflow for Stage N+1]` correctly — it reads the Brief, sees the next stage's `goal_text` and any inherited preferences, calls `propose_workflow`. The workflow proposal flows through the existing approval surface (auto-approved if Brief was set to auto-approve at proposal time; otherwise UI surfaces).

For B.2.3 we add:
- `briefs.auto_approve_workflow_proposals BOOLEAN NOT NULL DEFAULT FALSE` (M-120 alteration)
- UI checkbox in `BriefProposalCard` ("Auto-approve subsequent stages") — when set, the push-model director_iteration auto-approves each proposed workflow without user intervention.
- `app/api/director/turns/[turnId]/auto-approve-workflow/route.ts` (called from the director_iteration runner when `auto_approve_workflow_proposals=true`).

### §5.3 — Files modified or created

- **NEW** `lib/scheduler/batch-submitter.ts`
- **NEW** `lib/scheduler/batch-poller.ts`
- **MODIFY** `lib/agent/runner.ts` (BYOK routing + route stamping + token reconciliation)
- **MODIFY** `lib/llm/factory.ts` (already takes optional userId from B.1.2; verify agent runner path is correct)
- **MODIFY** `components/director/BriefProposalCard.tsx` (auto-approve checkbox)
- **NEW** `app/api/cron/poll-batches/route.ts`
- **NEW** `app/api/director/turns/[turnId]/auto-approve-workflow/route.ts`
- **MIGRATIONS** 117–122

### §5.4 — Acceptance criteria

- A workflow with `execution_intent='batched_24h'` on all 10 steps submits 1 Anthropic batch (min_batch_size=5 met after 10) and processes all 10 results when the batch completes.
- An agent_job for a BYOK user routes through `ByokProvider` and the Edge Function (verifiable via Edge Function logs).
- An agent_job for a platform user does NOT route through the Edge Function (verifiable via Edge Function logs not showing the call).
- A 3-stage Brief with all stages on auto-approve completes end-to-end without user intervention (single approval at Brief creation).
- A 3-stage Brief without auto-approve auto-fires the director_iteration to plan stage 2 (visible in scheduler panel) but parks the proposal for user approval.
- Anthropic API outage: a batch poll returning HTTP 503 is classified Class A, retried, and the failure_taxonomy_samples row is written.

---

## §6 — B.2.4 — Tier-A consolidation + integration test + merge

### §6.1 — Goals

Single-pass consolidation of all Tier-A specs absorbing V1.x-B.1.1 + V1.x-B.1.2 + V1.x-B.2 changes. End-to-end integration test exercising every cross-cutting path. Test Report. Merge to master.

### §6.2 — Tasks

#### 6.2.1 — Tier-A spec bumps

| Spec | From → To | Major content additions |
|---|---|---|
| `docs/stelavox_director_architecture_v2_0.md` | v2.0 → **v2.2** | Per-iteration decomposition (§8.1a) → fully wired; Stop semantics (§13 expansion); push-model triggers (§8.4 expansion); agent runner BYOK (new §17 BYOK routing); failure taxonomy classifier (§10 implementation note); WFQ with VFT (§9 algorithm specification); per-user buckets + reserved slots (§9 expansion); batched_24h (§4.4 Batch API integration); BYOK isolation invariants (§13 + H-09 amplification) |
| `docs/stelavox_technical_architecture_v2_3.md` | v2.3.4 → **v2.4** | Full doc bump (file rename) consolidating §3.6 V1.x-A.1 schema + V1.x-B.1.1 scheduler + V1.x-B.1.2 BYOK + V1.x-B.2 traffic engineering. New §3.7 metrics tables. §5 hazards updated (any new H-NN). §11 phase-roadmap row updates. |
| `docs/stelavox_component_specification_v2_10.md` | v2.10 → **v2.11** | StopButton spec (§5.14 new); SchedulerPanel Stop controls (§A.4 expansion); BriefProposalCard auto-approve checkbox (§A.7 expansion); CostMeter readiness for V1.x-C (§A.6 — no functional change yet) |
| `docs/stelavox_product_specification_v1_9.md` | v1.9 → **v1.10** | §11 V1.x-B.2 capability list; user-visible: per-iteration Director, Stop button, batched_24h toggle on Brief; admin-visible (preview): metrics in dashboard |
| `docs/stelavox_agent_profile_library_v1_0.md` | v1.3 → **v1.4** (internal) | No new operation types in B.2; bump notes that all ops now estimate input + output tokens via `agent_profiles.estimated_input_tokens` + `estimated_output_tokens` (column additions in M-105 alteration) and the values are populated for all 18 V1 system profiles. |
| Repo `CLAUDE.md` + `docs/CLAUDE_stelavox_project.md` | v1.28 → **v1.29** | V1.x-B.2 SHIPPED entry; Spec Library Reference table re-pointed; Critical Component Specifications table updated; Hazards summary updated |

#### 6.2.2 — Migrations (123–125)

- **M-123 — `metrics_minute_buckets_table`**:
  ```sql
  CREATE TABLE metrics_minute_buckets (
    bucket_started_at TIMESTAMPTZ NOT NULL,
    metric_kind TEXT NOT NULL,  -- 'queue_depth' | 'dispatch_rate' | 'failure_rate' | 'cost_rate' | ...
    dimensions JSONB NOT NULL,  -- e.g. {"class": 1, "pool_key": "platform"}
    value NUMERIC(20,6) NOT NULL,
    sample_count INTEGER NOT NULL,
    PRIMARY KEY (bucket_started_at, metric_kind, dimensions)
  );
  CREATE INDEX metrics_minute_buckets_kind_time_idx ON metrics_minute_buckets(metric_kind, bucket_started_at DESC);
  ```

- **M-124 — `metrics_rollup_pg_cron`**:
  pg_cron job every minute that aggregates `dispatcher_tick_samples` + `route_capacity_samples` + `failure_taxonomy_samples` from the last minute into `metrics_minute_buckets` rows. Pre-computes p50/p95/p99 latencies, dispatch counts per class, failure counts per class, average bucket utilisation per pool. Atomic INSERT … ON CONFLICT DO UPDATE so re-runs are idempotent.

- **M-125 — `raw_samples_retention_purge`**:
  pg_cron job daily that purges `dispatcher_tick_samples` older than 7 days, `route_capacity_samples` older than 7 days, `failure_taxonomy_samples` older than 30 days. Roll-up data in `metrics_minute_buckets` retained 90 days.

#### 6.2.3 — End-to-end integration test

`tests/v1x-b-2/end-to-end-integration.spec.ts` — single Playwright spec exercising:

1. Sign in as platform user A.
2. Create a 4-stage Brief on auto-approve (stage 1 expand chapters, stage 2 synthesise beats, stage 3 batched_24h refine summaries, stage 4 generate context) — single approval click.
3. Verify stage 1 dispatches as Class 3 immediately, all chapter expands run.
4. Verify stage 2 push-fires automatically when stage 1 completes (no user re-engagement).
5. Verify stage 3 routes through Anthropic Batch API (poll for batch completion).
6. Verify stage 4 completes and Brief.status = 'completed'.
7. Sign in as BYOK user B in another browser context, kick off a synthesise on a beat — verify it routes via Edge Function (Edge Function log assertion).
8. Mid-Director-turn: send a 5-iteration query (mix of read tools), Stop after iteration 3 — verify cancellation cascade.
9. Force a Class A failure (kill Anthropic mock for one ticket) — verify auto-retry, success after retry, failure_taxonomy_samples row.
10. Force a Class C bucket exhaustion — verify ticket re-queues, bucket refills, ticket dispatches.
11. Verify dispatcher_tick_samples + route_capacity_samples + metrics_minute_buckets all populated.

#### 6.2.4 — Test Report

Authored as `docs/stelavox_v1x_b_2_test_report_v1_0.md`. PASS verdict requires every CK in §10 green.

#### 6.2.5 — Merge to master

After Test Report PASS:
1. Merge V1.x-B.2 worktree branch to master with `--no-ff` (preserves the V1.x-B.2 commit history as a discrete merge bubble).
2. Push to origin.
3. Update `MEMORY.md`: archive V1.x-B.2 progress memos, write `project_v1x_b_2_shipped.md`, update next-session-prep memo for V1.x-B.3.
4. Tag the merge commit `v1.x-b.2`.

### §6.3 — Acceptance criteria

- All six Tier-A docs bumped, internally consistent, cross-referenced.
- M-123 / M-124 / M-125 applied; metrics_minute_buckets populates on the next pg_cron tick.
- Integration test passes end-to-end.
- Test Report PASS verdict; all CKs green.
- Type-check 0 errors; lint 0 errors (or only pre-existing warnings carried forward).
- `npm run build` passes.

---

## §7 — Metrics collection (cross-cutting)

Already detailed inline across §3 (per-ticket lifecycle stamps), §4 (`dispatcher_tick_samples`, `route_capacity_samples`), §5 (`failure_taxonomy_samples`), §6 (`metrics_minute_buckets` rollup + retention).

**The principle**: every dispatcher decision and every job lifecycle event writes a sample. Raw samples retained 7–30 days; rollups retained 90 days. V1.x-E ships visualisation against `metrics_minute_buckets` for fast queries plus drill-down to raw samples for incident forensics.

**Operational-dashboard primary metrics** (V1.x-E will surface; B.2.4 ensures the data exists):

| Metric | Source | Aggregation |
|---|---|---|
| Tickets dispatched per minute, per class | `agent_jobs.dispatched_at` + `traffic_class` | count |
| Queue depth per class, current | `agent_jobs WHERE queue_status='queued'` | count |
| Wait time p50/p95/p99 per class | `dispatched_at - queued_at` per ticket | percentile |
| Tokens consumed per minute, per pool | `actual_input_tokens + actual_output_tokens` | sum |
| Bucket utilisation per pool | `current_tokens / bucket_size` | avg + min over window |
| Class 1 reserved slot utilisation | `class_1_reserved_slots.in_use / total_slots` | avg + max over window |
| Failure rate per class (A/B/C/D/E) | `failure_taxonomy_samples` | count per class per minute |
| Auto-recovery rate (Class A retries succeeding) | `failure_taxonomy_samples WHERE auto_recovered=true / total Class A` | ratio |
| Cost per minute, per pool, per operation_type | `cost_credits` | sum |
| BYOK vs platform split | `route` | count per route |
| batched_24h adoption rate | `execution_intent` | count per intent |
| pg_cron job durations | pg_cron native log table | percentile |

---

## §8 — Hazards introduced or mitigated

### §8.1 — Mitigated

- **H-17 (reservation TTL hygiene)** — already documented; V1.x-B.2 actually exercises the sweep at scale via WFQ. CK-12 in §10 verifies sweep correctness under load.

### §8.2 — Newly introduced (full entries to be authored in TA v2.4 §5)

- **H-21 — Per-iteration state-store drift** — The iteration_state JSONB on `agent_jobs` carries the running assistant message and pending tool_results between iterations. If the schema evolves (new fields in the assistant content type, new tool block shape), older in-flight iterations could deserialise wrong. Mitigation: `__schema_version` field on the JSONB; runner reads version, applies migration in-memory if older than current; never persists in mixed shape.
- **H-22 — VFT virtual clock overflow** — virtual_clock is NUMERIC(20,6) which gives ~14 digits before decimal. At sustained 1M tokens/sec dispatch (orders of magnitude beyond reality), overflow is millennia away. But cumulative drift over years of operation is a soft concern. Mitigation: monthly pg_cron job that subtracts the minimum class-N-last_vft from virtual_clock and all class-N-last_vfts simultaneously, preserving relative order while resetting absolute magnitude.
- **H-23 — Push-model trigger storm** — A pathological brief with many compound-trigger stages all becoming ready in the same transaction could insert N director_iteration tickets for the same Director conversation simultaneously. Mitigation: completion-trigger function checks for any in-flight director_iteration row on the same conversation_id; if found, defers (queues a deferred-trigger record for the next dispatcher tick) instead of inserting concurrently. A Director conversation is single-threaded by design.
- **H-24 — Batch API stale poll** — A submitted batch could complete on Anthropic's side but our poller misses N polls (network outage, dev environment off). Mitigation: poller backfill — on first successful poll after a gap, request the full batch result regardless of cached `polled_at`.
- **H-25 — Stop request race** — A Stop request lands between a runner's pre-call check and the actual LLM call (microseconds). The LLM call proceeds; the response is used. Mitigation: runner checks Stop predicate again on response receipt; if Stop is now active, discards the response (records it to `agent_jobs.iteration_state.discarded_response` for forensics) and marks cancelled. The Anthropic call cost is sunk but minimal (typically one extra iteration).

---

## §9 — Inviolables impact

**Verdigris-use count remains nine.** The Stop button uses the destructive token (matches Delete in BYOK panel and Delete in NodeMoreMenu) — NOT verdigris. The auto-approve checkbox in BriefProposalCard uses verdigris ONLY in its checked state, falling under existing use #7 (Affirmative-action triggers — broadened in v1.18 to cover "user-driven affirmative-action triggers against agent/workflow proposals"; an auto-approve commitment fits the family without broadening the count).

**Five Inviolables intact**: prose surface lowest-noise; verdigris in nine places; Cinzel only in wordmark; typeface boundary absolute; prose editor no visible toolbar.

CK-Inviol in §10 verifies via grep audit (matches CK-Inviol in V1.x-B.1.1 + V1.x-B.1.2 test reports).

---

## §10 — Test plan (extensive — per "rock solid, no shortcuts")

Test plan is comprehensive because per-iteration decomposition + WFQ + bucket lifecycle + push-model + BYOK routing have many cross-product cases. Boundary conditions are explicitly enumerated.

### §10.1 — Checkpoints

| CK | What it proves | Method |
|---|---|---|
| CK-1 | Per-iteration Director turn creates correct chain | Unit test: 5-iteration Director turn → 5 agent_jobs rows, sequential iteration_number, chained parent_iteration_id, single director_turn_id |
| CK-2 | Iteration crash + recovery | Integration: kill dev server mid-iteration → recovery sweep marks crashed → user surface shows resumable state |
| CK-3 | Stop mid-turn cancels in-flight + queued descendants | Integration: 3-iteration turn, Stop after iteration 2 → iteration 2 marked cancelled, iteration 3 (just inserted by trigger) marked cancelled, [SYSTEM EVENT] message written |
| CK-4 | Failure classifier maps every code correctly | Unit: 50+ synthetic error cases through `classifyFailure(...)` → expected class returned |
| CK-5 | All 5 failure classes triggered end-to-end | Integration: synthetic Class A/B/C/D/E failure → correct queue_status outcome + failure_taxonomy_samples row |
| CK-6 | WFQ VFT picks correctly under uniform load | Synthetic: 100 tickets each class → dispatch ratio matches weights ±5% |
| CK-7 | WFQ VFT picks correctly under non-uniform load | Synthetic: class 1 large + class 3 small → consumed-token ratio matches weights ±5% |
| CK-8 | Per-user bucket lazy refill correct | Unit: bucket at 50%, wait N seconds, lazyRefill → expected value ±0.1% |
| CK-9 | Bucket FOR UPDATE prevents double-spend | Concurrency: 100 parallel reserve attempts on same bucket → final state correct |
| CK-10 | Bucket exhaustion re-queues, refill releases | Integration: drain bucket, attempt dispatch → ticket skipped; wait for refill → ticket dispatches |
| CK-11 | Class 1 reserved slots honoured | Synthetic: 5 class-1 tickets, 3 reserved slots → first 3 dispatch immediately, 4-5 wait |
| CK-12 | Reservation TTL sweep refunds correctly | Integration: reserve, wait beyond TTL → sweep refunds tokens |
| CK-13 | Aging promotion prevents starvation | Synthetic: load class 1/2/3 to saturation, queue class 4 ticket → class 4 dispatches within aging window |
| CK-14 | dispatcher_tick_samples populates every tick | Integration: monitor table for 60 seconds → 60 rows ±2 |
| CK-15 | route_capacity_samples populates per pool per minute | Integration: 5 pools active for 5 minutes → ≥25 rows |
| CK-16 | Push-model: stage completion auto-fires next director_iteration | Integration: 3-stage Brief on auto-approve → all 3 stages run end-to-end with no user click after Brief approval |
| CK-17 | Push-model: trigger storm prevention | Synthetic: 5 stages all becoming ready simultaneously → only 1 director_iteration inserted, others deferred |
| CK-18 | batched_24h: small batch waits for min_batch_size | Integration: queue 3 batched tickets → no Anthropic call; queue 2 more → batch submits |
| CK-19 | batched_24h: max_wait_minutes overrides min_batch_size | Integration: queue 2 batched tickets, advance time → batch submits at threshold |
| CK-20 | batched_24h: batch poll completion processes all results | Integration: submit 5-ticket batch, poll → all 5 agent_jobs marked completed with results |
| CK-21 | Agent runner BYOK routes via Edge Function | Integration: BYOK user kicks off synthesise → Edge Function log shows the call; platform user → Edge Function log empty |
| CK-22 | Cross-pool isolation: BYOK exhaustion does not affect platform | Synthetic: drain BYOK user's bucket → platform tickets continue dispatching |
| CK-23 | metrics_minute_buckets rollup correctness | Integration: known synthetic load → rolled-up values match expected within 1% |
| CK-24 | All pg_cron jobs run on schedule | Integration: 10-minute observation → each job's run count matches expected |
| CK-25 | Type-check 0 errors, lint clean (modulo pre-existing warnings), build passes | CI |
| CK-26 | All V1.x-A.1 + V1.x-B.1.1 + V1.x-B.1.2 tests still green (no regression) | CI |
| CK-Inviol | Verdigris use count = 9; no Cinzel outside wordmark; typeface boundary clean | grep audit |

### §10.2 — Boundary cases enumerated

For each major capability, boundary cases tested explicitly:

**Per-iteration decomposition:**
- 1-iteration turn (model returns final response immediately)
- 30-iteration turn (max iterations reached → Class D)
- iteration that returns text + tool_use (text persisted, tool_use triggers next iteration)
- iteration that returns tool_use only (no text) → next iteration
- iteration with parallel tool_use blocks → all tools execute, single next iteration
- iteration crash before any output → recovery, classifier Class B, resumable
- iteration with model returning malformed JSON in tool input → Class D, fail
- iteration with canary leak → Class D, fail

**WFQ:**
- All 4 classes empty
- One class only populated
- Two classes populated, one with much higher weight
- Aging triggers exactly at threshold
- VFT-tied tickets (same VFT value) → tie-break by queued_at FIFO

**Buckets:**
- bucket_size = 0 (degenerate; should reject all immediately)
- refill_rate = 0 (degenerate; bucket only refills via reconcile)
- reservation TTL exactly at expiry
- 1000 concurrent reserve attempts (stress test for FOR UPDATE)

**Push-model:**
- Brief with 1 stage (stage trigger never fires; brief completes after stage 1)
- Brief with 10 stages all on auto-approve (full chain)
- Stage with `compound` trigger requiring multiple prerequisite stages
- Stage with `scheduled_at` trigger (dispatched at scheduled time)
- Push-fired director_iteration rejected by Director (Director responds "I cannot plan stage X without information Y") → stage stays pending, surfaces to user

**BYOK:**
- BYOK user with valid key
- BYOK user with key that has been revoked at Anthropic side mid-flight
- BYOK user whose Edge Function unreachable
- Platform user (control: never routes via Edge Function)

**batched_24h:**
- Batch submits successfully
- Batch fails entirely (Anthropic returns batch-level failure)
- Batch partially succeeds (some requests fail; others succeed)
- User cancels brief while batch is in_progress → batch tickets cancelled; pending Anthropic batch is left to drain (we don't have batch-cancel API in V1)

### §10.3 — Test counts target

Following V1.x-B.1.1 precedent (66 unit + 30 Playwright = 96 total) and V1.x-B.1.2 (74 unit + 35 Playwright = 109 total), V1.x-B.2 targets:

- **Vitest unit**: ≥150 tests across `tests/v1x-b-2/unit/` (WFQ math, bucket math, classifier, iteration-state schema migration, batch builder)
- **Playwright integration**: ≥60 tests across `tests/v1x-b-2/integration/` (per-iteration flows, push-model end-to-end, batch flows, cross-pool isolation, Stop cascade, recovery)
- **End-to-end**: 1 long-running Playwright spec covering the full integration walkthrough (§6.2.3)

### §10.4 — Stress and chaos tests

For "rock solid", §10.4 mandates explicit stress tests:

- **Sustained-load stress**: 10 concurrent Director turns + 50 concurrent workflows for 10 minutes → verify queue depth bounded, latency p99 stable, no leaked reservations.
- **Bucket-thrash chaos**: drain and refill 20 BYOK buckets randomly for 10 minutes → verify no double-spend, no negative leaks.
- **Push-storm chaos**: 10 concurrent multi-stage briefs all auto-approve completing stages near-simultaneously → verify trigger-storm prevention holds.
- **Recovery chaos**: kill dispatcher process every 30 seconds for 5 minutes → verify recovery sweep + LISTEN reconnect maintain throughput.
- **Anthropic-flake chaos**: inject 10% rate of HTTP 503 from Anthropic mock → verify Class A retry budget honoured, eventual success rate >99%.

---

## §11 — Migration plan

| # | Description | Sub-phase |
|---|---|---|
| 105 | agent_jobs metric columns + director_iteration type | B.2.1 |
| 106 | agent_jobs status machine v2 | B.2.1 |
| 107 | director_iterations → agent_jobs migration | B.2.1 |
| 108 | stop_requests table | B.2.1 |
| 109 | agent_jobs completion trigger v2 (notify only) | B.2.1 |
| 110 | failure taxonomy SQL helper | B.2.1 |
| 111 | wfq_state table | B.2.2 |
| 112 | user_throttle_buckets table | B.2.2 |
| 113 | class_1_reserved_slots counter | B.2.2 |
| 114 | platform_config V1.x-B.2 keys (WFQ + buckets + slots + tick) | B.2.2 |
| 115 | dispatcher_tick_samples table | B.2.2 |
| 116 | route_capacity_samples table | B.2.2 |
| 117 | agent_jobs execution_intent + batch columns | B.2.3 |
| 118 | anthropic_batches table | B.2.3 |
| 119 | failure_taxonomy_samples table | B.2.3 |
| 120 | push-model completion trigger (full) | B.2.3 |
| 121 | platform_config batched_24h keys | B.2.3 |
| 122 | pg_cron jobs (dispatcher_tick + batch_poller + route_capacity_sampler + already-existing reservation_sweep retained) | B.2.3 |
| 123 | metrics_minute_buckets table | B.2.4 |
| 124 | metrics_minute_rollup pg_cron | B.2.4 |
| 125 | raw_samples_retention_purge pg_cron | B.2.4 |

Migration count moves 104 → 125 (+21).

**No destructive operations on shipped tables** other than M-107 (drop V1.x-B.1.1 `director_iterations` standalone table — this table was only ever a holding pattern; rows did not contain user data). Any additional drops would be flagged for explicit user approval.

---

## §12 — Risks and watchpoints

1. **Executor refactor scale.** 943 lines → ~400 lines of per-iteration runner + ~200 lines of dispatcher integration. The agentic-loop edge cases (parallel tool_use, mid-turn write proposals, end-of-turn block parsing) are subtle. Mitigation: §10.2 boundary cases enumerated; CK-1 through CK-5 explicit; chaos tests in §10.4.
2. **VFT correctness under concurrency.** WFQ math is straightforward but the FOR UPDATE on `wfq_state` serialises all dispatcher claims through a single row. Throughput ceiling is approximately 1 / (transaction duration). At 10ms transactions that's ~100 dispatches/sec — adequate for V1 but a watchpoint for scale. Mitigation: dispatcher_max_per_tick caps batch size; stress test in §10.4.
3. **Push-model trigger storms.** H-23 mitigation is correct but adds complexity. Prefer to test exhaustively via CK-17.
4. **batched_24h uncertainty.** Anthropic Batch API has a 24h SLA but real completion is usually minutes. Our poller backoff strategy needs to balance "respond quickly when batch completes" with "don't hammer the API." Default poll = 5 min; consider exponential backoff for batches older than 1 hour.
5. **BYOK Edge Function cold starts.** Supabase Edge Functions cold-start in ~500ms. For interactive Director iterations the first call after idle could feel sluggish. Mitigation: a synthetic warm-keepalive cron hitting the function every 30 seconds (V1.x-E concern but flag in B.2.3).
6. **Metrics table growth.** Raw samples at 1 row/sec/dispatcher_tick = 86,400 rows/day from dispatcher_tick_samples alone. M-125 retention purge keeps it bounded. Watchpoint: index bloat on heavy-INSERT tables; reindex schedule or pg_repack candidate for V1.x-E.
7. **Tier-A consolidation surface.** Six docs change in one pass. Mitigation: do them in order (TA → Director Arch → Component Spec → Product Spec → Agent Profile Library → CLAUDE.md), check cross-references after each.

---

## §13 — Sign-off criteria

V1.x-B.2 PASSES when, in this order:

1. All migrations 105–125 applied locally without error.
2. Every CK in §10.1 green (CK-1 through CK-26 + CK-Inviol).
3. Every boundary case in §10.2 covered by at least one passing test.
4. Stress and chaos tests in §10.4 complete without leaked reservations, double-spends, or unbounded queue growth.
5. Type-check 0 errors. Lint clean (modulo pre-existing warnings carried from prior phases). `npm run build` passes.
6. End-to-end integration test (§6.2.3) passes.
7. Test Report v1.0 (`docs/stelavox_v1x_b_2_test_report_v1_0.md`) authored with PASS verdict + per-CK evidence.
8. All six Tier-A docs bumped, internally consistent, cross-references current.
9. CLAUDE.md changelog entry v1.29 written.
10. Merge to master with `--no-ff`; push to origin; tag `v1.x-b.2`.
11. `MEMORY.md` updated with `project_v1x_b_2_shipped.md`.

Anything below this bar is not a ship.

---

## Changelog

**v1.0 — 2026-05-15** Initial draft. Authored against locked design decisions (Q1 four-way split, Q2 push-model = Postgres completion-trigger cascade, Q3 per-user buckets = database-backed lazy-refill, Q4 Tier-A consolidation in single pass at end) plus user direction "rock solid, no shortcuts, comprehensive test plan". WFQ algorithm choice locked to Virtual Finish Time; B.2.1 builds dispatcher with naive class-priority first then B.2.2 layers VFT on top. Cross-cutting metrics-collection layer woven through B.2.1 / B.2.2 / B.2.3 with rollup in B.2.4. 21 migrations spanning 105–125. Estimated 5–7 sessions total.
