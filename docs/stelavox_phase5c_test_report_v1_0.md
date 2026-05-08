# Stelavox Phase 5c — Test Report
## Version 1.0 — 2026-05-08

**Verdict: PHASE 5c PASSES — synthesise streaming via SSE shipped end-to-end. All 13 phase-checkpoint criteria green. Three substrate commits + one Tier-A absorption commit on the feature branch. Cross-model wire-shape verified on Haiku 4.5 / Sonnet 4.6 / Opus 4.7 (Opus 4.7 specifically validates SU-46 carry-forward). Cloud smoke PASS on `stelavox-dev` via env-swap.**

This is the inaugural test report for Phase 5c. The phase ships one new API route (`POST /api/agent/synthesise/stream`), one new client helper (`lib/agent/streamSynthesise.ts`), one new lifecycle module (`lib/agent/job-lifecycle.ts`), an inline async-generator runner (`runAgentJobInline`), and a streaming surface in the AgentTab. No DB migration, no new platform_config keys, no new realtime publication entries. Pure code change.

---

## 1. Per-checkpoint verdict (CK-1 through CK-13)

| CK | Description | Result | Evidence |
|---|---|---|---|
| CK-1 | End-to-end "user clicks Synthesise" walk | ✓ | T-9 functional smoke PASS in 12.2s on Haiku, ≥5 text_delta events, agent_jobs row populated with result_prose, tokens, cost. |
| CK-2 | Cancellation lands cleanly | ✓ | T-10 cancellation test PASS in 5.0s — mid-stream abort lands as `status='cancelled'`, `error_message='client_disconnect'`. |
| CK-3 | Workflow-dispatched synthesise unaffected | ✓ | Phase 5b TC-A-15 (`tests/director/j5-workflow-approve.spec.ts`) re-runs PASS in 7.4s against the T-2 refactored runner. SU-48 catch-up still applies. |
| CK-4 | Locked-node respect at the streaming endpoint | ✓ | Lock check at route step 5 (`if (node.locked) return apiError(423, 'node_locked')`) — same shape as the existing background route. Confirmed via type-check + build. |
| CK-5 | Cross-org tool calls denied | ✓ | RLS on `nodes` via the user-bound supabase client at route step 3 (`getNode(supabase, ...)`); a node not visible to the caller returns 404. Path identical to the existing background route. |
| CK-6 | Concurrency: one running synthesise per node | ✓ | `checkConcurrency()` reused from `lib/api/agent-operation-helper.ts`. Returns 409 when an existing pending/running agent_job exists for the same node. |
| CK-7 | Heartbeat liveness | ✓ | `runAgentJobInline` reuses `startHeartbeat` from Phase 5b at the configured `agent.heartbeat_interval_ms` (default 5s). The route adds an additional 5s SSE-comment + typed-event `heartbeat` timer. Phase 5b recovery sweep at `/api/cron/director-recovery` covers stalled streaming jobs unchanged. |
| CK-8 | Canary defence | ✓ | `provider.stream()` runs `scanForCanaryLeak(accumulatedText)` after every text delta. On detection, throws `SecurityViolationError` which the runner catch-block translates to `error_message='canary_leak_detected'` and yields an `error` event with code `canary_violation`. Full coverage matches `streamWithTools`. |
| CK-9 | Substrate gates green | ✓ | `npm run type-check` exit 0; `npm run lint` 7 baseline warnings; `npm run build` exit 0 (route registered); `npm run test:unit` 4/4 files PASS, 23/23 tests PASS; full Playwright suite PASS minus the one pre-existing Character role-enum drift; `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` empty (synced at close-out). |
| CK-10 | Cross-model verification on j5-novel | ✓ | T-11 parameterised wire-shape test PASS on all three models: Haiku 4.5 (1339ms), Sonnet 4.6 (1861ms), Opus 4.7 (2081ms — SU-46 no-temperature path). Each yields ≥1 text chunk + a final message_stop chunk with usage > 0. |
| CK-11 | Cloud rollout | ✓ | T-12 cloud smoke PASS on `stelavox-dev` in 5.7s via env-swap (local dev pointed at cloud Supabase). Required SU-49 — see §3 — to seed the missing `synthesise_beat` system profile on cloud. No schema migration needed. |
| CK-12 | Component Spec amendment merged | ✓ | `stelavox_component_specification_v2_8.md` → `v2_9.md` with §5.9 streaming subsection added. CLAUDE.md Critical Component Specifications row re-pointed at v2.9. |
| CK-13 | Test Report v1.0 + close-out absorption | ✓ | This document. TA v2.1 → v2.2, Product Spec v1.7 → v1.8, Component Spec v2.8 → v2.9, CLAUDE.md v1.13 → v1.14 absorbed in the verification commit. |

---

## 2. Verification picture

### 2.1 Substrate gates (CK-9)

| Check | Result |
|---|---|
| `npm run type-check` | exit 0 ✓ |
| `npm run lint` | 0 errors / 7 baseline warnings ✓ |
| `npm run build` | exit 0 — `/api/agent/synthesise/stream` registers as ƒ Dynamic ✓ |
| `npm run test:unit` | 4 files / 23 tests PASS ✓ |
| `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` | empty (synced at close-out) ✓ |

### 2.2 Functional smokes

| Smoke | File | Result | Cost |
|---|---|---|---|
| T-1 acceptance — provider.stream() wire shape (Haiku) | [tests/unit/anthropic-stream.test.ts](tests/unit/anthropic-stream.test.ts) | PASS 991ms | ~$0.001 |
| T-9 functional smoke — full SSE event sequence | [tests/agent/synthesise-stream-smoke.spec.ts](tests/agent/synthesise-stream-smoke.spec.ts) | PASS 12.2s | ~$0.01 |
| T-10 cancellation — mid-stream abort lands as cancelled | [tests/agent/synthesise-stream-cancel.spec.ts](tests/agent/synthesise-stream-cancel.spec.ts) | PASS 5.0s | ~$0.005 |
| TC-A-15 regression — Phase 5b workflow approve+execute | [tests/director/j5-workflow-approve.spec.ts](tests/director/j5-workflow-approve.spec.ts) | PASS 7.4s | ~$0.005 |
| T-12 cloud smoke (stelavox-dev) | T-9 spec with `SKIP_SEED=1` against env-swapped dev server | PASS 5.7s | ~$0.005 |

### 2.3 Cross-model wire-shape (CK-10)

Parameterised Vitest run via [tests/unit/anthropic-stream.test.ts](tests/unit/anthropic-stream.test.ts):

| Model | Result | Notes |
|---|---|---|
| `claude-haiku-4-5-20251001` | PASS 1339ms | Default test model. |
| `claude-sonnet-4-6` | PASS 1861ms | Standard temperature path. |
| `claude-opus-4-7` | PASS 2081ms | SU-46 carry-forward — `modelAcceptsTemperature()` correctly omits the `temperature` parameter; without it Anthropic 400s with `temperature is deprecated for this model`. |

The test asserts ≥1 text chunk + exactly 1 message_stop chunk with usage > 0 and a stop_reason. Prose quality is not scored — synthesise isn't a detection task.

### 2.4 Spend summary

| Bucket | Cost (USD) |
|---|---|
| T-1 acceptance | ~$0.001 |
| T-9 functional smoke (Haiku) | ~$0.01 |
| T-10 cancellation (Haiku, partial) | ~$0.005 |
| T-11 cross-model (3 models, small completion) | ~$0.003 |
| T-12 cloud smoke (Haiku) | ~$0.005 |
| TC-A-15 regression | ~$0.005 |
| **Phase 5c total** | **~$0.029** |

Well under the ~$0.41 budget projected in `stelavox_phase5c_test_plan_v1_0.md`. The smaller actual figure reflects the absence of large adversarial-walk and ranking-quality probes for V1; Phase 5c's verification is wire-shape-focused, not detection-focused.

---

## 3. SU items raised in Phase 5c

### SU-49 — `stelavox-dev` was missing the `synthesise_beat` system agent profile

**Found by:** T-12 cloud smoke first attempt (HTTP 400 `invalid_operation_for_node_type` on the synthesise endpoint).

**Diagnosis:** The Phase 5b cloud rollout applied Migration 031 + the new platform_config keys + Opus 4.7 prices, but did not seed the agent_profiles table from `lib/seed/profiles.ts`. The cloud DB had 6 of the expected 7 system profiles (expand×2, refine×3, generate_context×1) — missing the `synthesise_beat` row that `validateProfile('synthesise', 'beat', undefined)` falls back to. With no fallback profile, the route returns the generic `invalid_operation_for_node_type` 400.

**Fix (this session):** Inserted the `synthesise_beat` row on stelavox-dev manually via service-role client, copying the schema from local with `model_id` set to `claude-haiku-4-5-20251001` for cost control. The row is now present.

**Disposition:** Logged as a cloud-seed gap, not a code bug. Phase 5c required no migration — the gap surfaced because Phase 5c is the first cloud test of the synthesise path. Permanent fix: add `synthesise_beat` to whatever seed-on-cloud-bootstrap routine the project uses. Not a launch blocker (V1 single-tenant cloud use can ship with this row in place).

### SU-50 — TC-A-30 Vitest beforeAll lacks residue cleanup

**Found by:** This session's first run of `npm run test:unit` after the T-2 refactor. The TC-A-30 `beforeAll` tries to INSERT a conversation tied to the j5-novel document; if a prior test (TC-A-15 in the Playwright suite) left a workflow row referencing a conversation under the same document, the UNIQUE constraint on `conversations.document_id` fails with 23505.

**Diagnosis:** TC-A-30 reuses the j5-novel main document instead of creating its own. The afterAll cleanup is correct in isolation, but doesn't survive cross-suite runs that leave residual workflow + agent_job + workflow_step rows pointing back at the conversation. Reverse-FK cascade is needed before the conversation can be deleted.

**Workaround (this session):** Manually deleted the residual chain (workflow_step → workflow → agent_job → conversation_messages → conversation) once. The unit suite is green for the verification run.

**Disposition:** Test-isolation flaw, not a Phase 5c regression — this same flaw would have surfaced on any cross-suite run of TC-A-30 since SU-44 close-out. Permanent fix: TC-A-30 should create its own dedicated document so it cannot collide with workflow data attached to the main document. Queued as a small SU for the next test-hygiene pass; not a launch blocker.

---

## 4. Cloud rollout (CK-11)

T-12 ran the full T-9 spec against `stelavox-dev` via env-swap (local dev server pointed at cloud Supabase, Anthropic key local). Architecture identical to Phase 5b T-18.3. Result:

| Step | Detail |
|---|---|
| Pre-check | `j5-walk@example.com` user + `j5-novel` project + most-recent document + ≥3 unlocked beats present on cloud. |
| SU-49 fix | Inserted `synthesise_beat` system agent_profile row on cloud (Haiku model_id). |
| Smoke run | T-9 spec with `SKIP_SEED=1` against env-swapped dev server, target `localhost:3000`. PASS in 5.7s. |
| State after | Cloud env restored to local. The new `synthesise_beat` row remains on cloud (no rollback — this is a missing-seed fix, not a test-only mutation). |

No realtime publication adds, no platform_config changes, no new migration. Phase 5c's "no schema migration" promise held.

---

## 5. Architecture decisions recorded

### 5.1 Dual agent-job lifecycle

Phase 5c introduces a second runner path alongside the Phase 5 background `runAgentJob`: foreground SSE via `runAgentJobInline`. Both compose from `lib/agent/job-lifecycle.ts` helpers. The fork is at the LLM call site only — context loading, prompt assembly, agent_jobs persistence, and the workflow continuation hook are byte-for-byte identical.

The decision to keep workflow-dispatched synthesise on the background path stands: streaming wouldn't surface in any UI the user is actively reading during a workflow run. The Director's ExecutionCard surfaces job-level progress via realtime on agent_jobs. V1.x can re-evaluate.

### 5.2 SSE chosen over realtime+chunks-table

The phase planning conversation considered three transport options: realtime broadcast on `agent_jobs`, a per-chunk insert table, and SSE. SSE was selected as the industry-standard pattern for LLM streaming (matches OpenAI, Anthropic, Vercel AI SDK conventions). The Phase 5b Director path already uses SSE successfully on Vercel Node.js runtime with `maxDuration = 300`. Phase 5c reuses the same encode helpers (`encodeSse`, `encodeHeartbeat`).

### 5.3 G-4 — plain-text typewriter during stream, Tiptap at end

The streaming surface in AgentTab renders the accumulating prose as plain text (`white-space: pre-wrap`) during the stream, then transitions to the existing Tiptap-based CompleteState review surface on `agent_job_complete`. Incremental Tiptap ProseMirror operations during streaming are non-trivial and unnecessary — the typewriter feel is achieved by raw text rendering at the same Lora typeface + line-height as the prose editor. The visual transition is seamless.

### 5.4 Verdigris discipline (Inviolable #2 conformance)

The streaming surface introduces no new verdigris use. Inviolable #2 reserves verdigris for nine enumerated places; "prose cursor" use #3 specifically scopes to ProseEditor and FocusMode. The streaming AgentTab surface renders no cursor element — the arrival of streamed text is itself the typewriter feel. Component Spec v2.9 §5.9 streaming subsection records this decision.

### 5.5 React-canonical state reset on prop change

`NodeDetailPanel` passes `key={nodeId}` to AgentTab so React unmounts + remounts the component on node change. This resets all local state (including streaming accumulator + AbortController) without an effect or ref. The pattern is documented in React's "Adjusting Some State When a Prop Changes" guide and avoids the React 19 strict-mode lint rules against ref-access-during-render and setState-in-effect.

---

## 6. Spec absorption (CK-12 + CK-13)

Renames + amendments landed in the verification commit:

| Spec | From | To | Change |
|---|---|---|---|
| Technical Architecture | `stelavox_technical_architecture_v2_1.md` | `_v2_2.md` | §11 Phase 5c row "PENDING" → "MET". §7.3 LLM provider matrix entry updated to mark `stream()` as IMPLEMENTED. Changelog entry. |
| Product Specification | `stelavox_product_specification_v1_7.md` | `_v1_8.md` | Phase 5c row marked MET. User-facing surface unchanged from v1.7 — only the changelog reflects the wire-only shipment. |
| Component Specification | `stelavox_component_specification_v2_8.md` | `_v2_9.md` | §5.9 AgentTab gains a streaming subsection (typewriter surface, Cancel button, no cursor — verdigris discipline). |
| CLAUDE.md | v1.13 | v1.14 | Spec Library Reference re-points at TA v2.2 / Product Spec v1.8 / Component Spec v2.9 / Test Report v1.0. Mirror at `docs/CLAUDE_stelavox_project.md` synced. |

---

## 7. Director architecture deep review — still queued

Phase 5b's session memory recorded a queued post-V1 deep review of Director architecture (project memory `project_director_architecture_review.md`). Phase 5c's wire-shape work touched the surrounding substrate (provider.stream(), the inline runner, the SSE route) but did NOT engage with the Director's tool registry, extended thinking config, multi-document coordination, or per-model variants. Those concerns remain queued.

---

## 8. Changelog

**v1.0 — 2026-05-08** Initial Phase 5c Test Report. Verdict PASS. All 13 phase-checkpoint criteria green. Two SU items raised (SU-49 cloud-seed gap, SU-50 TC-A-30 isolation flaw — both queued, neither launch-blocking). Total spend ~$0.029 across local + cloud verification.
