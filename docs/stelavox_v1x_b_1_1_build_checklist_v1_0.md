# Stelavox — V1.x-B.1.1 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for V1.x-B.1.1 build. The first sub-phase of V1.x-B per the four-way split locked in `docs/sessions/v1x_b_design_session_record_2026-05-14.md` §15. Architectural source: `docs/stelavox_director_architecture_v2_0.md` (Tier-A canonical) + the V1.x-B design session record (Tier-A decision provenance). Companion to (future) `stelavox_v1x_b_1_1_test_report_v1_0.md`. Source of truth for what gets built and in what order. Spec doc amendments listed in §4 land in lockstep with the build.

**Phase:** V1.x-B.1.1 — Scheduler engine + Brief lifecycle + UI substrate. Lands the *interfaces*, *contracts*, and *data shapes* for the V1.x-B execution model (per design record principle 4: "Architecture right in the first stage; implementation can layer"). B.1.2 (BYOK substrate), B.2 (full traffic-engineering policy), and B.3 (concurrent multi-Brief + Brief amendments) are separate later checklists.

**Substrate at V1.x-B.1.1 start:**

- Master HEAD `156e3d2` (V1.x-A.1 close-out + M-090 + V1.x-B design session record merge 2026-05-14).
- Migration count: 90.
- Director config v1.6 in production; 16 tools; system prompt with `<plan>` scratchpad + "tool call IS the proposal" framing. Model: Haiku 4.5.
- **Carry-over gaps from V1.x-A.1 test round (V1.x-B.1.1 closes both):**
  1. Brief auto-complete propagation never wired (workflow_complete → stage_complete → brief_complete). The Shadow Protocol document `73adfca9-f635-44ef-b07e-668d9896e3ca` carries a stale `active` Brief `d542f0af-6b89-4bbd-a93e-7f6b1ba61a26` left over from a single-stage refine that completed at the agent_job level but never propagated upward. CK-1 verifies the stale Brief retroactively closes once the propagation lands.
  2. Director registry has no `cancel_brief` tool. CK-2 verifies the new tool ships in v1.7.
- Local DB on the next-spawned worktree will receive migrations 091–101 (per §3.1). Pre-rework snapshot will be captured in PB-3 with the stale Brief intact.

**Locked decisions (one-line summaries — full text in design record §3–§16):**

1. Mid-Brief approval locus = Director conversation; SchedulerPanel = direct-manipulation; AppShellStatusIndicator + Director tab indicator = cross-context bridges. (Q1 / §3–§5)
2. Per-iteration Director-turn decomposition substrate (atomic iteration row, heartbeat-based interrupted detection, resume contract, idempotency, `failure_class`) + retry policy for classes A/B/D/E land in B.1.1; Class C policy lights up in B.2. (Q2 / §6)
3. Synchronous Director iteration = ONE atomic unit (call + response). `batched_24h` is the only two-atom shape and lives entirely in B.2. (Q2 follow-up / §7)
4. Atom-size guardrails configurable in `platform_config`; pre-flight check rejects too-big operations explicitly; logs to `constraint_violations` for capability-tuning telemetry. (Q2 extension / §8)
5. Throttle interface accepts `route` parameter from B.1.1 day one. B.1.1 policy: `route=platform` → cap=1 (preserves M-046 semantics); `route=byok` → pass-through. Full BYOK module = B.1.2. (Q3 / §9)
6. Sequential multi-Brief in B.1.1 — multiple Briefs as data-model concept with sequential execution; one active at a time enforced by stricter partial unique index `WHERE status='active'`; new `queued` status; `sequence_position` ordering. Concurrent execution + cross-Brief contention defer to B.3. Brief amendments split off entirely to B.3. (Q4 / §10)
7. Inline cards within Director conversation for all approval/proposal artefacts; conversation IS the history; subtle cause label on system-initiated turns. AppShellStatusIndicator for cross-context awareness; SchedulerPanel does NOT aggregate approvals. (Q5 / §11)
8. Tiered system event surfacing — lifecycle-significant events (Cancel, Stop, Resume, Brief activation/completion, attention-requiring failures) surface as inline `role=system` rows in `conversation_messages`. Routine parameter edits (reschedule, intent toggle) stay silent; Director picks up via `get_scheduler_state` on next turn. (Q6 / §12)
9. Recurring/template Briefs: deferred entirely to V1.x-D / V2 backlog. No template-specific hooks added in B.1. Two postures (parameterized Brief creation API + `briefs.cause` column) happen to make future template work cleaner. (Q7 / §13)
10. Budget cap field timing: deferred entirely to V1.x-C. Cancel is the cost-control affordance in B.1.1. (Q8 / §14)

**Architectural commitment for B.1.1 (design record §1):** ship the interfaces / contracts / data shapes even where B.2 lands the policy. Walked-back columns and refactored interfaces are the anti-pattern this principle exists to avoid.

---

## 1. Pre-Build Prerequisites

### PB-1 — Worktree and branch

The B.1.1 implementation uses a **new worktree** spawned from master `156e3d2` per `feedback_phase_session_procedure.md` step 5:

```
git -C C:/dev/stelavox_2 worktree add .claude/worktrees/<random-name> claude/v1x-b-1-1-substrate
```

The current `sad-noether-07f2e8` worktree is the design + checklist drafting worktree; it is left intact for reference. The `dreamy-sinoussi-e3a631` worktree (where the design session record was authored) is also left intact — its single commit (`44d0ab6`) merged into master via `156e3d2`.

### PB-2 — Supabase stack health

```
supabase status                                                   # all services healthy
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:54331/auth/v1/health
```

Stop `supabase_vector_stelavox_2` if it appears in `docker ps` — known restart-loop issue (see `feedback_supabase_stop_no_backup.md`).

### PB-3 — Snapshot before any migration runs

```
pg_dump -h 127.0.0.1 -p 54332 -U postgres -d postgres -Fc \
  -f snapshots/stelavox_local_<YYYY-MM-DD>_pre_v1x_b_1_1.dump
```

This snapshot captures the Shadow Protocol document **with** the stale active Brief `d542f0af` so CK-1 can verify retroactive auto-completion against real residue. Any further mid-build snapshot is no-op insurance.

### PB-4 — V1.x-B.1.1 spec library in source

```
ls docs/stelavox_director_architecture_v2_0.md           # exists; v2.0.2
ls docs/stelavox_director_architecture_v2_1_0.md         # exists; V1.x-A.1 doc rework
ls docs/stelavox_technical_architecture_v2_3.md          # v2.3.2
ls docs/sessions/v1x_b_design_session_record_2026-05-14.md  # exists; merged via 156e3d2
grep -m1 "## Version 1.26" CLAUDE.md
diff CLAUDE.md docs/CLAUDE_stelavox_project.md           # empty diff
```

### PB-5 — Type baseline + tests green for V1.x-A.1

```
npm run type-check     # exit 0
npm run lint           # 0 errors, pre-existing warnings only
npm run build          # passes
npm run test:unit -- tests/unit/v1x-a1-*.test.ts          # 34 pass
npm run test -- tests/v1x-a1/profile-and-brief-substrate.spec.ts  # 8 pass
```

This confirms the V1.x-A.1 code is healthy before V1.x-B.1.1 extends it.

### PB-6 — Cheap-model override

Per `feedback_haiku_default.md`, all LLM testing uses Haiku 4.5. Director config v1.6 currently in production; v1.7 will replace it as part of M-100.

### PB-7 — `.next/` wipe sanity

Wipe `.next/` after any change to `@keyframes` or root-level CSS tokens. Relevant in this phase for the new `SchedulerPanel`, `AppShellStatusIndicator`, system-event message styling, and any Director tab indicator visual treatment that touches token state. See Phase 3 Test Report v1.3 for the underlying Turbopack cache issue.

---

## 2. Phase Checkpoint Criteria

V1.x-B.1.1 is COMPLETE when all CKs are green.

### CK-1 — Brief lifecycle propagation works

`workflow_complete → stage_complete → brief_complete` propagation fires correctly. Validated against (a) the stale `d542f0af` Brief on the Shadow Protocol document, which retroactively closes when the new propagation runs against existing accepted agent_jobs; and (b) a freshly-created multi-stage Brief whose stage 1 workflow accepts and triggers stage 2 setup. After propagation, the Brief's `status` is `completed` (or `active` advancing to next stage) and a `brief_completed` (or `stage_completed`) `role=system` row exists in `conversation_messages`.

### CK-2 — `cancel_brief` Director tool works

The Director registry V1.7 includes `cancel_brief`. The tool produces a `<brief_cancellation_proposal>` artefact (per H-08 — proposes, does not execute). User-facing approval card appears in the Director conversation; on Approve, the `cancel_brief` RPC runs; the Brief status transitions to `cancelled`; the partial unique index slot releases; cascade summary surfaces as a `cancel_cascade` system event row; if a queued Brief exists, it auto-promotes per CK-3.

### CK-3 — Sequential multi-Brief queueing works

Approving a second Brief while one is `active` lands as `status='queued'` with `sequence_position = max(existing) + 1`. The stricter partial unique index `briefs(document_id) WHERE status='active'` permits this (the V1.x-A.1 index `WHERE status IN ('planned','active')` is dropped in M-091). On predecessor completion, the lowest `sequence_position` queued Brief promotes to `active`; stage 1 trigger fires; `brief_activated` system event row emits. `get_brief_state` returns `{active, queue: [...]}` shape.

### CK-4 — Stage-trigger-invokes-Director hook works

When a stage's `after_stage:N` trigger fires (predecessor completes), the scheduler creates a system-initiated Director turn with the stage context. The Director re-reads state via `get_brief_state` + document tools and proposes the workflow for the activated stage. Surfacing: full Director turn with subtle `SystemTurnHeader` cause label ("Triggered by Stage 1 completion") and an inline PlanCard for the proposed workflow. User approves at the normal workflow gate.

### CK-5 — Per-iteration Director-turn decomposition works

A Director turn executes as N scheduler-dispatched single-shot iteration jobs, not one long-lived function. Each iteration:

1. Loads turn state from `director_iterations` (messages array, accumulated tool_use blocks, suppression state).
2. Runs one Anthropic streaming call with one tool-use cycle.
3. Persists state at iteration end (`status='completed'`, `accumulated_proposals` JSONB).
4. Publishes events to Realtime channel `director_turn:{turn_id}`.
5. Enqueues iteration N+1 if more iterations are needed; exits.

Mid-turn function crash recovers from the last completed iteration boundary (verified by PROCESS KILL between iterations 2 and 3 of a 4-iteration turn — iteration 3 re-runs cleanly; user sees a short "Director is reconnecting…" indicator, not a Resume prompt). Realtime channel events stream to the client across function invocations. Turn-final state is identical to the legacy single-function-execution baseline (semantic regression test against V1.x-A.1 conversation outputs).

### CK-6 — Atom-size guardrails reject too-big operations

Pre-flight check evaluates configurable caps from `platform_config`. Tested for:

- **Per-tool result-size cap** — fabricated `get_node_tree` request with depth 8 against an enormous fixture exceeds `constraints.max_tool_result_bytes` → tool returns structured Class D error → entry written to `constraint_violations` with the limit hit, attempted value, configured cap, and context. Director sees the Class D failure and surfaces it conversationally.
- **Max-iterations-per-turn cap** — synthetic test forces a Director turn to exceed `constraints.max_iterations_per_turn` → the next iteration enqueue is refused; turn ends with Class D error; Director conversation surfaces "request exceeded N-iteration cap."

### CK-7 — Throttle interface contract honored

`throttle.mayDispatch(job, {route})` is the single entry point for both Director-iteration jobs and agent_jobs. Verified by:

- **Interface assertion** — every call site in the dispatch path passes `route` explicitly; no implicit defaults.
- **Behavioural test (`route=platform`)** — submits 3 jobs; only 1 runs at a time; remaining 2 sit in `pacing` until predecessor completes. Preserves the M-046 semantics.
- **Behavioural test (`route=byok` placeholder)** — passes `route=byok`; throttle returns immediately with no cap; job dispatches without queuing. (B.1.2 wires this path to the actual BYOK Edge Function dispatcher; B.1.1 verifies the *interface contract* holds.)

### CK-8 — Tiered system events surface correctly

Lifecycle-significant events emit as inline `role=system` rows in `conversation_messages` with the appropriate `event_type`:

- `cancel_cascade` (Brief or workflow cancellation with cascade summary)
- `stop` / `resume`
- `brief_activated` / `brief_completed`
- `stage_trigger_fired` (when scheduler-initiated turn opens a Director planning sequence)
- `failure_class_b` / `failure_class_c` / `failure_class_d` / `failure_class_e` (when failures need user attention)

Routine parameter edits emit nothing:

- Reschedule (`scheduled_at` change in SchedulerPanel)
- Execution intent toggle (`immediate` ↔ `scheduled`)

The Director picks up the silent edits via `get_scheduler_state` on its next conversational turn.

### CK-9 — AppShellStatusIndicator updates live

Per Component Spec v2.10 §17.1 (location, surface content) + v2.11 amendments (popover interaction model). Persistent bottom-right corner placement; non-blocking. Surface displays Director state badge + scheduler state counters + cost meter (compact form) + alert dot. **B.1.1 scope: Director state + scheduler counters + alert dot are live; cost meter compact form is mounted as a placeholder skeleton** (the data feed lights up in V1.x-C). Click-through behaviours route to the Director tab / SchedulerPanel / failure surface respectively. Realtime-subscribed to `director_iterations` + `agent_jobs` + `briefs`. No flashing on state transitions; subtle one-time pulse on 0→N alert dot transition is acceptable.

### CK-10 — Director tab indicator works

Small badge appears on the Director tab in `ModeTabBar` when the current document has any Director-conversation row in `awaiting_user_action` state (pending Brief proposal, pending workflow plan, pending profile amendment, pending cancellation proposal). Badge clears when the user opens the Director tab and views the pending item. Visual treatment: attention-amber dot (not verdigris — Inviolable #2 unchanged; verdigris-use #7 family does not extend to passive notifications).

### CK-11 — SchedulerPanel direct-manipulation works

Routable view at `/projects/[projectId]/scheduler` (per §3.7 below — full-page route is consistent with CS v2.10 §17.4 "Routable view" and matches the dashboard pattern of separate route for separate concern). Surfaces:

- Brief → Stage → Workflow → Step hierarchy as a tree (read-only display).
- Stop button (workflow + step level) with confirmation modal.
- Cancel button (workflow / stage / brief levels) with cascade-confirmation modal listing what will be cancelled.
- Reschedule field (`scheduled_at` inline edit on `parked` / `scheduled` items).
- Execution intent toggle (`immediate` ↔ `scheduled`; `batched_24h` deferred to B.2).

All actions route through the single internal scheduler API shared with Director write tools (`lib/scheduler/`). No alternative dispatch path.

### CK-12 — Existing V1.x-A.1 regressions pass

All 34 V1.x-A.1 Vitest unit tests + 8 V1.x-A.1 Playwright integration tests pass unchanged. Director executor tool-use protocol (SU-47 messages-array) semantics preserved across the per-iteration decomposition refactor. Profile + Brief substrate tests still green. No semantic regression in the existing Director conversation flow when measured against a captured baseline turn from V1.x-A.1.

### CK-13 — Pre-merge invariants

```
npm run type-check     # exit 0
npm run lint           # 0 errors
npm run build          # passes
diff CLAUDE.md docs/CLAUDE_stelavox_project.md   # empty
```

Plus: H-10 discipline — `lib/types/database.ts` regenerated via `supabase gen types typescript --local > lib/types/database.ts` after migrations land.

### CK-14 — Test Report + close-out

`docs/stelavox_v1x_b_1_1_test_report_v1_0.md` records every CK as PASS or explicit deferral. Spec doc amendments per §4 land in lockstep. CLAUDE.md bumps to v1.27 with the V1.x-B.1.1 changelog entry. New `project_v1x_b_1_1_shipped.md` memory authored; `project_v1x_b_next_session_prep.md` updated to point at B.1.2.

---

## 3. Ordered Task List

### 3.1 Migrations — schema + RPCs + cron + Director config

#### T-1.1 — Migration 091: `briefs` schema for sequential multi-Brief

`supabase/migrations/20260514000091_briefs_sequential_multi.sql`:

- DROP partial unique index `briefs_one_active_per_document_uidx` (the V1.x-A.1 `WHERE status IN ('planned','active')`).
- CREATE partial unique index `briefs_strict_one_active_per_document_uidx ON briefs(document_id) WHERE status = 'active'`.
- ALTER TABLE briefs ADD COLUMN `sequence_position INT NOT NULL DEFAULT 0`.
- ALTER TABLE briefs ADD COLUMN `cause TEXT NOT NULL DEFAULT 'user_initial'` with CHECK constraint admitting `user_initial`, `sequence_promotion`, future-extensible. Backfill existing rows to `'user_initial'`.
- ALTER TABLE briefs DROP CONSTRAINT briefs_status_check (the existing 4-value constraint).
- ALTER TABLE briefs ADD CONSTRAINT briefs_status_check CHECK (status IN ('planned','queued','active','completed','cancelled')).

Comment header documents the V1.x-A.1 → V1.x-B.1.1 transition; references design record §10.

#### T-1.2 — Migration 092: `agent_jobs` queue extensions

`supabase/migrations/20260514000092_agent_jobs_queue_extensions.sql`:

- ADD COLUMN `traffic_class INT NOT NULL DEFAULT 2` (1=interactive Director / 2=author-foreground / 3=background batch / 4=scheduled+parked; B.1.1 default = 2; full WFQ classifier in B.2).
- ADD COLUMN `execution_intent TEXT NOT NULL DEFAULT 'immediate'` CHECK in (`immediate`, `parked`, `scheduled`, `batched_24h`).
- ADD COLUMN `scheduled_at TIMESTAMPTZ NULL`.
- ADD COLUMN `cause TEXT NULL` (free-text + structured event types; e.g. `director_iteration`, `workflow_step`, `stage_trigger`).
- ADD COLUMN `route TEXT NOT NULL DEFAULT 'platform'` CHECK in (`platform`, `byok`).
- ADD COLUMN `reservation_id UUID NULL` FK → `throttle_reservations(id)` (M-095).
- INDEX on `(status, scheduled_at)` for queue lookups.
- INDEX on `(traffic_class, status, scheduled_at)` for class-aware dispatch.

#### T-1.3 — Migration 093: `director_iterations` table

`supabase/migrations/20260514000093_director_iterations.sql`:

- CREATE TABLE `director_iterations` per design record §6 substrate:
  - `id UUID PK`
  - `turn_id UUID NOT NULL` FK → `agent_jobs(id)` (the Director turn's parent job)
  - `iteration_number INT NOT NULL` (1, 2, 3, …)
  - `status TEXT NOT NULL` CHECK in (`pending`, `running`, `completed`, `failed`, `interrupted`, `cancelled`)
  - `started_at TIMESTAMPTZ NULL`
  - `completed_at TIMESTAMPTZ NULL`
  - `last_heartbeat_at TIMESTAMPTZ NULL`
  - `failure_class TEXT NULL` CHECK in (`A`, `B`, `C`, `D`, `E`) (5-class taxonomy as data shape; B.1.1 populates A/B/D/E; C lights up in B.2)
  - `messages_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb` (Anthropic messages-array state at iteration start)
  - `accumulated_proposals JSONB NOT NULL DEFAULT '[]'::jsonb` (proposals collected across iterations)
  - `tokens_in BIGINT`, `tokens_out BIGINT`, `cost_credits BIGINT` (per-iteration cost transparency)
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - UNIQUE (`turn_id`, `iteration_number`)
- RLS: scoped via `turn_id → agent_jobs → conversation_messages → conversations → documents → organisation`.
- Index on `(turn_id, iteration_number)` and `(status, last_heartbeat_at)` (recovery sweep query).

#### T-1.4 — Migration 094: `constraint_violations` telemetry table

`supabase/migrations/20260514000094_constraint_violations.sql`:

- CREATE TABLE `constraint_violations` per design record §8:
  - `id UUID PK`
  - `violation_type TEXT NOT NULL` (e.g. `tool_result_size_exceeded`, `iterations_per_turn_exceeded`, `profile_size_warned`)
  - `attempted_value BIGINT NOT NULL`
  - `configured_cap BIGINT NOT NULL`
  - `context JSONB NOT NULL` (operation type, tool name, document_id, brief_id, etc.)
  - `user_id UUID FK` → auth.users
  - `organisation_id UUID FK` → organisations
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- RLS: service-role only (write); admin-only (read; future admin dashboard surface).

#### T-1.5 — Migration 095: `throttle_reservations` table

`supabase/migrations/20260514000095_throttle_reservations.sql`:

- CREATE TABLE `throttle_reservations` per Director Arch v2.0 §9.9 + H-17 mitigation:
  - `id UUID PK`
  - `route TEXT NOT NULL` CHECK in (`platform`, `byok`)
  - `traffic_class INT NULL` (NULL for byok pass-through)
  - `slots_reserved INT NOT NULL DEFAULT 1`
  - `tokens_reserved BIGINT NOT NULL DEFAULT 0`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `expires_at TIMESTAMPTZ NOT NULL` (created_at + `throttle.reservation_ttl_seconds`)
  - `consumed_at TIMESTAMPTZ NULL`
  - `released_at TIMESTAMPTZ NULL`
- Index on `(route, traffic_class, expires_at)` (sweep query).
- RLS: service-role only.

#### T-1.6 — Migration 096: `conversation_messages` system-event extensions

`supabase/migrations/20260514000096_conversation_messages_system_events.sql`:

- ALTER TABLE conversation_messages ADD COLUMN `event_type TEXT NULL` CHECK in (`stage_trigger_fired`, `brief_activated`, `brief_completed`, `stage_completed`, `cancel_cascade`, `stop`, `resume`, `failure_class_b`, `failure_class_c`, `failure_class_d`, `failure_class_e`).
- ALTER TABLE conversation_messages ADD COLUMN `event_payload JSONB NULL` (typed per event; e.g. cancel_cascade carries `{cancelled_count, completed_count}`).
- ALTER TABLE conversation_messages ADD COLUMN `cause TEXT NULL` (e.g. `user_action`, `scheduler_trigger`, `system_recovery`).
- ALTER TABLE conversation_messages DROP CONSTRAINT conversation_messages_role_check (existing 2-value).
- ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_role_check CHECK (role IN ('user','assistant','system')).
- ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_system_requires_event CHECK ((role = 'system' AND event_type IS NOT NULL) OR (role <> 'system' AND event_type IS NULL)).

Realtime publication already includes `conversation_messages`; no publication change.

#### T-1.7 — Migration 097: Brief lifecycle SECURITY DEFINER RPCs

`supabase/migrations/20260514000097_brief_lifecycle_rpcs.sql`:

- `propagate_brief_completion(p_brief_id UUID) RETURNS void` SECURITY DEFINER — called by `accept_agent_job` (extended in M-098 below) and by direct paths. Logic: check if all stages in the Brief have `status='completed'`; if yes, transition Brief to `completed`; insert `brief_completed` system event row in the document's primary conversation; call `promote_next_queued_brief` for the document.
- `complete_brief_stage_workflow(p_workflow_id UUID) RETURNS void` SECURITY DEFINER — called by the workflow execution layer when the last step in a workflow accepts. Logic: transition the linked stage to `completed`; insert `stage_completed` system event row; advance `briefs.current_stage_id` to next stage in order; if no next stage, call `propagate_brief_completion`.
- `promote_next_queued_brief(p_document_id UUID) RETURNS UUID` SECURITY DEFINER — finds lowest `sequence_position` Brief on the document with `status='queued'`; if found, transitions to `active`; inserts `brief_activated` system event row; fires stage 1 trigger via direct insert into the Director-turn enqueue path. Returns the promoted Brief id (NULL if none queued).
- `cancel_brief(p_brief_id UUID, p_reason TEXT) RETURNS jsonb` SECURITY DEFINER — extends V1.x-A.1's `cancel_brief`. Logic: transition Brief to `cancelled`; cascade-cancel descendant workflows + steps + agent_jobs (counting cancelled vs already-completed for the cascade summary); insert `cancel_cascade` system event row carrying `{cancelled_count, completed_count, reason}`; call `promote_next_queued_brief` for the document. Returns the cascade summary jsonb for the API route to surface.

All RPCs include `SET search_path = public` per H-13.

#### T-1.8 — Migration 098: `accept_brief` revised + `accept_agent_job` extended

`supabase/migrations/20260514000098_accept_brief_revised.sql`:

- Revise `accept_brief` (from V1.x-A.1 M-086) — when an active Brief exists on the document, insert with `status='queued'` + `sequence_position = COALESCE(MAX(sequence_position), 0) + 1` + `cause='user_initial'`. When no active Brief exists, insert as `status='active'` directly + `sequence_position=0`. Returns the Brief id and resolved status so the API route can surface "queued behind X" or "started" copy.
- Extend `accept_agent_job` (from M-090) — at the existing acceptance commit point, if `agent_jobs.workflow_step_id` is the last incomplete step in its workflow, call `complete_brief_stage_workflow(p_workflow_id)`. The version-bump GUC behaviour is unchanged.

#### T-1.9 — Migration 099: scheduler tick + recovery sweep cron

`supabase/migrations/20260514000099_scheduler_cron.sql`:

- pg_cron job `scheduler_tick` — runs every `scheduler.tick_interval_ms` (default 1000ms; configurable). Body:
  - Dispatch ready jobs: `SELECT … FROM agent_jobs WHERE status='ready' AND (scheduled_at IS NULL OR scheduled_at <= now()) ORDER BY traffic_class, queued_at FOR UPDATE SKIP LOCKED LIMIT N` per H-11; each row passes through `lib/scheduler/` (server-side) for throttle gate + dispatch.
  - Evaluate stage triggers: `SELECT … FROM brief_stages WHERE status='planned' AND trigger_type='after_stage' AND <predecessor completed>` → for each, insert system-initiated Director turn into `conversation_messages` and enqueue the iteration job.
  - Sweep stale throttle reservations: `UPDATE throttle_reservations SET released_at=now() WHERE expires_at < now() AND consumed_at IS NULL AND released_at IS NULL`. (H-17 mitigation.)
- pg_cron job `recovery_sweep` — runs every `scheduler.recovery_sweep_interval_ms` (default 30000ms). Body:
  - Detect interrupted Director iterations: `UPDATE director_iterations SET status='interrupted' WHERE status='running' AND last_heartbeat_at < now() - interval '60 seconds'`; for each, re-enqueue at the same `iteration_number` (idempotent — see CK-5).
  - Detect interrupted agent_jobs (existing Phase 5b heartbeat path; unchanged).

#### T-1.10 — Migration 100: Director config v1.7

`supabase/migrations/20260514000100_director_config_v1_7.sql`:

- UPDATE existing v1.6 row → `status='deprecated'`.
- INSERT v1.7 row with:
  - `system_prompt` body sourced from `prompts/director_v1_7_system_prompt.md` (T-2.1 below)
  - `tool_suite` array: 17 tools (the V1.6 16 + `cancel_brief`)
  - `model_id`, temperature, max_tokens carried from v1.6
  - `metadata` JSONB documenting the v1.6 → v1.7 diff
- Migration body invokes `director_configs_replace_active(...)` helper (existing) so the active config switches atomically.

#### T-1.11 — Migration 101: new `platform_config` keys

`supabase/migrations/20260514000101_platform_config_v1_x_b_1_1.sql`:

- INSERT keys (all per H-12 — no hardcoded operational values):

| Key | Value | Notes |
|---|---|---|
| `scheduler.tick_interval_ms` | 1000 | pg_cron tick body cadence |
| `scheduler.recovery_sweep_interval_ms` | 30000 | heartbeat-stale detection cadence |
| `throttle.reservation_ttl_seconds` | 60 | H-17 mitigation; reservation cleanup |
| `throttle.platform_concurrent_dispatch_cap` | 1 | replaces M-046's `agent.director_max_concurrent_dispatch`; B.2 swaps for WFQ |
| `constraints.max_tool_result_bytes` | 524288 | 512 KB; tunable via `constraint_violations` telemetry |
| `constraints.max_iterations_per_turn` | 20 | matches existing `agent.director_max_tool_iterations` initial value |
| `constraints.max_profile_size_bytes` | 65536 | 64 KB soft watch; logs violations but doesn't reject in B.1.1 |
| `director.iteration_timeout_seconds` | 120 | per-iteration function timeout safety margin (Vercel ceiling 300) |
| `director.iteration_heartbeat_interval_seconds` | 10 | heartbeat write cadence within an iteration |

- Mark M-046's `agent.director_max_concurrent_dispatch` as deprecated (preserve row for rollback safety; new code reads `throttle.platform_concurrent_dispatch_cap`).

#### T-1.12 — Apply migrations + regenerate types

```
supabase migration up --local
supabase gen types typescript --local > lib/types/database.ts
npm run type-check
```

Verify Shadow Protocol data state per CK-1 acceptance: stale Brief `d542f0af` retroactively closes during M-097 `propagate_brief_completion` if its workflow is fully accepted. Confirm via Studio query.

### 3.2 Director system prompt v1.7

#### T-2.1 — Author `prompts/director_v1_7_system_prompt.md`

Diffs from v1.6:

- **"The Brief" section** revised — adds sequential multi-Brief framing. When `get_brief_state` returns a non-null `active` Brief and the user prompts a new operation, default behaviour is to propose a Brief that will queue (cause: `sequence_promotion`); the Director communicates "This will queue behind your current Brief and start when that completes." Override path: if the user explicitly says "instead of" or "stop the current one and do this," propose a `cancel_brief` first, then the new Brief.
- **Tool registry** — `cancel_brief` added with usage guidance: when to propose (user explicitly requests cancel; Director recognises a stuck Brief; user pivots scope dramatically); not the same as Stop (which is a workflow-level pause). Cancel is destructive — always frame as a proposal, never as a fait accompli.
- **`get_brief_state` shape** — extended to return `{active, queue: [...]}`; Director must check both fields when planning.
- **System-initiated turn framing** — when the conversation context contains a `role=system` event with `event_type='stage_trigger_fired'`, the Director recognises it as a planning prompt rather than a user message. Plan the workflow for the activated stage; reference the trigger explicitly in the response ("Stage 2's trigger fired — here's the workflow plan").
- **Atom-size guardrail awareness** — Director sees the configured caps as facts in its prompt (per Director Arch v2.0 §5.1). Plain-language listing: "Per-tool result-size cap: ~512 KB. Max iterations per turn: 20." When approaching a cap, Director volunteers the constraint conversationally rather than waiting for a hard rejection.

Prompt length: aim for delta ≤ 500 tokens vs v1.6 to preserve cache headroom under the per-iteration decomposition (each iteration replays the system prompt; cache discipline matters more under §8.1a).

### 3.3 Library module decomposition

#### T-3.1 — New `lib/scheduler/`

Files:

- `lib/scheduler/types.ts` — `JobDispatchRequest`, `ThrottleDecision`, `ReservationHandle`, `StageTriggerEvent`.
- `lib/scheduler/dispatcher.ts` — `dispatchReadyJobs()` (pg_cron tick body; reads queue + throttle + dispatches); `enqueueJob(spec)` (single internal API for both Director iteration jobs and agent_jobs).
- `lib/scheduler/throttleInterface.ts` — `mayDispatch(job, {route})` returns `{decision: 'dispatch' | 'pace' | 'reject', reservation?, retryAfterMs?}`. B.1.1 implementation: `route='platform'` → check `throttle.platform_concurrent_dispatch_cap` against running count; `route='byok'` → always `dispatch` with a no-op reservation. **Module surface is the contract** — B.2 swaps the implementation, the surface stays.
- `lib/scheduler/reservation.ts` — `reserve({route, slots, tokens})` (atomic INSERT into `throttle_reservations`); `consume(reservationId)`; `release(reservationId)`; `sweepExpired()`.
- `lib/scheduler/stageTriggers.ts` — `evaluateStageTriggers()` (called by tick body); `enqueueDirectorPlanningTurn(stageId)` (system-initiated turn substrate).
- `lib/scheduler/recoverySweep.ts` — `sweepInterruptedIterations()`; `sweepInterruptedAgentJobs()`.
- `lib/scheduler/index.ts` — public surface.

Single internal API consumed by both Director write tools (when proposing schedule changes) and SchedulerPanel (when user directly manipulates).

#### T-3.2 — New `lib/iteration/`

Director-turn per-iteration substrate.

Files:

- `lib/iteration/types.ts` — `IterationState`, `IterationResult`, `IterationEvent`.
- `lib/iteration/store.ts` — `loadIterationState(turnId, n)`, `saveIterationState(state)`, `getLastCompletedIteration(turnId)`.
- `lib/iteration/runner.ts` — `runOneIteration(state): Promise<IterationResult>`; loads conversation history + tool definitions + system prompt, runs one Anthropic streaming call, persists state, returns `{nextIterationNeeded: boolean, accumulatedProposals, tokens, cost}`.
- `lib/iteration/realtime.ts` — `publishIterationEvent(turnId, event)` — Supabase Realtime broadcast helper; clients subscribe to `director_turn:{turnId}`.
- `lib/iteration/heartbeat.ts` — heartbeat writer (writes `director_iterations.last_heartbeat_at` every `director.iteration_heartbeat_interval_seconds`).

Idempotency invariant per design record §6: deterministic inputs (messages array + tool definitions + system prompt) + propose-only invariant (write tools don't write during the loop) → retry is safe. `runOneIteration` enforces this at the boundary.

#### T-3.3 — New `lib/constraints/`

Atom-size guardrails.

Files:

- `lib/constraints/types.ts` — `ConstraintCap`, `ViolationContext`.
- `lib/constraints/caps.ts` — `getCap(violationType)` reads from `platform_config` via `getConfig()`.
- `lib/constraints/preflight.ts` — `preflightCheck(operationType, attemptedValue, context): {ok: true} | {ok: false, violation}`.
- `lib/constraints/recordViolation.ts` — INSERT into `constraint_violations`.

Failure-class mapping per design record §8: limit-exceeded rejections are Class D (validation). Caller consumes `{ok: false, violation}` and surfaces a Class D failure response.

#### T-3.4 — Extend `lib/brief/`

Files added:

- `lib/brief/completeBriefStage.ts` — wraps `complete_brief_stage_workflow` RPC.
- `lib/brief/propagateBriefCompletion.ts` — wraps `propagate_brief_completion` RPC.
- `lib/brief/promoteNextQueuedBrief.ts` — wraps `promote_next_queued_brief` RPC.
- `lib/brief/cancelBrief.ts` — wraps `cancel_brief` RPC.
- `lib/brief/getActiveAndQueuedBriefs.ts` — extended `getBriefState` returning `{active, queue: [...]}`.

Files updated:

- `lib/brief/getBriefState.ts` — returns `{active, queue}` shape.
- `lib/brief/types.ts` — `BriefState` shape extended; `queued` status added to enum.

#### T-3.5 — Extend `lib/director/tools/read.ts`

`execGetBriefState` returns `{active, queue}` shape. JSON serialisation contract documented in T-4.1 schemas.

#### T-3.6 — Extend `lib/director/tools/write.ts`

New `execCancelBrief(input): WriteToolResult` — produces a `<brief_cancellation_proposal>` artefact (per H-08; design decision per Q3 of the proposal — propose-first, not execute-inline). `WriteToolResult` shape extended with optional `brief_cancellation_proposal: {brief_id, current_active_status, reason}`.

#### T-3.7 — Refactor `lib/director/executor.ts` for per-iteration decomposition

Substantial change. Conceptual diff:

**Before (V1.x-A.1):** single function holds the loop across iterations 1..N within one HTTP request. Iteration boundaries are in-process; turn state lives in function-local variables; mid-turn crash loses everything from iteration 1 onward.

**After (V1.x-B.1.1):** the executor's public surface (`startDirectorTurn(input)`) creates a turn registry row + the iteration-1 row, enqueues the iteration-1 job via `lib/scheduler/`, and returns. The new `runDirectorIteration(turnId, iterationNumber)` function (called by the scheduler dispatcher when the iteration job picks up) does exactly one iteration:

1. Load iteration state via `lib/iteration/store`.
2. Run one Anthropic streaming call via `lib/iteration/runner` — this is the irreducible atom (per design record §7).
3. Publish per-delta events to Realtime channel `director_turn:{turnId}` via `lib/iteration/realtime`.
4. Heartbeat every `director.iteration_heartbeat_interval_seconds` via `lib/iteration/heartbeat`.
5. At iteration end: save state; mark iteration `completed`; if more iterations needed, enqueue iteration N+1 via `lib/scheduler/`; exit.

Existing `TurnEvent` event types preserved on the Realtime channel. SU-47 messages-array contract preserved. Suppression-state handling moves into iteration state (persisted in `messages_snapshot`).

#### T-3.8 — Update `lib/director/parse-message-proposals.ts`

Add `<brief_cancellation_proposal>` to the suppression tag set so it's stripped from rendered text. Add system-event suppression for `<system_event>` tags if any prompt-side templating uses them (revisit during T-2.1 prompt authoring).

### 3.4 Director tool registry V1.7

#### T-4.1 — `lib/director/schemas.ts` updates

- Add `cancel_brief` Zod schema (input: `{brief_id: uuid, reason: string}`).
- Add `BriefCancellationProposal` Zod schema for the artefact shape.
- Update `GetBriefStateResponse` Zod schema to `{active: BriefState | null, queue: BriefStateLite[]}`.
- Auto-gen tool input_schemas for the Anthropic API per round-3 audit B6.1 (existing pattern).

#### T-4.2 — `lib/director/tools/index.ts` updates

- Add `cancel_brief` to tool list.
- Wire to `execCancelBrief` from T-3.6.
- Tool count: 17.

### 3.5 Realtime channel + publication

#### T-5.1 — Realtime publication ADD for `director_iterations`

`supabase/migrations/20260514000093_director_iterations.sql` (combined into M-093 above to avoid a thin extra migration):

- ALTER PUBLICATION supabase_realtime ADD TABLE director_iterations.

Clients subscribe to `director_turn:{turn_id}` channel via Supabase Realtime broadcast (not direct table subscription) — broadcast is initiated by `lib/iteration/realtime.publishIterationEvent` which writes events the channel subscribers receive.

#### T-5.2 — Realtime smoke for `conversation_messages` system rows

Verify `role='system'` rows propagate through existing `conversation_messages` realtime subscription (publication already includes the table). RLS allows the relevant subset; CK-8 confirms.

### 3.6 API routes

#### T-6.1 — Scheduler routes

- `GET /api/scheduler/queue` — paginated, filterable by `(brief_id?, document_id?, status?)`; returns the Brief → Stage → Workflow → Step tree shape + queue position estimates. RLS-gated.
- `POST /api/scheduler/jobs/[id]/stop` — Stop (resumable halt) per design record §3. Cascade summary computed server-side and returned for the modal.
- `POST /api/scheduler/jobs/[id]/cancel` — Cancel (terminal) per design record §3. Cascade summary computed server-side; user-confirmation modal flow on the client.
- `POST /api/scheduler/jobs/[id]/reschedule` — change `scheduled_at`. Returns updated row. **No system event emitted** (silent edit per CK-8).
- `POST /api/scheduler/jobs/[id]/intent` — change `execution_intent` (immediate ↔ scheduled). **No system event emitted.**

#### T-6.2 — Brief queue routes

- `POST /api/brief/[id]/cancel` — extended from V1.x-A.1 with cascade summary in the response and emission of `cancel_cascade` system event row (M-097).
- `POST /api/brief/queue/reorder` — drag-reorder; updates `sequence_position` for the document's queued Briefs atomically. Active Brief is not reorderable.
- `GET /api/brief/document/[documentId]/queue` — returns `{active, queue}` shape for SchedulerPanel + BriefViewer.

#### T-6.3 — Director iteration internals

No public routes. The scheduler dispatcher invokes `runDirectorIteration(turnId, iterationNumber)` directly via the dispatch path (server-internal). Realtime channel `director_turn:{turn_id}` is the client-facing surface.

#### T-6.4 — Status indicator

- `GET /api/status/pending-attention` — for `AppShellStatusIndicator` first-render hydrate (Realtime is the live update path). Returns `{director_state, scheduler_counts, alert_count, alerts: [...]}`.
- `GET /api/status/document/[documentId]/pending-director` — for `ModeTabBar` Director tab indicator. Returns `{has_pending: boolean, types: ['brief_proposal' | 'workflow_plan' | 'profile_amendment' | 'brief_cancellation_proposal']}`.

### 3.7 UI components

#### T-7.1 — `components/scheduler/SchedulerPanel.tsx`

New component. Routable view at `/projects/[projectId]/scheduler`. Composition:

- Header — project title + active Brief summary + Cancel-project CTA.
- Queue tree — Brief → Stage → Workflow → Step rows via `QueueRow` (T-7.2). Realtime-subscribed to `briefs`, `brief_stages`, `workflows`, `workflow_steps`, `agent_jobs`.
- Inline edit affordances per `QueueRow`.

Per Component Spec v2.10 §17.4 — routable view, accessible from `AppShellStatusIndicator` click-through and main navigation. **Design call (CS v2.11 amendment):** mount as full-page route at `/projects/[projectId]/scheduler` (consistent with the dashboard pattern; matches design record §4 mental-model split "talk to Director / touch scheduler"; no competition with Director Panel context). Modal/drawer overlay was rejected because (a) brand discipline favours non-blocking calm surfaces and a modal mid-Director-conversation creates context conflict, (b) the Brief → Stage → Workflow → Step tree benefits from screen real estate, (c) the dashboard pattern of separate route for separate concern is already established.

Inviolable discipline: Inter typography only (structural panel); no verdigris use (Cancel + Stop buttons are neutral primary; cascade-confirm modal handles affirmative-action gate, but the gate's confirmation button is destructive-styled per existing destructive-action token pattern, not verdigris use #7).

#### T-7.2 — `components/scheduler/QueueRow.tsx`

New. Single queue entry row with status badge (using existing `StageCard` pattern from CS v2.10 §17.3 where applicable). Actions per level:

- **Step** — view detail; Cancel.
- **Workflow** — Stop / Cancel / view detail; reschedule + intent toggle inline.
- **Stage** — Cancel (cascade modal).
- **Brief** — Cancel (full cascade modal).

#### T-7.3 — `components/scheduler/CancelCascadeModal.tsx`

New. Lists what will be cancelled with confirmation. Matches the Component Spec v2.10 §9.1 Modal sub-rule (scrollable body for long cascade lists). Confirmation copy structured per cascade level.

#### T-7.4 — `components/layout/AppShellStatusIndicator.tsx`

New (per CS v2.10 §17.1 spec; B.1.1 lights up the Director-state + scheduler-counters + alert-dot surfaces; cost meter compact form mounted as placeholder skeleton until V1.x-C). Bottom-right corner placement; non-blocking. Realtime-subscribed to relevant substrates. Click-through routes per spec.

CS v2.11 amendment: confirms B.1.1 ships the substrate AppShellStatusIndicator depends on; promotes the spec from "V1.x-D" tag to "V1.x-B.1.1 (substrate) + V1.x-D (cost-meter feed)" two-phase delivery.

#### T-7.5 — `components/layout/StatusIndicatorPopover.tsx`

New. Opens on `AppShellStatusIndicator` click. Lists pending Director attention items grouped **by document** (design call — most coherent grouping for the user's mental model; date-grouping deferred to V1.x-D as a power-user refinement). Each row deep-links to the Director conversation with the relevant proposal scrolled into view.

#### T-7.6 — `components/layout/ModeTabBar.tsx`

Extended. Director tab row gains a small badge (attention-amber dot, not verdigris — passive-notification surface; verdigris-use #7 family covers user-driven affirmative-action, not passive notifications). Visible when `GET /api/status/document/[documentId]/pending-director` returns `has_pending=true`. Realtime-subscribed.

#### T-7.7 — `components/director/BriefViewer.tsx` extended

Status badge now reflects `active` / `queued · position N`. Queue list visible below active Brief on hover or expand (small inline list per design record §10). Cancel affordance visible on `active` (via Director conversation card + scheduler panel; the Brief viewer itself stays read-only per existing CS v2.10 §17.2).

#### T-7.8 — `components/director/SystemEventMessage.tsx`

New. Lightweight inline event rendering for `role=system` rows with `event_type` in the lightweight set (`brief_activated`, `brief_completed`, `cancel_cascade`, `stop`, `resume`). Visual: one-line muted text with timestamp; small icon per event type; no card chrome. Inter 11px `--color-text-muted`.

#### T-7.9 — `components/director/SystemTurnHeader.tsx`

New. Subtle cause label rendered above a system-initiated full Director turn. Visual: Inter 11px `--color-text-muted`, single line ("Triggered by Stage 1 completion"), no background, no icon. Body of the turn renders as a normal Director message with the standard PlanCard inline.

#### T-7.10 — `components/director/DirectorPanel.tsx` extended

Conversation-thread renderer dispatches on row type:

- `role='user'` → existing `UserMessage`.
- `role='assistant'` → existing `DirectorMessage` + inline cards (`PlanCard`, `BriefProposalCard`, `ProjectProfileAmendmentCard`, **new** `BriefCancellationProposalCard` from T-7.12).
- `role='system'` with lightweight `event_type` → `SystemEventMessage` (T-7.8).
- `role='system'` with full-turn `event_type='stage_trigger_fired'` → group with the following `assistant` row under a `SystemTurnHeader` (T-7.9).

#### T-7.11 — `components/director/BriefCancellationProposalCard.tsx`

New. Renders a `<brief_cancellation_proposal>` artefact with single Approve button (verdigris use #7 — within the existing affirmative-action triggers family, no Inviolable broadening needed). Shows the cascade preview ("This will cancel N pending workflows; M completed steps will remain") inline. On Approve → calls `POST /api/brief/[id]/cancel`.

#### T-7.12 — Document page wiring

- `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` — no structural change (BriefViewer already present from V1.x-A.1; T-7.7 extends it).
- `app/(app)/layout.tsx` (or AppShell equivalent) — mount `AppShellStatusIndicator` once globally.
- `app/(app)/projects/[projectId]/scheduler/page.tsx` — new route mounting `SchedulerPanel`.

### 3.8 Tests

#### T-8.1 — Vitest unit tests

New files under `tests/unit/`:

- `v1x-b1-scheduler-tick.test.ts` — `dispatchReadyJobs` selects ready jobs in `(traffic_class, queued_at)` order; honours `FOR UPDATE SKIP LOCKED` (H-11); evaluates stage triggers correctly.
- `v1x-b1-throttle-interface.test.ts` — `mayDispatch({route})` returns `dispatch` for byok; returns `pace` for platform when at cap; returns `dispatch` for platform when below cap.
- `v1x-b1-atom-size-guardrails.test.ts` — `preflightCheck` rejects too-big tool result; `recordViolation` writes to `constraint_violations`; mapping to Class D failure shape correct.
- `v1x-b1-iteration-runner.test.ts` — `runOneIteration` is idempotent under retry (mock Anthropic call); state persists at iteration end; heartbeat writes during.
- `v1x-b1-brief-queue-lifecycle.test.ts` — `accept_brief` lands as queued when active exists; `promote_next_queued_brief` selects lowest `sequence_position`; `cancel_brief` cascades correctly + auto-promotes next.
- `v1x-b1-brief-completion-propagation.test.ts` — `complete_brief_stage_workflow` advances stage; `propagate_brief_completion` closes Brief when last stage done; emits the right system events.
- `v1x-b1-system-event-render.test.ts` — `DirectorPanel` row dispatcher routes `role=system` rows to the right component variant.
- `v1x-b1-parse-message-proposals.test.ts` — `<brief_cancellation_proposal>` parsed and stripped from rendered text.

#### T-8.2 — Playwright integration tests

New files under `tests/v1x-b1/`:

- `scheduler-substrate.spec.ts` — end-to-end multi-Brief queue: create Brief A, kick off; create Brief B (lands queued); complete Brief A's only workflow; verify Brief B auto-promotes to active + system events emitted in conversation.
- `per-iteration-decomposition.spec.ts` — Director turn runs as multiple iterations; mid-turn function kill recovers from last completed iteration; Realtime channel events arrive on the client across function boundaries; turn-final state matches a captured V1.x-A.1 baseline.
- `scheduler-panel.spec.ts` — Stop, Cancel (with cascade modal), reschedule edit, intent toggle. Each action's effect verified against DB state + UI re-render.
- `app-shell-status-indicator.spec.ts` — quiet at zero pending; attention badge with correct count; popover groups by document; deep-link routes correctly. No flashing.
- `director-tab-indicator.spec.ts` — badge appears on Director tab when current document has pending approval; clears when user opens the tab.
- `cancel-brief-tool.spec.ts` — Director proposes `<brief_cancellation_proposal>`; user approves card; cascade-confirm modal flow; Brief cancelled; queue auto-promotion if applicable.
- `stage-trigger-invokes-director.spec.ts` — multi-stage Brief; stage 1 workflow accepts; system-initiated turn with `SystemTurnHeader` opens; Director plans stage 2; user approves.
- `brief-completion-propagation.spec.ts` — single-stage Brief workflow accepts; `brief_completed` system event emits; Brief status `completed`; verify against the stale `d542f0af` retroactive close path.

#### T-8.3 — Regression

```
npm run test:unit -- tests/unit/v1x-a1-*.test.ts          # 34 still pass
npm run test -- tests/v1x-a1/profile-and-brief-substrate.spec.ts  # 8 still pass
npm run test:unit -- tests/unit/                          # full unit suite
npm run test                                              # full Playwright suite (chunked per feedback_phase_session_procedure)
```

### 3.9 Close-out

#### T-9.1 — Test Report

Author `docs/stelavox_v1x_b_1_1_test_report_v1_0.md` recording every CK PASS / explicit deferral, with classification (spec gap / spec error / impl gap / env) for any iteration during the build.

#### T-9.2 — CLAUDE.md → v1.27

- Spec Library Reference rows updated for the bumped Tier-A docs (per §4 below).
- New Critical Component Specifications rows: `SchedulerPanel`, `AppShellStatusIndicator`, `Director tab indicator on ModeTabBar`, `SystemEventMessage`, `SystemTurnHeader`, `BriefCancellationProposalCard`.
- Hazards summary unchanged (B.1.1 implements H-17 mitigation; H-16 + H-18 mitigations carry; no new hazards expected — log any that surface).
- Migration count updated 90 → 101.
- Changelog entry summarising V1.x-B.1.1 ship.

#### T-9.3 — Memory updates

- New `project_v1x_b_1_1_shipped.md` capturing branch SHA, verdict, deferred items.
- Update `project_v1x_b_next_session_prep.md` to point at B.1.2 (BYOK substrate) as the next sub-phase.
- Mark V1.x-A.1 carry-over gaps (Brief auto-complete, missing `cancel_brief`) as resolved in `project_v1x_a1_test_round_closeout.md` MEMORY.md hook.
- `project_v1x_a1_shipped.md` retitled as historical snapshot.

#### T-9.4 — Merge to master

```
git push origin claude/v1x-b-1-1-substrate
git -C C:/dev/stelavox_2 checkout master && git pull
git -C C:/dev/stelavox_2 merge --no-ff claude/v1x-b-1-1-substrate -m "Merge V1.x-B.1.1 — scheduler engine + Brief lifecycle + UI substrate"
git -C C:/dev/stelavox_2 push origin master
```

---

## 4. Spec doc amendments landing in lockstep

The spec amendments below land **with** the V1.x-B.1.1 code merge — same commit set, same review gate, same close-out artefact. The Tier-B build checklist is the source-of-record for what gets implemented; the Tier-A docs are the source-of-record for the architectural commitments. Both need to ship together to keep the spec ↔ code mirror clean.

### §4.1 Director Architecture v2.2

Bumped from v2.0.2 + v2.1.0 (consolidates both forward into a single canonical doc). Filename: `docs/stelavox_director_architecture_v2_2.md`. Substantive changes:

- **§6 The Brief / The Project Profile** — preserves v2.1.0's V1.x-A.1 split; adds **§6.6 Sequential multi-Brief queue lifecycle** documenting the new `queued` status, `sequence_position` ordering, stricter partial unique index, queue-promotion mechanics, and `cause` column.
- **§8 Scheduler** — clarifies §8.1a per-iteration decomposition substrate split: A/B/D/E retry policy lands in B.1.1; C lights up in B.2. Adds **§8.7 Throttle interface contract** documenting the `route` parameter shape and B.1.1 vs B.2 implementation policy.
- **§9 Throttling** — clarifies that the contract surface (route-aware `mayDispatch`) lands in B.1.1 with trivial cap=1 platform / pass-through byok policy; full WFQ + per-user buckets + Class 1 reserved slots policy lands in B.2.
- **§10 Failure-mode taxonomy** — adds **§10.7 Atom-size guardrails** subsection documenting the configurable caps + pre-flight check + `constraint_violations` telemetry + Class D mapping.
- **§12 Conversation context model** — adds **§12.7 Tiered system event surfacing** subsection documenting the `role='system'` row pattern, lightweight vs full-turn rendering, and the silent-edit policy for routine parameter changes.
- **§15 UX surfaces** — extends §15.1 (AppShellStatusIndicator) to document the popover interaction model + Director tab indicator on ModeTabBar; clarifies B.1.1-vs-V1.x-D substrate-vs-data-feed split.
- **§16.1** — V1.x-B row split into B.1.1 / B.1.2 / B.2 / B.3 sub-rows with scope per design record §15. Cross-reference to `docs/sessions/v1x_b_design_session_record_2026-05-14.md`.
- **§17.4** clarification — five new H-NN hazards (H-16..H-20) implementation status: H-17 (reservation TTL) implemented in B.1.1; H-18 (preference type drift, V1.x-A.1 mitigation) carries; H-16 / H-19 / H-20 implementation as scoped in their respective phases.

Changelog entry documents the consolidation of v2.0.2 + v2.1.0 → v2.2.

### §4.2 TA v2.3.3

Bumped from v2.3.2. Filename stays at `docs/stelavox_technical_architecture_v2_3.md` per the in-file changelog convention used for v2.3.1 / v2.3.2. Substantive changes:

- **§3.5** — migration count moved 90 → 101.
- **§3.6** — new migration blocks for M-091 through M-101 with the inline schema delta.
- **§3.7.4** Canonical Configuration Keys — adds the nine new V1.x-B.1.1 keys (per T-1.11 above).
- **§5 Hazards** — H-17 entry gains a "Mitigation status: implemented in V1.x-B.1.1 via M-095 + M-099" footnote. H-16 / H-19 / H-20 carry. H-18 footnote already documents V1.x-A.1 implementation. **No new hazards expected** — flag any that emerge during the build.
- **§11 Phase Plan** — V1.x-B row split into V1.x-B.1.1 / V1.x-B.1.2 / V1.x-B.2 / V1.x-B.3 sub-rows. V1.x-B.1.1 row checkpoint set to "MET" at close-out.

### §4.3 Component Spec v2.11

Bumped from v2.10. Filename: `docs/stelavox_component_specification_v2_11.md`. Substantive changes:

- **§17.1 `AppShellStatusIndicator`** — promote phase tag from "V1.x-D" to "V1.x-B.1.1 (substrate) + V1.x-D (cost-meter data feed)" two-phase delivery. Add popover interaction model subsection (grouped by document with deep-link rows). Add Director tab indicator subsection (T-7.6 above; passive notification, attention-amber dot, not verdigris).
- **§17.2 `BriefViewer`** — extend to document the queue display ("Active" / "Queued · position N") and the inline expand for queue list. No verdigris use change.
- **§17.4 `SchedulerPanel`** — promote phase tag from "V1.x-D" to "V1.x-B.1.1 (engine + lifecycle controls + reschedule + intent toggle) + V1.x-D (Stop refinement, Resume/Discard, AI-changed flag, full Cancel UX) + V1.x-B.2 (`batched_24h` toggle) + V1.x-C (top-up CTA + budget cap)". Document the routable view at `/projects/[projectId]/scheduler` (full-page, not modal). Cancel-cascade modal sub-rule cross-referenced to §9.1.
- **New §17.7 `SystemEventMessage`** — lightweight inline event rendering for `role=system` rows with lightweight `event_type`. Inter 11px `--color-text-muted`. No verdigris use.
- **New §17.8 `SystemTurnHeader`** — subtle cause label above system-initiated Director turns. Inter 11px `--color-text-muted`. No verdigris use.
- **New §17.9 `BriefCancellationProposalCard`** — renders `<brief_cancellation_proposal>` with single Approve button (verdigris use #7 — affirmative-action triggers family, no Inviolable broadening needed).
- **§7.1 `DirectorPanel`** — extend the conversation-thread renderer description to cover the `role=system` row dispatch (lightweight vs full-turn variants).
- **Changelog entry** documenting the additions; verdigris-use count remains nine (cancellation proposal Approve falls within the existing #7 family).

### §4.4 Director config Migration M-100 (system prompt v1.7)

Documented at T-1.10 + T-2.1 above. Lands as part of the migration set; no separate spec doc.

### §4.5 Product Spec v1.10 (partial-update)

Bumped from v1.9. The user-facing surfaces V1.x-B.1.1 introduces (sequential multi-Brief queueing, SchedulerPanel as routable view, AppShellStatusIndicator presence) deserve product-spec coverage. Substantive additions:

- **§11 Director surfaces** subsection — sequential multi-Brief queue UX (queue-by-default-when-active, "queued behind X" copy, Cancel-and-replace path).
- **§12 Scheduling** subsection — SchedulerPanel as the direct-manipulation surface; Stop vs Cancel asymmetry; cascade confirmations.
- **§13 App shell** subsection — AppShellStatusIndicator visibility from every screen; Director tab indicator on the current document.

Defer the full traffic-engineering UX (BYOK toggle, batched_24h plan-card affordance, cost meter detail) to subsequent Product Spec bumps when B.1.2 / B.2 / V1.x-C land.

### §4.6 CLAUDE.md v1.27

Per T-9.2 above.

---

## 5. Changelog

**v1.0 — 2026-05-14** Initial version. Frozen for V1.x-B.1.1 build per `docs/sessions/v1x_b_design_session_record_2026-05-14.md` §15 four-way phase split. Substrate: master HEAD `156e3d2`; migration count 90; Director config v1.6. Carry-over gaps from V1.x-A.1 test round (Brief auto-complete propagation, missing `cancel_brief` tool, stale active Brief on Shadow Protocol) all closed by V1.x-B.1.1 scope. Spec doc amendments per §4 land in lockstep with the build (Director Architecture v2.2 consolidation; TA v2.3.3; Component Spec v2.11; Product Spec v1.10 partial-update; CLAUDE.md v1.27).
