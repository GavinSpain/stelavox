# Stelavox — Phase 5c Test Plan
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5c verification. Companion to `stelavox_phase5c_api_contract_v1_0.md` and `stelavox_phase5c_build_checklist_v1_0.md`. Enumerates every test case for Phase 5c by category. Cross-cutting test conventions are inherited from Phase 5b's Test Plan and not restated.

**Phase:** 5c — synthesise streaming via SSE.

**β-scope vs full coverage.** Phase 5c is a narrower scope than Phase 5b — one new endpoint, one new provider method, one new UI surface. Full coverage is achievable. There is no β-scope carve-out for Phase 5c.

---

## 1. Scope

### 1.1 What's tested

- The new `POST /api/agent/synthesise/stream` endpoint, end-to-end (TC-A)
- The new `provider.stream()` method on AnthropicProvider (TC-D unit-level)
- The runner refactor — `lib/agent/job-lifecycle.ts` shared module + `runAgentJobInline` (TC-D unit-level)
- Cancellation semantics (TC-A)
- Heartbeat liveness during streaming (TC-A)
- Canary defence on streamed text (TC-S)
- Cross-org / cross-document / locked-node / concurrency rejection at the streaming endpoint (TC-S)
- AgentTab streaming UI surface (TC-U)
- Workflow integration unaffected — Phase 5b TC-A-15 re-runs PASS (TC-A)
- Cross-model synthesise verification on j5-novel (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) (TC-A)

### 1.2 What's not tested

- **Refine / expand / generate-context streaming** — out of scope for Phase 5c.
- **Workflow-dispatched synthesise streaming** — out of scope; the workflow path stays non-streaming. Verified by re-running TC-A-15.
- **Reconnect-with-resume** — V1.x candidate.
- **Partial-Tiptap rendering during stream** — V1 simplification (plain-text typewriter only).

### 1.3 Test models

Per `feedback_haiku_default.md` user-preference memory: all Phase 5c testing defaults to Haiku 4.5. Use Sonnet 4.6 / Opus 4.7 only for the cross-model verification round (T-11).

---

## 2. TC-A — API tests (functional)

### 2.1 Happy paths

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-A-01 | POST /api/agent/synthesise/stream against an unlocked leaf returns SSE; events arrive in order: `agent_job_created` → ≥1 `text_delta` → `usage` → `agent_job_complete` → `done` | ~$0.01 Haiku | Happy path end-to-end |
| TC-A-02 | The agent_jobs row created by TC-A-01 ends with `status='completed'`, `result_prose` populated (Tiptap-JSON-stringified), `tokens_input + tokens_output > 0`, `cost_usd > 0` | (riding TC-A-01) | DB final state |
| TC-A-03 | The `agent_job_created` event's `agent_job_id` matches the row created in step 7 of the validation flow | (riding TC-A-01) | Event correctness |
| TC-A-04 | The `usage` event's token counts match the agent_jobs row's `tokens_*` columns | (riding TC-A-01) | Cost reconciliation |
| TC-A-05 | The `agent_job_complete` event's `result_prose` field is byte-equal to the agent_jobs row's `result_prose` | (riding TC-A-01) | Wire/DB consistency |

### 2.2 Cancellation

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-A-06 | Client closes the SSE connection mid-stream after the first `text_delta` arrives. Anthropic stream is aborted; agent_jobs row ends `status='cancelled'`, `error_message='client_disconnect'`. Token count reflects partial consumption. | ~$0.005 | Cancel-mid-stream |
| TC-A-07 | Client closes the SSE connection BEFORE the first `text_delta` (early cancel after `agent_job_created`). agent_jobs row ends `status='cancelled'`, `result_prose` NULL. | ~$0.001 | Early cancel |
| TC-A-08 | Cancelling an already-completed stream is a no-op (the connection-close event arrives after `done`). agent_jobs row stays `status='completed'`. | (riding TC-A-01) | Race window |

### 2.3 Heartbeat

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-A-09 | During a long synthesise stream (>10s), `heartbeat` SSE events fire when no `text_delta` arrives in any 10-second window. | (riding cross-model) | SSE liveness |
| TC-A-10 | During the same long stream, `agent_jobs.last_heartbeat_at` advances at least every 10 seconds. | (riding cross-model) | DB liveness |
| TC-A-11 | A simulated stalled job (heartbeat last updated >120s ago, status still `running`) is marked `failed` with `error_message='heartbeat_timeout'` by the next `/api/cron/director-recovery` invocation. | $0 (mocked) | Recovery sweep |

### 2.4 Workflow integration unaffected

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-A-12 | Phase 5b TC-A-15 (`tests/director/j5-workflow-approve.spec.ts`) PASSES post-Phase-5c implementation. The workflow_executor still uses the background path; SU-48 catch-up still applies the result; node version still advances. | ~$0.005 | Regression: workflow path |
| TC-A-13 | A synthesise dispatched by a workflow_step does NOT call `/api/agent/synthesise/stream`. Verified by checking that no SSE endpoint hits land during a TC-A-15 run. | (riding TC-A-12) | Path isolation |

### 2.5 Cross-model verification

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-A-14 | Synthesise probe `P-SYNTH-CH3-SC1-BT1` runs end-to-end on Haiku 4.5 — produces in-voice prose, streaming wire works, completes successfully | ~$0.02 | Haiku |
| TC-A-15 | Same probe on Sonnet 4.6 | ~$0.05 | Sonnet |
| TC-A-16 | Same probe on Opus 4.7 — verifies SU-46 temperature handling extends to `provider.stream()` | ~$0.20 | Opus 4.7 + SU-46 carry-forward |

---

## 3. TC-D — Data integrity / unit tests (Vitest)

| ID | Description | Pre-req | Coverage |
|---|---|---|---|
| TC-D-01 | `provider.stream()` yields a sequence of `text` chunks followed by exactly one `message_stop` chunk. | Real Haiku key (skipped without) | Provider chunk sequence |
| TC-D-02 | `provider.stream()` against Opus 4.7 does NOT pass `temperature` to the SDK (SU-46 carry-forward). Verified by mocking the SDK or inspecting the request payload. | Mock | SU-46 cross-method coverage |
| TC-D-03 | `runAgentJobInline()` yield sequence on a successful job: `job_created` → ≥1 `text_delta` → `usage` → `job_complete`. agent_jobs row final state matches the yield. | Real key + j5-novel fixture | Inline runner happy path |
| TC-D-04 | `runAgentJobInline()` on a job whose target node has been deleted between INSERT and the LLM call yields a single `error` event with code `internal_error`. agent_jobs row marked `failed`. | Mock + DB | Inline runner failure path |
| TC-D-05 | After T-2 refactor, `runAgentJob()` (background) produces identical agent_jobs DB transitions as before — verified by the existing Phase 5 agent test suite re-running PASS. | Existing Phase 5 tests | Refactor invariance |

---

## 4. TC-S — Security tests

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-S-01 | POST /api/agent/synthesise/stream against a node in another organisation returns 403/404 (per RLS); no agent_jobs row created. | $0 | Cross-org rejection at endpoint |
| TC-S-02 | POST against a node in the caller's org but a different document returns 404 / 403. | $0 | Cross-document rejection |
| TC-S-03 | POST against a locked node returns 423 `node_locked`; no agent_jobs row created. | $0 | Locked-node defence |
| TC-S-04 | POST against a non-leaf node returns 422 `not_a_leaf`; no agent_jobs row created. | $0 | Leaf-only constraint |
| TC-S-05 | POST against a node that already has a running agent_job returns 409 `agent_job_in_progress`; no second agent_jobs row created. | $0 | Concurrency lock |
| TC-S-06 | Token-budget gate (Phase 5 H-07) runs before the agent_jobs row is created. A user with 0 budget gets 429 with no DB write. | $0 | Budget gate carry-forward |
| TC-S-07 | A simulated canary leak in the model output (forced via test-mode flag or mock) terminates the stream with `error` event code `canary_violation`. agent_jobs row marked `failed` with `error_message='canary_leak'`. | $0 (mock) | Canary defence in stream |
| TC-S-08 | The `agent_job_created` event does NOT include the canary token or any other server-side secret. | (riding TC-A-01) | Wire-shape secret hygiene |
| TC-S-09 | Unauthenticated POST returns 401 before any agent_jobs row creation. | $0 | Auth gate |
| TC-S-10 | An SSE connection from one user to another user's already-running agent_job (via guessed agent_job_id in URL — not the actual contract here, but defended for completeness) returns 404. | $0 | Auth on SSE |

---

## 5. TC-U — UI tests

| ID | Description | LLM cost | Coverage |
|---|---|---|---|
| TC-U-01 | Click Synthesise on a beat node in AgentTab. Streaming surface appears within 2 seconds. The "streaming…" indicator and Cancel button are visible. | ~$0.01 | UI mount |
| TC-U-02 | Text appears progressively in the streaming surface as deltas arrive (typewriter feel). | (riding TC-U-01) | Typewriter rendering |
| TC-U-03 | On `agent_job_complete`, the streaming surface transitions to the existing accept / dismiss view, with the full prose rendered in Tiptap. | (riding TC-U-01) | End-of-stream transition |
| TC-U-04 | Cancel button click during streaming closes the SSE connection; surface clears; AgentTab returns to the idle / pre-click state with a "cancelled" message. | ~$0.005 | Cancel UX |
| TC-U-05 | While streaming, navigating away from the document (closing the tab, going to another node) closes the SSE connection cleanly; agent_job ends `cancelled`. | ~$0.005 | Implicit cancel |
| TC-U-06 | While streaming, the user clicks Synthesise on a different unlocked beat. The first stream cancels; the second opens. | ~$0.01 | Two-stream sequencing |
| TC-U-07 | Streaming surface honours `prefers-reduced-motion`: no caret-blink, no transition animations. | $0 | Accessibility |
| TC-U-08 | Streaming surface uses the prose typeface (Lora) and the prose-editor styling so the end-of-stream transition is seamless. | $0 (visual) | Typeface continuity |

---

## 6. TC-V — Visual tests

| ID | Description | Coverage |
|---|---|---|
| TC-V-01 | Streaming surface in `running` state — Lora 18px / 16px panel, accent caret at end of accumulated text, "streaming…" indicator + Cancel button in upper-right. Captured via Playwright screenshot during a long synthesise. | Visual snapshot |
| TC-V-02 | Transition from streaming surface to accept/dismiss view at end-of-stream — no flash, no layout shift. | Visual continuity |

---

## 7. TC-M — Motion tests

| ID | Description | Coverage |
|---|---|---|
| TC-M-01 | Caret behaviour during streaming: solid (no blink) while text is actively arriving; standard 1Hz blink during `heartbeat` gaps. Mirrors ProseEditor's caret behaviour (Component Spec §5.5). | Caret semantics |

---

## 8. TC-AX — Accessibility tests

| ID | Description | Coverage |
|---|---|---|
| TC-AX-01 | Streaming surface has `role="status"` and `aria-live="polite"` so screen readers announce text as it arrives without interrupting the user. | A11y for live region |
| TC-AX-02 | Cancel button has `aria-label="Cancel streaming synthesise"`; keyboard-accessible. | A11y for cancel |

---

## 9. Test execution plan

### 9.1 Local non-LLM cases (CI-runnable)

All TC-S except TC-S-07's canary scenario, all TC-D-04, TC-U-07/08, TC-V-02, TC-M-01, TC-AX-01/02 — pure-validation or mock-based, zero LLM cost. Runnable in CI on every PR.

### 9.2 Local LLM-bearing cases (manual / pre-merge)

TC-A-01..05, TC-A-06..08, TC-A-09..11, TC-A-12, TC-D-01, TC-D-03, TC-U-01..06 — require a real Anthropic key. Run on Haiku 4.5 (per `feedback_haiku_default.md`). Total cost ~$0.10 for a full pass.

### 9.3 Cross-model verification

TC-A-14..16 — Haiku + Sonnet + Opus on the synthesise probe. Total cost ~$0.30 for a single round; ~$0.10 for Haiku-only re-runs after iteration.

### 9.4 Cloud smoke

One streaming synthesise probe against `stelavox-dev` post-master-push. Verifies the SSE wire works through Vercel's runtime. Cost ~$0.01.

### 9.5 Cumulative LLM budget

| Pass | Cost |
|---|---|
| Local non-LLM (TC-S, TC-D-04, TC-U-07/08, TC-V, TC-M, TC-AX) | $0 |
| Local LLM (TC-A-01..12, TC-D-01/03, TC-U-01..06) | ~$0.10 |
| Cross-model verification (TC-A-14..16) | ~$0.30 |
| Cloud smoke (CK-11) | ~$0.01 |
| **Total** | **~$0.41** |

Substantially under Phase 5b's $5 spend.

---

## 10. Acceptance verdict

Phase 5c PASSES when:

- All 13 phase checkpoint criteria (CK-1 through CK-13 in the Build Checklist) are GREEN
- Every TC-A / TC-D / TC-S / TC-U test case in this Plan PASSES (no skips at PASS time)
- All three models in TC-A-14..16 produce in-voice prose with no wire-shape errors
- Cloud smoke (CK-11) PASSES
- Phase 1–5b broader regression unaffected (429/430 PASS; 1 pre-existing carry-forward)

If any TC-A / TC-D / TC-S case fails: stop-the-line. Diagnose. Fix. Re-run. Document in Test Report.

If a TC-U / TC-V / TC-M / TC-AX case fails: assess severity. Layout-shift / visual regression on the streaming-to-completed transition is launch-blocking; minor caret-blink discrepancies are V1.x candidates.

---

## 11. Changelog

**v1.0 — 2026-05-08** Initial Phase 5c Test Plan. Six categories (TC-A API, TC-D data integrity, TC-S security, TC-U UI, TC-V visual, TC-M motion, TC-AX accessibility). 16 TC-A cases, 5 TC-D cases, 10 TC-S cases, 8 TC-U cases, 2 TC-V cases, 1 TC-M case, 2 TC-AX cases. Total ~44 cases across the categories. No β-scope carve-out — Phase 5c is narrow enough scope for full coverage. Cumulative LLM budget ~$0.41 for a full pass on Haiku + cross-model triple. Acceptance: all CKs green, all TC-A/D/S/U cases PASS, cloud smoke PASS, Phase 1–5b regression unchanged.
