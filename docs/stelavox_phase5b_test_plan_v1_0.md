# Stelavox — Phase 5b Test Plan
## Version 1.1

> **Tier-B per-phase document.** The authoritative test-case list for Phase 5b (Director). Companion to `stelavox_phase5b_api_contract_v1_0.md` and `stelavox_phase5b_build_checklist_v1_0.md`. Every authored test case in `tests/` must correspond to a TC-X-N entry here; every TC-X-N entry must have a matching `test('TC-X-N — ...')` in a spec file by phase end. The Test Report's verdict count must match the grep audit, not this plan's planned count (Phase 3 v1.5 audit lesson).

**Phase:** 5b — Director: conversation thread, agentic loop, plan approval, workflow execution.

**Total planned cases:** 100 (v1.1 — was 94). 35 TC-A + 6 TC-B + 8 TC-D + 8 TC-S + 30 TC-U + 6 TC-V + 4 TC-M + 4 TC-AX. v1.1 adds 5 TC-A cases (heartbeat liveness, recovery sweep, resume after interrupt) and 2 TC-U cases (heartbeat indicator pulse + amber-on-timeout) per SU-40 / SU-41 / SU-42.

**β-scope (must-pass for Phase 5b merge):** 45 cases (was 40). Remaining 55 cases deferred to Phase 8 expansion as SU-37.

---

## 1. Test Environment

### 1.1 Where tests run

Local development against the +10-shifted Supabase stack (per `project_worktree_ports.md` — API at `127.0.0.1:54331`). The Vercel dev server runs on port 3000 from the worktree. Phase B cloud smoke runs against `stelavox-dev` (project `zhcdbofshifzblkgqrsc`, Singapore).

The four cloud-smoke cases per Build Checklist T-18.3 are TC-A-01, TC-A-15, TC-A-22, TC-A-30. **All Phase 5b LLM API calls run on Haiku 4.5** — local build-test, T-17 prompt review, and cloud smoke. Per the standing user direction (`feedback_haiku_default.md`, reaffirmed 2026-05-06), Sonnet and Opus are not used for any Phase 5b test path. Production-default in `director_configs` remains Opus (Migration 013); the Haiku selection is a per-environment override applied during testing only.

### 1.2 Test users

Inherits from Phase 1's seeded test users plus the Phase 5 cross-org user:
- `alice@example.com` — owns the test project with completed Acts/Chapters/Scenes/Beats from Phase 5 fixtures.
- `bob@example.com` — same org as Alice, used for non-author-of-conversation rejection tests (`not_conversation_author`).
- `carol@example.com` — different org owner for cross-org tests (TC-B).

### 1.3 Test data

Phase 5b builds on the Phase 5 fixtures (a sample novel project with a partial tree, six core context nodes, structural↔context links, system agent profiles seeded). Phase 5b adds:
- The Director v1.0 production config row (Migration 031) — must contain the real system prompt body, not the placeholder.
- A "synthetic-conversation-fixture" pre-baked conversation row + 50 messages totaling ~75_000 tokens — used by TC-D-30 (summarisation threshold).
- A pre-baked `workflows` row in `draft` status with 4 steps — used by approve / per-step PATCH tests without having to first run a full Director conversation.
- A pre-baked `workflows` row in `running` status with 2 of 4 steps `completed` and 1 `running` — used by pause / resume / stop tests.

Test fixtures live in `tests/fixtures/phase5b/` and are seeded by a per-test-suite `beforeAll` hook that runs `supabase db reset` + the Phase 5 + Phase 5b fixture seed SQL.

### 1.4 Tooling

- Playwright for end-to-end (TC-A, TC-U, TC-V, TC-M, TC-AX).
- Vitest for unit tests (Zod schema validation, `parseWorkflowProposal`, `validateToolCall`, `summariseConversation` mock harness).
- Real Anthropic API calls for TC-A's LLM-bearing happy paths; no mocking (§1.5).
- Phase 5's `tests/reporters/cost-reporter.ts` carries forward — Phase 5b's `conversation_messages.cost_usd` and per-step `agent_jobs.cost_usd` aggregate to a per-test cost line.
- An EventSource-shimming Playwright helper for SSE-stream assertions: `tests/helpers/sse-collector.ts` — records every event-type/payload pair for a given EventSource and exposes them for ordered assertion.

### 1.5 Mocking

LLM calls are NOT mocked for happy-path cases. Cost is bounded — Phase 5b's full local test run on Haiku is ~$1–2 per run; cloud smoke on Haiku ~$0.05–0.15.

Mocking IS used for:
- TC-D-2 (Zod schema validation rejection on malformed `<workflow_proposal>` JSON) — pre-canned bad model output.
- TC-A-13 (canary leak detection mid-stream) — patched response stream that injects the canary token.
- TC-A-26 (workflow-step rollback simulation) — mock dispatcher that throws after step 2.

### 1.6 Independence

Each test creates and deletes its own data within an `afterEach` cleanup hook. The fixtures from §1.3 are read-only — tests COPY them per-run and operate on the copy. The Director config row is shared; tests must not mutate it during execution (Migration 031's row is the runtime config and changing it mid-test would corrupt parallel test runs).

### 1.7 Cost capture during tests

Per API Contract §2.13 — every TC-A test that triggers an LLM call captures `cost_usd` from the resulting `conversation_messages` row (and per-step `agent_jobs.cost_usd` for workflow execution tests). The Playwright cost-reporter logs each test's cost inline:

```
✓ TC-A-15 — Workflow approve + execute happy path (24.1s)
  cost: $0.0420  | tokens: 18400 in / 4200 out  | model: claude-haiku-4-5  | cache hit: 64%
  per-step jobs: 2 × refine = $0.011
```

**Model in use during tests (Haiku-everywhere per the user's standing direction):**
- Build-test phase (T-1..T-17 including prompt review): Haiku 4.5 — override via `UPDATE director_configs SET model_id='claude-haiku-4-5-20251001'`.
- T-18 cloud smoke: Haiku 4.5 — same override applied on cloud-dev `director_configs`.

**Cost discipline:** Total Director-bearing LLM cost across one full local Haiku test run (all 30 TC-A cases including the multi-step workflow happy path) is bounded by ~$1.50. Cloud smoke ~$0.10. Phase 5b's total LLM spend (build + cloud smoke + 5–10 prompt-review iterations) is bounded by ~$3.

### 1.8 Notation

```
**Setup:** the precondition state.
**Steps:** the actions the test performs (numbered).
**Expected:** the verifiable assertion(s).
```

When a step or expectation references the API Contract / TA / Component Spec, the reference is inline.

---

## 2. Section 1 — UI Checkpoint Tests (TC-U)

### TC-U-01 — DirectorPanel mounts when ModeTabBar switches to Director
**Setup:** Open a project with at least one node tree. Edit Mode is active.
**Steps:** Click the "Director" tab in the ModeTabBar.
**Expected:** The right column's NodeDetailPanel unmounts; DirectorPanel mounts in its place. The tree (left column) remains. The DirectorHeader shows the document name in the document tag.

### TC-U-02 — DirectorPanel preserves conversation across mode switches
**Setup:** Director Mode is active with at least one user message + one assistant message in the thread.
**Steps:** Switch to Edit Mode, then back to Director Mode.
**Expected:** The conversation thread renders the same messages in the same order. Scroll position is restored to bottom.

### TC-U-03 — ConversationThread auto-scrolls on new message arrival
**Setup:** Director Mode is active; the thread has 5+ messages so the scroll position is meaningful.
**Steps:** Send a user message; observe the assistant SSE stream.
**Expected:** As `text_delta` events arrive, ConversationThread auto-scrolls to keep the streaming message visible. Scroll position is "bottom" at end of stream.

### TC-U-04 — "Jump to latest" button appears when user scrolls up during a stream
**Setup:** Director Mode active; user is sending a message that produces a long response.
**Steps:** Mid-stream, manually scroll the thread upward.
**Expected:** A "Jump to latest" pill appears at the bottom edge of the thread. Click → thread scrolls to bottom and pill hides.

### TC-U-05 — UserMessage renders right-aligned with correct background
**Setup:** A user message is in the thread.
**Expected:** The message is right-aligned, max-width 78%, background `--color-bg-selected` (#1f2d45), Inter 400 12px (Component Spec §7.3).

### TC-U-06 — DirectorMessage streams text word-by-word
**Setup:** Director Mode active; user sends a message that triggers a multi-paragraph response.
**Steps:** Observe the assistant message during streaming.
**Expected:** Text appears as individual word-delta paint operations. No animation on the text itself (no fade, no slide). The DirectorMessage `◆ Director` header is visible as soon as `start` event arrives.

### TC-U-07 — ThinkingIndicator shows between message-send and first text_delta
**Setup:** Director Mode active.
**Steps:** Send a user message.
**Expected:** ThinkingIndicator appears immediately on send; remains visible while the Director runs read tools (between `tool_use_start` and the next `text_delta`); disappears once the first `text_delta` arrives. The three dots animate per Component Spec §7.5 (1.2s ease-in-out infinite, staggered 0.2s).

### TC-U-08 — DirectorInput auto-expands 1 to 5 rows
**Setup:** DirectorPanel is mounted.
**Steps:** Type a multi-line message (use Shift+Enter to add newlines).
**Expected:** The textarea expands from 1 row up to 5; beyond 5 rows it scrolls internally. Send button stays anchored at the right of the input pill.

### TC-U-09 — DirectorInput Enter sends, Shift+Enter inserts newline
**Setup:** DirectorPanel is mounted with cursor in the textarea.
**Steps:** Type "first line", press Shift+Enter, type "second line", press Enter.
**Expected:** The composed message "first line\nsecond line" is sent (verified via the SSE `start` event); the textarea clears.

### TC-U-10 — DirectorInput disabled state during execution
**Setup:** Director is mid-stream.
**Expected:** The textarea + send button are at opacity 0.5 with `pointer-events: none`. Placeholder text reads "Director is working..." (Component Spec §7.9).

### TC-U-11 — @ keypress opens NodePicker
**Setup:** DirectorPanel mounted; cursor in textarea.
**Steps:** Type `@`.
**Expected:** NodePicker opens below the cursor, showing a searchable list of the current document's nodes. Typing filters; arrow keys navigate; Enter inserts the selected node as a pill.

### TC-U-12 — NodePicker dismisses on Escape
**Setup:** NodePicker is open.
**Steps:** Press Escape.
**Expected:** Picker closes; the literal `@` remains in the textarea. Cursor remains at the same position.

### TC-U-13 — Node pill renders inline
**Setup:** NodePicker is open; user selects "Chapter 1".
**Expected:** The textarea content shows a pill with `--color-bg-elevated` background, the node-type icon, and the node name "Chapter 1". The `mentioned_node_ids` array (verified by sending the message) contains the selected node's UUID.

### TC-U-14 — PlanCard renders inline below the assistant message
**Setup:** A workflow_proposal SSE event has fired during a streaming response.
**Expected:** Below the streaming assistant message, a PlanCard renders. All steps are visible (no expand-on-click). Header shows step count + estimated time. Footer shows Approve / Edit Steps / Cancel.

### TC-U-15 — PlanCard step checkbox toggles step status
**Setup:** PlanCard is rendered with 4 steps, all checked.
**Steps:** Click the checkbox on step 2.
**Expected:** Step 2's row goes to opacity 0.55 with text muted. Approve button label updates from "Approve All" to "Approve 3 of 4".

### TC-U-16 — PlanCard remove × removes a step from the plan
**Setup:** PlanCard rendered with 4 steps.
**Steps:** Click the × on step 3.
**Expected:** Step 3 is removed from the visible list (status set to `removed` via PATCH). Approve button label updates to "Approve [N] of 3" (where N depends on how many of the remaining 3 are checked).

### TC-U-17 — PlanCard locked-node warning row renders
**Setup:** A PlanCard whose plan touches a locked node (Chapter 1 with `nodes.locked = true`).
**Expected:** The warning row renders with `--color-status-review` text + ⚠ icon + the locked node names. The Approve button remains enabled (the warning is informational; the plan as proposed by the Director already excludes the locked node).

### TC-U-18 — PlanCard Approve transitions to ExecutionCard
**Setup:** PlanCard rendered, all steps approved.
**Steps:** Click Approve.
**Expected:** PlanCard unmounts; ExecutionCard mounts in its place. ExecutionCard's first step shows `running` state (icon ⟳, animated row).

### TC-U-19 — ExecutionCard step states update in real-time
**Setup:** ExecutionCard is showing a 2-step workflow; step 1 is running.
**Steps:** Wait for step 1 to complete; observe step 2.
**Expected:** Step 1 transitions running → complete (icon ✓, text muted). Step 2 transitions pending → running (icon ⟳, animated). Tree NodeRow for step 1's target updates with the new content.

### TC-U-20 — ExecutionCard footer shows "Step N of M"
**Setup:** A 4-step workflow is mid-execution; step 2 is running.
**Expected:** Footer text reads "Step 2 of 4" (live-updated as steps progress).

### TC-U-21 — ExecutionCard Pause button pauses the workflow
**Setup:** ExecutionCard is running.
**Steps:** Click Pause.
**Expected:** `POST /api/director/workflows/[id]/pause` is called. The currently-running step continues; subsequent steps wait. Footer shows a "Paused — click Resume" indicator.

### TC-U-22 — ExecutionCard Resume after Pause restarts dispatch
**Setup:** Workflow is paused mid-execution.
**Steps:** Click Resume.
**Expected:** Status returns to `running`; the next pending step is dispatched.

### TC-U-23 — ExecutionCard Stop ends the workflow
**Setup:** ExecutionCard is running.
**Steps:** Click Stop.
**Expected:** Workflow status → `cancelled`. Pending steps marked `skipped`. The Director's final summary message references the early termination.

### TC-U-24 — ExecutionCard replaced by Director summary message at end
**Setup:** A workflow has just completed all steps.
**Expected:** ExecutionCard unmounts. A new DirectorMessage appears below the previous one, summarising what was done. Tree NodeStatusBadges return to their normal (non-WorkflowStepIndicator) display.

### TC-U-25 — Workflow history button opens history panel
**Setup:** DirectorHeader is visible.
**Steps:** Click the History button.
**Expected:** A history panel slides in showing all workflows for this document, newest first. Each entry shows title, status, step count, completed_at.

### TC-U-26 — Conversation history pagination
**Setup:** A conversation with 50+ messages.
**Steps:** Open Director Mode; scroll up to the top of the visible thread.
**Expected:** Earlier messages load (cursor pagination). Scroll position is preserved across the load.

### TC-U-27 — Director Mode preserves selected tree node
**Setup:** Edit Mode with Chapter 3 selected in the tree.
**Steps:** Switch to Director Mode, then back to Edit Mode.
**Expected:** Chapter 3 is still selected; NodeDetailPanel reopens to its previous state.

### TC-U-29 — ExecutionCard heartbeat indicator pulses (v1.1 SU-42)
**Setup:** ExecutionCard rendered with one running step. The underlying agent_job's `last_heartbeat_at` is updating every 5s.
**Expected:** A small pulsing dot adjacent to the running step row. Colour: green when `last_heartbeat_at < 15s ago`. Pulse animation: opacity 1 → 0.3 → 1 over 2s. Tooltip on hover: "Last heartbeat 3s ago" (live-updated).

### TC-U-30 — ExecutionCard heartbeat goes amber on timeout (v1.1 SU-42)
**Setup:** Mid-execution, manually update `agent_jobs.last_heartbeat_at` to 30s ago (simulate stalled runner).
**Expected:** Heartbeat indicator transitions green → amber within 1s of the real-time fire. Tooltip: "Last heartbeat 30s ago — recovery sweep imminent". After another 60s without heartbeat update (now 90s old): indicator goes red; on the next recovery sweep, the step shows the failed icon ✗.

### TC-U-28 — DirectorMessage inline node link navigates the tree
**Setup:** A Director message contains a "[Chapter 4 Scene 1](node:uuid)" inline link.
**Steps:** Click the link.
**Expected:** Tree navigates to that node (the same behaviour as clicking a node in the tree). Director Mode remains; the conversation is preserved.

---

## 3. Section 2 — Visual / Styling Tests (TC-V)

### TC-V-01 — DirectorPanel width and minimum tree width
**Expected:** DirectorPanel width is 580px (max 55% of viewport). Tree min-width 300px is enforced (resize would not compress below).

### TC-V-02 — DirectorMessage typography
**Expected:** Inter 400 12px `--color-text-secondary`, line-height 1.6. Bold-within-text uses Inter 500 `--color-text-primary` (Component Spec §7.4).

### TC-V-03 — UserMessage background colour
**Expected:** User message backgrounds resolve to `--color-bg-selected` (#1f2d45). NEVER `--color-accent-muted` (Inviolable: see Component Spec §7.3 lock icon).

### TC-V-04 — Approve button verdigris matches Inviolable #2 use #6
**Expected:** PlanCard's Approve button background resolves to `--color-accent`. This is verdigris use #6 in CLAUDE.md's Inviolable #2 enumeration (Wordmark lozenge / Wordmark rule / Prose cursor / Agent-complete badge / Approved badge / Word count at target / Accept button / Trial expiry CTA / Active node left border — Phase 5b's PlanCard Approve button is *not* a new use; Component Spec §7.6 specifies it explicitly).

Note: The CLAUDE.md v1.10 enumeration lists 9 uses; PlanCard Approve does NOT appear by name, but Component Spec §7.6 marks it "Approve button: 🔒 `--color-accent` bg". This is a specification gap — Phase 5b's first SU at close-out: align CLAUDE.md's Inviolable #2 enumeration with Component Spec §7.6 (either add PlanCard Approve as use #10, or fold it into use #7 Accept button). Logged as **SU-38**.

### TC-V-05 — ThinkingIndicator typography and dot styling
**Expected:** Inter 300 12px italic `--color-text-muted`; three 5px circles in `--color-text-muted`.

### TC-V-06 — DirectorHeader ◆ verdigris icon
**Expected:** The ◆ in `◆ The Director` resolves to `--color-accent`. This is the Director's typographic signature — explicitly allowed by Component Spec §7.1's note ("part of the Director's typographic signature — not subject to the nine-use rule").

---

## 4. Section 3 — Motion / Transition Tests (TC-M)

### TC-M-01 — ThinkingIndicator dot animation timing
**Expected:** Each dot's opacity animates `0.3 → 1 → 0.3` over 1.2s ease-in-out, staggered 0.2s per dot. Timing verified via DOM `animation` computed style.

### TC-M-02 — Reduce-motion collapses ThinkingIndicator animation
**Setup:** OS-level reduce-motion is on.
**Expected:** The three dots are static; no opacity animation.

### TC-M-03 — ExecutionCard running-step row pulse
**Expected:** Running step row opacity animates `1 → 0.5 → 1` over 2s; reduce-motion collapses to static.

### TC-M-04 — DirectorPanel mount/unmount on mode switch
**Expected:** Switching Edit ↔ Director triggers no janky reflow. The tree column does not resize. DirectorPanel mounts/unmounts within 100ms of the mode change.

---

## 5. Section 4 — API Integration Tests (TC-A)

### TC-A-01 — POST /api/director/message creates conversation + streams response
**Setup:** Authenticated as Alice; document with no existing conversation.
**Steps:** POST `/api/director/message` with `{ document_id, content: "Tell me about my project" }` and `Accept: text/event-stream`.
**Expected:** Response is `200 text/event-stream`. Events arrive: `start` (with `conversation_id`), one or more `text_delta`, possibly `tool_use_*`, `assistant_message_complete`, `done`. After: `conversations` row exists; 2 `conversation_messages` rows (1 user + 1 assistant). `cost_usd` populated on the assistant message.

### TC-A-02 — POST /api/director/message resumes existing conversation
**Setup:** A conversation already exists for the document.
**Steps:** POST with `conversation_id` of the existing conversation.
**Expected:** No new `conversations` row; messages append (sequence increments).

### TC-A-03 — POST /api/director/message rejects empty content
**Setup:** Authenticated.
**Steps:** POST with `content: ""`.
**Expected:** 400 `validation_failed`. No SSE response begins. No DB writes.

### TC-A-04 — GET /api/documents/[id]/conversation creates if absent
**Setup:** Document has no conversation.
**Steps:** GET endpoint twice in sequence.
**Expected:** First call returns conversation with `message_count: 0`. Second call returns the same conversation row (same `id`). No duplicate rows in DB.

### TC-A-05 — GET /api/director/conversation/[id] paginates messages
**Setup:** Conversation with 30 messages.
**Steps:** GET with `limit=10`; then again with `cursor` from response.
**Expected:** First response: 10 most-recent messages, `next_cursor` set. Second response: next 10 messages.

### TC-A-06 — POST /api/director/conversation/[id]/messages rejects non-admin
**Setup:** Authenticated as Alice (non-admin).
**Steps:** POST to the append-message endpoint.
**Expected:** 403 `not_admin`. Reserved for V2 admin tooling.

### TC-A-07 — Director-message rate limit
**Setup:** Authenticated.
**Steps:** Send 7 messages within 60 seconds.
**Expected:** First 6 succeed; 7th returns 429 `director_message_rate_limit` with `retry_after_seconds`.

### TC-A-08 — Token budget gate runs before message append
**Setup:** Org with budget = 100 tokens (artificially low).
**Steps:** Send any user message.
**Expected:** 402 `director_token_budget_exceeded`. No `conversation_messages` row created.

### TC-A-09 — Read-tool calls produce no agent_jobs
**Setup:** Authenticated; no agent jobs in DB for this document.
**Steps:** Send "Tell me what's in my project" — Director will call `get_document_state` and possibly `get_node_tree`.
**Expected:** After stream completes, `SELECT count(*) FROM agent_jobs WHERE document_id = $1` is unchanged from pre-test. The conversation message's `tool_calls` JSONB records the read-tool calls.

### TC-A-10 — Write-tool call produces a draft workflow, not DB writes
**Setup:** Authenticated.
**Steps:** Send "Refine Chapter 3 Scene 2's summary to be tenser" — Director should call `create_refine_step`.
**Expected:** End-of-turn produces a `workflow_proposal` SSE event. After: 1 new `workflows` row (`status='draft'`); N new `workflow_steps` rows. NO new `agent_jobs` rows. NO new `node_versions` rows. The target node is unchanged.

### TC-A-11 — Multi-step workflow proposal
**Setup:** Authenticated; a project with at least 2 chapters.
**Steps:** Send a request requiring multi-step planning ("reorder chapters and rewrite the first scene of each").
**Expected:** Workflow has ≥3 steps. `depends_on_step_orders` populated where appropriate. `impact_summary` non-empty.

### TC-A-12 — Workflow step max 30 (G-5)
**Setup:** Authenticated; a deliberately-evil request inducing the Director to plan many steps.
**Steps:** Send "Refine the summary of every node in my project."
**Expected:** Workflow has at most 30 steps. The assistant message text mentions the cap (e.g. "I had more steps in mind but capped at 30...").

### TC-A-13 — Canary leak aborts stream
**Setup:** Mock harness that injects the canary token into the model's text output mid-stream.
**Steps:** Send any message.
**Expected:** SSE `error` event with `director_canary_leak`. No assistant message persisted. Audit log entry of severity `critical`.

### TC-A-14 — Conversation summarisation triggers at 60k tokens
**Setup:** Conversation with 50 pre-baked messages totaling ~75_000 input tokens.
**Steps:** Send one new user message.
**Expected:** Before the SSE response begins, an inline summarisation pass runs (visible via `conversations.conversation_summary` becoming non-NULL, `summary_covers_through` advancing). The subsequent agentic loop uses the summary.

### TC-A-15 — Workflow approve + execute happy path
**Setup:** A draft workflow with 2 refine steps.
**Steps:** POST `/api/director/workflows/[id]/approve` with `approved_step_orders: [1,2]`.
**Expected:** Workflow status `draft → approved → running → completed`. Each step dispatches an agent_job (`triggered_by` includes `workflow_step:`). Each step auto-Accepts on completion. The 2 target nodes have new versions. The Director posts a final summary message.

### TC-A-16 — Workflow approve with deselected step
**Setup:** Draft workflow with 4 steps.
**Steps:** POST approve with `approved_step_orders: [1, 3]`.
**Expected:** Steps 2 and 4 marked `removed`. Steps 1 and 3 execute. Step 3 starts only after step 1 completes (or in parallel if `depends_on` allows).

### TC-A-17 — Workflow approve rejects cross-org caller
**Setup:** Draft workflow created by Alice; Carol authenticated.
**Steps:** Carol POSTs approve.
**Expected:** 404 `workflow_not_found` (RLS-hidden).

### TC-A-18 — Workflow approve rejects when locked-node in scope
**Setup:** Draft workflow with one step targeting a locked node.
**Steps:** POST approve.
**Expected:** 423 `workflow_locked_nodes` with `locked_node_ids: [node_id]` in body. Workflow status remains `draft`.

### TC-A-19 — Workflow cancel from draft
**Setup:** Draft workflow.
**Steps:** POST `/cancel`.
**Expected:** Status → `cancelled`. No execution side effects.

### TC-A-20 — Workflow cancel rejects when running
**Setup:** Workflow in `running` status.
**Steps:** POST `/cancel`.
**Expected:** 409 `workflow_invalid_status`. Use `/stop` instead.

### TC-A-21 — Workflow pause and resume
**Setup:** Workflow `running`, step 2 of 4.
**Steps:** POST `/pause`. Wait for step 2 to complete. POST `/resume`.
**Expected:** After pause: status `paused`. Step 2 finishes. Step 3 does NOT start. After resume: status `running`. Step 3 starts.

### TC-A-22 — Cross-document tool call rejected with audit
**Setup:** Authenticated as Alice. Conversation is for Document A. Send a message that induces the Director to call `get_node` with a node ID belonging to Alice's Document B.
**Expected:** `validateToolCall()` denies with `cross_document_access_denied`. The model's tool result is `{ "error": "cross_document_access_denied" }`. Audit log entry of severity `high` with the attempted node ID. The Director recovers and apologises in plain language.

### TC-A-23 — Per-conversation tool-call rate limit
**Setup:** A conversation with a deliberately-injection-laced node summary inducing the Director to make many tool calls.
**Steps:** Send a message that triggers >30 tool calls within one turn.
**Expected:** After the 30th call within 60s, subsequent `validateToolCall()` returns `tool_rate_limit_exceeded`. Audit log entry written. The Director gives up and explains in plain text.

### TC-A-24 — PATCH workflow step deselect
**Setup:** Draft workflow with 4 steps.
**Steps:** PATCH `/steps/2` with `{ status: "removed" }`.
**Expected:** 200 with full workflow body. Step 2 is `removed`. Other steps unchanged.

### TC-A-25 — PATCH workflow step parameter override
**Setup:** Draft workflow with a refine step.
**Steps:** PATCH `/steps/[order]` with `{ parameters: { instruction: "Make it shorter, not tenser" } }`.
**Expected:** Step's `parameters` JSONB merged. Other fields unchanged.

### TC-A-26 — Step rollback on simulated mid-execution failure
**Setup:** A 3-step workflow; mock dispatcher that throws on step 2.
**Steps:** Approve and execute.
**Expected:** Step 1 completes (`accepted`). Step 2 fails. Workflow status `paused`. Step 3 stays `pending`. `workflows.error_message` mirrors step 2's error.

### TC-A-27 — Mid-execution lock causes pause
**Setup:** A 3-step workflow targeting Chapters 1, 2, 3 (none locked at approval).
**Steps:** Approve. While step 1 is running, manually `UPDATE nodes SET locked=true WHERE id = step3.target_node_id`.
**Expected:** Step 1 completes. Step 2 runs and completes. Step 3's pre-dispatch `lockChainCheck()` fails; step 3 marked `failed`; workflow paused.

### TC-A-28 — Workflow history pagination
**Setup:** Document with 25 historical workflows.
**Steps:** GET `/api/documents/[id]/workflows?limit=10` then again with `cursor`.
**Expected:** First page: 10 most-recent. Second page: next 10. Steps NOT included in list response (only `step_count`).

### TC-A-29 — Phase 5 regression — single-node Refine still works
**Setup:** Authenticated as Alice; Phase 5 fixtures.
**Steps:** Run a manual Refine via the Phase 5 AgentTab (NOT via Director).
**Expected:** Refine succeeds end-to-end. The Phase 5b dispatch refactor (T-7.1) preserved Phase 5 behaviour exactly.

### TC-A-30 — Conversation summarisation cloud-smoke variant
**Setup:** Cloud-smoke fixture with a 75k-token conversation.
**Steps:** Send a message (cloud, on Haiku).
**Expected:** Inline summary pass runs; persists. Subsequent assistant response references the summary (Director's text mentions earlier topics).

### TC-A-31 — Heartbeat updates fire during a long agent job (v1.1 SU-40)
**Setup:** A workflow with one synthesise step targeting a large beat (expected ~30s LLM call on Haiku).
**Steps:** Approve the workflow; observe `agent_jobs` row via real-time during execution.
**Expected:** `last_heartbeat_at` updates at least 5 times during the LLM call (every ~5s). Real-time fires for each update. The ExecutionCard's heartbeat indicator pulses (TC-U-29).

### TC-A-32 — SSE heartbeat comment lines emitted during silence (v1.1 SU-40)
**Setup:** A Director conversation that triggers a slow read tool (mock the tool's executor with a 15s delay).
**Steps:** Send a message; record raw SSE bytes via the test helper.
**Expected:** During the 15s tool execution, the response stream contains at least 1 `:heartbeat <iso-timestamp>\n\n` line. The EventSource does NOT fire `message` events for these lines (they're SSE comments).

### TC-A-33 — Recovery sweep marks orphaned agent_jobs failed (v1.1 SU-40)
**Setup:** Manually create an `agent_jobs` row with `status='running'`, `started_at = now() - 10 minutes`, `last_heartbeat_at = NULL`. Configure a fresh workflow_step pointing at it.
**Steps:** Call `POST /api/cron/director-recovery` with the dev `CRON_SECRET`.
**Expected:** Response: `{ "agent_jobs_failed": 1, "workflows_paused": 1 }`. The orphaned job is now `failed` with `error_message='heartbeat_timeout'`. The workflow is now `paused` with `error_message` mirroring.

### TC-A-34 — Recovery sweep rejects unauthenticated calls (v1.1 SU-40)
**Steps:** Call `POST /api/cron/director-recovery` without `Authorization` header (or with a wrong secret).
**Expected:** 401 `unauthenticated`. No DB writes.

### TC-A-35 — Resume after interrupted turn preserves tool calls (v1.1 SU-41)
**Setup:** A `conversation_messages` row with `role='assistant'`, `turn_state='interrupted'`, `tool_calls` JSONB containing 3 completed read tools (e.g. get_node_tree, get_node × 2). The prior user message is the original prompt that initiated the turn.
**Steps:** Call `POST /api/director/conversation/[id]/resume` with `Accept: text/event-stream`.
**Expected:** SSE stream begins with `start` event including `{ resumed: true, recovered_tool_call_count: 3 }`. The Director continues from the partial state — does NOT re-call the 3 already-completed tools (verified via tool_calls counter; only NEW tool calls increment the count). On clean end-of-turn, the row's `turn_state` transitions `interrupted → final` (UPDATE in place; same row id; created_at preserved). `cost_usd` is the sum of original + resume LLM call costs.

---

## 6. Section 5 — Cross-Org RLS Tests (TC-B)

### TC-B-01 — Carol cannot read Alice's conversation
**Setup:** Alice has a conversation; Carol authenticated.
**Steps:** Carol GETs `/api/director/conversation/[alice_conv_id]`.
**Expected:** 404 `conversation_not_found` (RLS-hidden).

### TC-B-02 — Carol cannot send a message to Alice's conversation
**Steps:** Carol POSTs to `/api/director/message` with Alice's `conversation_id`.
**Expected:** 403 `cross_org_access_denied`.

### TC-B-03 — Carol cannot approve Alice's workflow
**Steps:** Carol POSTs `/approve` on Alice's workflow.
**Expected:** 404 `workflow_not_found`.

### TC-B-04 — Bob (same org as Alice) cannot approve Alice's workflow
**Setup:** Bob is in Alice's org but did not author the conversation.
**Steps:** Bob POSTs `/approve`.
**Expected:** 403 `not_conversation_author`. (Different from cross-org: Bob has read access to the workflow, just not approve rights — see API Contract §2.2 G-2.)

### TC-B-05 — Carol cannot list Alice's workflows
**Steps:** Carol GETs `/api/documents/[alice_doc_id]/workflows`.
**Expected:** 404 `document_not_found`.

### TC-B-06 — Real-time subscription respects RLS
**Setup:** Carol subscribes to the workflows real-time channel filtered by Alice's `document_id`.
**Steps:** Alice creates a workflow.
**Expected:** Carol receives no real-time event (RLS-filtered at the publication level).

---

## 7. Section 6 — Data Integrity / Zod Tests (TC-D)

### TC-D-01 — Zod rejects malformed message body
**Steps:** POST with `content` as a number, or missing `document_id`.
**Expected:** 400 with Zod-formatted issues.

### TC-D-02 — `parseWorkflowProposal` rejects malformed JSON
**Setup:** Mock model output containing a malformed `<workflow_proposal>` block.
**Steps:** Run the agentic loop in unit-test mode.
**Expected:** Loop exits with `proposal_parse_failed` event; no workflow row persisted.

### TC-D-03 — WorkflowStepProposal Zod rejects missing fields
**Steps:** Construct a write-tool that returns a proposal missing `target_node_id`.
**Expected:** Zod validation throws inside the executor; the loop yields a `tool_validation_failed` event with `proposal_invalid`.

### TC-D-04 — `mentioned_node_ids` cross-org rejection
**Setup:** Alice authenticated; `mentioned_node_ids` contains a node from Carol's org.
**Steps:** POST `/api/director/message`.
**Expected:** 422 `mentioned_node_cross_org` before the SSE response begins.

### TC-D-05 — Workflow step `operation_type` whitelisted
**Steps:** Try to insert a `workflow_steps` row with `operation_type='delete_document'` via the executor.
**Expected:** Zod validation rejects the proposal before persistence.

### TC-D-06 — Conversation `UNIQUE(document_id)` enforced
**Steps:** Manually attempt to INSERT a second `conversations` row for the same `document_id`.
**Expected:** Postgres unique constraint violation; the `getOrCreateConversation()` helper handles via `ON CONFLICT DO NOTHING RETURNING`.

### TC-D-07 — Author user id is FK to auth.users
**Steps:** Attempt to insert a `conversation_messages` row with `author_user_id` of a non-existent user.
**Expected:** FK violation.

### TC-D-08 — Conversation summarisation persists `summary_covers_through`
**Setup:** Conversation with messages 1..50; summarisation triggered.
**Expected:** After: `summary_covers_through = 25` (the midpoint). Subsequent context builds use messages 26..50 + the summary.

---

## 8. Section 7 — Security Tests (TC-S)

### TC-S-01 — `validateToolCall` blocks cross-org write
**Setup:** Alice's Director attempts `create_refine_step` against a Carol-owned node ID.
**Expected:** Tool call denied with `cross_org_access_denied`. Audit log entry severity `critical`. The model receives the error tool-result.

### TC-S-02 — `validateToolCall` blocks locked-node write
**Setup:** Locked target node.
**Expected:** Write tool rejected with `node_locked`.

### TC-S-03 — `validateToolCall` blocks injection in parameters
**Setup:** A write tool's `instruction` parameter contains `</user_data>` literal.
**Expected:** Rejected with `injection_pattern_in_parameters`. Audit log severity `high`.

### TC-S-04 — Per-conversation tool-call rate limit (logical-time-shifted)
**Steps:** In a unit test, fast-forward conversation_messages.tool_calls to simulate 31 tool calls in 30 seconds.
**Expected:** 31st call rejected with `tool_rate_limit_exceeded`.

### TC-S-05 — Cross-document tool call blocked
Per TC-A-22.

### TC-S-06 — Canary scan on stream chunks
**Setup:** Mock provider that emits the canary token in a `text_delta` chunk.
**Expected:** Stream aborts at the chunk; `error` event with `director_canary_leak`. No partial assistant message persisted.

### TC-S-07 — Injection in user message body rejected pre-stream
**Setup:** User message containing `</user_data>` literal.
**Expected:** 422 `injection_blocked`. No SSE response begins. Audit entry severity `high`.

### TC-S-08 — Director system prompt does not name the model
**Setup:** Load `director_configs.system_prompt`.
**Expected:** Prompt body does not contain "Sonnet", "Opus", "Haiku", "Claude" (model identity excluded per G-15).

---

## 9. Section 8 — Accessibility Tests (TC-AX)

### TC-AX-01 — DirectorPanel role + aria-label
**Expected:** `role="complementary"` and `aria-label="Director"` on the panel root (Component Spec §7.1).

### TC-AX-02 — DirectorInput keyboard send
**Expected:** Tab focuses the textarea; Enter sends; Shift+Enter newlines. Send button is reachable via Tab and triggers send via Enter/Space.

### TC-AX-03 — PlanCard step checkboxes are keyboard-operable
**Expected:** Each step's checkbox is focusable; Space toggles. Approve button is the next focus stop after the last checkbox.

### TC-AX-04 — ExecutionCard step states announced
**Expected:** Each step row has `aria-live="polite"` and announces state changes ("running", "complete", "failed") to screen readers.

---

## 10. Verdict Count and Summary

### 10.1 β-scope (must-pass for Phase 5b merge) — 45 cases (v1.1)

The Phase 5b merge gate is a 45-case β-scope (v1.1: was 40; +5 for the new SU-40 / SU-41 / SU-42 must-pass cases):

- TC-A: 19 — TC-A-01, 02, 03, 04, 09, 10, 13, 14, 15, 16, 17, 18, 22, 29, **31** (heartbeat updates), **32** (SSE heartbeat lines), **33** (recovery sweep marks orphans), **34** (cron auth), **35** (resume preserves tool calls)
- TC-B: 4 — TC-B-01, 02, 03, 04
- TC-D: 4 — TC-D-01, 02, 03, 08
- TC-S: 6 — TC-S-01, 02, 03, 06, 07, 08
- TC-U: 10 — TC-U-01, 02, 03, 06, 07, 14, 18, 19, **29** (heartbeat indicator pulse), **30** (amber on timeout)
- TC-V: 2 — TC-V-01, TC-V-04
- TC-M: 1 — TC-M-01
- TC-AX: 1 — TC-AX-01

Phase 5b ships if these 45 PASS local + 4 PASS cloud smoke. The remaining 55 cases are deferred to Phase 8 expansion as **SU-37**.

### 10.2 Cloud smoke set — 4 cases

- TC-A-01 (Director conversation create + first message + simple read-tool plan)
- TC-A-15 (Workflow approve + execute happy path with refine steps)
- TC-A-22 (Cross-document tool call denied with audit entry)
- TC-A-30 (Conversation summarisation crosses 60k threshold and persists)

Run on **Haiku 4.5** against `stelavox-dev` (per the Haiku-everywhere user directive). Total budget ~$0.05–0.15.

### 10.3 Deferred set (Phase 8, SU-37) — 54 cases

All cases not in §10.1. They cover edge cases (idempotency on re-approve, paused-then-stopped, history pagination edge cases, all visual-rule subtleties beyond the load-bearing two, non-load-bearing motion-timing tests, full accessibility audit). Phase 5b ships the substrate; Phase 8 hardens it.

### 10.4 Verdict count audit (CK-10)

At Phase 5b merge:
1. Run `grep -rE "TC-(A|B|D|S|U|V|M|AX)-[0-9]+" tests/`.
2. Count by category.
3. Match the count to the Phase 5b Test Report's claimed verdict.
4. Resolve any mismatch BEFORE merging. Per the Phase 3 v1.5 lesson: a claimed test that doesn't exist in `tests/` is a hard fail, not a documentation issue.

---

## 11. Changelog

**v1.1 — 2026-05-06** Aligns with API Contract v1.1 amendments (SU-40 / SU-41 / SU-42). Total planned cases 94 → 100. β-scope 40 → 45. New cases: TC-A-31 (heartbeat updates fire during long agent jobs), TC-A-32 (SSE heartbeat comment lines), TC-A-33 (recovery sweep marks orphans failed), TC-A-34 (cron route rejects unauthenticated calls), TC-A-35 (resume preserves tool calls), TC-U-29 (heartbeat indicator pulses green), TC-U-30 (heartbeat goes amber on timeout). All five new TC-A cases are β-scope and must-pass for merge. Cloud smoke set unchanged at 4 cases on Haiku.

**v1.0 — 2026-05-06** Initial Phase 5b Test Plan. 94 planned cases across 8 categories. β-scope of 40 cases for merge; remaining 54 deferred to Phase 8 as SU-37 (joins SU-33's 100-case Phase 5 deferral set). Cloud smoke set of 4 cases on **Haiku** against `stelavox-dev`. **All Phase 5b LLM API calls run on Haiku 4.5** — local build-test, T-17 prompt review, and cloud smoke — per the user's standing Haiku-everywhere direction (`feedback_haiku_default.md`, reaffirmed 2026-05-06 at Phase 5b startup). Production-default in `director_configs` remains Opus. One pre-emptive SU recorded against TC-V-04 (SU-38: align CLAUDE.md Inviolable #2 enumeration with Component Spec §7.6's PlanCard Approve verdigris use).
