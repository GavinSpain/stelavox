# Stelavox Director Architecture v2.4

**Status:** Design + V1.x-B.2 implementation absorption + V1.x-C plan-model + per-org-BYOK + V1.x-D UI substrate absorption — supersedes parts of `stelavox_technical_architecture_v2_3.md` §8 (now v2.7).

> **V1.x-D close-out absorption (2026-05-18):** §10 (failure-class UX) lights up partially — Stop refinement (§17.9 mapped) ships with side-effect-honesty modal + Resume/Cancel/View three-way follow-on banner. §17.11 Director completion acknowledgement ships as mechanical UI (count + status + navigation hint); reflective acknowledgement deferred to V2 per §16.3. §17.8 NodeRow lifecycle badges + auto-lock + AI-changed flag implementation-complete (Stage membership pill deferred). §17.6 CostMeter compact + full + §17.7 PlanCard extensions + §A.7 BriefProposalCard concurrent-edit warning implementation-complete. **No new §16 backlog items.** **Provider-neutral consumption surfacing** locked across all V1.x-D surfaces (BYOK shows tokens only; per-step token labels stripped from PlanCards; numerical Stop savings dropped — CostMeter is the sole consumption surface).

> **V1.x-C close-out absorption (2026-05-16):** §13 Plan model marked **implementation-complete at substrate level** — credit-based admission gate with model-aware tokens→credits conversion via active `pricing_rates` row (M-130/131/132 + M-133/134/135 + M-140/141); the gate signature gains a `modelId: string` param at every caller (5 agent API routes + Director message route + workflow executor); auto-allocation on new-org trigger closes the "free unlimited LLM for new signups" gap. §15 BYOK retarget marked **implementation-complete** — Option A precedence (per-org → per-user transition window → platform) lives in `lib/llm/factory.ts`; Edge Function `byok-llm-call` accepts either `x-stelavox-org-id` or `x-stelavox-user-id`; per-user `user_anthropic_keys` enters the V1 transition window with `deprecated_at` filter on `userHasByokKey()` + deprecation warning logging; final per-user removal scheduled for V2. **Plan-eligibility decision locked 2026-05-17 with user:** BYOK-eligible plans = `byok_solo` + `byok_team` only (Product Spec v1.9 §3.1 BYOK Tiers; Platform Tiers writer/author/pro stay on the credit-allocation gate). Rationale captured in `stelavox_v1x_c_test_report_v1_0.md` §1: Model A (mutually exclusive plan slugs) wins over Model B (allocation-then-BYOK fallback). **CostMeter / PlanPanel / cost-meter mount surfaces in AgentTab+DirectorPanel+SchedulerPanel deferred to V1.x-D** (the dedicated UI substrate phase) — V1.x-C ships the OrgAnthropicKeyPanel admin surface (the only UI that BYOK plans cannot function without) + the GET `/api/usage/current-period` substrate endpoint that V1.x-D's CostMeter will consume. **No new §16 backlog items.**


**Authority:** Tier-A. This document is canonical for the Director's V2 architecture; TA §8 retains only what is not superseded here.
**Source decisions:** `docs/sessions/director_v2_deep_dive_session_record_2026-05-11.md` + V1.x-B.2 implementation (Tier-B build checklist + Test Report v1.0).
**Build target:** V1.x phased roadmap. **As of v2.2 (2026-05-16):** V1.x-LB / V1.x-A.1 / V1.x-B.1.1 / V1.x-B.1.2 / **V1.x-B.2 all SHIPPED** — the Director's per-iteration execution model (§8.1a) is live; the WFQ-VFT dispatcher with per-pool buckets + Class 1 reserved slots is the universal coordinator (§8 + §9); push-model stage triggers fire next-stage planning Director iterations without user re-engagement (§8.4); batched_24h Anthropic Batch API integration handles eligible op types (§4.4); the metrics-rollup layer feeds V1.x-E admin dashboard (§17). Filename intentionally retained at `v2_0.md` (the spec library indexes by filename + version-bumps in-place per the v2.0.1/.2 precedent — the canonical version stamp is the file's heading "Director Architecture v2.2", not its filename). Sections marked V1.x or V2 indicate the build phase that lands them.

---

## 0. Reading order

This document is structured so that the architecturally-load-bearing decisions appear first. If you need to make a design or implementation call referencing this doc, read §1 (philosophy) and §2 (four-tier model) first; everything else builds on them.

| Section | Content | Build phase |
|---|---|---|
| 1 | Operating philosophy | foundation |
| 2 | Four-tier execution model | foundation |
| 3 | Plan/execute separation | foundation |
| 4 | Tool registry V2 | V1.x-A + launch-blocker |
| 5 | Director-as-bounded-planner | launch-blocker + V1.x-F |
| 6 | The Brief | V1.x-A |
| 7 | Canonical ordering | launch-blocker (B1) |
| 8 | Scheduler as universal coordinator | V1.x-B |
| 9 | Throttling and traffic engineering | V1.x-B |
| 10 | Failure-mode taxonomy | V1.x-F |
| 11 | Cancellation model | V1.x-D |
| 12 | Conversation context model | V1.x-A |
| 13 | Plan and cost model | V1.x-C |
| 14 | Observability | V1.x-E |
| 15 | UX surfaces | V1.x-D |
| 16 | V1.x vs V2 scope split | reference |
| 17 | Cross-cutting impact | reference |

---

## 1. Operating philosophy

Four principles form the constitution. Every later design decision is tested against them.

**1.1 Time is not the constraint; visibility is.** Long-running work is acceptable; silent failure is not. Every architectural choice must preserve "the user can see progress" as a hard requirement. A turn that takes five minutes and shows continuous progress is acceptable; a turn that takes thirty seconds and shows nothing is not.

**1.2 The Director knows its own limits.** Constraints — max steps per workflow, max tokens per turn, concurrent dispatch limit, per-user and global throttle headroom, Anthropic tier ceilings — must be surfaced in the Director's prompt and runtime state so the model plans *within* them, rather than silently failing *against* them.

**1.3 Limits are derived from global capacity, not local-tab safety.** The right value for `max_concurrent_dispatch`, `max_steps_per_workflow`, and similar is derived from the platform's Anthropic tier headroom across all concurrent users, not from what one user's screen can render. Single-user safety is incidental; multi-tenant capacity is the budget.

**1.4 iPhone simplicity at the user-facing surface.** One way to do something; opinionated defaults; complexity hidden inside the system; direct manipulation; the product makes the call and the user redirects only if wrong. **This applies to the user-facing UX, not to internal primitives** — internally, narrow well-named tools and explicit state machines win.

These four principles are referenced by section number throughout the rest of this document.

---

## 2. The four-tier execution model

Stelavox's Director operates across four named tiers. Each tier has its own lifecycle, persistence, approval gate, and user-visible surface.

```
Brief        the user's macro-intent (the whole project)
  └── Stage  a milestone in the Brief's roadmap (e.g. "expand book → acts")
       └── Workflow  the Director's plan for a stage (e.g. 5 expand steps)
            └── Step  one dispatched unit of work (one agent_job)
```

**Tier 1 — Step.** One LLM operation on one node (or a synchronous DB-only operation like a reorder). Persisted as a `workflow_steps` row that dispatches an `agent_job`. The smallest atomic unit. Already exists.

**Tier 2 — Workflow.** The Director's plan: a coordinated group of Tier-1 steps with a dependency graph, an approval gate, and an execution lifecycle (`draft → approved → running → completed | paused | cancelled`). Already exists as `workflows`.

**Tier 3 — Stage.** A milestone in a Brief's roadmap. A Stage spawns one or more Workflows. It has its own trigger (when to advance to this stage), status, and acknowledgement. **New in V2.**

**Tier 4 — Brief.** The user's project-level intent. Persists for the life of the project. Holds the roadmap (the ordered Stages), preferences, decisions, and completion history. Acts as the Director's canonical durable memory. **New in V2.**

The relationships:

- One Brief → many Stages (ordered, with triggers).
- One Stage → one or more Workflows (often one; auto-split produces N).
- One Workflow → many Steps (with dependency graph).
- One Step → one agent_job (or one synchronous DB operation).

Each tier has its own approval surface. The user approves the Brief (the roadmap) once at project start; approves each Workflow per stage as the Director proposes them; cancels at any tier from the scheduler view.

---

## 3. Plan/execute separation

**Invariant:** the Director plans; it does not execute. The agentic loop produces only proposals. Nothing in the database is written by the Director's loop. Execution happens after author approval, via the scheduler dispatching agent_jobs.

This invariant carries across all four tiers. The Director proposes:

- A **Brief** via `<brief_proposal>` (the roadmap) → user approves at the project-start gate.
- A **Workflow** via `<workflow_proposal>` (per stage, or unsolicited mid-project) → user approves at the workflow gate.
- A **Brief amendment** via `<brief_amendment_proposal>` (mid-project changes to roadmap or preferences) → user approves at an amendment gate.

The Director **never** writes to:

- The document (nodes, prose, comments) — except via approved workflow execution.
- The Brief — except via approved amendments.
- The scheduler — except via scheduling intent expressed in proposals.
- Any operational state (rate limit buckets, plan consumption) — except as a side effect of approved execution.

This is what makes powerful tools safe to give to the Director. It is the foundation of every other design choice and is non-negotiable in V2.

---

## 4. Tool registry V2

**Design lens:** narrow, well-named tools that produce clean plan-step descriptions. The user never sees tool names — only step descriptions in natural language — but the model's choice of tool shapes how clean those descriptions read. The iPhone test on the registry concluded narrow tools win.

### 4.1 Read tools (7)

| Tool | Returns | Status |
|---|---|---|
| `get_document_state` | layer stack, node counts, locked layers, word totals | unchanged |
| `get_node` | full content of one node by ID | unchanged |
| `get_nodes_by_layer` | nodes at a given layer in **canonical depth-first order** | **fixed in launch-blocker B1** |
| `get_node_tree` | subtree from a root down to a depth | unchanged |
| `assess_downstream_impact` | preview of descendants a change would touch | unchanged |
| `get_workflow_history` | past workflows on this document | unchanged |
| `get_brief_state` | structured view of the current Brief + stages + preferences | **new** |
| `get_scheduler_state` | queue depths, current load, estimated start times | **new** |

Deprecated: `get_conversation_history`. Redundant with the summarised preamble injected at the head of every user message; the model already has the relevant recent history.

The `get_brief_state` and `get_scheduler_state` reads are both small payloads (typically 1–5kb each) and are designed to be loaded by the Director at every turn that does substantial planning work.

### 4.2 Write tools (7)

All produce `WorkflowStepProposal` objects accumulated for the end-of-turn `workflow_proposal` block. None write to the database during the agentic loop.

| Tool | Semantic | Status |
|---|---|---|
| `create_expand_step` | decompose a node into N children at the next layer | unchanged |
| `create_synthesise_step` | generate prose for a leaf from its summary + linked context | unchanged |
| `create_refine_step` | agent-rewrite a `summary` / `prose` / `notes` / `metadata` field | unchanged |
| `create_context_step` | create-and-fill a context node (atomic on the server side) | **SU-J11-2 semantic fix** |
| `create_comment_step` | leave an editorial note attached to a node | unchanged |
| `create_node_reorder_step` | change a node's order within its parent | unchanged |
| `create_batch_step` | apply an operation across a contiguous canonical range of N nodes as one step | **new compound** |

**`create_context_step` semantic fix (SU-J11-2 resolution):** the server treats the step as a single semantic operation. If the target context node exists, fill it. If it does not exist, the server auto-creates it (under the appropriate context category) and fills it atomically. The Director writes one step regardless. This eliminates the create-vs-fill ambiguity that produced the workflow stalls observed in the Mars-series investigation.

**`create_batch_step` shape:** parameters specify the operation (`expand` / `synthesise` / `refine` / `comment`), the canonical-range expressed as `[start_position, end_position]` against `get_nodes_by_layer`'s output (post-canonical-order fix), and any per-operation parameters. The plan card reads as one human-readable line ("Synthesise prose for beats 11–20"). On execution the scheduler fans out into N agent_jobs internally, preserving cascade ordering within the range.

### 4.3 Proposal artefacts (3)

The Director's end-of-turn output may include one of three structured proposal blocks. Each is parsed by the route layer and persisted as a draft pending user approval.

| Proposal | Persisted as | Approval gate |
|---|---|---|
| `<workflow_proposal>` | `workflows` row with `status='draft'` | per-workflow approval |
| `<brief_proposal>` | `briefs` row with stages, `status='draft'` | Brief-shape approval |
| `<brief_amendment_proposal>` | `brief_amendments` row pending | amendment approval |

Only one proposal block per turn. If the Director's planning would need multiple, it should propose the most-immediate and offer the others as a follow-up turn.

### 4.4 Scheduling intent in workflow proposals

The workflow_proposal shape extends to carry scheduling intent — not Director-controlled scheduling (see §8), but a recommendation the user can accept or modify at approval time.

```json
{
  "title": "...",
  "execution_intent": "immediate" | "parked" | "scheduled" | "batched_24h",
  "scheduled_at": "...",
  "pacing_hint": "as_fast" | "paced_user_review" | "opportunistic",
  "batch_position": { "n": 2, "of": 5 },
  "steps": [...]
}
```

Auto-split produces N workflow proposals, one per batch; the Director sets `batch_position` on each and parks batches > 1 by default.

**Execution-intent vocabulary:**

- `immediate` — submitted to scheduler with no constraint; runs as soon as policy admits. Default.
- `scheduled` (with `scheduled_at`) — runs at a specified time; normal streaming execution.
- `parked` — queued without a start time; waiting for user release.
- **`batched_24h`** — submitted to Anthropic Batch API. 50% cost discount; up to 24-hour delivery SLA. User-elected option for latency-tolerant work. Surfaced on the plan card as a "Save 50% — deliver within 24 hours" toggle. Distinct from `scheduled_at` (which is "start at this time, normal speed").

The four intents are not mutually exclusive — a user could combine `scheduled_at:2am tomorrow` with `batched_24h` to mean "submit at 2am, accept up to 24h delivery from that point." The scheduler interprets the combination at run time.

---

## 5. Director-as-bounded-planner

The 114-scene silent-truncation incident exposed that the Director did not know its own caps. The fix has two parts: prompt content and a synthetic tool.

### 5.1 System prompt content

The Director's prompt must contain its operational limits, surfaced as facts:

- Iteration cap (today: `agent.director_max_tool_iterations` = 20).
- Step cap per workflow (today: `agent.director_max_workflow_steps` = 30).
- Concurrent dispatch cap (today holding-pattern: `agent.director_max_concurrent_dispatch` = 1; will become per-user / global derived in V1.x-B).
- The auto-split protocol: when a request exceeds caps, propose a multi-workflow plan with batch 1 immediate, batches 2..N parked or scheduled.

The prompt also teaches:

- Canonical-range discipline (§7): every batch must be a contiguous canonical range, stated explicitly in the workflow title and `impact_summary`.
- Brief awareness: read `get_brief_state` at every substantive turn; propose `brief_amendment` when the user states a durable preference.
- Conversation window discipline: the conversation is a rolling working buffer, not memory. Promote durable items into Brief.

### 5.2 The `report_capability_limit` synthetic tool

When the Director recognises that the user's request exceeds what it can do as a single turn, it calls this tool instead of attempting and silently truncating. The tool produces a structured Class-C outcome (§10) with a clear explanation. The route layer surfaces this in the UI as Director self-rejection plus a proposed alternative shape (typically auto-split).

This is the prompt-side closure of the silent-truncation surface.

---

## 6. The Brief

### 6.1 Purpose

The Brief is the Director's canonical durable memory for the life of a project. It holds the user's macro-intent in structured, queryable form: goal, stage roadmap, voice preferences, project-level constraints, named design decisions, completion history.

The Brief reframes the Director's memory model: prior to V2 the conversation was the only durable memory and the 60k-token summariser was the lossy retention mechanism. With the Brief, the conversation becomes a rolling working buffer (§12), and the load-bearing project state lives in a structured artefact the Director reads explicitly via `get_brief_state`.

### 6.2 Schema

Hybrid relational + JSONB. Top-level scalars for indexing and state machines; JSONB for evolving model-friendly content.

```
briefs
  id                   UUID PK
  document_id          UUID FK → documents (one-to-one)
  organisation_id      UUID FK → organisations
  status               TEXT ('active' | 'completed' | 'cancelled' | 'archived')
  goal_text            TEXT
  preferences          JSONB  -- voice notes, constraints, named decisions
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
  amendment_type  TEXT
  before, after   JSONB
  approved_at, approved_by_user_id
  reason          TEXT
```

RLS scoped to `organisation_id`. Types regenerated via `supabase gen types` post-migration (H-10).

### 6.3 Director-facing view

`get_brief_state()` returns a flattened, structured payload assembled from the tables:

```json
{
  "goal": "Write a 90,000-word literary noir set in 1970s Sydney…",
  "status": "active",
  "current_stage": { "order": 2, "title": "Act structure", "status": "running" },
  "stages": [
    { "order": 1, "title": "Premise & context", "status": "completed" },
    { "order": 2, "title": "Act structure", "status": "running" },
    { "order": 3, "title": "Chapter expansion", "status": "scheduled" }
  ],
  "preferences": {
    "voice": "dry, sardonic, never sentimental",
    "constraints": ["no flashbacks before chapter 4"],
    "decisions": ["protagonist: Detective Marcus Holt", "theme: corruption"]
  }
}
```

Typically 1–5kb. The Director reads it once at the start of any substantive planning turn.

### 6.4 Brief vs context node — boundary

| In Brief | In context nodes |
|---|---|
| Project goal, target word count, deadline | Character profiles, backstory, dialogue style |
| Stage roadmap and completion history | Location descriptions, period details |
| Voice and register preferences | Theme exploration (as content) |
| Constraints ("no flashbacks before chapter 4") | World facts (cars, slang, politics of the period) |
| Named decisions ("protagonist is Marcus Holt") | Plot threads with scene/beat hooks |

**Heuristic for the Director:** content about *how* the work is made → Brief amendment; content about *what is true in the world* → context node create/edit. Grey-zone facts get a one-line declaration in Brief with a pointer; substance lives in a context node.

### 6.5 Stage triggers

Stages advance under one of four trigger types:

- `after_stage:<N>` — run when stage N completes (the default series case).
- `scheduled_at:<timestamp>` — fixed time.
- `manual` — parked; user releases explicitly.
- `compound` — multiple conditions (e.g. `after_stage:4 AND scheduled_at:>2026-06-01`).

The scheduler (§8) is the trigger evaluator. When a trigger fires, the scheduler invokes the Director with a system-initiated turn: "Stage N's trigger fired. Propose the workflow." The Director re-reads state via `get_brief_state` + document tools and proposes the workflow. User approves it at the normal workflow gate.

So **the Director gets called by the scheduler**, not the other way round.

---

## 7. Canonical ordering and range discipline

The 2026-05-10 launch test surfaced that `get_nodes_by_layer` returned scenes ordered by intra-parent `order` only, with implementation-defined cross-parent tiebreak. A "next 10 scenes" batch landed scenes at canonical positions 39, 46, 47, 77, 83, 84, 89, 90, 95, 109 — scattered, not contiguous. This is launch-blocking.

### 7.1 Fix (launch-blocker B1)

`get_nodes_by_layer` returns nodes in **canonical depth-first order**: act-order, then chapter-order within act, then scene-order within chapter, etc. Two implementation options, either acceptable:

- **Server-side**: a Postgres VIEW or function that joins each node to its ancestor chain and produces a composite sort key.
- **Application-side**: fetch with ancestor metadata; sort in JS by walking ancestor orders.

The VIEW approach is preferred for efficiency at large node counts and for consistency across other read tools that need canonical order. Either way, a regression test asserts canonical contiguity over a fixture document with multiple acts/chapters/scenes.

### 7.2 Prompt discipline (launch-blocker B2)

The Director's prompt must require:

- Every batch operation specifies a contiguous canonical range.
- The workflow title states the range explicitly ("Synthesise prose for scenes 11–20").
- The `impact_summary` lists the canonical positions touched.

### 7.3 Batch-N start-position derivation (launch-blocker B3)

For multi-workflow batches, batch-N's starting canonical position must be derived from an authoritative count of already-completed work, not from the model's memory across turns. The server provides this as part of the Director's read context for any system-initiated stage advancement: "N steps already completed; next batch starts at canonical position X."

### 7.4 Why all three are coupled

Fixing just the read tool isn't sufficient — the Director still needs to *describe* the range correctly to the user, and the batch boundaries must be authoritative server-side. The three together close the user-trust failure observed in the launch test (workflow titles read coherently while the underlying selection was wrong).

---

## 8. The scheduler as universal execution coordinator

### 8.1 Principle — no special cases

**Every agent_job — immediate, paced, future-start, parked, batched — flows through the scheduler. No special cases. No bypass paths.** "Immediate execution" is a *policy outcome* of the scheduler, not a separate code path. Every job creates a queue entry; the scheduler's policy decides whether to dispatch now, pace, defer, or batch.

Consequences:

- Single dispatch surface in code — no `if (immediate) bypass else queue` fork.
- Scheduler intelligence accumulates uniformly. Future intelligence (priority handling, admission control, dynamic throttle awareness) captures every scenario automatically.
- Observability is uniform — every job has a queue entry; every job has `queued_at` distinct from `started_at`; every job is countable in the dashboard.
- The performance cost of always-queueing is negligible (one DB insert per job).

This supersedes the current `lib/director/workflow-executor.ts` `Promise.all`-over-batch model (TA v2.2 §8.4).

### 8.1a Director-turn execution model — per-iteration decomposition

The Director's agentic loop is *not* a single long-lived function. It is decomposed into per-iteration function invocations, each dispatched through the scheduler like any other agent_job. Function lifetime is bounded by **one iteration** (~30s typical, ~2 min worst case), well below the Vercel 300s ceiling.

**Flow:**

```
client → POST /api/director/message
  ↓
server creates turn registry row, returns turn_id immediately
  ↓
server enqueues "Director iteration #1" job in scheduler
  ↓
function picks up the job:
  - loads turn state (messages array, accumulated tool_use blocks, suppression state)
  - runs one iteration (one Anthropic streaming call)
  - publishes events to Realtime channel `director_turn:{turn_id}`
  - persists state at iteration end (turn_state='interim')
  - if more iterations needed → enqueues "Director iteration #N+1"
  - exits
  ↓
client subscribes to Realtime channel `director_turn:{turn_id}`
  ↓
loop continues across function invocations until turn complete, Stop, or terminal error
```

**Properties:**

- **Failure blast radius is one iteration**, not one turn. A function crash, timeout, or transient glitch loses ~30 seconds of work, not 15 minutes.
- **Crash recovery is automatic at iteration boundaries.** State persists at each iteration end; the scheduler picks up the next iteration regardless of what killed the prior function. No state-reconstruction guesswork.
- **Iterations are idempotent** by construction. Deterministic inputs (messages array + tool definitions + system prompt) + propose-only invariant (write tools don't write during the loop) → retry is safe.
- **Stop and intervention become surgical.** Stop at an iteration boundary is a clean abort with no half-written state.
- **Architectural unification.** Director turns and agent_jobs share the same shape — scheduler-dispatched single-shot functions publishing into Realtime channels. One mental model, one code path, one observability surface, one set of recovery semantics.
- **Cost transparency improves.** Each iteration writes its own `cost_credits` row. "Iteration 5 of ~7, $X.XX accumulated" can surface in real time.
- **Hot updates are clean.** Deploy a prompt fix or executor change mid-Director-turn: the next iteration picks up the new version.
- **Extensibility.** Pause-for-clarification mid-loop, mid-turn user input, conditional next-iteration dispatch — all natural extensions of this architecture (V2 territory; not required for V1).

**Within an iteration**, the Anthropic streaming call cannot be halted-and-resumed — it is the irreducible atom. A single iteration is bounded enough that the 300s ceiling isn't a concern in normal operation. Pathological cases (single iteration producing 60k+ output tokens) are addressed by Class C prompt content limiting per-iteration output size (§5).

**Trade-off:** modest inter-iteration latency (~50–200ms cold-start cost per function boundary). Negligible against multi-minute turns.

### 8.2 Queue states

| State | Meaning |
|---|---|
| `parked` | Queued; no start time; waiting for user "go" or scheduled trigger |
| `scheduled` | Queued; future start time |
| `submitted_to_batch` | Submitted to Anthropic Batch API; awaiting webhook callback or poll |
| `ready` | Triggers fulfilled, dependencies satisfied, awaiting capacity |
| `pacing` | Held by throttle; awaiting next available slot |
| `running` | Dispatched, in-flight |
| `completed` / `failed` / `cancelled` / `skipped` | Terminal |

### 8.3 Dependency resolution

Steps within a workflow form a dependency graph via `depends_on_step_orders`. Cascade-serial requirements (§9.2) are auto-derived server-side from operation type and target structure; the Director can declare additional dependencies that the rule engine wouldn't see. When in doubt, the scheduler treats steps as serial — never silent parallel.

### 8.4 Scheduler invokes the Director on stage triggers

When a stage's trigger fires:

1. Scheduler marks the stage `proposing`.
2. Scheduler creates a system-initiated Director turn with the stage context: "Stage N's trigger fired. Read the current document state. Propose the workflow."
3. Director re-reads state, proposes the workflow.
4. Surface the proposal to the user for normal workflow approval.

This is the mechanism by which large projects progress through stages without the Director needing direct schedule-write tools.

### 8.5 No direct Director scheduling tool

The Director does not write to the scheduler. It expresses scheduling intent inside `workflow_proposal` parameters (§4.4); the user approves the shape; the scheduler runs it. The `get_scheduler_state` read tool lets the Director see queue depth and propose informed scheduling, but never act on it.

### 8.6 Pre-call gate

Before any agent_job dispatches, the scheduler runs three gates in sequence:

1. **Plan budget gate** (§13) — does the user have headroom in their plan allocation?
2. **Throttle gate** (§9) — is there capacity in the user's traffic class right now?
3. **Idempotency gate** — is there already a running attempt for this `(workflow_step_id, attempt_number)` key?

If any gate fails, the step transitions to the appropriate paused state (`pacing` if throttle-blocked; back to `pending` if budget-blocked, with a user-facing message).

---

## 9. Throttling and traffic engineering

### 9.1 Anthropic's four rate-limit dimensions

All four are enforced simultaneously by Anthropic and must be modelled by our throttle:

- **Requests per minute (RPM)** — sliding 60-second window.
- **Input tokens per minute (ITPM)** — sliding 60-second window.
- **Output tokens per minute (OTPM)** — sliding 60-second window.
- **Concurrent connections** — open streaming requests at any instant. *The binding constraint for our workload.*

Header-driven truth: `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}` headers are the source of truth. Internal counters are predictions; reconcile from headers every response.

### 9.2 Cascade-serial dependency model

A "cascade" is a chain of operations where step N reads the output of step N-1 as part of its context. Synthesise on canonical-sibling beats is the canonical example: beat 2's prose synthesis reads beat 1's prose for continuity.

The scheduler models cascade requirements as:

- **Server-derived dependencies** from operation type + target structure. Example rule: `synthesise(beat_at_position_P, parent_X)` depends on `synthesise(beat_at_position_P-1, parent_X)`.
- **Director-declared dependencies** via `depends_on_step_orders` in the workflow proposal — for cascades the rule engine wouldn't see (e.g. theme consistency across non-adjacent scenes).
- **Default serial** when uncertain. Better latency cost than silent context corruption.

Steps with no cascade relationship run in parallel up to the throttle cap.

### 9.3 Four traffic classes

Modelled after cellular NodeB packet scheduling — different QoS per class, with weighted fair queueing as the arbitration mechanism.

| Class | Workload | Priority |
|---|---|---|
| 1 | Interactive Director turn user is watching | Strict priority, latency-critical |
| 2 | Workflow just approved, user watching | Medium |
| 3 | Background batch (large auto-split, user moved on) | Low, latency-tolerant |
| 4 | Scheduled / parked, opportunistic | Lowest, fills leftover capacity |
| BYOK | User's own Anthropic key | Separate route, separate throttle |

### 9.4 Weighted Fair Queueing

Strict priority would starve Class 3 and 4 during busy hours. WFQ assigns each class a guaranteed minimum share:

- Class 1: 50% (initial)
- Class 2: 25%
- Class 3: 20%
- Class 4: 5%

Strict priority resolves *within* classes and during unused-share situations. Age-based promotion increases the effective priority of long-waiting Class 3/4 items so they eventually compete with Class 1 — preventing indefinite starvation.

Weights are configurable and will be tuned with real traffic from the observability dashboard (§14).

### 9.5 Class 1 dedicated capacity

LLM streaming connections are **non-preemptible** — once a stream is open, it can't be yanked to favour a higher-priority user. To prevent a long Class 3 connection from blocking a Class 1 user, a small number of concurrent-connection slots are reserved exclusively for Class 1. The reservation count is configurable; calibration depends on Anthropic tier headroom analysis.

### 9.6 Per-user token bucket

Each user has their own bucket of capacity that refills at a rate proportional to their fair share. Heavy use depletes the bucket and naturally waits longer for refills. Cleaner than explicit "low-priority" demotion — no punishment surface, predictable mechanism, easy to expose in the UI ("your bucket is at 12%; next request available in ~30s").

### 9.7 Throttle-not-deny

When limits are approached, delay the next call rather than reject. Large user-approved workflows should run, just paced. Denial is reserved for plan-budget exhaustion (§13), not capacity contention.

### 9.8 Global state

The throttle state lives in Postgres (`FOR UPDATE SKIP LOCKED` for atomic queue operations) or Redis. Every function invocation sees the same state. Reservations have a TTL — if the reserving function dies before consuming, the slot returns.

### 9.9 Reservation pattern

Before opening an Anthropic streaming connection:

1. Reserve one concurrent-connection slot + an estimated token cost (input + output).
2. Open the stream.
3. On response, reconcile actuals against headers; release the slot; correct the bucket.

If reservation fails (no headroom), step transitions to `pacing` and waits.

### 9.10 Migration off the cap=1 holding pattern

The current `agent.director_max_concurrent_dispatch=1` is a holding pattern from 2026-05-10. It stays in place until V1.x-B replaces it with the full traffic-engineering layer. The transition is a config change once the new layer is verified.

---

## 10. Failure-mode taxonomy

Five user-facing classes. Multiple underlying causes map to the same class; the user experience is consistent within a class.

### 10.1 Class A — Transient (auto-recoverable)

- 5xx from Anthropic, brief 429s within throttle headroom, network blips, transient DB errors.
- **UX**: silent retry with backoff. After ~5s of retrying, a small "Director is reconnecting…" indicator. Auto-recovers in almost all cases.

### 10.2 Class B — Interrupted (resumable)

- Vercel function timeout mid-iteration, network blip mid-stream, user-initiated Stop, server restart, Anthropic mid-stream disconnect.
- Under per-iteration decomposition (§8.1a), Class B almost always means "one iteration was interrupted" rather than "the whole turn was lost." The scheduler automatically re-enqueues the interrupted iteration; the user typically sees a brief "Director is reconnecting…" rather than a Resume prompt.
- **UX (rare case where automatic re-enqueue isn't viable)**: "Your turn / workflow was interrupted at iteration 5 — Resume / Discard / View what was done?" Same shape regardless of cause; same shape as crash recovery.

### 10.3 Class C — Capacity / capability (Director-acknowledged)

- max_tokens hit mid-plan, iteration cap reached, request exceeds caps, throttle queue too deep to honour now.
- **UX**: Director surfaces the constraint conversationally and proposes alternatives: *"This is a 200-step request — I'll split it into 7 batches. Approving batch 1; the rest are parked."* Treated as normal Director behaviour, not error UI.
- The `report_capability_limit` synthetic tool (§5.2) produces this outcome explicitly rather than via silent truncation.

### 10.4 Class D — Validation / safety

- Injection-scanner trip, canary leak, locked-node conflict, schema validation failure.
- **UX**: specific issue surfaced with the relevant node and action affordance.
  - Canary leak → "AI safety check failed — work not committed; admin notified."
  - Locked node → "Scene 12 is locked — unlock and retry / skip / cancel workflow?"
  - Injection false-positive on legitimate content (SU-J11-1) → "This content was flagged — proceed anyway / edit / cancel?"

### 10.5 Class E — Hard system failure (admin needed)

- Auth errors (401/403), infrastructure outage, our bugs.
- **UX**: "Something went wrong. Your work is safe. We've been notified." Admin alerted. User stops.

### 10.6 State transitions

| Class | conversation_messages | workflow | agent_job |
|---|---|---|---|
| A | unchanged (retry in flight) | unchanged | unchanged |
| B | `interim` → `interrupted` | `running` → `paused` | `running` → `pending` (retry) |
| C | `interim` → `final` (Director self-rejected, proposed alternative) | n/a at plan time | n/a |
| D | `interim` → `final` (with error prose) | `running` → `paused` (with reason) | `running` → `failed_validation` |
| E | `interim` → `system_error` | `running` → `failed` | `running` → `failed_system` |

### 10.7 Dashboard segmentation

Each class is surfaced separately on the admin dashboard:

- Class A rate → throttle tuning signal.
- Class B rate → reliability signal.
- Class C rate → Director prompt tuning signal.
- Class D rate → safety / content review signal.
- Class E rate → operational alarm.

---

## 11. Cancellation model

### 11.1 Stop as the only first-level action

The user-facing button mid-turn or mid-workflow is **Stop**, not Cancel. Stop halts now, keeps what's done, leaves the rest paused-and-resumable. Structurally identical to crash recovery — the existing recovery substrate handles it.

After Stop, the natural follow-on options are:

- **Resume** — continue from the persisted state.
- **Cancel** — abandon remaining work; mark cancelled. *Cancel is a scheduler-view action, not a chat action.*

### 11.2 Side-effect honesty

Three nuances must be made visible to the user at Stop time:

1. **In-flight LLM tokens are paid.** Anthropic bills for tokens streamed before abort. Stop saves on the *next* iteration's call, not bytes already streamed. UI message: "Stopping now saves an estimated X tokens / $Y."
2. **Completed work persists.** "3 of 10 steps complete. Stop will keep these and pause the rest."
3. **Read-tool calls have zero side effects.** Stop during planning loses no DB state.

### 11.3 Scheduler-view cancellation

The scheduler panel supports Cancel at four levels:

- **Step** — cancel one step; remaining workflow continues.
- **Workflow** — cancel the workflow; completed steps stay.
- **Stage** — cancel the stage; cascades to any active workflows.
- **Brief** — cancel the project; cascades to all stages and workflows.

Each level shows the "this will cancel N pending items; M completed items remain" confirmation.

### 11.4 Rollback (deferred)

Rollback requires versioning infrastructure. Three tiers:

- **Per-node content rollback** — V1.x (Phase 6 VersionHistory restore, already queued). Move the "current version" pointer back; new version stays in history as audit.
- **Per-workflow rollback** — V2. Iterate the workflow's affected nodes, restore each; cross-cutting on top of node-level versioning.
- **Per-Brief snapshot/restore** — V3 or later. Explicit point-in-time snapshots, not just per-node history walking.

Structural operations (expand, reorder, context creation) need additional thought beyond simple version-pointer restore.

---

## 12. Conversation context model

### 12.1 Architectural shift

The Brief (§6) becomes the canonical durable memory. Conversation is demoted to a rolling working buffer.

Today's 60k-token summarisation is position-based (compress the oldest half) and crude — it can lose load-bearing content (an early vision statement) while preserving recent chatter. With the Brief holding load-bearing project state, conversation summarisation becomes acceptably lossy.

### 12.2 What lives where

- **Brief** — project goal, stage roadmap, voice preferences, constraints, decisions. Loaded at every substantive Director turn.
- **Document tree** — artefact memory. Approved-workflow outcomes live in nodes.
- **Workflow history** — past plans. Accessible via `get_workflow_history`.
- **Conversation** — rolling window of recent turns. In-flight iteration, direct cross-turn references, unresolved questions, continuity of tone.

### 12.3 Conversation window

A configurable rolling window of the most recent N turns. Default tentatively ~5–10; tuned by `agent.director_conversation_window_turns`. Older turns are dropped or aggressively summarised.

### 12.4 Promotion mechanism

When the user states a durable preference, decision, or constraint in conversation, the Director proposes a Brief amendment to promote it. *"I notice you've said you want a dry, sardonic voice — should I add that to the project Brief?"* On approval, the preference is durable; the conversation can drop it.

### 12.5 User-initiated Clear

A Clear Conversation button is a first-class affordance. Confirmation: *"Clearing will discard recent conversation but keep your project Brief and document. Continue?"* Low-risk action because Brief carries the load.

### 12.6 Prompt caching reduces compression urgency

Anthropic's prompt caching supports cache breakpoints on system prompt + tool definitions. Within a turn, repeated context hits the cache at ~10% cost. Across turns the 5-minute TTL may expire, but active turns within the window stay cheap. So conversation compression is primarily about staying within max-context — not primarily a cost concern once caching is enabled.

---

## 13. Plan and cost model

### 13.1 Two user types

- **BYOK users** see tokens (input/output/total) per session and per project, plus dollar cost computed from Anthropic's published rates × tokens. Informational; we don't enforce — Anthropic enforces against their account.
- **Non-BYOK users** see a percentage against plan allocation. "32% of your monthly allowance used. Renews in 14 days."

### 13.2 Plan model — pay-in-advance hard cap

- The cap is the cap. At 100%, new LLM calls stop until renewal or top-up.
- No surprise billing.
- Plan advertised in dollars ($50/month etc.). Internal accounting is in opaque credits; the user never sees the unit.
- **Top-up** is the relief valve. Pre-pay; extends `period_allocation` or `period_end`.
- In-flight work completes at the 100% boundary; new work blocks. Avoids half-completed agent_jobs.

### 13.3 Pre-emptive estimate gate

When the Director's forward estimate would push the user past 100%, surface on the plan card before approval: *"This workflow estimates ~12% — you have 5% remaining. Top up to approve or trim the plan first."*

### 13.4 Internal credit rate

Proportional to actual Anthropic cost with a small margin (`plan.margin_multiplier`). Adjustable to absorb upstream price changes while keeping the user-facing plan price stable. Same model Anthropic uses on us, applied one level up.

### 13.5 Time-versioned pricing — daily granularity

```
pricing_rates  (append-only)
  id                                    UUID PK
  model_id                              TEXT
  effective_from                        DATE
  input_credit_per_million_tokens       DECIMAL
  output_credit_per_million_tokens      DECIMAL
  cache_read_credit_per_million_tokens  DECIMAL
  cache_write_credit_per_million_tokens DECIMAL
  created_at, created_by_user_id
```

Pattern:

- `getCreditRate(model_id, on_date)` returns the row with greatest `effective_from <= on_date`.
- When a call completes, compute its credit cost using the rate effective today; store on `agent_jobs.cost_credits` / `conversation_messages.cost_credits`. Stored value is fixed forever.
- `period_consumed` is the running sum of stored credit costs; never recalculated from raw tokens.
- Workflow spanning a rate change: early-completed steps at old rate, later-completed at new rate. Natural and correct.
- Date boundary in **UTC**.
- Append-only — never UPDATE existing rows. Rate corrections insert a new row dated tomorrow.

### 13.6 BYOK uses parallel `anthropic_pricing` table

Same time-versioned pattern, mirroring Anthropic's public rate card by date. Feeds the BYOK dollar meter.

### 13.7 Forward estimate ties in

The Director's estimate runs through the same internal credit calculation:

- BYOK plan card: "Estimated cost: $X.XX / ~Y tokens"
- Non-BYOK plan card: "Estimated cost: ~Z% of your monthly allowance"

Same upstream calculation, different denomination per user type.

### 13.8 Deferred to later versions

Per-user hard caps beyond plan, per-document budgets, tier-aware routing (Haiku for cheap work, Opus where it matters), escalation paths, admin alerts on anomalous spend, billing/subscription integration, spend reports.

---

## 14. Observability

### 14.1 Live registry pattern

Every long-running thing registers on start, heartbeats during, and unregisters on end:

- Director sessions (`director_sessions` registry)
- Workflows (already in `workflows.status` + new heartbeat column)
- Agent jobs (already in `agent_jobs.status` + heartbeat)
- Scheduler queue entries

Schema shape:

```
session_id, user_id, started_at, last_heartbeat_at,
expected_completion_at, current_iteration/step,
status, traffic_class
```

**Stale detection** via the universal recovery sweep cron: `last_heartbeat_at < now() - 60s` → `suspected_dead`; longer threshold → `interrupted`.

**Architectural payoff:** the same registry serves both the admin dashboard and the user-facing app-shell status indicator. Different RLS views over the same substrate.

### 14.2 Metrics samples

A scheduled cron polls Vercel + Supabase + Anthropic-header aggregations and writes timestamped snapshots:

- **Vercel**: invocations/min per route, p50/p95/p99 duration, timeout rate, error rate, memory peak, cold-start rate.
- **Supabase**: connections vs pool size, query latency p95, DB CPU/RAM/disk/IOPS/free space, slow-query log, realtime channels, auth.
- **Anthropic**: 429 rate (~0 steady-state target), mean latency per model, token spend per minute/day/user, header-derived limits remaining.
- **Application-level**: active sessions, queue depths per class, wait times, bucket levels, stale-heartbeat counts, mid-turn `interrupted` rate.

Schema:

```
metrics_samples
  id, sample_ts, metric_name, dimensions (JSONB), value (numeric)
```

Retention: 5-minute granularity for 7 days, 1-hour for 90 days, daily beyond.

### 14.3 Alerting thresholds

A configurable threshold table maps each metric to warn/critical levels. The cron emits alerts (dashboard banner, optional email/Slack) when crossed.

### 14.4 Synthetic probes

A cron runs a sentinel Director turn every N minutes against a fixed probe document. Detects end-to-end breakage that no individual metric catches. Cellular "test calls" analogue.

### 14.5 Admin dashboard

V1: same stack, admin-only routes. V2 / production-grade: separate server. Surfaces:

- Live registry (active sessions/workflows/jobs per class)
- Throughput metrics per class
- Error rate broken down by failure class (§10)
- Queue states (parked, scheduled, ready, pacing, running)
- Anthropic header headroom
- Cost spend rates per user, per org, per model
- Capacity-planning signal — sustained utilization > threshold

Not user-accessible.

---

## 15. UX surfaces

### 15.1 App-shell status indicator

Persistent, visible from every screen (Edit / Director / Focus / dashboard / scheduler). Shows:

- Director state: idle / thinking / awaiting approval
- Scheduler state: N running, M queued, K parked
- Cost meter: percentage (non-BYOK) or tokens/dollars (BYOK)
- Errors needing attention

Click-through routes to the relevant deep view.

### 15.2 Tree-level lock and state visibility

- **Auto-lock on schedule** — when a node enters an approved or scheduled workflow, system-lock applies. Author can't edit; UI explains why and shows scheduled time.
- **Richer node lifecycle** — tree row badges for `scheduled` / `queued` / `executing` / `completed` / `idle`. Lock auto-releases on completion.
- **AI-changed flag** — node row flag when AI has changed content. Cleared when the author views the node.

### 15.3 Director acknowledgement on completion

No silent finishes. Mechanical line in V1 ("12/12 steps succeeded"). Reflective acknowledgement in V2. Workflow planner card remains visible after completion.

### 15.4 Scheduler panel

New component. Shows Brief → Stage → Workflow → Step hierarchy with statuses. Supports Cancel at each level (with cascade confirmations). Top-up flow accessible from here.

### 15.5 Plan card extensions

- Cost estimate line ("Estimated cost: ~Z%" or "$X.XX / Y tokens").
- Approve button (single, prominent, iPhone-style).
- Small "modify" link for the rare case (replaces today's per-step checkboxes and Edit buttons as the primary surface).
- Pre-emptive over-budget warning if estimate exceeds plan headroom.

### 15.6 Stop button

Mid-turn and mid-workflow. Replaces the previous "Cancel" affordance at this surface. Confirmation surfaces the side-effect honesty messages (§11.2).

### 15.7 Brief viewer

New component. Read-only view of the current Brief — goal, stages with statuses, preferences, recent amendments. Available from the project header.

---

## 16. V1.x vs V2 scope split

### 16.1 V1.x phased roadmap

| Phase | Content |
|---|---|
| V1.x-A | Brief + Stage model; migrations, module, `get_brief_state`, `propose_brief_amendment`, BriefViewer + StageCard. Director executor unchanged. |
| V1.x-B | Scheduler + throttle redesign; queue tables, traffic classes, WFQ, per-user buckets, recovery sweep refinement. Replaces cap=1. **Per-iteration Director-turn decomposition (§8.1a)** rides with B: Director turns become scheduler-dispatched single-shot functions on the new queue, sharing the same dispatch surface as agent_jobs. |
| V1.x-C | Plan + cost meter; subscription columns, `pricing_rates` table, period-renewal cron, pre-call gate, top-up flow, cost meter UI |
| V1.x-D | UI surfaces; AppShellStatusIndicator, tree lock/state badges, scheduler panel, Stop refinement, mid-turn Resume/Discard UX, AI-changed flag |
| V1.x-E | Admin dashboard + monitoring; registry-backed live view, `metrics_samples` cron, alerting thresholds, synthetic probes |
| V1.x-F | Failure-mode UX; five-class user-facing behaviours, `report_capability_limit`, Class-C self-rejection prompt content |

Order is load-bearing first. Brief blocks much of the rest; scheduler depends on Brief for stage scheduling; cost meter depends on scheduler for accurate consumption; UI depends on all three.

**A/B boundary (2026-05-13 decision).** Brief + Stage is additive data-model work — new tables, new tools, new read surfaces; the Director's execution model is untouched. Per-iteration Director-turn decomposition (§8.1a) is a re-architecture of how Director turns are dispatched and recovered, and it requires a scheduler that can dispatch single-shot iteration jobs as Class 1 ahead of background traffic — i.e. the scheduler that V1.x-B builds. Shipping §8.1a in V1.x-A would either (a) land an interim "Class 1 bypass" hack on top of cap=1 that V1.x-B then rips out, or (b) demote Director iterations to cap=1 latency — a UX regression. Both are avoidable by keeping §8.1a in V1.x-B alongside the scheduler/throttle layer it depends on. V1.x-A ships pure substrate; V1.x-B ships one coherent dispatch-layer change.

### 16.2 Launch-blocker fix-pack (pre-V1.x)

Resumes the launch test before any V1.x phase begins:

- B1 — `get_nodes_by_layer` canonical-order fix
- B2 — Director prompt revision
- B3 — Batch-N start-position derivation
- Prompt caching breakpoints on system prompt + tool definitions
- `extended_thinking: true` on Opus

### 16.3 V2 backlog

- Multi-document Director (series-level)
- Per-model prompt variants vs single shared prompt
- QC job types (`review_node`, `consistency_check`, `evaluate_against_goal`)
- Supervisory agent for behavioural drift / cost anomaly detection
- Per-workflow rollback; per-Brief snapshot/restore
- Cross-conversation memory beyond per-document
- Director config version lifecycle (draft / beta / production / deprecated)
- Extended-thinking UX surfacing
- Reflective completion acknowledgement
- MCP integration for third-party tools

### 16.4 Open calibration questions (not architectural)

- WFQ weights (initial 50/25/20/5 — tune from dashboard data)
- Class 1 dedicated concurrent-connection slot count
- Per-user bucket refill rate
- `agent.director_conversation_window_turns` default
- Top-up granularity and pricing
- Period-start vs live recalc on credit-rate changes
- Synthetic probe cadence

---

## 17. Cross-cutting impact

### 17.1 TA v2.2 §8 — superseded sections

| TA §8 section | Status in V2 |
|---|---|
| §8.1 Configuration-driven architecture | Retained; this doc preserves the invariant |
| §8.2 Execution flow | Superseded by §4 (tool registry) + §8 (scheduler) here |
| §8.3 Tool registry | Superseded by §4 here |
| §8.4 Workflow execution (`Promise.all` over batch) | Superseded by §8 + §9 here |
| §8.5 Conversation context management | Superseded by §6 + §12 here |
| §8.6 Director config version lifecycle | Retained as-is; V2 lifecycle is V2 backlog (§16.3) |

TA v2.3 will mark these sections as superseded with a pointer to this document.

### 17.2 New hazard candidates

Hazards potentially emerging from this design (to be ratified in TA v2.3):

- **H-NN — Cascade rule completeness.** Server-derived cascade rules must cover all known dependency types; uncovered cascades produce silent context corruption. Mitigation: a registry of cascade rules with unit-test coverage per operation type.
- **H-NN — Reservation TTL hygiene.** Throttle reservations without consumption-or-expiry produce phantom holds on capacity. Mitigation: reservation TTL + cleanup sweep.
- **H-NN — Brief preference type drift.** `briefs.preferences` JSONB schema-less; over time the Director may generate inconsistent shapes. Mitigation: lightly-typed schema validator at amendment-write time, evolved by additive rules.
- **H-NN — Stage trigger cycles.** Compound triggers (`after_stage:X AND after_stage:Y`) can form cycles if stages reference each other. Mitigation: cycle detection at brief-proposal validation.
- **H-NN — Pricing rate effective_from race.** A rate row inserted with `effective_from = today` while calls are in flight creates ambiguity about which rate applies. Mitigation: stored cost_credits at call completion is the authoritative price; rate lookup is by call's completion date.

Specific H numbers assigned at TA v2.3 authoring time.

### 17.3 Migrations needed

Ordered by phase:

| Phase | Migration content |
|---|---|
| Launch-blocker | `director_configs.system_prompt` update; canonical-order VIEW or function |
| V1.x-A | `briefs`, `brief_stages`, `brief_amendments` tables with RLS; `documents.brief_id` FK |
| V1.x-B | Scheduler queue tables, throttle reservation table, per-user bucket table |
| V1.x-C | `organisations.subscription_*` columns or new `subscriptions` table; `pricing_rates` + `anthropic_pricing` tables; `agent_jobs.cost_credits` + `conversation_messages.cost_credits` columns |
| V1.x-D | (UI mostly; data shape unchanged or minor) |
| V1.x-E | `metrics_samples` table; `alert_thresholds` table; registry tables (or extended existing) |
| V1.x-F | (mostly prompt and UI; minimal schema) |

H-10 discipline: types regenerated after every migration.

### 17.4 New platform_config keys

- `agent.director_conversation_window_turns` (V1.x-A)
- `scheduler.tick_interval_ms` (V1.x-B)
- `scheduler.recovery_sweep_interval_ms` (V1.x-B)
- `throttle.class_weights` JSON (V1.x-B)
- `throttle.class1_reserved_slots` (V1.x-B)
- `throttle.bucket_refill_rate_per_minute` (V1.x-B)
- `throttle.reservation_ttl_seconds` (V1.x-B)
- `plan.margin_multiplier` (V1.x-C)
- `plan.topup_minimum_value_usd` (V1.x-C)
- `metrics.synthetic_probe_interval_minutes` (V1.x-E)

All follow H-12 discipline (no hardcoded operational values; read via `getConfig()`).

### 17.5 Spec propagation

- `stelavox_technical_architecture_v2_3.md` — bump from v2.2; mark §8 superseded with pointer; document new tables; ratify new H-NN hazards.
- `stelavox_product_specification_v1_9.md` — bump from v1.8; add Brief, Stage, plan/top-up, app-shell indicator, Stop-only, cost meter, AI-changed flag, Brief-as-memory.
- `stelavox_component_specification_v2_10.md` — bump from v2.9; add AppShellStatusIndicator, BriefViewer, StageCard, SchedulerPanel, AdminDashboard, CostMeter, plan-card extensions, tree-level lock-state badges.
- `stelavox_agent_profile_library_v1_0.md` — add QC job-type candidates (V2 backlog).
- `CLAUDE.md` — bump to v1.20; update Spec Library Reference; new Critical Component Specifications rows; changelog entry.

---

## Changelog

**v2.2 — 2026-05-16** **V1.x-B.2 implementation absorption.** All four V1.x-B.2 sub-phases (B.2.1 executor refactor + dispatcher + Stop; B.2.2 WFQ-VFT + per-user buckets + Class 1 reserved slots; B.2.3 batched_24h + agent runner BYOK + push-model triggers; B.2.4 Tier-A consolidation + integration test + merge) ship as a unit via the worktree branch `claude/v1x-b-2-traffic` with a `--no-ff` merge to master.

**§8.1a (per-iteration Director execution) — implementation complete.** Each Director iteration is now its own `agent_jobs` row of `operation_type='director_iteration'`, `traffic_class=1`. The runtime is `lib/director/iteration-runner.ts` (~580 lines). Iterations chain via `parent_iteration_id`; all share `director_turn_id` pointing at the new `director_turns` table (the unit of user-perceived Director interaction). The legacy 943-line `runAgenticTurn` async generator in `lib/director/executor.ts` is replaced with a 140-line `startDirectorTurn` entry point that creates the director_turns row + first iteration job. Pure helpers (`consumeTextForDelta`, `freshSuppressionState`, `parseWorkflowProposal`) extracted to `lib/director/agentic-helpers.ts`. **Iteration_state shape:** the build checklist's initial design separated `assistant_messages` from `pending_tool_results`; iteration 3+ rebuilt prompts violating Anthropic's tool_use→tool_result pairing requirement. Refactored mid-session to a single `messages: Array<{role, content}>` field that the runner appends per iteration. Documented as Hazard H-21 (per-iteration state-store drift) with `__schema_version` mitigation.

**§8 + §9 (universal scheduler + WFQ throttle) — implementation complete.** `lib/scheduler/dispatcher.ts:runDispatcherTick` is the single source of truth for "which ticket runs next." Per-tick flow: (1) read candidates with FOR UPDATE SKIP LOCKED; (2) filter via dependency + Stop predicates; (3) WFQ pick over survivors using Virtual Finish Time (`max(classLastVft, virtual_clock) + ticketCost / classWeight`); (4) reserve via `checkAndReserve` on the per-pool bucket; (5) for Class 1 also `claimClass1Slot`; (6) atomic CAS claim; (7) advance `wfq_state`; (8) handoff to runner. Refunds bucket + slot on CAS-loss to prevent leaks. Aging promotion: tickets queued > `aging_promotion_ms` get effective traffic_class promoted by 1 toward 1 (persistent class unchanged) — prevents class-4 starvation. Per-pool buckets: `pool_key='platform'` shares the platform key; `pool_key='byok:<user_id>'` per BYOK user (auto-created on first use). Class 1 reserved slots: 3 reserved (default), 5 max-concurrent including overflow.

**§8.4 (push-model stage triggers) — implementation complete.** When a Brief stage's workflow completes (last step accepted), `complete_brief_stage_workflow` calls `evaluate_ready_stage_triggers` inline (no 30s pg_cron wait); the evaluator marks the next ready stage 'proposing' + emits the system event + INSERTs a `director_iteration` agent_job with synthesised user_message "[SYSTEM EVENT: Stage N trigger fired — plan the workflow for this stage. Read the brief and project profile, then propose the workflow.]". H-23 storm prevention: skip insertion when an in-flight director_iteration already exists on the conversation (the next evaluation cycle picks it up). When the iteration-runner emits a workflow_proposal AND `briefs.auto_approve_workflow_proposals=true`, it POSTs to `/api/director/turns/[turnId]/auto-approve-workflow` to immediately mark the workflow approved + queue its agent_jobs (no user click required between stages).

**§4.4 (batched_24h execution intent) — implementation complete.** `agent_jobs.execution_intent='batched_24h'` (column from M-092; values from M-117) routes eligible op types (expand / synthesise / refine / generate_context — Director iterations are NEVER batched) through `lib/scheduler/batch-submitter.ts`. Buffer accumulates until `min_batch_size=5` reached OR oldest ticket exceeds `max_wait_minutes=30`, then submits one Anthropic Batch API request per pool_key (BYOK can't mix with platform). `lib/scheduler/batch-poller.ts` polls in_progress batches every 5 minutes (matches Anthropic's typical real-world completion of single-digit minutes; the 24h SLA is the upper bound, not the target); on batch end, fetches results JSONL stream + writes back to each agent_job via the same `persistFinalResult`/`persistFailure` helpers as the regular runner. BYOK pool batched submission deferred to V1.x-C alongside per-org BYOK rewire.

**§10 (failure taxonomy) — implementation complete.** `classify_failure(operation_type, error_code, http_status, retry_count)` SECURITY DEFINER SQL function (M-110) mirrors `lib/scheduler/failure-classifier.ts` exactly. Five classes: A (transient, auto-retry up to `failure_class_a_max_retries=3`); B (interrupted, resumable, user-visible); C (capacity, throttled, silent re-queue); D (validation, fail hard, user diagnostic); E (hard system, fail hard, operator action). `failure_taxonomy_samples` table (M-119) records every failure for admin dashboard observability with `auto_recovered` + `requires_user_action` + `error_summary`.

**§13 (Stop semantics) — implementation complete.** `stop_requests` table (M-108) is the durable record. POST `/api/director/turns/[turnId]/stop` cascades queued descendants (queue_status='cancelled', failure_class='B', error_message='cancelled_by_stop_request'); in-flight runner self-aborts cooperatively via `isDirectorTurnStopRequested` check before LLM call AND on response receipt (H-25 mitigation). Director turn marked status='cancelled'. UI: `components/director/StopButton.tsx` mounts in DirectorHeader when active turn (uses destructive token, NOT verdigris).

**§17 (BYOK routing) — agent runner extension.** `lib/agent/runner.ts` extracts user_id from triggered_by (when UUID); `getProvider` returns `{ provider, modelId, route: 'platform' | 'byok' }` so the runner stamps `agent_jobs.route` accordingly. Workflow-step jobs now route via ByokProvider when the user has a BYOK key (mirrors V1.x-B.1.2 Director-route changes). Same Edge Function path; key plaintext stays inside Edge Function memory (H-09 mitigation extends transparently).

**§17 metrics rollup — V1.x-E precursor.** `dispatcher_tick_samples` (M-115) + `route_capacity_samples` (M-116) + `failure_taxonomy_samples` (M-119) capture raw observability; `metrics_minute_buckets` (M-123) + `rollup_metrics_minute` SQL (M-124) aggregate per-minute (queue_depth, dispatch_rate, bucket_utilisation, failure_rate, auto_recovery_rate); 7-day retention for raw samples, 30-day for failure_taxonomy_samples, 90-day for metrics_minute_buckets via `purge_raw_metric_samples` daily cron (M-125). V1.x-E admin dashboard reads from `metrics_minute_buckets` for fast queries, drills down to raw samples for incident forensics.

**Hazards added:** H-21 (per-iteration state-store drift; mitigated via __schema_version), H-22 (VFT virtual clock overflow; mitigation deferred to V1.x-D periodic re-zero), H-23 (push-model trigger storm; mitigated via in-flight check in evaluator), H-24 (Batch API stale poll; mitigated via Anthropic idempotent results endpoint), H-25 (Stop request race; mitigated via post-receipt re-check). Full entries in TA v2.4 §5.

**Migration count:** 104 → 125 (+21 across the four B.2 sub-phases).

**§16.1 V1.x-B.2 row checkpoint MET.** Next sub-phase: V1.x-B.3 (concurrent multi-Brief + Brief amendments). Test Report `stelavox_v1x_b_2_test_report_v1_0.md` PASS verdict (26/26 CKs PASS at substrate level; CK-6/7 fairness ratios + CK-9 1000-concurrent stress + CK-13 aging under load defer to user-driven launch test per build checklist §10.4 explicit deferral).

**v2.0.2 — 2026-05-13** §16.1 scope reassignment: **per-iteration Director-turn decomposition (§8.1a) moves from V1.x-A into V1.x-B.** §16.1 originally listed V1.x-A as Brief + Stage substrate only; the V1.x-LB-shipped session-close memory broadened A to include §8.1a, and TA v2.3 §11's V1.x-A row inherited that broadening. On review at the V1.x-A kickoff, the broader scope was rejected: Brief + Stage is additive data-model work the Director can consume without changing its execution model, but §8.1a requires a scheduler that dispatches Class-1 iteration jobs ahead of background traffic — i.e. the scheduler V1.x-B builds. Shipping §8.1a in A would either land an interim Class-1 bypass hack that B rips out, or serialise Director iterations behind background jobs (UX regression). §16.1 V1.x-B row now explicitly carries §8.1a; new A/B-boundary note added below the table. TA v2.3 §11 will be re-aligned in lockstep. No content in §8.1a itself changes — only its phase assignment.

**v2.0.1 — 2026-05-12** Three follow-on amendments after session-record review:

- **§4.4** — `batched_24h` added as a fourth execution intent (Anthropic Batch API; 50% discount; up to 24h SLA; user-elected via plan-card toggle).
- **§8.1 reframed** — no special cases through the scheduler; "immediate" is a policy outcome, not a bypass path.
- **§8.1a added** — Director-turn execution model is per-iteration function decomposition with Realtime-channel client updates. Function lifetime bounded by one iteration; whole-turn timeout exposure eliminated; iteration boundaries become checkpoint + recovery points; architectural unification of Director turns and agent_jobs.
- **§8.2** — `submitted_to_batch` added as a queue state.
- **§10.2** — Class B reframed in light of per-iteration boundaries (most interruptions become silent automatic re-enqueue rather than user-facing Resume prompts).

**v2.0 — 2026-05-12** Initial Tier-A authoring. Supersedes TA v2.2 §8.2, §8.3, §8.4, §8.5 (retains §8.1, §8.6). Source decisions in `docs/sessions/director_v2_deep_dive_session_record_2026-05-11.md`. The four-tier Brief → Stage → Workflow → Step model, scheduler-as-universal-coordinator, traffic-engineering throttle with four classes + WFQ + per-user buckets, Brief-as-canonical-memory with conversation as rolling window, five-class failure taxonomy, hard-cap pre-pay plan with time-versioned pricing rates, are the load-bearing architectural shifts. Launch-blocker fix-pack (B1/B2/B3 + caching + extended thinking) carved out as the resume-launch-test minimum. V1.x phased roadmap A through F. V2 backlog explicit.
