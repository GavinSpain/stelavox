# Stelavox — Pre-Phase-8 Functional Test Pass Report v1.0

**Date:** 2026-05-17
**Branch:** `claude/lucid-kare-fc8032`
**Commit:** `021976b`
**Test base:** Shadow Protocol corpus (109 nodes; mention-relinked context)
**Test user:** `author@stelavox.local`
**Model:** Claude Haiku 4.5 (Director + agents)
**LLM spend:** ~$0.30 across all journeys

---

## §1 — Executive summary

Before Phase 8 polish kicks off, the test plan walked all 10 author-journey paths through the live web interface against the Shadow Protocol corpus. The pass found **5 distinct wiring or schema gaps**, all fixed in commit `021976b`. **2 of those gaps were launch blockers** that would have surfaced as silent failures only when a user tried the relevant feature.

The test pass validated:
- ✅ Login + dashboard + project + document navigation
- ✅ Tree rendering (95 structural + 14 context nodes; 16 chapters; 22 beats with prose)
- ✅ Direct authoring surfaces (Tiptap editors, Comments, Context links, Focus Mode)
- ✅ Author Lock substrate (apply + write-gate blocks agent + unlock)
- ✅ Agent operations end-to-end (Expand + Accept; 17,568 credits; 3 children created)
- ✅ Director multi-stage Brief proposal + Stage 1 execution + Stage 2 auto-promotion (after the wiring fix)
- ✅ Scheduler API + queue endpoint
- ✅ Plan + cost meter (303,694 / 1M credits; 30% rendered)
- ✅ All 4 export formats (DOCX, EPUB, JSON, Outline) end-to-end with verified downloads
- ✅ Admin dashboard with 7 sections + live capacity alert firing on a real condition

---

## §2 — Bugs found + fixed

### B-1 ❌→✅ NodeDetailPanel status pills 4→2 (Journey A)

**Severity:** medium. UI/UX bug, not data-loss.

**What:** `components/detail/NodeDetailPanel.tsx` declared `STATUS_VALUES = ['draft', 'in_review', 'approved', 'locked']` — the pre-Phase-6 enum. Phase 6 D7 reduced the status enum to `{draft, approved}`. The TabStrip rendered 4 status pills; clicking "in_review" or "locked" would have produced a CHECK-constraint rejection from the DB.

**Fix:** Reduced to `['draft', 'approved']` with a `// Phase 6 D7` comment explaining the reduction.

**Why it escaped:** Phase 6's NodeStatusBadge + NodeMoreMenu were updated (both shipped with 2-value enums), but the NodeDetailPanel sister component was missed. The Phase 6 test pass ran NodeStatusBadge cases against the new enum but didn't cover the NodeDetailPanel status-pill render.

### B-2 ❌→✅ context-links SELECT references dropped columns (Journey B)

**Severity:** high. Silent feature-disable.

**What:** `lib/data/context-links.ts` had two SELECT statements (`listDirectLinks` + `listAncestorLinksForNode`) requesting `nodes.locked` and `nodes.lock_reason` as part of the inline node embed. Both columns were dropped in Phase 6 M-154. PostgREST silently returned empty results, so the entire "INHERITED FROM ANCESTORS" panel showed 0 inherited links even when 12 valid ones existed at the ancestor level.

**Fix:** Dropped the dropped columns from both SELECT bodies.

**Why it escaped:** Phase 6 close-out gates (type-check, lint, Vitest, build) did not exercise the live context-links endpoint against a real ancestor chain with linked context. The dispatcher test M-154 dropped the columns but PostgREST doesn't fail with a 4xx — it silently returns rows without the requested embed.

### B-3 ❌→✅ Tree GET handler missing Author Lock state (Journey C)

**Severity:** high. Silent feature-disable.

**What:** `GET /api/documents/[documentId]/nodes` returned each node row through `decorateWithLeaf()`, but did not enrich rows with Author Lock state. `nodes.locked` was dropped in Phase 6 M-154; lock state moved to the dedicated `node_author_locks` table. NodeRow consumed `data.locked` which was therefore always `undefined`. The 🔒 indicator never rendered on any node, regardless of lock state.

**Fix:** Added a single LEFT-JOIN-shaped fetch of `node_author_locks` after `listNodes()`, merged into each decorated row as `locked: boolean`.

**Why it escaped:** Phase 6 added the NodeLockIndicator component + the back-end RPCs, but the migration from `nodes.locked` (a column on the row) to `node_author_locks` (a separate table) meant the existing list endpoint stopped surfacing the field. No Phase 6 test asserted on the rendered 🔒 in the live tree.

### B-4 ❌→✅ Multi-stage Brief Stage 2 auto-promotion (Journey E — launch-blocker)

**Severity:** **launch-blocker**. The headline V1 Director feature was architecturally broken.

**What:** `lib/director/workflow-executor.ts` marked `workflows.status='completed'` when all steps finished but never invoked the brief-stage propagation RPC. The DB-side RPCs `complete_brief_stage_workflow` (M-097) + `evaluate_ready_stage_triggers` push-model upgrade (M-120) existed but no TS code called them. So multi-stage Briefs would complete Stage 1 then silently sit forever; Stage 2 with `trigger_type='after_stage'` never fired.

**Fix:** Added a 6-line call to `complete_brief_stage_workflow` in `advanceWorkflow()` at the point where `workflows.status='completed'` is set. Verified live: Stage 1 of a 2-stage Brief now propagates to Stage 2 `status='proposing'` + queues a `director_iteration` agent_job for Stage 2 planning.

**Why it escaped:** This was the gap that V1.x-A.1 close-out flagged for "V1.x-B" deferral; V1.x-B.1.1 + V1.x-B.2 each shipped the DB-side primitives but the TS caller wasn't added in either phase. The Vitest tests for `complete_brief_stage_workflow` itself ran the RPC directly without exercising the workflow-completion path that triggers it.

### B-5 ❌→✅ throttle_reservations schema-vs-code drift M-163 (Journey E — launch-blocker)

**Severity:** **launch-blocker**. The entire WFQ scheduler was dead — no dispatch could ever succeed.

**What:** `lib/scheduler/buckets.ts:checkAndReserve` INSERTed into `throttle_reservations` with columns `pool_key`, `agent_job_id`, `estimated_tokens` — none of which existed on the table. V1.x-B.1.1 (M-095) created `throttle_reservations` with a route/user_id/org_id/slots/tokens shape; V1.x-B.2 re-abstracted around `pool_key` + `agent_job_id` but never added those columns. The INSERT failed silently inside `checkAndReserve`'s error branch which refunded the bucket UPDATE and returned `reason='insufficient_tokens'`. The dispatcher counted this as a `no_capacity` skip and re-queued the ticket forever. Every WFQ tick across every environment would fail to dispatch any ticket.

**Fix:** Migration `20260517000163_throttle_reservations_v1xb2_columns.sql` adds `pool_key TEXT`, `agent_job_id UUID REFERENCES agent_jobs(id) ON DELETE CASCADE`, `estimated_tokens BIGINT`. Relaxes `route` to NULL-able (V1.x-B.2 doesn't populate it). Adds two indexes for the V1.x-B.2 lookup paths. After applying, the dispatcher successfully dispatched the first queued ticket on the next tick. Verified end-to-end.

**Why it escaped:** V1.x-B.2 unit tests mocked the supabase client; the integration tests likely seeded the reservations directly via SQL or never exercised the dispatch path under conditions that would force a real `checkAndReserve` call. Without the listener auto-starting in any environment (the V1.x-B.2 "cloud cutover" was a known deferral), the dispatcher path was never actually run during V1.x-B.2 close-out.

---

## §3 — New surfaces shipped in this commit

### POST /api/cron/dispatcher-tick (Journey E support)

The V1.x-B.2 architecture relies on pg_cron + pg_notify('dispatcher_tick_request') + a TS listener (`lib/scheduler/listener.ts`) subscribing to that channel. The listener was never auto-wired into local-dev (no `instrumentation.ts` hook) or Vercel deploy (no boot path). Without it the WFQ scheduler is dead — even with the M-163 fix.

This route gives both environments a concrete dispatch path: Vercel-Cron can hit it every minute with `{ max_ticks: 60, intra_tick_delay_ms: 1000 }` to drive sub-second tick cadence; local-dev tests can call it ad-hoc. Auth follows the existing `/api/cron/*` pattern (Bearer `CRON_SECRET`). The dispatcher's CAS-on-claim and reservation lifecycle make double-dispatch safe — this complement to a future listener-based path is harmless.

### scripts/relink-shadow-protocol-context.ts

Replaces the seed-time all-link-to-book shortcut with realistic mention-based linking: 37 context links across 14 context nodes, distributed by character/location/theme mentions in beat prose. Used to validate the inheritance walk in Journey B against realistic data.

### .claude/launch.json

Preview MCP server config for `stelavox-dev` (port 3000) so future test passes can attach to the dev server via `mcp__Claude_Preview__preview_start`.

---

## §4 — Journey-by-journey results

| Journey | Result | Bugs found | Bugs fixed |
|---|---|---|---|
| A — Onboarding + Tree Navigation | ✅ PASS | B-1 (status pills 4→2) | B-1 ✅ |
| B — Direct Authoring | ✅ PASS | B-2 (context-links query) | B-2 ✅ |
| C — Locking + Status + Restore | ✅ PASS | B-3 (tree lock state) | B-3 ✅ |
| D — Agent Operations | ✅ PASS | none (note: `actual_input/output_tokens` are NULL on agent_jobs rows — cost_credits populates correctly, but the per-token columns aren't filled. Minor; doesn't affect cost math) | — |
| E — Director-Driven multi-stage | ✅ PASS at substrate level | B-4 (Brief stage propagation), B-5 (scheduler schema gap) | B-4 ✅, B-5 ✅ |
| F — Scheduler + Status | ✅ PASS at API level | none | — |
| G — Plan + Cost | ✅ PASS | none (minor: trial plan `period_start` is NULL — UX implication for "renews in N days" copy) | — |
| H — Failure-Mode UX | ⊝ SKIPPED | n/a — V1.x-F substrate-only by design; per-surface adoption deferred to incremental Phase 8 polish | — |
| I — Export (Phase 7) | ✅ PASS | none | — |
| J — Admin dashboard | ✅ PASS at API level | none (one real alert fired on the queue-stale condition caused by B-5) | — |

**Total: 5 bugs found, 5 bugs fixed.** All fixes in commit `021976b`.

---

## §5 — Items still outstanding (Phase 8 candidates)

These were observed during the test pass but didn't warrant in-pass fixes. They are recommended for Phase 8 attention.

1. **Director iteration `actual_input_tokens` / `actual_output_tokens` columns NULL** while `cost_credits` populates correctly. The per-iteration cost calc in V1.x-C.1.b derives credits without backfilling the token columns on the parent agent_jobs row. Admin dashboard's "by-model spend" then attributes the deltas to `model_id='unknown'` for any iteration that didn't populate them. Investigate iteration-runner's persist path.

2. **`agent_jobs.queue_status='queued'` on completed expand jobs** (workflow-step path). Only dispatcher-driven jobs get the V1.x-B.2 queue_status state machine. Workflow agent_jobs run via the legacy inline path; queue_status never advances. Admin dashboard queue counts therefore under-report. Either decommission the legacy path (route workflow steps through the dispatcher) or have `accept_agent_job` flip queue_status as well.

3. **Trial plan `current_period_start` is NULL** because `handle_new_user` doesn't set it. The CostMeter "renews in N days" UI presumably renders "—" or hides; minor UX gap.

4. **TS listener `startSchedulerListener` is never invoked** by any boot path. The new `/api/cron/dispatcher-tick` route is the Vercel-Cron fallback path; in V1 production the cron job needs to be wired up in `vercel.json` or the equivalent. Wire it before launch.

5. **NodeMoreMenu Unlock affordance** — when a node is locked by the current user, the More menu should include an "Unlock" item. The API path is verified to work; the UI exposure of it was missed during Phase 6 polish and the test pass didn't exercise it deeply enough to confirm.

6. **`/api/usage/current-period` requires explicit `org_id` query param.** Without it returns 400 `invalid_body`. The CostMeter UI knows the org_id from elsewhere so this is harmless in practice but the error message is misleading ("body" implies POST; this is a GET param).

7. **Director iteration's auto-approve workflow-proposal path** — when `briefs.auto_approve_workflow_proposals=true`, Stage 2's Director iteration should auto-approve the workflow it proposes. End-to-end run during the test pass ran 5+ iterations without surfacing the workflow proposal — Director may have spent iterations on planning/reading without converging. Worth a focused dedicated test once the dispatcher's listener is auto-running.

---

## §6 — Final regression verification

| Gate | Result |
|---|---|
| `npm run type-check` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings |
| `npm run build` | Compiled successfully |

---

## §7 — Verdict

**PASS for V1-substrate readiness.** All identified gaps are fixed in the same commit. The 2 launch-blockers (B-4 multi-stage Brief, B-5 dispatcher schema) would have surfaced as silent feature failures in production; both are now closed.

V1 launch readiness requires the user-driven full-novel test per `project_launch_standard.md`. The substrate is ready.

---

## Changelog

**v1.0 — 2026-05-17** Initial report. 10-journey test pass; 5 bugs found, 5 bugs fixed.
