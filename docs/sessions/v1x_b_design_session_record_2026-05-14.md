# V1.x-B Design Session Record

**Session:** 2026-05-14
**Status:** closed; design phase complete; build phase opening
**Outcome doc:** `docs/stelavox_v1x_b_1_1_build_checklist_v1_0.md` (Tier-B, follow-on session)
**Prior context:** `docs/sessions/director_v2_deep_dive_session_record_2026-05-11.md` (Director V2 deep-dive — Tier-A architecture); `project_v1x_a_shipped.md` + `project_v1x_a1_shipped.md` + `project_v1x_a1_test_round_closeout.md` (V1.x-A through V1.x-A.1 ship history)

This document records the decisions made during the V1.x-B design discussion. It is the audit trail — decision provenance, not a transcript. Anything described as "decided" here is locked unless explicitly reopened in a later session. Anything described as "deferred" is queued. Anything described as "flagged" is a known unresolved question that needs a specific decision before implementation.

The session focused on splitting the V1.x-B scope (locked at Director Architecture v2.0 §16.1 + TA v2.3 §11) into shippable sub-phases. The Director V2 deep-dive set the *what*; this session set the *when* — phase ordering, scope boundaries between sub-phases, and the architectural commitments the substrate must carry from day one to avoid rework later.

The document is organised by topic-as-discussed. The Tier-B build checklist that follows from this session organises the same content by build artefact (migrations, modules, components, tests).

---

## 1. Operating context

The session opened with the V1.x-A.1 test-round close-out fresh in mind. Two carry-overs from that test round entered V1.x-B scope: the Brief auto-complete wiring gap (workflow_complete → stage_complete → brief_complete propagation, never wired in V1.x-A.1 because the Brief substrate was substrate-only) and the missing `cancel_brief` tool in the Director registry (observed model-behaviour stall when the only sensible action would have been to cancel a stuck active Brief).

Three principles from the Director V2 deep-dive operating philosophy were reaffirmed and tested against every decision in this session:

1. **Time is not the constraint; visibility is.** Long-running work is acceptable; silent failure is not.
2. **The Director knows its own limits.** Constraints surfaced in the prompt + state.
3. **Limits are derived from global capacity, not local-tab safety.**

A new principle emerged during the session and is worth recording explicitly:

4. **Architecture right in the first stage; implementation can layer.** When the user said "I want the architecture right in the first stage" early in the discussion, this became the lens for every B.1/B.2 split — the *interface* / *contract* / *data shape* lands in B.1; the *policy* / *implementation* / *intelligence* layers in B.2 and beyond. Walked-back columns and refactored interfaces are the anti-pattern this principle exists to avoid.

---

## 2. Phasing — initial three-way split

Initial phasing proposal sliced V1.x-B into three sub-phases:

- **B.1** — Substrate (scheduler + execution model + Brief lifecycle close-out + minimum UI)
- **B.2** — Traffic engineering implementation (WFQ + per-user buckets + `batched_24h`)
- **B.3** — Concurrent multi-Brief + Brief amendments

This three-way split survived the entire session and was refined further into a four-way split (see §13). The B.2 / B.3 boundaries were stable from the start; the B.1 scope grew as the design discussion accumulated decisions, eventually warranting an internal split into B.1.1 + B.1.2.

---

## 3. Q1 — Where mid-Brief interactions live

**The question.** Once a Brief is kicked off (potentially multi-stage, potentially long-running), where do mid-Brief approvals and other interactions live? Does everything migrate to the SchedulerPanel after kickoff, or does the Director conversation remain the conversational locus?

**Decided: Director conversation continues to host every mid-Brief approval; SchedulerPanel is observability + lifecycle controls; AppShellStatusIndicator is the cross-context bridge.**

The Director conversation does NOT end when a Brief kicks off. A multi-stage Brief is a long-running plan whose later stages get planned just-in-time when their triggers fire. When stage 2's trigger fires three hours later and Director plans that stage's workflow, that's another turn in the same conversation: "Stage 1 complete. Stage 2 trigger fired. Here's the workflow plan — approve?" Pulling that approval out of the conversation and into the SchedulerPanel breaks the conversational thread that the Brief metaphor depends on.

**Mid-Brief interactions in the Director conversation:**

- Stage workflow approvals (just-in-time plans for stages 2..N)
- Brief amendments (operation plan changes — V1.x-B.3 territory but architecturally lives here)
- Profile amendments (durable preference promotions)
- Per-step approval gates (steps with `requires_approval=true`)
- Cost over-cap warnings / pre-emptive plan cost approvals (V1.x-C territory but architecturally lives here)

**SchedulerPanel responsibilities:**

- Read-only queue view across all Briefs / stages / workflows / steps
- **Stop** — resumable halt (matches user's original Stop/Cancel asymmetry intent)
- **Cancel** — terminal kill, scheduler-only, cascade confirmations
- Inspect — drill into any in-flight unit
- Direct edit of dispatch parameters (`scheduled_at`, `execution_intent`, future budget cap)

**Stop vs Cancel asymmetry preserved.** Stop is dual-surface (Director conversation + SchedulerPanel) because it's a conversational primitive ("pause, I want to think") as much as a queue primitive. Cancel is scheduler-only because it's terminal — the cascade should be explicit when nuking work.

**AppShellStatusIndicator (cross-context bridge).** Without it, mid-Brief approvals are invisible until the user navigates back to the right Director conversation. With multi-stage Briefs spanning hours/days, that's unworkable. The indicator is the "Director needs you" notification surface, deep-linking back to the right conversation.

**Director conversation extension to two-way model.** The conversation is no longer strictly user-prompts-Director-replies. After B.1.1 it accepts system-initiated turns (stage trigger fires, Brief activation, etc.). This is a structural change to the conversation model — flagged so it doesn't surprise at build time.

---

## 4. Q1 — Scheduler interface scope

**The question.** Does all interaction with the scheduler occur through the Director (LLM-mediated), or does the scheduler have its own purely programmatic, non-LLM interface?

**Decided: scheduler has a real direct-manipulation programmatic interface. Director plans; scheduler dispatches. They share access to the same underlying entities (Briefs, stages, workflows, steps) but operate at different layers.**

The natural split is by what each surface does well:

**Director (LLM-mediated) — cognition over plans:**
- Plan creation — `propose_brief`
- Plan revision — Brief amendments, profile amendments
- Just-in-time stage planning when triggers fire
- Conversational diagnosis ("why did stage 2 fail?", "what's the cheapest way to do X?")

**Scheduler (programmatic, no LLM) — dispatch over already-planned work:**
- Lifecycle controls — Stop, Cancel, Resume, Re-run failed step
- Dispatch parameter edits — `scheduled_at`, `execution_intent`, future budget cap
- Queue inspection
- Recurring schedule management (deferred to V1.x-D / V2 — see §11)

**Key architectural commitments:**

- **Single internal scheduler API** that both Director write tools and SchedulerPanel UI call. The same code path validates and executes "schedule this Brief for tonight 2am" whether the request originates from a Director `propose_brief` or a SchedulerPanel field edit.
- **The Director sets sensible defaults** for dispatch parameters when creating a Brief; the user accepts or edits at approve-time in BriefProposalCard, and can re-edit later in SchedulerPanel without re-engaging the Director.
- **Director reads scheduler state** when relevant via `get_scheduler_state` (already in V2 tool registry per Director Architecture v2.0 §4.1).

**Cost upside.** Routine dispatch operations (reschedule, toggle batched_24h, Stop, change cap) account for most day-to-day interaction with running work. Routing all of that through an LLM would burn tokens and add latency for mechanical edits. Direct scheduler UI is the right affordance.

**Mental-model upside.** Two clean affordances: "talk to Director when I want to think about *what to do*; touch scheduler when I want to control *when and how it runs*."

---

## 5. Q1 — SchedulerPanel scope in B.1.1

**Decided: SchedulerPanel ships as a real direct-manipulation UI from B.1.1 day one, NOT just a read-only queue view.**

Includes:
- Queue view (read-only listing of all Briefs / stages / workflows / steps with status)
- Stop / Cancel with cascade confirmations (per Component Spec v2.10 §A.4)
- Editable `scheduled_at` and `execution_intent` (immediate / scheduled toggle — `batched_24h` value adds in B.2)
- Inspect (drill into any in-flight unit)

Does NOT include:
- Aggregated approval card surface (cards live in Director conversation per §3)
- Budget cap field (deferred entirely to V1.x-C per §12)
- `batched_24h` toggle option (B.2)
- Recurring schedule management (V1.x-D / V2)

**AppShellStatusIndicator** (Component Spec v2.10 §A.1) ships in B.1.1 — global header notification. **Director tab indicator** (small badge on the Director tab in the existing ModeTabBar when there are pending Director approvals on the current document) also ships in B.1.1 as a Component Spec v2.11 amendment — it's essentially free and gives the user local pending-approval awareness when in Edit/Focus mode on the same document.

Visual treatment for AppShellStatusIndicator: small icon in header near user menu; quiet at zero pending; attention-warm badge with count when N>0; **no flashing** (accessibility, calm aesthetic); subtle one-time pulse on 0→N transition acceptable; click opens a small popover listing pending items grouped by document with deep-link rows.

---

## 6. Q2 — Per-iteration Director-turn decomposition substrate scope

**The question.** What does per-iteration decomposition (Director Architecture v2.0 §8.1a) actually require us to land architecturally in B.1, and what defers?

**Substrate decomposition framing (user-articulated).** "We came across limitations in serverless function timeouts, rate limits, context size limits etc. This led to the decomposition of the jobs into smaller components. We tried to work out the smallest atom of work that exists and make sure we have state managed around that. This then allows several things: easy recovery from a crash at any point. Easy stop and resume. More easily manage limits like timeouts and rate limits. More granular scheduling and prioritisation."

**The atom for Director iterations: one model API call → tool calls execute → results written → conversation state updated → iteration marked complete.** Bounded by ~30s typical, ~2 min worst case. Well under Vercel 300s.

**Decided substrate (B.1.1 — Q2a):**

- **Iteration row schema** (one row per Director iteration, parented to the agent_job representing the turn)
- **Atomic write boundary** — tool side effects + iteration completion marker land in one transaction so a crash mid-tool-execution can't leave half-applied state
- **Heartbeat-based interrupted detection** (extending the Phase 5b heartbeat protocol — stale heartbeat + status=running → interrupted)
- **Resume contract** — what state iteration N+1 needs from iteration N to start cleanly (conversation messages, accumulated tool results, accumulated proposals)
- **`failure_class` column** on the iteration row (5-class taxonomy as data shape, even if not all classes get policy in B.1.1)
- **Idempotency contract for tool calls** — Director read tools are inherently idempotent; Director write tools produce proposals not writes, so they're idempotent too. Executor enforces this as an invariant.

**Decided retry policy (B.1.1 — Q2b):**

| Class | Trigger | B.1.1 policy |
|---|---|---|
| A — Transient | Network blip, momentary 500 from Anthropic | Retry with short backoff |
| B — Interrupted | Function timeout, server restart, deploy interruption | Resume from last completed iteration |
| C — Capacity | Throttle says "wait" or "reject" | Empty in B.1.1 (no throttle backpressure exists yet); column + classification path exists; lights up in B.2 |
| D — Validation | Malformed XML, tool args fail schema, atom-size cap exceeded (§7) | Don't retry; surface to user |
| E — Hard system | DB unavailable, auth failure | Don't retry (or very limited); surface |

**The wrinkle and resolution.** The LLM API call is the long, non-transactional part of an iteration (~5-30s of nothing-on-our-side-can-do happening externally). Two crash sub-states ("API call in flight" vs "API returned, tool execution in flight") were considered. **Decided: simpler model — persist nothing mid-iteration; on crash, re-run the whole iteration from the API call.** Director iterations are cheap (a few cents typically); the simplicity of "iteration is atomic, no intermediate state" is worth more than the rare double-pay. Revisit if observability shows expensive iterations being re-paid often.

---

## 7. Q2 follow-up — Atomic unit confirmation

**The question.** Is "send API call" + "receive response" one atomic unit, or two separate units?

**Decided: ONE atomic unit for synchronous Director iterations.** The serverless function holds the HTTP connection open through the entire roundtrip; the iteration row is the unit of recovery. Streaming chunks are a UX optimisation, not separate atoms.

Rationale: the Anthropic Messages API is synchronous from our side — there's no separate "I submitted a request, now I poll for the answer" pattern that would naturally produce two atoms. Two atoms would force us to persist request IDs, intermediate token state, and partial responses — complexity that buys nothing because we have no way to "resume" a half-completed Anthropic request anyway.

**The one exception: `batched_24h` (B.2 work).** The Anthropic Batch API is genuinely async — submit a batch, come back later to collect results. Those ARE two atoms by necessity ("submit batch" and "collect batch results"), connected by a `batch_id`. Different execution path from synchronous Director iterations, lives entirely in B.2.

**Verification — iteration size is comfortably within all limits:**

| Limit | Value | Largest realistic iteration | Headroom |
|---|---|---|---|
| Vercel function timeout | 300s | 30s typical, 60-90s worst | ~3-5x |
| Anthropic context window | 200K tokens | ~71K input | ~2.5x |
| Anthropic max output | 8-16K tokens | ~5-8K + extended thinking budget | comfortable |

Largest realistic single Director iteration on a mature project (heavy mid-Brief turn deep in a multi-iteration sequence): ~3K system prompt + ~2K tool definitions + ~5K Project Profile + ~10K active Brief state + ~20K conversation history + ~30K accumulated tool results + <1K user message = ~71K input. Output ~15-30K (extended thinking + response + tool calls). Time ~33s. All well within ceilings.

---

## 8. Q2 extension — Atom-size guardrails

**User-stated principle.** "I want to ensure we have customisable constraints that limit the size of an atom before it can silently fail. I would rather explicitly reject a proposal and inform the user it's too big rather than to just fail. We can also log these occurrences to learn the limits of the system. This will naturally become more capable over time so it needs to be customisable."

**Decided posture for B.1.1:**

- **Configurable in `platform_config`** (per H-12 — no hardcoded operational values). Caps include per-tool result-size caps, max-iterations-per-turn cap, future Profile-size watch.
- **Pre-flight check** — guardrail evaluated before the operation starts (or before the next iteration begins). If exceeded, reject explicitly with a user-visible error citing the specific limit hit.
- **Telemetry** — every rejection logs to a `constraint_violations` table (or similar) with the limit type, the value attempted, the configured cap, and the context. Becomes the dataset that informs cap tuning as model capabilities evolve.
- **Failure-class mapping** — limit-exceeded rejections are Class D (validation) per §6's failure taxonomy. Same code path, same UX shape as schema-validation failures.

**Three risk areas the guardrails address:**

1. **A tool returning a massive payload.** Each tool needs a bounded result contract; per-tool result-size caps enforce this.
2. **Pathological multi-iteration turns.** Max-iterations-per-turn cap; when hit, Director either summarises or hands back to the user.
3. **Project Profile growing unbounded.** Soft watch in B.1.1; full Profile-summarisation candidate is V2.

---

## 9. Q3 — BYOK route placement

**Context.** BYOK is greenfield. No live BYOK implementation exists today; no users to protect or regress.

**Decided B.1.1/B.1.2 split:**

**B.1.1 (interface + non-BYOK substrate):**
- Throttle interface accepts `route` parameter from day one — `throttle.mayDispatch(job, {route: 'platform' | 'byok'})`
- B.1.1 throttle policy: `route=platform` → cap=1 (current holding pattern from Migration 046); `route=byok` → pass-through (no platform-side throttle ever)

**B.1.2 (BYOK substrate as self-contained module):**
- `user_anthropic_keys` table — encrypted column, RLS scoped to user
- **Encryption: Supabase Vault** (KMS-backed; simpler operationally than pgsodium; matches existing project precedent)
- BYOK Edge Function dispatcher (per H-09 — BYOK key plaintext never materialises outside Edge Function memory)
- `lib/llm/factory.ts` extended to route BYOK calls to Edge Function dispatcher
- Route parameter actually selects the Edge worker for byok jobs
- **Add-time validation against Anthropic** — round-trip to verify the key works before saving
- **Single key per user in V1** (multiple keys is a V2 candidate)
- Minimum-viable UI — settings panel with one input, delete button, status indicator (key present / absent / rejected)

**B.2 (no additional BYOK work):**
- Platform route policy swaps to WFQ + per-user buckets + Class 1 reserved slots
- BYOK route stays pass-through forever

**Deferred to V1.x-C:** BYOK cost reporting (tokens + dollars) vs non-BYOK (opaque credits/percentages); CostMeter UI variation per user type.

**Deferred to V1.x-D:** Better key-management affordances (key health checks, usage breakdown, key rotation flow); BYOK-specific scheduler-panel surface variations.

---

## 10. Q4 — Multi-Brief sequencing

**User proposal.** "I want to allow the concept of multiple briefs to exist as soon as possible. Not running in parallel though — this is more complex and for later. But there is still a precedent order requirement here. I'm thinking of a first implementation that allows multiple briefs to be staged in order and run sequentially."

**Decided: sequential multi-Brief lands in B.1.1; concurrent multi-Brief and Brief amendments defer to B.3.**

The user's proposal cleanly separates *concept* (multiple Briefs as data model + UX affordance) from *concurrency* (the genuinely hard problem of cross-Brief node contention and parallel execution). Sequential multi-Brief is a small extension to the substrate that B.1.1 already needs (Brief lifecycle wiring), and removes a meaningful UX limitation (today: can't queue work).

**B.1.1 schema changes:**

- **Drop the V1.x-A.1 partial unique index** `briefs(document_id) WHERE status IN ('planned','active')`
- **Replace with stricter index** `briefs(document_id) WHERE status = 'active'` — at most one *active* per document
- **Add `briefs.sequence_position`** — per-document integer for queue ordering
- **Add new status `queued`** — Brief is approved and waiting for predecessor to complete
- **Add `briefs.cause`** — track activation cause (initial creation, sequence promotion, future trigger types)

**State machine:**
- `planned` (proposed, not yet approved) → `queued` (approved, awaiting predecessor) → `active` (currently running, exactly one) → `completed` / `cancelled`
- "First queued Brief on an empty document" path skips `queued` and goes straight to `active`

**Lifecycle wiring:**
- Workflow → stage → brief auto-complete propagation (the V1.x-A.1 carry-over gap)
- When active Brief completes → find next `queued` by `sequence_position` → promote to `active` → fire stage 1 trigger (Director plans first workflow)

**Director awareness:**
- When user prompts a new Brief while one is active, Director's `propose_brief` defaults to queueing rather than blocking
- Director communicates: "This Brief will queue behind your current Brief and start when that completes."
- Extend `get_brief_state` to return `{active, queue: [...]}` rather than just the active one

**UI:**
- BriefViewer shows status badge + queue position ("Active" / "Queued · position 2")
- SchedulerPanel shows queue order with reorder affordances
- Cancel on `queued` Brief is trivial (just remove from queue); Cancel on `active` cascades as today
- `cancel_brief` Director tool (the V1.x-A.1 carry-over) becomes more useful with multi-Brief

**Deferred to B.3:**
- True concurrent execution (multiple `active` Briefs at once)
- Soft node-reservation warnings ("Brief A is editing chapter 3; Brief B also wants to edit chapter 3 — proceed anyway?")
- Cross-Brief contention resolution
- Full operation-level Brief amendments (Brief amendments split off entirely from multi-Brief; sequential multi-Brief obviates much of the V1 need by letting users queue follow-on work as new Briefs)

---

## 11. Q5 — Inline cards in Director conversation

**The question.** Should approval cards live inline with the conversation, or be a separate thread? Do we show the history of cards and their responses?

**Decided: inline rendering for B.1.1; conversation IS the history; subtle cause label on system-initiated turns.**

**Why inline wins as the V1 default:**

- One surface, one mental model — conversation = ledger
- Conversational context is the explanation (PlanCard makes sense because of the user message or stage trigger that prompted it)
- Matches V1.x-A.1's existing pattern (BriefProposalCard, ProjectProfileAmendmentCard already render inline)
- Cheaper to ship — one rendering surface, one state machine

**Inline rendering of each artefact:**

| Artefact | Rendering |
|---|---|
| User-initiated Brief proposal | BriefProposalCard at the Director response (existing) |
| Profile amendment | ProjectProfileAmendmentCard at the Director response (existing) |
| Stage workflow plan (system-initiated) | New Director turn with cause label + PlanCard inline |
| Brief queue activation | Lightweight system message ("Brief B activated · 2:14pm") — not a card, just a status line |
| Per-step approval gate within a workflow | Inline within the existing ExecutionCard (no new surface) |

**History model — conversation IS the history.** Cards persist with terminal-state badges (`Approved by you · 2 May` / `Rejected · reason` / `Cancelled · cascade from Brief cancel`). Scrolling back is the audit trail. Matches V1.x-A.1's existing BriefProposalCard behaviour.

**Visual differentiation for system-initiated turns.** Subtle but unmissable — small cause label at top of turn ("Triggered by Stage 1 completion" / "Brief activated" / "Scheduled trigger fired") in existing meta typography (Inter 11px muted). Body rendered as normal Director message. No special background, no big icon.

**Deferred to V1.x-D or later:**
- Separate "card thread" view for power-user triage
- Collapse/expand for resolved cards in long conversations
- Per-Brief conversation segments / tabs
- Notification grouping when multiple stage triggers fire close together

---

## 12. Q6 — Tiered system event surfacing

**The question.** When the user makes a change in SchedulerPanel (independent of Director conversation), how does the Director conversation become aware?

**Decided: tiered surfacing — lifecycle-significant events surface as inline system messages; routine parameter edits stay silent.**

**Always surface as inline system messages** (same lightweight format as "Brief B activated" from §11):
- Cancel (with cascade summary)
- Stop / Resume
- Brief activation (sequential multi-Brief queue promotion)
- Brief completion
- Failures requiring user attention (Class C/D/E events from §6 taxonomy)

**Don't surface (silent property edits):**
- Reschedule changes (`scheduled_at` updates)
- Budget cap edits (when V1.x-C lands)
- `batched_24h` toggle (when B.2 lands)
- Other dispatch parameter tweaks

**Director catches up via `get_scheduler_state`** on its next conversational turn for the silent stuff. The audit trail for surfaced stuff lives in the conversation directly.

**Implementation note.** Both system-initiated turns from stage triggers (§11) and lifecycle-significant scheduler edits share a mechanism: a row in `conversation_messages` with `role=system` and a typed event payload. Single mechanism, multiple causes. Renderer chooses display weight by event type — full Director turn for "stage trigger fired here's a plan" (with PlanCard); lightweight one-line system message for "Brief activated" or "Stage cancelled by user".

Director naturally sees these system events as part of its conversation context window — audit trail awareness without extra plumbing.

---

## 13. Q7 — Recurring/template Briefs

**Decided: backlog. No recurring/template hooks in B.1.**

The scheduler is naturally template-agnostic — it dispatches whatever Briefs exist; it doesn't care how they were created. Adding columns "just in case" violates the don't-design-for-hypothetical-requirements principle, and the cost of adding template support cleanly later is bounded.

**Two postures B.1 maintains for unrelated reasons** that happen to make future template work cleaner:

1. **Parameterized Brief creation API.** The Brief creation path needs to be callable from multiple causes already in B.1 (user approval, sequential multi-Brief activation, stage triggers). The V1.x-A.1 RPCs (`apply_brief_proposal` etc.) stay parameter-driven and don't assume "user just clicked Approve in Director conversation." Future recurring instantiation would call the same kind of function with parameters from a template.

2. **`briefs.cause` column.** Worth adding in B.1.1 anyway for sequential multi-Brief, stage triggers, audit trail. Future recurring would naturally extend the enum with `recurring_schedule`.

**Explicitly NOT added in B.1:** `brief_templates` table; `template_brief_id` reference; `is_template` flag; recurring schedule table; cron parser; template management UI; "Save as template" affordances.

---

## 14. Q8 — Budget cap field timing

**Decided: defer entirely to V1.x-C alongside the rest of the cost subsystem. Nothing budget-related lands in B.1.**

A column without enforcement is worse than no column — false promise UX. The "avoid a backfill migration later" argument is weak: `ALTER TABLE briefs ADD COLUMN budget_cap_credits BIGINT NULL` is cheap; no data migration needed.

**B.1.1 cost-control affordance: Cancel.** If a Brief is running expensive, the user cancels it. Crude but safe.

**V1.x-C lands together as one coherent change:**
- `briefs.budget_cap_credits` column
- `pricing_rates` table (time-versioned per Director Architecture v2.0 §21)
- `anthropic_pricing` parallel table for BYOK
- Budget enforcement logic in dispatch path
- CostMeter UI (per-user-type variant per Component Spec v2.10 §A.6)
- Director awareness — `propose_brief` includes recommended cap; user edits at approve-time
- SchedulerPanel gains budget cap edit affordance

---

## 15. B.1 scope sanity-check + B.1.1 / B.1.2 split

After all 8 questions resolved, B.1's scope tallied to 17 distinct workstreams. Sanity-check pass identified one clean internal seam — the BYOK module is genuinely self-contained (new table, new Edge worker, new dispatch path, small UI surface; plugs into the throttle interface via the `route` parameter; otherwise touches nothing else).

**Decided: split B.1 into B.1.1 + B.1.2.**

**Why this split (and no further):**
- BYOK is genuinely self-contained → clean separation
- BYOK has its own test surface (encryption + key resolution + Edge dispatch + Anthropic validation) → quality isolation
- Greenfield with no users → no regression risk from sequencing
- Encryption + Edge Function infrastructure is the most novel piece → isolating it means quality issues there don't block scheduler/Brief work from landing

**Why not split B.1.1 further:**
- Sequential multi-Brief depends on Brief lifecycle wiring
- SchedulerPanel needs the scheduler to exist with real queued items
- System-initiated turns need scheduler-fired triggers and a real Brief queue
- AppShellStatusIndicator needs system events being emitted
- Splitting B.1.1 would force interim states where the user-visible product is broken; each piece individually doesn't deliver value, the cluster does

**Final phasing:**

- **V1.x-B.1.1** — Scheduler + Brief lifecycle + UI substrate (~10–14 days estimated, comparable to V1.x-A.1's scope)
- **V1.x-B.1.2** — BYOK substrate (~3–5 days, contained module)
- **V1.x-B.2** — Traffic engineering implementation (WFQ + per-user buckets + Class 1 reserved slots + `batched_24h`)
- **V1.x-B.3** — Concurrent multi-Brief + Brief amendments + cross-Brief contention warnings

---

## 16. V1.x-B.1.1 scope summary

For Tier-B drafting reference, the consolidated B.1.1 scope across all 17 workstreams identified:

**Engine layer:**
1. Scheduler substrate — data model (queue extensions on `agent_jobs`: `traffic_class`, `execution_intent`, `scheduled_at`, `reservation_id`, `cause`, `route`), dispatch loop, recovery sweep extensions
2. Per-iteration Director-turn decomposition — execution model change; iteration row schema; atomic write boundary; resume contract
3. Throttle interface contract — route-aware (`platform` / `byok`); trivial cap=1 platform / pass-through byok policy
4. Atom-size guardrails — configurable `platform_config` caps; pre-flight rejection; `constraint_violations` telemetry; Class D failure mapping

**Brief / lifecycle layer:**
5. Brief lifecycle wiring — workflow → stage → brief auto-complete propagation
6. `cancel_brief` tool — Director registry V1.7
7. Sequential multi-Brief — schema (`sequence_position`, `queued` status, stricter active-uniqueness index), queue lifecycle, queue management UI, Director queue awareness via extended `get_brief_state`
8. Stage-trigger-invokes-Director hook — scheduler fires triggers; Director plans just-in-time
9. `briefs.cause` column — cause tracking for sequential activation, triggers, future extensions

**UI layer:**
10. SchedulerPanel — direct-manipulation (queue view, Stop, Cancel with cascade confirmations, reschedule, immediate/scheduled toggle)
11. AppShellStatusIndicator — global header notification; Director tab indicator on ModeTabBar
12. Director conversation extension — system-initiated turns
13. Tiered system-event surfacing — lifecycle events as inline `role=system` messages in `conversation_messages`

**Out of B.1.1 (deferred to B.1.2):**
14. `user_anthropic_keys` table + Supabase Vault encryption
15. BYOK Edge Function dispatcher
16. Route parameter actually routes byok jobs to Edge worker
17. BYOK key management UI + add-time validation

---

## 17. Cross-references — where each decision lives in the wider doc set

The follow-on documents that will absorb these decisions:

- **`docs/stelavox_v1x_b_1_1_build_checklist_v1_0.md`** (new Tier-B) — the sections above are the structural source. The checklist reorganises by build artefact.
- **`docs/stelavox_director_architecture_v2_2.md`** (bumped from v2.0) — codify: tiered system event surfacing (§12); sequential multi-Brief schema + queue lifecycle (§10); throttle interface contract shape with route parameter (§9); atom-size guardrails (§8); two-atom shape for `batched_24h` (§7); AppShellStatusIndicator + Director tab indicator behaviour (§5); per-iteration decomposition substrate scope split A/B/D/E in B.1.1 vs C in B.2 (§6).
- **`docs/stelavox_technical_architecture_v2_3_3.md`** (bumped from v2.3.2) — schema changes for `briefs` (new `queued` status + `sequence_position` + `cause` column; partial unique index replacement); `conversation_messages` (`role=system` event types); new tables for atom-size telemetry (`constraint_violations`); throttle reservation model.
- **`docs/stelavox_component_specification_v2_11.md`** (bumped from v2.10) — SchedulerPanel scope (queue + Stop/Cancel + reschedule + immediate/scheduled toggle); Director tab indicator addition on ModeTabBar; AppShellStatusIndicator interaction model (popover with grouped pending items + deep-link rows); system-initiated turn rendering with subtle cause label; lightweight system message styling.
- **`director_configs` Migration 09x** — system prompt updates: sequential multi-Brief queue awareness; queueing-by-default when active Brief exists; `cancel_brief` tool addition; extended `get_brief_state` shape ({active, queue}).
- **`CLAUDE.md`** v1.27 — Spec Library Reference updated; Critical Component Specifications rows added; changelog entry summarising the design conversation and Tier-B target.

---

## 18. Flagged-for-future decisions

Items deliberately left unresolved for later specific decisions:

- **Atom-size cap default values** — initial values for per-tool result-size cap, max-iterations-per-turn cap; calibrate from `constraint_violations` telemetry over time.
- **Director tab indicator visual treatment** — small dot, badge with count, or color shift on the tab itself; Tier-B authoring decides.
- **AppShellStatusIndicator popover grouping** — by document, by Brief, by recency; Tier-B authoring decides.
- **Stage trigger evaluation cadence** — how often the scheduler polls for stage triggers ready to fire; relates to recovery sweep cadence.
- **`cancel_brief` semantics on multi-Brief queue** — does cancel of an `active` Brief auto-promote the next `queued`, or require user action? Tier-B authoring decides.
- **Per-iteration retry max count** — Class A transient retry budget before escalating to Class B (interrupted) or surfacing.
- **Reservation TTL** — the throttle reservation lifetime before automatic release (H-17 mitigation calibration).

---

## 19. What is NOT changing

For clarity — these decisions remain locked from prior work:

- The propose-only contract (write tools do not execute during the agentic loop).
- The five Inviolables (verdigris uses, Cinzel in wordmark only, typeface boundary, no prose-editor toolbar, prose surface as lowest-noise).
- The H-01..H-20 hazards.
- The single-agent Director model.
- The `director_configs` row as the source of truth for system prompt, tool suite, model parameters.
- The agent_profiles model for individual agent_job system prompts.
- RLS-everywhere discipline.
- H-12 (no hardcoded operational values; everything via `getConfig()`).
- The Project Profile + Brief separation locked in V1.x-A.1.
- The four-tier execution model: Brief → Stage → Workflow → Step.
- The scheduler-as-single-dispatch-surface principle (Director Architecture v2.0 §7).

---

## Changelog

**v1.0 — 2026-05-14** Initial record. Captures decisions from the V1.x-B design conversation held 2026-05-14. Closed the design phase of V1.x-B; opens the Tier-B build checklist drafting phase. All decisions herein are locked unless explicitly reopened in a later session. Eight design questions resolved; V1.x-B split into four sub-phases (B.1.1, B.1.2, B.2, B.3); B.1.1 scope consolidated as 13 workstreams across engine / Brief-lifecycle / UI layers.
