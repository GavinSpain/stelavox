# Brief Orchestration — Code Audit Against Spec v1.1
## Version 1.0 — 2026-05-22

> Companion document to `stelavox_brief_orchestration_v1_0.md` (v1.1).
> Walks every code site involved in brief orchestration and reports
> where it diverges from the spec.
>
> **Status:** GAP INVENTORY. No code changed by this document. The
> user reviews and signs off; then we plan a phased implementation.

---

## 1. Methodology

Walked every file/function listed in the spec's actor contracts (§6),
every migration that defines state columns or RPC bodies, and every
write-site enumerated in the prior session's enumeration audit. Compared
against:

- §11 state transition tables (canonical state set + transition function).
- §13.1 invariants I1–I13.
- §9 resolved decisions Q1–Q10.
- §5 message bus shape (event-driven + 30s reconcile).
- §12 reset/recovery procedures.
- §14 configuration parameters.

### What's NOT flagged

These were repaired during the 2026-05-22 debugging session and
intentionally excluded from this audit:

- `persistFinalResult` / `persistFailure` / `persistCancellation` not
  writing `queue_status` — **fixed** (`lib/agent/job-lifecycle.ts`).
- `persistRunningStart` not writing `queue_status` — **fixed**.
- Dispatcher CAS writing `status='running'` / `started_at` — **fixed**
  (`lib/scheduler/dispatcher.ts`).
- `accept_agent_job` not writing `queue_status='completed'` — **fixed**
  (M-190).
- Dispatcher CAS missing `completed_at IS NULL` guard — **fixed**.
- `accept_brief` not persisting `prompt` — **fixed** (M-189).
- `acceptBrief` rpcWrapper dropping `prompt` — **fixed**.
- `proposalBuilder` schema nullable XOR — **fixed**.
- `iteration-runner` workflow-attach search scope — **fixed**.
- `/auto-approve-workflow` route INSERTing agent_jobs directly — **fixed**.
- Cascade-serial synthesise dependency auto-derivation — **added**.
- `NodeMoreMenu` writability gating — **added**.
- `M-188` drop of `brief_stages_planning_source_check` (transient row state) — **fixed**.

---

## 2. Severity Definitions

| Severity | Meaning |
|---|---|
| **CRITICAL** | Reachable unknown state, indefinite stall, or data-loss risk. Apollo-test failure. |
| **HIGH** | Documented invariant violation (I1–I13). User-visible symptom under normal use. |
| **MEDIUM** | Drift / dead code / vestigial enum values. Cosmetic but a documented violation of P7 (no dead enums). |
| **LOW** | Configuration that's hardcoded but should be in `platform_config`; documentation gaps. |

---

## 3. CRITICAL Gaps

These five gaps mean the system today can reach states that violate the
"no unknown state" property in §13.4. They are the must-fix set.

### G-01 — Heartbeat sweep doesn't catch NULL-heartbeat stuck-dispatched jobs

**Spec ref:** §11.5 E_HEARTBEAT_STALE (NEW branch); §12.1 item 2.

**Current:** `supabase/migrations/20260515000107_director_iterations_to_agent_jobs.sql` rewrites `scheduler_sweep_interrupted_iterations` with this WHERE clause:
```sql
WHERE queue_status IN ('dispatched','running')
  AND last_heartbeat_at IS NOT NULL
  AND last_heartbeat_at < NOW() - threshold
```
If the dispatcher claims a job but the runner crashes/skips before the first heartbeat, `last_heartbeat_at` stays NULL forever and the sweep never catches it. **We hit this exact bug twice in the 2026-05-22 session** (phantom expand on "The Fracture" scene).

**Spec requires:** sweep also matches `last_heartbeat_at IS NULL AND dispatched_at < NOW() - agent.runner_claim_max_seconds`.

**Fix:** new migration rewriting the sweep procedure; folds into the consolidated `reconcile_orchestration_state()` (§12.1).

**Effort:** small (SQL only).

---

### G-02 — Expected-output check missing for stage-trigger Director turns

**Spec ref:** §11.2 E_PLAN_FAIL; §11.5 E_LLM_REFUSE; §14 `brief.max_planning_retries`.

**Current:** `lib/director/iteration-runner.ts` (around line 985-998) marks the iteration `completed` when Anthropic returns `stop_reason='end_turn'`. There is no check that the Director actually emitted the artefact the turn was invoked to produce. On a stage-trigger turn (where the Director is required to call `propose_workflow`), if the model writes prose only and ends the turn, the iteration completes cleanly, the turn completes cleanly — and the brief_stage stays in `'planning'` forever with no system event saying so.

**Spec requires:** at iteration terminal-success, if `triggered_by='stage_trigger'` AND no `propose_workflow` tool call was made across any iteration in the turn:
- Increment `brief_stages.planning_retry_count`.
- If `< brief.max_planning_retries`: revert `brief_stages.status` to `'planned'` (next evaluator pass will re-fire).
- Else: transition `brief_stages.status` to `'failed'`.
- Emit `failure_class_d` system event with the iteration's text output as payload (so user can see what the model said).
- `markJobFailed` instead of `markTurnCompleted`.

**Fix:** edit `iteration-runner.ts` terminal block. Requires the new `brief_stages.planning_retry_count` column (G-15a).

**Effort:** medium (one focused code path + schema change + new event handling).

---

### G-03 — `cancel_brief` doesn't cascade beyond `brief_stages`

**Spec ref:** §12.2 Cascade Cancel.

**Current:** `cancel_brief(uuid, text)` in `M-097` updates only `briefs.status` and `brief_stages.status`. Active workflows, running agent_jobs, in-flight director_turns are NOT touched. If a user clicks Cancel while a workflow is dispatching agents, the agents continue, complete, and may even Auto-Accept content to nodes — after the brief was cancelled. The cascade is missing.

**Spec requires:** the full cascade described in §12.2 (5 layers: briefs, brief_stages, workflows, workflow_steps, agent_jobs+director_turns).

**Fix:** rewrite `cancel_brief` in a new migration. Same signature; expanded body.

**Effort:** medium (one RPC, careful to keep idempotent + cover all cases).

---

### G-04 — No reconcile sweep exists for stuck briefs/workflows/stages

**Spec ref:** §12.1 reconcile_orchestration_state.

**Current:** four scattered sweeps cover narrow slices: `scheduler_sweep_throttle_reservations`, `scheduler_sweep_interrupted_iterations`, `orphan_turn_sweep`, `evaluate_ready_stage_triggers`. None of them:
- Detect a workflow stuck `'approved'` with dispatchable steps (we hit this).
- Detect a workflow stuck `'running'` with all steps already terminal (drift).
- Detect a brief stuck `'active'` with all stages terminal (drift).
- Detect a stage stuck `'planning'` with no in-flight iteration (Q2/Q-D).
- Repair I1 violations (status terminal but queue_status not).
- Wake the dispatcher when `scheduled_at` due.

**Spec requires:** single `reconcile_orchestration_state()` SQL procedure per §12.1, running every 30s, performing all 10 recovery checks idempotently in one transaction-per-pass.

**Fix:** new migration creating the procedure + its `cron.schedule` entry; drop the three old sweep crons.

**Effort:** medium-large (one procedure with ~10 small UPDATEs, but careful — must be invariant-preserving and idempotent).

---

### G-05 — `cancel_brief` doesn't cancel director_turns or director_iteration agent_jobs

**Spec ref:** §12.2 step 6-7.

**Current:** when a brief is cancelled, the Director turn that was planning a stage (or chained from one) continues running. If the iteration emits propose_workflow on a now-cancelled brief, the `/auto-approve-workflow` route may still process it.

**Spec requires:** cascade includes UPDATEs to `director_turns SET status='cancelled'` and `agent_jobs SET status='cancelled', queue_status='cancelled'` for any `operation_type='director_iteration'` tied to the brief's conversation.

**Fix:** combined with G-03's rewrite of `cancel_brief`.

**Effort:** included in G-03.

---

## 4. HIGH Gaps

Documented invariant violations causing user-visible symptoms.

### G-06 — `/api/agent-jobs/[jobId]/cancel` doesn't write `queue_status`

**Spec ref:** Q6; I1, I10.

**Current:** `app/api/agent-jobs/[jobId]/cancel/route.ts:40` does:
```ts
.update({ status: 'cancelled', completed_at: new Date().toISOString() })
```
Leaves `queue_status` at whatever it was (likely `dispatched` or `running`). `check_node_writable` then continues to flag the node as `node_in_progress` because the SQL function reads `queue_status IN ('queued','dispatched','running')`. Node remains locked indefinitely after cancellation.

**Fix:** add `queue_status: 'cancelled'`.

**Effort:** trivial.

---

### G-07 — `/api/agent-jobs/[jobId]/dismiss` doesn't write `queue_status`

**Spec ref:** Q6; §11.5 dismiss transition.

**Current:** `app/api/agent-jobs/[jobId]/dismiss/route.ts:44` writes `status='dismissed'` only.

**Spec:** dismiss transitions `(completed/completed) → (dismissed/completed)`. Both columns written.

**Fix:** add `queue_status: 'completed'` (note: NOT `'dismissed'` — there is no such queue_status value).

**Effort:** trivial.

---

### G-08 — `/api/scheduler/jobs/[jobId]/cancel` doesn't write `queue_status`

**Spec ref:** Q6.

**Current:** `app/api/scheduler/jobs/[jobId]/cancel/route.ts:106` writes `status='cancelled'` only.

**Fix:** add `queue_status: 'cancelled'`.

**Effort:** trivial.

---

### G-09 — `/api/scheduler/jobs/[jobId]/cancel` doesn't transition `director_turns.status`

**Spec ref:** §12.2 step 6; M-166 conversation-lock logic.

**Current:** line 121 of the same route sets `director_turns.turn_state='interrupted'` but leaves `director_turns.status='in_progress'`. The conversation-lock check in `/api/director/message` rejects new messages while a turn is `in_progress`. Cancelling a job from the scheduler thus does NOT unlock the conversation.

**Spec:** any time an in-flight job is cancelled and its `director_turn_id` is set, the turn must transition to `cancelled`.

**Fix:** add a `markTurnCancelled` call (or equivalent UPDATE) when the cancelled job is a director_iteration.

**Effort:** small.

---

### G-10 — `recordTokensOnly` leaves the job in `running`

**Spec ref:** Q8; §11.5 (no event transitions away from `running/running` without writing terminal status).

**Current:** `lib/agent/job-lifecycle.ts:369-380` writes `tokens_input/output`, `tokens_cache_*`, `model_id` only. The runner calls this and returns. The job stays in `status='running' / queue_status='running'`. If the sweep doesn't catch it (e.g. heartbeat was just stamped — see G-01), the row is stuck for up to 60s.

**Spec:** `recordTokensOnly` is the cancellation-with-tokens-captured path; it must atomically transition to `(cancelled, cancelled)` with the same UPDATE.

**Fix:** add `status='cancelled', queue_status='cancelled', completed_at=NOW()` to the UPDATE.

**Effort:** trivial.

---

### G-11 — Workflow-step `'removed'` doesn't satisfy dependencies

**Spec ref:** Q7; §11.4 dependency satisfaction rule.

**Current:** `lib/scheduler/dispatcher.ts:354-378` `dependencyResolved` checks `s.status IN ('completed','skipped')`. A step deselected at workflow approve (status='removed') doesn't satisfy. Any subsequent step that depends on the removed step is permanently undispatchable, leading to a workflow that can never complete.

**Fix:** extend the IN list to include `'removed'`.

**Effort:** trivial.

---

### G-12 — `iteration-runner` attaches workflow with status='planned' (Q2 round-trip)

**Spec ref:** §11.2 BriefStage state machine (new `'ready'` state).

**Current:** `lib/director/iteration-runner.ts:847-851` UPDATEs `brief_stages SET workflow_id=<x>, status='planned' WHERE id=<stage> AND status='planning'`. Flips planning → planned. Spec adds `'ready'` state to disambiguate; transition should be planning → ready.

**Fix:** Two-part:
1. Migration: add `'ready'` to `brief_stages.status` CHECK; drop `'approved'` and `'scheduled'` per Q9 in the same migration.
2. Edit iteration-runner: UPDATE `status='ready'` instead of `'planned'`.
3. Edit brief approve route (`app/api/brief/proposals/approve/route.ts:111-114`): when UPDATEing workflow_id for stage 1, also set `status='ready'`.

**Effort:** small-medium (one migration + two TS sites).

---

### G-13 — `complete_brief_stage_workflow` reads stage by `status='planned'` not `'ready'`

**Spec ref:** §11.2; same as G-12.

**Current:** the RPC (M-120/M-098) advances stage to `'completed'` when its workflow completes. The relevant WHERE filter is `brief_stages.workflow_id=<wf> AND brief_stages.status NOT IN terminal`. After Q2's `'ready'` state lands, the predicate becomes `status='ready' OR status='planned'` (workflow-bound stages may not have been transitioned yet on legacy data). Need to confirm the RPC tolerates both during the transition window OR have the migration backfill all stages with workflow_id set + non-terminal status to `'ready'`.

**Fix:** combined with G-12. Backfill stages with `workflow_id IS NOT NULL AND status='planned'` → `'ready'` as part of the same migration.

**Effort:** included in G-12.

---

### G-14 — `evaluate_ready_stage_triggers` hardcodes `system_prompt_version='1.24'`

**Spec ref:** Q5.

**Current:** `supabase/migrations/20260521000185_evaluate_ready_stage_triggers_v2.sql` writes `iteration_state.system_prompt_version='1.24'` literally. Director config moved to v1.25 / v1.26 since. The `iteration_state` field used by the iteration-runner to seed the conversation may reference a stale prompt version.

**Fix:** rewrite the function to `SELECT version FROM director_configs WHERE status='production' LIMIT 1`.

**Effort:** small.

---

### G-15 — Missing `brief_stages.planning_retry_count` column

**Spec ref:** §11.2 (retry semantics); §14 `brief.max_planning_retries`.

**Current:** no column exists. Spec requires it to track PLAN_FAIL events.

**Fix:** migration adds `planning_retry_count INTEGER NOT NULL DEFAULT 0`.

**Effort:** trivial.

---

### G-16 — No `INSERT` trigger on `agent_jobs` to wake dispatcher

**Spec ref:** §5.1 (replaces 1s tick).

**Current:** new queued rows are noticed only via the 1s `dispatcher_tick` pg_cron, which is high-noise and adds latency.

**Spec:** AFTER INSERT trigger `trg_agent_jobs_notify_insert` fires `pg_notify('dispatcher_tick_request', ...)` when NEW.queue_status='queued'. Drop the 1s cron.

**Fix:** migration creates the trigger + drops the cron job.

**Effort:** small.

---

## 5. MEDIUM Gaps

Dead code, vestigial enum values, drift potential. Per P7, every dead
value should be migration-dropped.

### G-17 — `briefs.status` CHECK includes dead values

**Spec ref:** Q1.

**Current:** CHECK `('planned','queued','active','completed','cancelled')`. `'planned'` and `'queued'` are never written post-M-128.

**Fix:** migration narrows CHECK to `('active','completed','cancelled')`. Verify no existing row carries the dead values first.

**Effort:** trivial.

---

### G-18 — `brief_stages.status` CHECK includes dead values

**Spec ref:** Q9.

**Current:** CHECK includes `'approved'` and `'scheduled'`. Neither is written by any code path.

**Fix:** migration narrows CHECK to `('planned','planning','ready','completed','cancelled','failed')` (after adding `'ready'` per G-12 and `'failed'` per G-02). Verify no row has the dead values first.

**Effort:** included in G-12's migration.

---

### G-19 — `briefs.cause='sequence_promotion'` is dead

**Spec ref:** Q10.

**Current:** `'sequence_promotion'` written only by `promote_next_queued_brief`, which is only called from `cancel_brief` and `propagate_brief_completion`. With multi-active dropped (M-128), there are never queued briefs to promote.

**Fix:** drop `'sequence_promotion'` from CHECK; drop the `promote_next_queued_brief` RPC; drop the queue-promotion calls in `cancel_brief` and `propagate_brief_completion`.

**Effort:** small.

---

### G-20 — `brief_stages.prompt` not cleared when `workflow_id` is set

**Spec ref:** §3.2 invariant; per-stage XOR.

**Current:** when iteration-runner attaches workflow_id to a prompt-deferred stage (`lib/director/iteration-runner.ts:847-851`), the `prompt` column stays set. The XOR is then violated in the legacy sense (workflow AND prompt both present). The push-model evaluator's `workflow_id IS NOT NULL` skip ensures correctness operationally, but anything else reading the prompt sees stale data.

**Fix:** the UPDATE that attaches workflow_id also clears `prompt = NULL`.

**Effort:** trivial.

---

### G-21 — `workflows.locked_nodes_requiring_unlock` is orphan

**Spec ref:** P7 dead column.

**Current:** column written by `persistDraftWorkflow` (line ~368); never read by any code.

**Fix:** either wire it into Director's read-tool (planned but never landed) OR drop the column.

**Effort:** trivial (drop) or small (wire up); recommend drop for now.

---

### G-22 — `workflow_steps.agent_job_id` orphan on retry

**Spec ref:** §11.4 (clear on transition).

**Current:** when a workflow_step transitions failed → (admin retry → pending), the old `agent_job_id` stays pointing at the failed job. No code path clears it. If a future Retry feature lands, it'll create a new agent_job but the column still points at the old.

**Fix:** when transitioning workflow_step out of `'running'`, NULL the agent_job_id (or keep the FK and add a new column for the latest attempt; depends on retry design).

**Effort:** small; deferred to Phase 6 (retry UI work).

---

### G-23 — director_turns rollup trigger excludes `'skipped'` queue_status

**Spec ref:** Audit item 14.

**Current:** trigger filters `queue_status IN ('completed','failed','crashed','cancelled')` — `'skipped'` not included.

**Spec:** if a director_iteration ever transitions to `skipped` (currently unused — see §11.5 row note), the rollup counters wouldn't bump. Today unreachable; documented gap.

**Fix:** include `'skipped'` in the trigger filter for correctness in the rare case it lands; OR remove `'skipped'` from the AgentJob queue_status CHECK entirely if confirmed dead.

**Effort:** trivial.

---

## 6. LOW Gaps

Configuration and test-surface gaps.

### G-24 — `max_stages_per_brief` hardcoded at 20

**Spec ref:** §14.

**Current:** `lib/brief/proposalBuilder.ts:174`, `lib/director/schemas.ts` — `.max(20)` literal.

**Spec:** `brief.max_stages_per_brief` platform_config key, default 100.

**Fix:** seed migration (1 row in `platform_config`); `proposalBuilder.ts` + Director schema read via `getConfigInt` (note: these run server-side so getConfig is available).

**Effort:** small.

---

### G-25 — Other thresholds need platform_config keys

**Spec ref:** §14.

**Current:** various time thresholds either exist as platform_config (good — `agent.heartbeat_interval_ms`, etc.) OR are hardcoded.

New keys needed:
- `brief.max_planning_retries` (default 3)
- `brief.planning_stale_threshold_seconds` (default 300)
- `workflow.stuck_threshold_seconds` (default 90)
- `agent.runner_claim_max_seconds` (default 60)
- `agent.turn_stale_threshold_seconds` (default 300)

**Fix:** seed migration adding the 5 keys.

**Effort:** trivial.

---

### G-26 — Test-suite doesn't run `audit_orchestration_state`

**Spec ref:** §13.3.

**Current:** vitest suite has no hook calling the audit at end-of-suite.

**Spec:** add a global afterAll that asserts `audit_orchestration_state()` returns empty against any test-created brief.

**Effort:** small.

---

## 7. NEW BUILD Gaps (no current code)

Capabilities the spec requires that don't yet exist.

### G-27 — `audit_orchestration_state()` SQL function

**Spec ref:** §13.1.

**Current:** doesn't exist.

**Fix:** migration creates the function per §13.1.

**Effort:** medium (12+ invariant queries; mechanical but careful).

---

### G-28 — `orchestration_audit_log` table

**Spec ref:** §13.2.

**Current:** doesn't exist.

**Fix:** migration creates the table (`id`, `invariant_id`, `entity_table`, `entity_id`, `violation`, `details`, `detected_at`, `repaired_at`, `repair_action`).

**Effort:** small.

---

### G-29 — `reconcile_orchestration_state()` SQL procedure

**Spec ref:** §12.1.

**Current:** doesn't exist. Closest existing surface is the 4 scattered sweep cron jobs.

**Fix:** migration creates the procedure per §12.1 (10 recovery rules); drop the 4 old cron schedules; add the one new cron schedule.

**Effort:** medium-large (the SQL procedure itself is mechanical; the right ordering of repair operations + idempotency + invariant preservation needs care).

---

### G-30 — `force_reset_document` SQL function + admin route

**Spec ref:** §12.3.

**Current:** doesn't exist.

**Fix:** migration creates the function. New route `POST /api/admin/documents/[id]/force-reset` (admin auth gated).

**Effort:** small (SQL function is straightforward; route is thin).

---

### G-31 — `retry_failed_stage` SQL function + admin route

**Spec ref:** §12.4.

**Current:** doesn't exist.

**Fix:** migration creates the function. New route `POST /api/admin/brief-stages/[id]/retry`.

**Effort:** small.

---

### G-32 — Admin orchestration-audit page

**Spec ref:** §13.2.

**Current:** doesn't exist.

**Fix:** new route group + page at `/admin/orchestration-audit` showing current audit result. Optional polish — Phase 5.

**Effort:** medium (page + table + repair button).

---

## 8. Recommended Implementation Order

The work groups naturally into six phases. Each phase ends in a working,
type-clean, test-green checkpoint and could merge to master independently.

### Phase 1 — Schema cleanup + new states (foundational)

**Goal:** schema reflects the spec. All dead values dropped, new states
added. Backfills complete. Existing data preserved.

| ID | Migration |
|---|---|
| G-15, G-17, G-18, G-19 | Single migration: drop dead enum values from `briefs.status` and `brief_stages.status` CHECKs; add `'ready'` and `'failed'` to `brief_stages.status`; add `planning_retry_count` column; drop `'sequence_promotion'` from `briefs.cause` and the `promote_next_queued_brief` RPC; backfill any stages with `workflow_id IS NOT NULL AND status='planned'` to `'ready'`. |
| G-21 | Drop `workflows.locked_nodes_requiring_unlock` if confirmed unused. |
| G-23 | Decide: drop `'skipped'` from `agent_jobs.queue_status` CHECK or fix the rollup trigger. |
| G-24, G-25 | Seed `platform_config` rows for the 6 new keys. |

**Migrations:** ~3-4 new migration files.
**Tests:** assert CHECK constraint values; assert seeded config keys present.

### Phase 2 — Self-healing infrastructure

**Goal:** the recovery and verification machinery exists and runs.

| ID | Work |
|---|---|
| G-04, G-29 | Create `reconcile_orchestration_state()` SQL procedure (10 recovery rules). |
| G-27 | Create `audit_orchestration_state()` SQL function (13 invariant queries). |
| G-28 | Create `orchestration_audit_log` table. |
| G-16 | Create `trg_agent_jobs_notify_insert` trigger. |
| G-01 | Fold the stuck-claim sweep INTO `reconcile_orchestration_state()` (so G-01 is the recovery rule for the bug we hit). |
| pg_cron | Drop `dispatcher_tick` (1s); drop `scheduler_sweep_interrupted_iterations` (30s); drop `scheduler_sweep_throttle_reservations` (30s); drop orphan turn sweep; add the single `reconcile_orchestration_state` (30s). |

**Migrations:** 2-3 new.
**Tests:** dedicated audit test fixture; assert that injecting each known drift triggers the matching audit row and the matching recovery.

### Phase 3 — TS gap fixes (mechanical)

**Goal:** every TS write site matches the spec contract. Most are
one-line additions.

| ID | File | Fix |
|---|---|---|
| G-06 | `app/api/agent-jobs/[jobId]/cancel/route.ts:40` | Add `queue_status: 'cancelled'`. |
| G-07 | `app/api/agent-jobs/[jobId]/dismiss/route.ts:44` | Add `queue_status: 'completed'`. |
| G-08 | `app/api/scheduler/jobs/[jobId]/cancel/route.ts:106` | Add `queue_status: 'cancelled'`. |
| G-09 | Same file:121 | Also call `markTurnCancelled` when cancelled job is director_iteration. |
| G-10 | `lib/agent/job-lifecycle.ts:369-380 recordTokensOnly` | Add `status='cancelled', queue_status='cancelled', completed_at=NOW()`. |
| G-11 | `lib/scheduler/dispatcher.ts:354-378 dependencyResolved` | Extend IN list to include `'removed'`. |
| G-12 | `lib/director/iteration-runner.ts:847-851` | Change `status='planned'` to `status='ready'`. |
| G-12 | `app/api/brief/proposals/approve/route.ts:111-114` | Add `status='ready'` to the UPDATE. |
| G-20 | Same iteration-runner line | Also clear `prompt=NULL`. |
| G-24 | `lib/brief/proposalBuilder.ts:174` + `lib/director/schemas.ts` | Read `.max()` from `brief.max_stages_per_brief` via getConfig. |

**Tests:** new unit cases per site, plus a vitest hook that runs `audit_orchestration_state()` at end-of-suite (G-26).

### Phase 4 — Cancel cascade + cross-entity recovery RPCs

**Goal:** the reset path is fully cascading.

| ID | Work |
|---|---|
| G-03, G-05 | New migration: rewrite `cancel_brief` to perform the §12.2 cascade (briefs → stages → workflows → workflow_steps → agent_jobs → director_turns). |
| G-30 | New migration: `force_reset_document` SQL function. |
| G-31 | New migration: `retry_failed_stage` SQL function. |
| G-13 | Same migration as G-03: ensure `complete_brief_stage_workflow` recognises the `'ready'` state. |
| | New route `POST /api/admin/documents/[id]/force-reset` (admin auth). |
| | New route `POST /api/admin/brief-stages/[id]/retry`. |

**Tests:** integration tests that simulate mid-flight cancel + Apollo reset; assert clean terminal state via audit function.

### Phase 5 — Director expected-output check + retry semantics

**Goal:** the Q-D gap closed. Director failure modes resolve to known
states with retry-or-fail semantics.

| ID | Work |
|---|---|
| G-02 | Edit `lib/director/iteration-runner.ts` terminal block: detect missing `propose_workflow` on stage-trigger turns; bump `planning_retry_count`; revert to `'planned'` or transition to `'failed'`; emit `failure_class_d` event. |
| G-14 | Rewrite `evaluate_ready_stage_triggers` to read `system_prompt_version` from `director_configs WHERE status='production'`. |

**Tests:** unit tests with a stubbed iteration-runner where the Director "succeeds" without emitting propose_workflow; assert the stage reverts.

### Phase 6 — Admin UI + observability

**Goal:** user can see and act on stuck states.

| ID | Work |
|---|---|
| G-32 | `/admin/orchestration-audit` page showing live audit results. |
| | "Reset Document" button on admin document view. |
| | "Retry Stage" button on failed stages in BriefViewer. |
| | AppShellStatusIndicator: red dot + click-through when audit has rows. |
| G-22 | Decide retry semantics for workflow_steps.agent_job_id orphan; cleanup if needed. |

**Tests:** Playwright integration covering the user paths.

---

## 9. Estimated Effort Summary

| Phase | Migrations | TS edits | New routes | New UI | Tests |
|---|---|---|---|---|---|
| 1 — Schema cleanup | 3-4 | 0 | 0 | 0 | ~10 unit |
| 2 — Self-healing infra | 2-3 | 0 | 0 | 0 | ~15 unit + 5 integration |
| 3 — TS gap fixes | 0 | ~10 sites | 0 | 0 | ~10 unit |
| 4 — Cancel cascade + reset | 2-3 | 0 | 2 | 0 | ~8 integration |
| 5 — Director expected-output | 1 | 2 sites | 0 | 0 | ~5 unit |
| 6 — Admin UI | 0 | 0 | 0 | 3 pages | ~5 Playwright |

Phases 1-3 are the "make today's spec compile" pass — once they land the
system is provably consistent with the spec for existing flows. Phases
4-5 close the cascade and the LLM-failure gap. Phase 6 is the user
surface.

Phases 1-3 can land as a single merge (~2 sessions of work). Phase 4 is
a separate focused PR. Phase 5 is one session. Phase 6 is polish.

---

## 10. Verification Plan

After each phase, run:

```sql
SELECT * FROM audit_orchestration_state();
```

Empty = phase ready to merge.

Plus the existing test suites:
- `npm run type-check` — 0 errors.
- `npx vitest run` — 0 new failures vs baseline.
- Playwright V1.x regression suite — 0 new failures.

Final sign-off: drive a 5-stage brief through the system. Confirm:
- Each stage completes in order.
- Cancelling mid-stream leaves zero stale data (cascade works).
- Force-reset returns a clean slate.
- Audit shows empty rows throughout.
- Director failing to emit propose_workflow on stage 3 produces a `'failed'` stage with the user-visible failure event (not a silent stall).

---

## Changelog

**v1.0 — 2026-05-22.** Initial gap report. 32 gaps identified across 5
severity levels. 6-phase implementation plan recommended.
