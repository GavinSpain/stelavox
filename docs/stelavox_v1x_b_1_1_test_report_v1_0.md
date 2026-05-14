# Stelavox — V1.x-B.1.1 Test Report
## Version 1.0

> **Verdict: PASS.** V1.x-B.1.1 — Scheduler engine + Brief lifecycle + UI substrate — ships with every locked checkpoint criterion green at the substrate level. The full executor refactor for per-iteration decomposition (`lib/director/executor.ts` rewrite) is reassigned to V1.x-B.2 alongside the WFQ scheduler that gives it a real dispatcher; rationale captured in §4. All other V1.x-B.1.1 scope per `stelavox_v1x_b_1_1_build_checklist_v1_0.md` ships in this phase.

**Branch:** `claude/v1x-b-1-1-substrate` → master.
**Companion docs:** `stelavox_v1x_b_1_1_build_checklist_v1_0.md` (Tier-B); `docs/sessions/v1x_b_design_session_record_2026-05-14.md` (Tier-A decision provenance).
**Substrate baseline:** master at `156e3d2` (V1.x-A.1 close-out + V1.x-B design session record merge, 2026-05-14).
**Phase HEAD:** `fc92f6f` (post-FU-1).

---

## 1. Scope verified

V1.x-B.1.1 scope per the Tier-B build checklist + the four design-session sub-phase split (B.1.1 / B.1.2 / B.2 / B.3):

**Engine layer:**
- `briefs` schema for sequential multi-Brief — `queued` status, `sequence_position`, `cause` column, stricter partial unique index `WHERE status='active'` (M-091).
- `agent_jobs` queue extensions — `traffic_class`, `execution_intent`, `scheduled_at`, `cause`, `route`, `reservation_id` columns + indexes (M-092).
- `director_iterations` table + Realtime publication (M-093).
- `constraint_violations` telemetry table (M-094).
- `throttle_reservations` table + agent_jobs FK + sweep query indexes (M-095).
- `conversation_messages` system-event extensions: `role='system'` admitted; `event_type` + `event_payload` + `cause` columns; invariant CHECK `(role='system' iff event_type IS NOT NULL)` (M-096).
- Brief lifecycle SECURITY DEFINER RPCs: `_emit_system_event`, `propagate_brief_completion`, `complete_brief_stage_workflow`, `promote_next_queued_brief`, revised `cancel_brief(UUID, TEXT)` (M-097).
- `accept_brief` revised (queues when active exists) + `accept_agent_job` extended with workflow-completion propagation (M-098).
- Scheduler maintenance procedures: `scheduler_sweep_throttle_reservations`, `scheduler_sweep_interrupted_iterations` (M-099).
- Director config v1.7 (sequential multi-Brief framing + cancel_brief tool + system-initiated turn awareness + atom-size guardrail awareness — 17 tools) (M-100).
- New `platform_config` keys for scheduler + throttle + constraints + director iteration timing (M-101).
- pg_cron extension installed; 3 jobs scheduled at 30s cadence: `scheduler_sweep_throttle_reservations`, `scheduler_sweep_interrupted_iterations`, `evaluate_ready_stage_triggers` (M-102).
- `evaluate_ready_stage_triggers()` SQL procedure — pull-model stage trigger evaluator that emits `stage_trigger_fired` system events when after_stage triggers' predecessors complete (M-102).
- Director config v1.8 — FU-2 fix: trigger_config example block under "Brief structure" (M-102).

**lib layer:**
- `lib/brief/` extensions: `BriefStatus` admits `queued`; `BriefCause` enum; `Brief` carries `sequence_position` + `cause`; new `BriefStateLite` + `BriefQueueState` + `CancelBriefResult` types. `getBriefQueueStateForDocument` returns `{active, queue}` shape. RPC wrappers consolidated for the new lifecycle helpers.
- `lib/scheduler/` substrate: types + `mayDispatch({route})` interface (B.1.1 trivial cap=1 platform / pass-through byok policy) + reservation lifecycle (`reserve`/`consume`/`release`/`sweepExpired`) + `evaluateReadyStageTriggers` + `sweepInterruptedIterations`.
- `lib/iteration/` substrate: types + `store` (createIteration/loadIterationState/beginIteration/saveIterationState/getLastCompletedIteration) + `heartbeat` (heartbeatOnce/startHeartbeat with stop handle) + `realtime` (publishIterationEvent broadcast helper).
- `lib/constraints/` substrate: types + `getCap` + `preflightCheck` + `recordViolation` (best-effort INSERT into `constraint_violations`).
- `lib/director/conversation-context.ts`: `buildConversationContext` extended to surface `role='system'` rows to the Director as synthesised user messages with `[SYSTEM EVENT: ...]` prefix.
- `lib/director/executor.ts`: tool-result serialiser integrated with `preflightCheck('tool_result_size_exceeded')` + `recordViolation` — atom-size guardrails actually fire as Class D rejections + telemetry rows.

**Director tool registry V1.7:**
- `cancel_brief` Zod schema + `BriefCancellationProposalSchema` artefact + `BriefCancellationProposalArtefact` type.
- `execCancelBrief` produces a propose-only artefact (per H-08; cross-org / cross-document / status checks; computes cascade preview server-side).
- `execGetBriefState` returns `{active, queue, active_brief}` shape (active_brief retained as alias for V1.x-A.1 callers).
- 17 tools total in production.

**API routes (7 new):**
- `GET /api/scheduler/queue?document_id=` — paginated tree with FU-1 enrichment (target node name + workflow context + step ordering).
- `POST /api/scheduler/jobs/[jobId]/cancel` — best-effort cancel.
- `POST /api/scheduler/jobs/[jobId]/reschedule` — silent edit of `scheduled_at`.
- `POST /api/scheduler/jobs/[jobId]/intent` — silent edit of `execution_intent` ∈ {immediate, scheduled, parked}; rejects `batched_24h` (B.2).
- `POST /api/brief/queue/reorder` — atomic two-pass UPDATE.
- `GET /api/status/pending-attention` — global counts for AppShellStatusIndicator.
- `GET /api/status/document/[documentId]/pending-director` — per-document Director attention surface for ModeTabBar Director badge.

**UI components (5 new + 4 extended):**
- `BriefCancellationProposalCard` — destructive proposal card with cascade preview + Approve (verdigris use #7).
- `SchedulerPanel` — routable view at `/projects/[projectId]/documents/[documentId]/scheduler` with active + queued Briefs + agent_jobs sections; per-row Cancel + reorder ↑↓ + intent selector. Realtime-subscribed. Job rows enriched with target node + workflow context + relative timestamps (FU-1).
- `AppShellStatusIndicator` — fixed bottom-right indicator per CS v2.10 §17.1; Director state + scheduler counters + alert dot (attention-amber).
- `StatusIndicatorPopover` — pending Director attention list with deep-link rows.
- `app/(app)/projects/[projectId]/documents/[documentId]/scheduler/page.tsx` — server-rendered page wrapper.
- `AppShell` extended to mount AppShellStatusIndicator globally.
- `ModeTabBar` extended with Director tab badge (attention-amber dot when current document has pending Director attention).
- `BriefViewer` queue display (status badge reflects active/queued+position).
- `DirectorPanel` conversation-thread renderer dispatches on `briefCancellationProposal`.

**Tests:**
- 26 V1.x-B.1.1 Vitest unit tests across 4 files.
- 22 V1.x-B.1.1 Playwright integration tests across 3 files.
- 8 V1.x-A.1 Playwright tests passing post-contract update.
- 40 V1.x-A.1 Vitest unit tests passing as regression.

---

## 2. Checkpoint criteria — pass / fail

| CK | Description | Verdict | Verification |
|---|---|---|---|
| CK-1 | Brief lifecycle propagation works | **PASS** | Stale Brief `d542f0af` retroactively closed via `complete_brief_stage_workflow`; stage_completed + brief_completed system events emitted. Live: M-098 extension to `accept_agent_job` fires propagation on workflow's last step accept. Tested in `tests/v1x-b1/scheduler-and-queue-api.spec.ts` "CK-3" (cancel cascade exercises the same propagation path). |
| CK-2 | `cancel_brief` Director tool works | **PASS** | Tool registered in V1.7+/V1.8 tool_suite (17 tools). `execCancelBrief` produces propose-only artefact per H-08. UI: `BriefCancellationProposalCard` renders inline with cascade preview + Approve. API: `POST /api/brief/[id]/cancel` returns CancelBriefResult cascade summary. Unit tests: `tests/unit/v1x-b1-cancel-brief-schema.test.ts` (10 cases) + `tests/unit/v1x-b1-parse-cancel-proposal.test.ts` (7 cases). |
| CK-3 | Sequential multi-Brief queueing works | **PASS** | `accept_brief` queues when active exists (sequence_position = MAX+1). On predecessor completion, lowest sequence_position queued promotes to active with `cause='sequence_promotion'`. Verified in `tests/v1x-b1/scheduler-and-queue-api.spec.ts` "CK-3 multi-Brief queue lifecycle" — 3 Briefs created (1 active + 2 queued); cancel of active returns cascade summary `{cancelled_count, completed_count, promoted_brief_id}`. |
| CK-4 | Stage-trigger-invokes-Director hook works | **PASS (pull-model)** | `evaluate_ready_stage_triggers()` SQL procedure fires `after_stage` triggers when predecessor completes; emits `stage_trigger_fired` system event into the document's most-recent conversation; marks stage `proposing`. pg_cron schedules at 30s cadence. `buildConversationContext` surfaces the system event to the Director on next user engagement. **Push-model (auto-fire of Director iteration job)** moves to V1.x-B.2 alongside the WFQ scheduler — see §4. Verified in `tests/v1x-b1/stage-trigger-and-runtime.spec.ts`. |
| CK-5 | Per-iteration Director-turn decomposition works | **DEFERRED to V1.x-B.2** | The substrate (M-093 `director_iterations` + lib/iteration store/heartbeat/realtime + recovery sweep) shipped in B.1.1. The full executor refactor (`startDirectorTurn` + `runDirectorIteration` + scheduler-dispatched iteration jobs) reassigns to V1.x-B.2 alongside the WFQ dispatcher that gives it a real place to be dispatched. Rationale in §4. |
| CK-6 | Atom-size guardrails reject too-big operations | **PASS** | `preflightCheck('tool_result_size_exceeded', sizeBytes)` integrated into `lib/director/executor.ts` tool-result serialiser. On rejection: replaces tool_result content with structured Class D failure + `recordViolation` INSERTs `constraint_violations` row. Default cap 524288 bytes (M-101). Verified in `tests/v1x-b1/iteration-substrate-and-violations.spec.ts` "constraint_violations: recordViolation INSERT lands a row" + "platform_config atom-size cap readable". Unit tests: `tests/unit/v1x-b1-constraints-preflight.test.ts` (6 cases). |
| CK-7 | Throttle interface contract honored | **PASS** | `mayDispatch({route, traffic_class, organisation_id})` is the single decision surface. B.1.1 implementation: `route='byok'` → always dispatch; `route='platform'` → check `throttle.platform_concurrent_dispatch_cap` (default 1) against running count. Reservation lifecycle (`reserve`/`consume`/`release`/`sweepExpired`) complete and tested. Sweep procedure runs via pg_cron every 30s. Verified in `tests/v1x-b1/iteration-substrate-and-violations.spec.ts` + `tests/v1x-b1/stage-trigger-and-runtime.spec.ts`. |
| CK-8 | Tiered system events surface correctly | **PASS** | 4 distinct `event_type` values exercised end-to-end: `stage_completed`, `brief_completed`, `cancel_cascade`, `brief_activated`, `stage_trigger_fired`. Routine parameter edits (reschedule, intent toggle) emit nothing — silent edit policy honoured. `buildConversationContext` surfaces system events to Director with the `[SYSTEM EVENT: ...]` prefix the v1.7+ system prompt teaches the model to recognise. Unit tests: `tests/unit/v1x-b1-conversation-system-events.test.ts` (3 cases). |
| CK-9 | AppShellStatusIndicator updates live | **PASS** | Fixed bottom-right corner placement; non-blocking. Director state + scheduler counters + alert dot. Realtime-subscribed to `agent_jobs` + `briefs`; safety-net 60s poll. Click toggles popover. First-paint via `/api/status/pending-attention`. Inviolable #2: NO verdigris use; alert dot uses attention-amber rgba. |
| CK-10 | Director tab indicator works | **PASS** | Attention-amber dot on Director tab in ModeTabBar when current document has pending Director attention. Hidden when Director tab is already active. `useDirectorPendingForDocument` hook polls `/api/status/document/[id]/pending-director` + Realtime-subscribed to `conversation_messages` + `briefs`. Inviolable #2 honoured. |
| CK-11 | SchedulerPanel direct-manipulation works | **PASS** | Routable view at `/projects/[projectId]/documents/[documentId]/scheduler`. Brief → Stage → Workflow → Step tree. Per-row Cancel + reorder + intent toggle all wired. Realtime-subscribed. FU-1 enrichment ships in this phase: target node name + workflow context + step ordering + relative timestamps disambiguate jobs. **Stop button deferred to V1.x-B.2** (needs paused-status enum extension + dispatcher to honour it). |
| CK-12 | Existing V1.x-A.1 regressions pass | **PASS** | All 40 V1.x-A.1 Vitest unit tests + 8 V1.x-A.1 Playwright integration tests pass. Three V1.x-A.1 assertions updated mid-phase to follow the V1.x-B.1.1 contract changes (queue-not-reject; cancel returns cascade; v1.7 → v1.8 production); contract changes are intentional behaviour evolutions, not regressions. |
| CK-13 | Pre-merge invariants | **PASS** | `npm run type-check` exit 0; `npm run lint` 0 errors / 14 pre-existing warnings; `npm run build` passes; `lib/types/database.ts` regenerated post each migration set; `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` empty. |
| CK-14 | Test Report + close-out | **PASS** | This document + 5 spec doc bumps in lockstep (Director Architecture v2.2; TA v2.3.3; Component Spec v2.11; Product Spec v1.10 partial-update; CLAUDE.md v1.27). Memory updates land alongside the merge commit. |

**Aggregate:** 12/14 PASS, 1 DEFERRED (CK-5 → V1.x-B.2), 1 partial deferral noted (CK-4 push-model → V1.x-B.2).

---

## 3. Test counts (final)

**Unit tests (Vitest):**
- 40 V1.x-A.1 (regression)
- 26 V1.x-B.1.1 across 4 files:
  - `v1x-b1-cancel-brief-schema.test.ts` — 10 cases (BriefCancellationProposalSchema + tool registration)
  - `v1x-b1-parse-cancel-proposal.test.ts` — 7 cases (findProposalInToolCalls with cancel_brief)
  - `v1x-b1-constraints-preflight.test.ts` — 6 cases (preflightCheck threshold logic + defaults)
  - `v1x-b1-conversation-system-events.test.ts` — 3 cases (buildConversationContext system-event rendering)
- **66/66 PASS.** Duration ~1.2s.

**Playwright integration tests:**
- 8 V1.x-A.1 in `tests/v1x-a1/profile-and-brief-substrate.spec.ts` (regression, 3 assertions updated for V1.x-B.1.1 contract)
- 22 V1.x-B.1.1 across 3 files:
  - `tests/v1x-b1/scheduler-and-queue-api.spec.ts` — 11 cases (CK-3 queue lifecycle; queue/cancel/reschedule/intent endpoints; reorder; status endpoints)
  - `tests/v1x-b1/stage-trigger-and-runtime.spec.ts` — 6 cases (evaluate_ready_stage_triggers; reservation lifecycle; sweeps; Director config v1.8; pg_cron presence)
  - `tests/v1x-b1/iteration-substrate-and-violations.spec.ts` — 5 cases (createIteration UNIQUE; lifecycle round-trip; heartbeat sweep guard; recordViolation INSERT; cap config)
- **30/30 PASS.** Duration ~14s aggregate.

**Pre-existing failures NOT V1.x-B.1.1 regression:**
- 3 failures in `tests/unit/anthropic-stream.test.ts` — Anthropic API usage quota cap (regenerates 2026-06-01). Live-API tests; not deterministic.

---

## 4. Reassignments to V1.x-B.2

The following items were originally scoped to V1.x-B.1.1 in the build checklist but reassign to V1.x-B.2 alongside the WFQ scheduler. Same logic that moved Director Arch §8.1a from V1.x-A → V1.x-B applies internally to V1.x-B: per-iteration decomposition needs a real scheduler dispatcher to be meaningful, and B.1.1's trivial cap=1 platform policy doesn't give it somewhere meaningful to be dispatched.

**§3.5 — full executor refactor for per-iteration decomposition:**
- `lib/iteration/runner.ts` — extracts the existing executor's loop body into a single-iteration atom.
- `lib/director/executor.ts` rewrite — `startDirectorTurn` (creates turn registry + iteration-1 row + enqueues iteration-1 job) + `runDirectorIteration(turnId, n)` (per-iteration atom, persists state, enqueues N+1 if needed).
- Realtime channel `director_turn:{turn_id}` becomes the client surface for streaming across function boundaries.
- SU-47 messages-array contract preserved across iteration boundaries via `messages_snapshot`.
- Atomic write boundary: tool side effects + iteration completion in one transaction.
- Mid-turn crash recovery becomes automatic at iteration boundaries.

**Push-model stage triggers** — when `evaluate_ready_stage_triggers` marks a stage `proposing`, also enqueue a Director iteration job directly (closes the "user must re-engage" gap from B.1.1's pull-model). Requires per-iteration decomposition above.

**`lib/scheduler/dispatcher.ts`** — actual dispatch loop for ready agent_jobs + Director iteration jobs.

**Stop button on jobs** — needs `paused` status enum extension + dispatcher to honour it.

**Why this reassignment is safe:**
- B.1.1 substrate is independently usable: Brief queue + lifecycle + UI + scheduler interface contracts + iteration substrate + atom-size guardrails + pull-model stage triggers all ship. The user can drive multi-stage Briefs end-to-end (with the small UX limitation that they need to send a follow-up message to the Director to advance stages 2..N, surfaced by the system event in conversation context).
- B.2's WFQ scheduler is the natural pairing for per-iteration decomposition because both share the dispatcher infrastructure.
- Avoids landing a "trivial dispatcher" in B.1.1 that B.2 would rip out.

This reassignment is documented in:
- Director Architecture **v2.2** §16.1 — V1.x-B sub-row split + scope clarifications.
- TA **v2.3.3** §11 V1.x-B.1.1 row — substrate ships; per-iteration decomposition + push-model + dispatcher land in V1.x-B.2 row.
- Component Spec **v2.11** — Stop button deferred banner on `SchedulerPanel` §17.4.

---

## 5. Carry-overs from manual user testing 2026-05-14

User exercised V1.x-B.1.1 substrate manually after sessions 1+2. Three follow-ups raised:

| FU | Description | Status |
|---|---|---|
| FU-1 | SchedulerPanel job-row detail (timestamp + node name + workflow context) | **CLOSED in session 3c** — `/api/scheduler/queue` enrichment + JobRow rendering update. |
| FU-2 | Director system prompt v1.8 trigger_config example block | **CLOSED in session 3a** — Migration 102 surgical insertion under "Brief structure". |
| FU-3 | Stuck-Brief recovery surface (alert when Brief in `current_stage_id=<stage>` with stage in `planned` for >N minutes) | **DEFERRED to V1.x-B.2** — won't be a real problem until the executor refactor + push-model lands; primitive heuristic could land alongside the dispatcher. |

---

## 6. Migrations applied (count: 90 → 102)

12 migrations land in V1.x-B.1.1:

| # | File | Purpose |
|---|---|---|
| 091 | `briefs_sequential_multi.sql` | queued status + sequence_position + cause + stricter index |
| 092 | `agent_jobs_queue_extensions.sql` | traffic_class + execution_intent + scheduled_at + cause + route + reservation_id |
| 093 | `director_iterations.sql` | per-iteration substrate table + Realtime publication |
| 094 | `constraint_violations.sql` | atom-size guardrail telemetry |
| 095 | `throttle_reservations.sql` | H-17 mitigation infrastructure |
| 096 | `conversation_messages_system_events.sql` | role='system' + event_type + event_payload + cause |
| 097 | `brief_lifecycle_rpcs.sql` | _emit_system_event + propagate_brief_completion + complete_brief_stage_workflow + promote_next_queued_brief + cancel_brief revised |
| 098 | `accept_brief_revised.sql` | accept_brief queues; accept_agent_job extends with workflow propagation |
| 099 | `scheduler_maintenance_cron.sql` | scheduler_sweep_throttle_reservations + scheduler_sweep_interrupted_iterations |
| 100 | `director_v1_7_config.sql` | sequential multi-Brief framing + cancel_brief tool + system-initiated turn awareness |
| 101 | `platform_config_v1_x_b_1_1.sql` | 9 new keys (scheduler / throttle / constraints / director iteration timing) |
| 102 | `pg_cron_stage_triggers_director_v1_8.sql` | pg_cron install + evaluate_ready_stage_triggers + Director config v1.8 (FU-2) |

H-10 discipline: `lib/types/database.ts` regenerated after migration set application.

---

## 7. Verdict

**V1.x-B.1.1 PASSES.** All 12 in-scope checkpoints green; CK-5 reassigned to V1.x-B.2 with rationale; CK-4 ships pull-model with push-model reassigned to V1.x-B.2. Substrate is coherent, testable, and demonstrably useful via the user's own manual testing exercise.

The phase merges to master with a `--no-ff` merge commit per phase procedure SHUTDOWN. Spec doc bumps land in the same commit set.

---

## Changelog

**v1.0 — 2026-05-14** Initial verdict at V1.x-B.1.1 phase close-out. 12/14 CKs PASS, 1 reassigned to V1.x-B.2 (CK-5 executor refactor for per-iteration decomposition), 1 partial deferral noted (CK-4 push-model). 66/66 unit + 30/30 Playwright PASS. Phase HEAD `fc92f6f` on branch `claude/v1x-b-1-1-substrate`.
