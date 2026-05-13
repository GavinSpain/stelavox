# Director V2 Deep-Dive Session Record

**Session:** 2026-05-11 to 2026-05-12
**Status:** closed, design phase opening
**Outcome doc:** `docs/stelavox_director_architecture_v2_0.md` (Tier-A, follow-on session)
**Prior context:** `project_director_architecture_review.md`, `project_director_deep_dive_session_prep.md`, the 2026-05-10 launch-test pause

This document records the decisions made during the deep-dive discussion. It is the audit trail — decision provenance, not a transcript. Anything described as "decided" here is locked unless explicitly reopened in a later session. Anything described as "deferred" is queued. Anything described as "flagged" is a known unresolved question that needs a specific decision before implementation.

The document is organised by topic-as-discussed. The Tier-A design doc that follows from this session organises the same content by architectural section.

---

## 1. Operating philosophy

Three principles articulated by the user during the launch-test pause and reaffirmed throughout this session. They are the constitution. Every later design decision was tested against them.

1. **Time is not the constraint; visibility is.** Long-running work is acceptable; silent failure is not. Every architectural decision must preserve "the user can see progress" as a hard requirement.
2. **The Director knows its own limits.** Constraints (max steps per workflow, max tokens per turn, concurrent dispatch, per-user and global throttles, Anthropic tier ceilings) must be surfaced in the Director's prompt and state so the model plans within them rather than silently failing against them.
3. **Limits are derived from global capacity, not local-tab safety.** The right `max_concurrent_dispatch`, `max_steps_per_workflow`, and similar are derived from the platform's Anthropic tier headroom across all concurrent users, not from what one user's screen can handle.

A fourth design principle was added later in the session as a UX lens:

4. **iPhone simplicity at the user-facing surface.** One way to do something; opinionated defaults; complexity hidden inside the system; direct manipulation; the product makes the call and the user redirects only if wrong. Applies to the user-facing UX, not to the internal architecture (where narrow well-named primitives win).

---

## 2. Scope and limits

**The Director handles the full range** — from "tighten beat 1" to "write the whole book." Same architecture; the only difference is depth of decomposition. This is a vision statement, not a technical claim about a single turn.

Four scope-clarifying decisions:

**2.1 Strict-serial vs cascade-chain-serial.** Decided: **cascade-chain-serial**. Strict serial along any context-cascade chain (e.g. beat-N's prose synthesis must wait for beat-N-1's prose to be written so it can read it as context). Parallel-up-to-throttle for steps with no shared cascading dependency. Conditional on the system being able to clearly distinguish dependency requirements — this is now a load-bearing design requirement. Fallback when uncertain: serial, never silent parallel. Belt-and-braces approach: server auto-derives cascade rules from operation type and target structure; Director can declare additional dependencies the rule engine wouldn't see.

**2.2 Scheduler integration shape.** Decided: **both pause-and-resume and future-start**. The scheduler supports queue states `parked` (no start time, waiting on user "go"), `scheduled` (queued with future start time), and `pacing` (running but rate-limited to N steps per window).

**2.3 Self-rejection vs auto-split.** Decided: **auto-split**. When the Director hits a capability ceiling (job too large for one workflow at current caps), it proposes a multi-workflow plan — batches 1..N — with batch 1 starting immediately and batches 2..N parked or scheduled. The user can then release subsequent batches manually or by schedule.

**2.4 Job-complete acknowledgement.** Decided: **mechanical for V1**. "12/12 steps succeeded" style summary on completion. Reflective acknowledgement (re-read artefacts and offer observation) is deferred to V2.

---

## 3. Terminology — three execution tiers

Three tiers identified that need distinguishing names; naming itself queued for the design doc:

- **Tier 1** — one LLM operation on one node (today: `agent_job` / `workflow_step`).
- **Tier 2** — a coordinated group of Tier-1 jobs (today: roughly `workflow`, but ambiguous since some workflows are single-node).
- **Tier 3** — the user's overall intent that may auto-split into multiple Tier-2 groups (no concept today).

Vocabulary leak today: `workflow` does double duty as "plan with one node" and "plan with many." Nothing names Tier 3.

Resolved during the session: the **four-tier hierarchy is Brief → Stage → Workflow → Step**.

- **Brief** is the Tier-3 macro-intent — the user's overall project (a novel, a series, a short story).
- **Stage** is an intermediate tier between Brief and Workflow. A Stage is a logical unit of work approved by the user as a whole; it spawns one or more workflows.
- **Workflow** is the Director's per-stage plan.
- **Step** is what the scheduler dispatches.

Brief and Stage are new concepts not in the current data model. Workflow and Step exist today.

---

## 4. Multi-agent stance

**Decided: stay single-agent for now.** Under the Anthropic philosophy ("don't multi-agent unless you genuinely need it"), the user concluded multi-agent should only be adopted if there is a real and genuine reason, otherwise it is just complexity.

Two clarifications:

- **Supervisory agent — V2 candidate, narrowly scoped.** Crash detection and recovery is deterministic work (stale-heartbeat sweep, transactional state, recovery cron); a rules-based watcher does it better and cheaper than an LLM. A supervisory *agent* could only earn its complexity for genuinely-LLM-suited tasks: detecting semantic drift (Director going in circles, plans degrading), cost anomalies, intervening when the Director is stuck. Not a V1 concern.
- **QC / review work — additional job types, not agents.** New `agent_profiles` entries dispatched the same way as expand / synthesise / refine. Single LLM call each; no agentic loop. Candidates: `review_node`, `consistency_check`, `evaluate_against_goal`. V1.x or V2 candidates.

---

## 5. Tool registry V2

**Decided: keep narrow, well-named tools** (the iPhone test on the registry concluded narrow tools produce cleaner plan-step descriptions than one-big-tool-with-type-parameter). User never sees tools — they see step descriptions in natural language. The registry decision is internal to the Director.

**Read tools (current 7 → 7 after swap):**

- `get_document_state` — keep.
- `get_node` — keep.
- `get_nodes_by_layer` — **canonical-order bug fix** (launch-blocker).
- `get_node_tree` — keep.
- `assess_downstream_impact` — keep.
- `get_workflow_history` — keep.
- `get_conversation_history` — **deprecate** (redundant with the summarised preamble; the model already has the relevant history in its context).
- `get_brief_state` — **new** (Director needs to see the roadmap, current stage, completed stages when invoked mid-project).
- `get_scheduler_state` — **new** (informs scheduling intent in proposals — queue depth, estimated start times, current load).

**Write tools (current 6 → 6, with semantic fixes + 1 compound):**

- `create_expand_step` — keep.
- `create_synthesise_step` — keep.
- `create_refine_step` — keep.
- `create_context_step` — **resolve SU-J11-2 semantically**. Decision: target an existing context node; if missing, server auto-creates then fills atomically. Director writes one step; the system handles create-and-fill as a single semantic operation.
- `create_comment_step` — keep.
- `create_node_reorder_step` — keep.
- `create_batch_step` — **new compound write tool**. Expresses "apply operation X across a contiguous range of N nodes" as a single workflow step. The plan-card description reads "Synthesise prose for beats 11-20" — one sentence, one approval — instead of ten near-identical steps. The execution layer fans out into N agent_jobs internally.

**Proposal artefact shapes the Director emits (current 1 → 3):**

- `<workflow_proposal>` — existing. Extend parameters to carry scheduling intent (`execution_intent`, `scheduled_at`, `pacing_hint`, `batch_position`).
- `<brief_proposal>` — **new** for the initial roadmap.
- `<brief_amendment_proposal>` — **new** for mid-project re-planning ("you've changed direction; I propose updating stages 4-7 like this") and for promoting in-conversation user preferences to durable Brief state.

---

## 6. Plan/execute separation

**Decided: keep the propose-only contract as foundational.** The Director plans, never executes. The agentic loop produces only proposals. This is what makes powerful tools safe to expose. Confirmed as inviolable in V2.

---

## 7. Scheduler as universal execution coordinator

**Decided: every agent_job — immediate, paced, future-start, parked, batched — flows through the scheduler. No special cases. No bypass paths.** "Immediate execution" is a *policy outcome* of the scheduler, not a separate code path. Every job creates a queue entry; the scheduler's policy decides whether to dispatch now, pace, defer, or batch.

Consequences locked in:

- Single dispatch surface in code — no `if (immediate) bypass else queue` fork.
- Scheduler intelligence accumulates uniformly. When V2 adds priority handling, throttle awareness, or admission control, it captures every scenario automatically.
- Observability is uniform — every job has a queue entry; every job has `queued_at` distinct from `started_at`; every job is countable in the dashboard.
- The performance cost of always-queueing is negligible (one DB insert per job).

This supersedes the current `lib/director/workflow-executor.ts` `Promise.all`-over-batch model that produced the launch-test 429.

---

## 8. Auto-split and the four-tier model — the worked example

**Decided: progressive hierarchical elaboration via Brief → Stage → Workflow → Step.**

The worked example: "create the entire book from this book node." Approach:

1. **Intent capture.** Director recognises this as a macro-intent (Brief), not a workflow. Does not attempt to plan the whole thing.
2. **Roadmap response.** Director's first reply proposes a Brief — a high-level staged plan (premise → acts → chapters → scenes → beats → prose synthesis → review). Presented as a new artefact distinct from a workflow. User approves the Brief shape.
3. **First workflow.** After roadmap approval, Director proposes a small, immediately-actionable workflow for Stage 1. User approves; scheduler runs.
4. **Stage gate.** Stage 1 completes; Director acknowledges; proposes Stage 2's workflow.
5. **Layer-by-layer expansion.** Each stage produces a workflow (or N batched workflows if the stage is too large). Auto-split handles overflow.
6. **Context-aware re-planning.** Between stages, Director re-reads current state; later stages are *informed by what came before*, not pre-computed from the original prompt.
7. **Prose pass.** Stage 6's monster — 800-2000 beat syntheses in canonical order with context cascade. Director proposes batched workflows with scheduler pacing.

**Stage triggers** — declared at roadmap approval, editable thereafter via the UI:

- `after_stage:<N>` — run when stage N completes (default series case)
- `scheduled_at:<timestamp>` — fixed time
- `manual` — parked; user releases
- Compound: `after_stage:4 AND scheduled_at:>2026-06-01`

**Stage advancement** is driven by the scheduler, not the Director. When a stage's trigger fires:

1. Scheduler marks the stage `proposing`.
2. Scheduler invokes the Director with a system-initiated turn ("Stage N's trigger fired. Propose the workflow.").
3. Director re-reads state, proposes the workflow.
4. User approves the workflow at the normal gate.
5. Scheduler runs it.

So the Director gets **called by** the scheduler, not the other way around.

---

## 9. Visibility and UX

**9.1 Persistent app-shell status surface.** A new component, visible from every screen (Edit / Director / Focus / dashboard). Shows: Director state (idle / thinking / awaiting approval), scheduler state (N running, M queued, K parked), errors needing attention. Click-through routes back to the Director tab or scheduler panel.

**9.2 Tree-level lock and state visibility.** Auto-lock on schedule — when a node enters an approved/scheduled workflow, system-lock applies; author can't edit; UI explains why and shows scheduled time. Richer node lifecycle states on the tree (`scheduled`, `queued`, `executing`, `completed`, then back to `idle` after author review). Lock auto-releases on completion.

**9.3 AI-changed flag.** When a node has been changed by AI, surface a flag on the tree row. Cleared when the author views the node. Provides the "what changed since I last looked" signal.

**9.4 Director acknowledgement on completion.** No more silent finishes. Mechanical line ("12/12 steps succeeded") in V1; reflective acknowledgement in V2. The workflow planner card remains visible after completion.

---

## 10. Server-side concurrency model — per-iteration decomposition

Reaffirmed structural truth: **processes are isolated; database and Anthropic key are the only shared substrates.** But the original "one function per Director turn" model is replaced by **per-iteration function decomposition** to eliminate Vercel timeout exposure on long turns.

**The new execution model for Director turns:**

```
client → POST /api/director/message
  ↓
server creates turn registry row, returns turn_id immediately
  ↓
server enqueues "run Director iteration #1" job in scheduler
  ↓
function picks up the job:
  - loads turn state (messages array, accumulated tool_use blocks)
  - runs one iteration (one Anthropic streaming call)
  - publishes events to Realtime channel `director_turn:{turn_id}`
  - persists state at iteration end
  - if more iterations needed → enqueues "run iteration #N+1"
  - exits
  ↓
client subscribes to Realtime channel `director_turn:{turn_id}`
  ↓
loop continues across function invocations until turn complete or Stop
```

**Key architectural shifts:**

- **Function lifetime is bounded by ONE iteration** (~30s typical, ~2 min worst case), not by the whole turn. A 30-iteration / 15-minute turn is now 30 function invocations, none of them near the timeout ceiling.
- **Client subscribes to a Realtime channel**, not a direct SSE stream from a specific function. Any function invocation can publish to the channel; the UI receives events regardless of which function is producing them.
- **Failure blast radius shrinks to one iteration.** A function crash, timeout, or transient glitch loses ~30 seconds, not 15 minutes.
- **Crash recovery is automatic at iteration boundaries.** State already persists at each iteration end (`turn_state='interim'`); the scheduler picks up the next iteration regardless of what killed the prior function.
- **Iterations are idempotent.** Deterministic inputs (messages array + tool definitions + system prompt) + propose-only invariant (write tools don't write during the loop) means retry is safe by construction.
- **Stop and intervention become surgical.** Stop at an iteration boundary is a clean abort.
- **Architectural unification.** Director turns and agent_jobs share the same shape — scheduler-dispatched single-shot functions publishing into Realtime channels. One mental model, one code path, one observability surface.

**Within a single iteration**, the Anthropic streaming call cannot be halted-and-resumed — that is the irreducible atom. A single iteration is bounded enough that the 300s ceiling isn't a concern in normal operation. Pathological cases (single iteration producing 60k+ output tokens) are addressed by Class C prompt content limiting per-iteration output size.

**Reaffirmed shared substrates:**

- Mid-turn state persists to Postgres via `conversation_messages.turn_state='interim'`.
- DB connections shared via PgBouncer.
- Anthropic platform API key is the chokepoint for non-BYOK users.
- BYOK calls use the user's own key; rate-limit picture is separate.
- Realtime broadcasts back independently to each subscribed client, RLS-filtered.
- Vercel function timeout: 300s standard, 900s pro. Per-iteration decomposition keeps individual function lifetimes well below these ceilings.

**Trade-off acknowledged:** modest inter-iteration latency (~50–200ms cold-start cost between functions; Vercel keeps recent containers warm). Trivial against multi-minute turns.

---

## 11. Live registry & admin dashboard

**Decided: register-on-start / heartbeat-during / unregister-on-end pattern** for all long-running things (Director sessions, workflows, agent_jobs, scheduler queue entries).

Table shape (one such registry per object type or unified):

- `session_id`, `user_id`, `started_at`, `last_heartbeat_at`, `expected_completion_at`, `current_iteration` / `current_step`, `status`.
- Stale detection: `last_heartbeat_at < now() - 60s` → mark `suspected_dead`; longer threshold → `interrupted`. Recovery sweep cleans.

**One architectural payoff:** the same registry serves both the admin dashboard and the user-facing app-shell status indicator. Different RLS views over the same substrate.

**Admin dashboard** — separate dashboard (production: separate server; V1: same stack, admin-only routes). Not user-accessible. Surfaces the registry, throughput metrics, error/class breakdown, queue states, Anthropic header headroom, cost spend rates.

---

## 12. Rate limiting & traffic engineering

**12.1 Four Anthropic rate-limit dimensions, all enforced simultaneously:**

- Requests per minute (RPM, 60s sliding window)
- Input tokens per minute (ITPM)
- Output tokens per minute (OTPM)
- Concurrent connections (open streams at any instant) — **the binding constraint for our workload**

The launch-test 429 was concurrent-connections, not RPM or token rates.

**12.2 Header-driven truth.** `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}` headers on every response are the source of truth. Our internal counters are predictions; reconcile from headers each response.

**12.3 Four traffic classes (cellular-NodeB-scheduler analogue).**

- **Class 1 — Interactive Director.** Streaming turn user is watching. Strict priority. Latency-critical.
- **Class 2 — Author-foreground execution.** Workflow just approved, user watching.
- **Class 3 — Background batch.** Steps from large auto-split workflow; user has moved on.
- **Class 4 — Scheduled / parked.** Released by scheduler; opportunistic.
- **BYOK lane** — separate route, separate throttle scoped to user's own key.

**12.4 Weighted Fair Queueing over strict priority.** Each class gets a guaranteed minimum share of capacity (proposed initial weights — Class 1: 50%, Class 2: 25%, Class 3: 20%, Class 4: 5%); priority only resolves *within* classes and during unused-share situations. Age-based promotion also in scope so Class 3 work doesn't starve indefinitely. Weight tuning happens with real traffic data from the dashboard.

**12.5 Per-user token bucket** (not explicit "low-priority" demotion). Each user's bucket refills at a rate proportional to their fair share. Heavy use depletes the bucket and naturally waits longer for refills. Cleaner than punishment-based demotion, easier to surface ("your bucket is at 12%; next request available in ~30s").

**12.6 Class 1 has dedicated guaranteed capacity** — a small number of concurrent-connection slots reserved exclusively. Implication: a long Class 3 streaming connection cannot block a Class 1 request by holding a concurrent-connection slot. Required because LLM calls are non-preemptible — once a stream is open, it can't be yanked.

**12.7 Throttle-not-deny.** When limits are approached, delay the next call rather than reject. Particularly for large user-approved workflows — they should run, just paced.

**12.8 Global, not in-process.** Throttle state lives in Postgres (with `FOR UPDATE SKIP LOCKED` for atomic state transitions) or Redis. Every function invocation sees the same state.

**12.9 Holding-pattern `agent.director_max_concurrent_dispatch=1`** stays in place until the proper layer lands. This is from the 2026-05-10 session.

---

## 13. Operational monitoring

Standard set, with the caveat that we're serverless — many metrics come from Vercel and Supabase APIs rather than agents we run.

- **Vercel:** invocations/min per route, p50/p95/p99 duration, timeout rate, error rate, memory peak per invocation, cold-start rate, bandwidth.
- **Supabase:** connections vs pool size, query latency p95, DB CPU/RAM/disk/IOPS/free space, slow-query log, realtime channels & message rate, auth sign-ins/failures.
- **Anthropic:** 429 rate (~0 steady-state target), mean latency per model, token spend per minute/day/user, header-derived limits remaining (four dimensions).
- **Application-level:** active Director sessions, active workflows, active agent_jobs (the registry from §11), per-class queue depths and wait times, per-user bucket levels, stale-heartbeat counts, mid-turn `interrupted` rate.

**Pattern.** A scheduled cron polls Vercel + Supabase + aggregated Anthropic-header data and writes timestamped snapshots to a `metrics_samples` table. Retention policy keeps the table bounded (e.g. 5-min granularity for 7 days, 1-hour granularity for 90 days).

**Two early decisions:** alerting threshold table with configurable warn/critical per metric; synthetic probes that run a sentinel Director turn every N minutes to detect end-to-end breakage.

---

## 14. Crash recovery & idempotency

**Reaffirmed: design for crash recovery from the start.** The substrate must support it; bolting it on later is painful.

**State that survives a crash at each layer:**

| Layer | Persistent state | Today | Gap |
|---|---|---|---|
| Brief | row in DB, stage list, current-stage pointer | not built | new |
| Stage | row with status, workflow children | not built | new |
| Workflow | `workflows.status`, `workflow_steps.status` | yes | none |
| Step | step row | yes | none |
| Agent job | row + status + heartbeat | yes | none |
| Director turn mid-iteration | `conversation_messages.turn_state='interim'` with accumulated text + `tool_calls` JSONB | partial | true mid-iteration resume is V2 — today we mark `interrupted` and re-send |
| Scheduler queue | Postgres rows | not built | new |
| Rate-limit reservations | with TTL — released if requester dies before consuming | not built | new |

**Universal mechanism — stale-heartbeat sweep:** a cron tick every 30-60 seconds that finds:

- interim conversation_messages with stale `updated_at` → `interrupted`, surface to user as "resume?"
- agent_jobs `running` with stale heartbeat → `pending` (retryable) or `failed` (not)
- workflow_steps in `running` with terminal agent_job → reconcile
- workflows `running` with no running steps → `advanceWorkflow()`
- rate-limit reservations past TTL → release

**Idempotency** is required on every operation:

- Idempotency keys on writes (e.g. agent_job's unique constraint on `(workflow_step_id, attempt_number)`)
- LLM calls bracketed by sentinel writes ("request sent", "response received") to distinguish pre- vs post-call crash
- Transactional boundaries — never half-write a step + agent_job pair
- `FOR UPDATE SKIP LOCKED` on the scheduler step-pickup query for at-most-once dispatch

**User-visible recovery surfaces** are the trust-builder. "Your last Director turn was interrupted at iteration 5. Resume / discard / view what was done?" — silence is what damages trust.

---

## 15. Scheduling tool — Director's role

**Decided: no direct scheduling tool for the Director** (it would break propose-only and require capacity decisions the Director can't make well). Instead:

- Scheduling **intent** expressed inside the workflow_proposal (`execution_intent`, `scheduled_at`, `pacing_hint`, `batch_position`). User approves the shape; scheduler interprets and executes.
- **`get_scheduler_state`** read tool added — Director can see queue state and propose informed scheduling.

**Execution-intent vocabulary locked:**

- `immediate` — submitted to the scheduler with no constraint; runs as soon as policy admits.
- `scheduled_at:<timestamp>` — runs at a specified time; normal (non-batched) execution.
- `parked` — queued without a time; waiting for user release.
- **`batched_24h`** — submitted to Anthropic Batch API. 50% cost discount; up to 24h delivery SLA. User-elected option for latency-tolerant work. Surfaced on the plan card as a "Save 50% — deliver within 24 hours" toggle. Distinct from `scheduled_at` (which is "start at this time, normal speed") — the two could be combined for "submit at 2am, accept up to 24h delivery from then."

The `batched_24h` intent is implemented under the hood via Anthropic's Batch API: submit → receive batch_id → exit function → webhook (preferred) or cron poll (fallback) picks up completion → results written back to agent_jobs row → workflow advances. The agent_jobs lifecycle gains a `submitted_to_batch` intermediate state.

---

## 16. Cancellation model

**Decided: Stop is the only first-level action.** After Stop the natural options are Resume or Cancel. Cancel is a scheduling action, not a chat action.

- **Stop** — halt now, keep what's done, leave the rest paused-and-resumable. Same shape as crash recovery.
- **Cancel** — second-level, lives in the scheduler view. Marks the workflow/stage/Brief `cancelled`; abandons remaining work. Completed work stays.
- **Rollback / undo** — requires versioning; deferred. V1.x: per-node content rollback (the existing VersionHistory restore). V2: per-workflow rollback (cross-cutting on top of node-level versioning). V3 or later: per-Brief snapshot/restore.

**Three nuances:**

- In-flight LLM tokens are paid; Stop saves on the next iteration, not on bytes already streamed.
- Completed work persists; Stop is not Undo.
- Stop level matters — mid-turn Stop targets the conversation_messages interim row; mid-workflow Stop targets the workflow's pending steps.

---

## 17. Failure-mode taxonomy

**Decided: five user-facing classes A–E.** Multiple underlying causes can map to the same class; UX behaviour is consistent within a class.

- **A — Transient (auto-recoverable).** 5xx, brief 429s within throttle, network blips. Silent retry with backoff; small "reconnecting" indicator if it takes more than ~5s.
- **B — Interrupted (resumable).** Function timeout, SSE cut, user Stop, server restart. "Resume / Discard / View" UI. Same shape regardless of cause.
- **C — Capacity / capability (Director-acknowledged).** max_tokens hit, iteration cap, request too large, throttle queue too deep. **Not really a failure** — Director self-rejects and proposes alternatives (auto-split flow). The 114-scene silent-truncation symptom is a Class C cause silently producing a Class B shape today; needs fixing.
- **D — Validation / safety.** Injection-scanner trip, canary leak, locked-node conflict, schema validation failure. Specific issue surfaced; user judgment usually needed. Some require admin (canary leak); some require user choice (locked node); some require user judgment (injection false-positive on legitimate fictional content — SU-J11-1).
- **E — Hard system failure.** Auth, infrastructure, bugs. "Something went wrong. Your work is safe. We've been notified." Admin alerted. User stops.

**State transitions are consistent within a class** — documented as a table in the design doc.

**Director self-awareness improvement:** add a `report_capability_limit` synthetic tool the Director can emit instead of silently truncating. Plus prompt content teaching the Director its iteration cap, step cap, and the multi-workflow-split protocol when a request exceeds them.

**Dashboard surfaces each class separately:** Class A informs throttle tuning; Class B informs reliability; Class C informs Director prompt tuning; Class D informs safety/content review; Class E is the operational alarm.

---

## 18. Conversation context — the Brief reframe

**Decided architectural shift:** **the Brief becomes the canonical durable memory; conversation becomes a rolling working buffer.**

Today the conversation is the *only* long-term memory and the 60k-token summariser is a blunt instrument (compresses by position, not importance). With the Brief in place:

- **Brief** — high-fidelity, structured, durable: project goal, stages, voice preferences, constraints, decisions, completion history. Director reads via `get_brief_state` at every turn start.
- **Document tree** — artefact memory. Approved-workflow outcomes live in nodes.
- **Workflow history** — past plans. Accessible via `get_workflow_history`.
- **Conversation** — rolling window of recent turns (configurable; default ~5–10 turns via `agent.director_conversation_window_turns`). For in-flight iteration, direct cross-turn references, unresolved questions, continuity of tone. Nothing load-bearing depends on conversation surviving long-term.

**Promotion mechanism:** when the user states something durable in conversation (a style preference, a project decision), the Director proposes a Brief amendment to promote it. Once approved → durable in Brief; the conversation can be summarised away.

**Practical consequences:**

- 60k-summarisation pressure largely dissolves.
- User-initiated **Clear Conversation** button becomes low-risk and is added.
- Conversation budget cap can drop to ~15-20k.
- Prompt caching covers repeated context within a turn at ~10% cost; the 5-minute cross-turn TTL is a smaller issue once conversation shrinks.

---

## 19. Brief vs context node — the distinction

**Decided clean rule:**

- **Brief = meta-information about the project.** How to write it, what stage we're at, what's been decided about the production. Project goal, stage roadmap, voice preferences, constraints, named decisions. Loaded at every Director turn.
- **Context nodes = in-world content.** Characters, locations, organisations, themes (as explored), plot threads, world details. Loaded selectively via `context_links` when an operation needs them.

**Different consumers:** Director reads Brief to plan; agent_jobs (especially `synthesise`) read context nodes to ground generated prose.

**Different evolution patterns:** Brief evolves via Director-proposed amendments approved by the user; context nodes evolve via the standard node operations (refine, agent updates, manual edits).

**Grey-zone rule:** when a fact has both project-meta and in-world flavours (e.g. "Setting: Sydney 1973"), Brief holds the one-line declaration with a pointer; the context node holds the substance.

**Heuristic for the Director:**

- User expresses something about **how** the work should be made → propose Brief amendment.
- User expresses something about **what's true in the world** → propose context node create/edit.

---

## 20. Brief storage schema

**Decided hybrid relational + JSONB pattern** (same shape as `workflows` + step `parameters`).

```
briefs
  id                   UUID PK
  document_id          UUID FK → documents (one-to-one)
  organisation_id      UUID FK → organisations
  status               TEXT ('active' | 'completed' | 'cancelled' | 'archived')
  goal_text            TEXT  -- vision in user's own words
  preferences          JSONB -- style notes, constraints, decisions
  current_stage_id     UUID FK → brief_stages (nullable)
  created_at, updated_at, completed_at

brief_stages
  id                       UUID PK
  brief_id                 UUID FK
  order                    INT
  title, description       TEXT
  trigger_type             TEXT ('after_stage' | 'scheduled_at' | 'manual' | 'compound')
  trigger_config           JSONB
  status                   TEXT ('planned' | 'proposing' | 'proposed' | 'approved'
                                | 'scheduled' | 'running' | 'completed' | 'cancelled'
                                | 'skipped')
  started_at, completed_at

brief_amendments  (append-only audit + replay)
  id              UUID PK
  brief_id        UUID FK
  proposed_by     TEXT ('user' | 'director')
  amendment_type  TEXT ('add_stage' | 'modify_stage' | 'add_preference'
                       | 'modify_goal' | 'reorder_stages' | ...)
  before, after   JSONB
  approved_at, approved_by_user_id
  reason          TEXT
```

**Director-facing view via `get_brief_state()`:**

```json
{
  "goal": "...",
  "status": "active",
  "current_stage": { "order": 2, "title": "Act structure", "status": "running" },
  "stages": [ ... ],
  "preferences": {
    "voice": "...",
    "constraints": [...],
    "decisions": [...]
  }
}
```

RLS scoped to organisation_id; generated types regenerated post-migration (H-10).

---

## 21. Plan & cost model

**21.1 Two user types, two displays.**

- **BYOK users** see tokens (input/output/total) for the session and the project, plus dollar cost computed from Anthropic's published rates × tokens. Informational; we don't enforce (Anthropic enforces against their account).
- **Non-BYOK users** see a percentage against plan allocation. "32% of your monthly allowance used. Renews in 14 days."

**21.2 Plan model — pay-in-advance hard cap.** Decided unambiguously:

- The cap is the cap. At 100% the system stops new LLM calls until renewal or top-up.
- No surprise billing.
- Plan advertised in dollars (e.g. "$50/month"). Internal accounting is in opaque credits — user never sees the unit.
- **Top-up** is the relief valve. Pre-pay; extends `period_allocation` or `period_end`.
- In-flight work completes at the 100% boundary; new work blocks. Avoids half-completed agent_jobs.
- Pre-emptive estimate gate: when Director's forward estimate would push the user over 100%, surface on the plan card before approval ("This workflow estimates ~12%; you have 5% remaining. Top up to approve or trim the plan first.").

**21.3 Internal credit rate is proportional to actual Anthropic cost with a small margin** — adjustable to absorb upstream price changes while keeping the user-facing plan price stable. Same model Anthropic uses on us, applied one level up.

**21.4 Time-versioned rates with daily granularity.** Decided pattern:

```
pricing_rates  (append-only)
  id                                    UUID PK
  model_id                              TEXT
  effective_from                        DATE  -- the day this rate starts applying
  input_credit_per_million_tokens       DECIMAL
  output_credit_per_million_tokens      DECIMAL
  cache_read_credit_per_million_tokens  DECIMAL
  cache_write_credit_per_million_tokens DECIMAL
  created_at, created_by_user_id
```

- Lookup `getCreditRate(model_id, on_date)` returns the row with greatest `effective_from <= on_date`.
- When a call completes, compute its credit cost using the rate effective today; store on `agent_jobs.cost_credits` / `conversation_messages.cost_credits`. Value is fixed forever.
- `period_consumed` is the running sum of stored credit costs; never recalculated.
- Workflow spanning a rate change: early-completed steps at old rate; later-completed at new rate. Natural and correct.
- Date boundary in **UTC**.
- Append-only — never UPDATE.

**21.5 BYOK pricing uses a parallel `anthropic_pricing` table** mirroring Anthropic's public rate card by date. Same mechanism, different table feeding the BYOK dollar meter.

**21.6 Forward estimate ties in cleanly:**

- BYOK plan card: "Estimated cost: $X.XX / ~Y tokens"
- Non-BYOK plan card: "Estimated cost: ~Z% of your monthly allowance"
- Same upstream calculation; different denomination per user type.

**21.7 Deferred to later versions:** per-user hard caps beyond plan, per-document budgets, tier-aware routing, escalation paths, admin alerts on anomalous spend, billing/subscription integration, spend reports.

---

## 22. Framework comparison decisions

**22.1 LangChain / LangGraph / AutoGen / OpenAI Assistants / Semantic Kernel / CrewAI / PydanticAI / Mastra — none adopted.**

The boilerplate-reduction window is behind us. The hand-rolled agentic loop, tool registry, security layer, and persistence model already exist and work. The remaining big work (throttling, Brief/Stage scheduler, admin dashboard, multi-class queueing) is bespoke architecture none of these frameworks help with significantly. API churn risk is real. No migration.

**22.2 Anthropic philosophy adopted.** "Building Effective Agents" (Schluntz & Zhang) — workflows are cheaper than agents; use the lowest-complexity pattern; agents earn their complexity only where genuinely warranted. Our architecture is already shaped this way.

**22.3 Two immediate Anthropic adoptions for V2:**

- **Prompt caching breakpoints** on system prompt + tool definitions. Today not used; we send full prompt every iteration. With caching, ~70% cost reduction on multi-iteration turns.
- **Extended thinking** on Opus-class models for plan synthesis on large documents. Today `extended_thinking: false`; turn on for Opus and validate.

**22.4 MCP (Model Context Protocol) — V2+ candidate.** Relevant if/when third-party tool integrations are added. Not V1.

---

## 23. iPhone simplicity lens applied to UX

Recorded principles and gaps identified during the discussion:

**Five principles:**

1. One way to do something.
2. Defaults that just work.
3. Hide underlying complexity.
4. Direct manipulation over commands.
5. Opinionated by default.

**Where the Director already does this well:**

- Natural-language chat; no operation_type dropdowns.
- Plan cards present human-readable step descriptions, not JSON.
- Tool calls and model iterations hidden.
- Director writes prose then plan — conversational, not transactional.

**Gaps flagged for follow-up (UX backlog):**

- **Too many buttons on the plan card.** Approve + per-step checkboxes + Reject + (sometimes) Edit. Reduce to one big "Approve" with a small "modify" link for the rare case.
- **Director sometimes asks clarifying questions instead of proposing.** Wrong shape. Better: propose; the user redirects only if wrong.
- **Defaults surfaced when they shouldn't be.** word_count_target, child_count_target — Director should pick sensible numbers based on the document; user overrides only if needed.
- **DirectorPanel exposes a lot of state.** Streaming text, plan card, execution card, error banners, heartbeats simultaneously. Progressive disclosure.
- **Silent completion** (already noted in §9.4).

---

## 24. Launch-blocker fix-pack

Carved out of the V2 scope as a small, immediate-execution set that unblocks the launch test. The launch test resumes only after these land.

- **B1.** `get_nodes_by_layer` canonical-order fix — Postgres VIEW or JS-side resort over ancestor orders. Regression test.
- **B2.** Director prompt revision — surface constraints (iteration cap, step cap, concurrent dispatch); require canonical-range statements in workflow proposals; instruct multi-workflow batching when request exceeds caps; stub Brief-awareness (graceful if Brief table not yet built).
- **B3.** Batch-N starting-position derivation from completed-work count (server-supplied to the Director's read context).
- **Prompt caching breakpoints** on system prompt + tool definitions.
- **`extended_thinking: true`** for Opus-class models in `director_configs.model_params`.
- Migration: updates to `director_configs.system_prompt`.

Holding-pattern `agent.director_max_concurrent_dispatch=1` stays in place until the proper throttle layer lands.

---

## 25. V1.x phased roadmap (post-launch-test)

Sequenced after the launch test resumes and passes. Each is a distinct build phase. Order is load-bearing first:

- **V1.x-A. Brief + Stage model.** Migrations (`briefs`, `brief_stages`, `brief_amendments`), `lib/brief/` module, `get_brief_state` tool, `propose_brief_amendment` proposal shape, `BriefViewer` + `StageCard` components.
- **V1.x-B. Scheduler & throttle redesign.** Queue tables, traffic classes, WFQ, per-user buckets, recovery sweep refinement. Replaces cap=1.
- **V1.x-C. Plan & cost meter.** Subscription columns on `organisations`, `pricing_rates` table, period-renewal cron, pre-call gate, cost meter UI for both user types, top-up flow.
- **V1.x-D. UI surfaces.** `AppShellStatusIndicator`, tree-level lock-and-state badges, scheduler panel, Stop button refinement, mid-turn Resume/Discard UX, AI-changed flag on nodes.
- **V1.x-E. Admin dashboard & monitoring.** Registry-backed live view, `metrics_samples` cron, alerting threshold config, synthetic probes.
- **V1.x-F. Failure-mode UX.** Implement the five-class user-facing behaviours, `report_capability_limit` synthetic tool, Class-C self-rejection prompt content.

---

## 26. V2 backlog (queued)

Multi-document Director (series-level); per-model prompt variants vs single shared prompt; QC job types (`review_node`, `consistency_check`, `evaluate_against_goal`); supervisory agent for behavioural drift and cost anomaly detection; per-node / per-workflow / per-Brief rollback (the latter two requiring snapshot infrastructure); cross-conversation memory beyond per-document; Director config version lifecycle (draft / beta / production / deprecated); extended-thinking UX surfacing (whether to expose reasoning blocks); reflective acknowledgement on completion; MCP integration for third-party tools.

---

## 27. Flagged-for-future decisions

Items deliberately left unresolved for later specific decisions:

- **WFQ weight tuning** — initial proposed weights (50/25/20/5) need real-traffic data from the dashboard to refine.
- **Class 1 dedicated concurrent-connection slot count** — depends on Anthropic tier headroom; needs analysis.
- **Per-user bucket refill rate** — calibration decision once real users are on the system.
- **Top-up granularity** — what sizes of top-ups are offered, at what prices.
- **Period-start vs live recalc on credit-rate changes** — the current decision is "lock the rate at period_start so existing in-period users don't see jumps" but the user-facing UX implication needs pinning before implementation.
- **Synthetic probe cadence** — every minute, every 5 minutes, etc.
- **`agent.director_conversation_window_turns` default** — TBD via real-traffic observation.

---

## 28. What is NOT changing

For clarity — these decisions remain locked from prior work:

- The propose-only contract (write tools do not execute during the agentic loop).
- The five Inviolables (verdigris uses, Cinzel in wordmark only, typeface boundary, no prose-editor toolbar, prose surface as lowest-noise).
- The H-01..H-15 hazards.
- The single-agent Director model.
- The `director_configs` row as the source of truth for system prompt, tool suite, model parameters.
- The agent_profiles model for individual agent_job system prompts.
- RLS-everywhere discipline.
- H-12 (no hardcoded operational values; everything via `getConfig()`).

---

## 29. Cross-references — where each decision lives in the wider doc set

The follow-on documents that will absorb these decisions:

- **`stelavox_director_architecture_v2_0.md`** (new Tier-A) — sections 1–27 above are the structural source. The design doc reorganises by architectural section.
- **`stelavox_technical_architecture_v2_3.md`** (bumped from v2.2) — §8 Director sections superseded with cross-reference. New tables documented. New H-NN hazards if any emerge during design-doc authoring.
- **`stelavox_product_specification_v1_9.md`** (bumped from v1.8) — Brief, Stage, plan/top-up model, app-shell status indicator, Stop-not-Cancel, cost meter, Brief-as-memory, AI-changed flag.
- **`stelavox_component_specification_v2_10.md`** (bumped from v2.9) — `AppShellStatusIndicator`, `BriefViewer`, `StageCard`, `SchedulerPanel`, `AdminDashboard`, `CostMeter`, plan-card extensions, tree-level lock-state badges.
- **`stelavox_agent_profile_library_v1_0.md`** — V1.x/V2 candidate job types listed (`review_node`, `consistency_check`, `evaluate_against_goal`).
- **`CLAUDE.md`** v1.20 — Spec Library Reference updated; Critical Component Specifications rows added; changelog entry summarising the deep dive.

---

## Changelog

**v1.1 — 2026-05-12** Three follow-on decisions locked after the initial record was reviewed:

1. **§7 reframed** — scheduler is the sole dispatch surface with no special cases. "Immediate execution" is a policy outcome, not a code-path bypass.
2. **§10 reframed** — Director turns adopt per-iteration function decomposition with Realtime-channel client updates. Function lifetime bounded by one iteration; whole-turn timeout risk eliminated. Architectural unification of Director turns and agent_jobs under one scheduler-dispatched single-shot pattern.
3. **§15 extended** — `batched_24h` added as a user-elected execution intent leveraging Anthropic Batch API (50% discount, up to 24h SLA, user-facing toggle). Distinct from `scheduled_at`.

All three locked; flow into the full Tier-A doc bump.

**v1.0 — 2026-05-12** Initial record. Captures decisions from the Director V2 deep-dive discussion held 2026-05-11 to 2026-05-12. Closed the conversation phase of the deep review; opens the design phase. All decisions herein are locked unless explicitly reopened in a later session.
