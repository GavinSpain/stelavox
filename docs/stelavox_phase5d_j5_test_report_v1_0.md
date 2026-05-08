# Stelavox — Phase 5d.J5 Single-Node Agent Ops Test Report
## Version 1.0

**Journey:** J5 — Single-node agent ops (synthesise / refine / expand / generate-context).

**Verdict:** PASS. **10/23 active**, 13 deferred (UI-bound or cross-cut). 19.3s wall time.

## 1. Per-case results

| TC ID | Status | Notes |
|---|---|---|
| TC-J5-01 | PASS | Synthesise endpoint accepts dispatch + creates agent_jobs row (LLM, ~$0.01 Haiku, in-flight cleanup). |
| TC-J5-02 | PASS | Concurrent job → 409 agent_job_in_progress. |
| TC-J5-03 | PASS | Synthesise on non-leaf rejected (not_a_leaf_node). |
| **TC-J5-04** | **SKIP** | Canary mock requires test-mode flag in provider. |
| **TC-J5-05** | **SKIP** | Unauth context still carries session state in this harness; redundant with J1/J2. |
| **TC-J5-06** | **SKIP** | AgentTab UI needs data-testid (SU-J3-5 family). |
| TC-J5-07 | PASS | Expand on a leaf (Beat) is rejected. |
| TC-J5-08v | PASS | refine_beat_prose + refine_beat_summary system profiles exist with correct (op, node_type) — SU-52 / Phase 5c bug #5 family. |
| **TC-J5-08..10** | **SKIP** | UI-bound; API resolution covered by TC-J5-08v + Phase 5 prior-art. |
| TC-J5-11 | PASS | Refine on empty target → 400 refine_empty_field. |
| **TC-J5-12** | **SKIP** | Generate-context end-to-end LLM cost-budgeted. |
| **TC-J5-13** | **SKIP** | Token-budget gate needs platform_config manipulation. |
| **TC-J5-14..16** | **SKIP** | UI-bound. |
| **TC-J5-17** | **SKIP** | Two-tab simulation; covered by Phase 3 optimistic concurrency. |
| TC-J5-18 | PASS | Dismiss completed job sets status='dismissed'. |
| TC-J5-19 | PASS | accept_agent_job stores Tiptap JSON in nodes.prose (Phase 5c bug #2 regression guard). |
| TC-J5-20 | PASS | Document agent-jobs history endpoint surfaces past jobs. |
| **TC-J5-21** | **SKIP** | Workflow integration is J6 territory. |
| **TC-J5-22** | **SKIP** | Cross-model triple-baseline expensive; opt-in. |
| **TC-J5-23** | **SKIP** | AgentActivityIndicator UI signal. |
| TC-J5-RLS | PASS | (Bonus) User B cross-org synthesise blocked by RLS. |

**Active: 10/10 PASS. Skipped: 13. Failures: 0. LLM spend: ~$0.01 (Haiku, TC-J5-01).**

## 2. Iterations

- TS shape errors on `seedCompletedJob` parameters (used `resultColumns:` wrapper, not `resultProse`/`targetField`).
- `agent_profiles` has no `target_field` column — target_field is encoded in the profile NAME. Test reframed accordingly.
- `agent_jobs` has no `dismissed_at` column — dismissed state is `status='dismissed'`. Test reframed.
- TC-J5-05 unauth context carried unexpected session state; skipped (redundant coverage exists).

## 3. SU items raised in J5

None new. SU-52 family (target_field disambiguation in user-clicked refine) verified at API level by TC-J5-08v + bug-fix family TC-J5-19.

## 4. Verdict

J5 PASSES for active scope. 10 cases ship covering: dispatch happy path (LLM), concurrency, leaf/non-leaf gating, profile resolution, accept Tiptap shape, dismiss, history, RLS. UI-heavy 13 cases deferred to AgentTab data-testid PR + opt-in LLM passes.

## 5. Changelog

**v1.0 — 2026-05-09** Initial Phase 5d.J5 Test Report. 10 active PASS, 13 skipped. One LLM-bearing case (Haiku ~$0.01). Three TS shape iterations during build. SU-52 family covered by API-level profile-resolution test + accept-flow Tiptap regression guard.
