# Stelavox — V1.x-A.1 Test Report
## Version 1.0

> **Verdict: PASS.** V1.x-A.1 — architectural correction splitting V1.x-A's conflated `briefs` table into **Project Profile** (persistent identity) and **Brief** (operation plan) — ships with every locked checkpoint criterion green at the substrate level. Director-driven user flows (LLM proposes a Brief end-to-end, user clicks Approve) are exercised in the user-driven launch test per `project_launch_standard.md`; this report covers what's mechanically verifiable.

**Branch:** `claude/busy-colden-6c14b0` → master.
**Companion docs:** `stelavox_v1x_a1_build_checklist_v1_0.md` (Tier-B).
**Substrate baseline:** master at `6f1063e` (V1.x-A shipped 2026-05-13).

---

## 1. Scope verified

V1.x-A.1 scope per Director Architecture v2.1.0 §6:

- Project Profile data model (`project_profiles`, `profile_amendments`) — 1:1 with documents, persistent identity, never completes.
- Brief data model (`briefs`, `brief_stages`) — operation plan, one active at a time per document during V1.x-A.1, multiple over project life.
- Partial unique index `briefs(document_id) WHERE status IN ('planned','active')` enforces the one-Brief-at-a-time constraint.
- `lib/profile/` module: types, preferencesValidator (H-18), getProjectProfile, proposalBuilder, applyAmendment, RpcError.
- `lib/brief/` module: types, cycleDetector (H-19), getBriefState (active-Brief + by-id), proposalBuilder (n=1 trivial case allowed; stage 1 workflow required; stages 2..N may have workflow:null), rpcWrappers (acceptBrief, completeBriefStage, cancelBrief).
- Director tool registry V1.5: 16 tools. Adds `get_project_profile`, `propose_profile_amendment`; revises `get_brief_state` (now operation-level, returns null when no active Brief) and `propose_brief` (now operation-level). Drops `propose_brief_amendment` (Brief amendments deferred to V1.x-B).
- API routes: `GET /api/profile/[id]`, `POST /api/profile/amendments/approve`, `GET /api/brief/[id]`, `POST /api/brief/proposals/approve`, `POST /api/brief/[id]/cancel`, `POST /api/director/conversation/[id]/clear` (unchanged).
- UI: `ProjectProfileViewer` (project header), `ProjectProfileAmendmentCard` (conversation thread), revised `BriefProposalCard` (handles trivial-vs-multi-stage rendering), `StageCard` (unchanged), `ConversationClearButton` (unchanged).
- Director system prompt v1.5: unified single+multi-step path. **Every Director-driven unit of work creates a Brief.** No scope-threshold judgement. The n=1 trivial case is a degenerate Brief.

Out of scope (deferred to V1.x-B):
- Stage triggers firing automatically.
- Multi-Brief concurrency + soft node-reservation warnings.
- Brief amendments.
- Per-iteration Director-turn decomposition.
- Stage-trigger-invokes-Director.

---

## 2. Phase checkpoints

| CK | Criterion | Verdict | Evidence |
|---|---|---|---|
| CK-1 | Every document has a Project Profile (FK NOT NULL) | PASS | M-084 backfill + M-085 auto-create; Playwright `profile-and-brief-substrate.spec.ts:75/84`. |
| CK-2 | `get_project_profile` returns §6.1.3 shape | PASS | `:94` |
| CK-3 | One Brief at a time per document | PASS | `:125` — second `accept_brief` rejected with `another_brief_active`. Partial unique index works. |
| CK-4 | Trivial n=1 Brief flow works | PASS | `:125` first call accepts a 1-stage Brief; downstream RPC path verified. |
| CK-5 | Multi-stage Brief (n=2+) flow works | PASS | Unit test `v1x-a1-proposal-builders.test.ts` covers schema; substrate-level verification confirms accept_brief with multi-stage payload. End-to-end with stage-2 workflow attachment is V1.x-B work (just-in-time planning on stage activation). |
| CK-6 | Profile amendments work | PASS | `:105` — apply_profile_amendment mutates `preferences.constraints` + writes audit row. |
| CK-7 | Conversation rolling window | PASS | `agent.director_conversation_window_turns` config persisted from V1.x-A (M-076 / M-088 carries forward); `buildConversationContext` slicing unchanged. |
| CK-8 | Director executor regression | PASS | Type-check clean; tool-use protocol intact (SU-47 messages-array unchanged). |
| CK-9 | Pre-merge invariants | PASS | type-check 0 errors; lint 0 errors, 12 pre-existing warnings; build passes. |
| CK-10 | Shadow Protocol preserved | PASS | 1 doc preserved through M-079 rip; M-084 backfill auto-created empty Project Profile. Post-rework counts: 1 doc / 109 nodes / 1 profile / 0 briefs (V1.x-A's empty Brief dropped — was semantically equivalent to no-Brief). |
| CK-11 | Test Report + close-out | PASS | This document + project_v1x_a1_shipped memory + CLAUDE.md v1.24 → v1.25 bump. |

---

## 3. Test totals

**Unit tests (Vitest) — V1.x-A.1:**

| File | Cases |
|---|---|
| `tests/unit/v1x-a1-cycle-detector.test.ts` | 6 |
| `tests/unit/v1x-a1-preferences-validator.test.ts` | 13 |
| `tests/unit/v1x-a1-proposal-builders.test.ts` | 11 |
| `tests/unit/v1x-a1-parse-message-proposals.test.ts` | 4 |
| **Total V1.x-A.1 unit** | **34** |

All 34 pass in 555ms.

**Playwright tests — V1.x-A.1:**

| File | Cases | Wall |
|---|---|---|
| `tests/v1x-a1/profile-and-brief-substrate.spec.ts` | 8 | 15.4s |

All 8 pass.

---

## 4. Migrations shipped

| # | Filename | Purpose |
|---|---|---|
| 079 | `v1x_a_schema_drop.sql` | Rip V1.x-A schema: drop documents.brief_id FK + column, drop briefs / brief_stages / brief_amendments tables (CASCADE for inter-table FK), drop apply_brief_proposal + apply_brief_amendment RPCs, restore create_document_with_layer_stack to non-Brief-creating form. |
| 080 | `project_profiles_table.sql` | New project_profiles table + RLS. |
| 081 | `profile_amendments_table.sql` | Append-only audit log + RLS. |
| 082 | `briefs_table.sql` | New operation-level briefs table + partial unique index for one-at-a-time. |
| 083 | `brief_stages_table.sql` | New brief_stages with nullable workflow_id (just-in-time) + FK back to briefs.current_stage_id. |
| 084 | `documents_profile_id.sql` | documents.profile_id NOT NULL FK (deferrable) + Shadow Protocol backfill. |
| 085 | `create_document_with_profile.sql` | Extended RPC auto-creates Project Profile for every new document. |
| 086 | `v1x_a1_rpcs.sql` | 4 SECURITY DEFINER RPCs: apply_profile_amendment, accept_brief, complete_brief_stage, cancel_brief. |
| 087 | `realtime_publication.sql` | Realtime ADDs: project_profiles, briefs, brief_stages. |
| 088 | `director_v1_5_config.sql` | Director config v1.5 — Profile + Brief aware system prompt + 16-tool registry. |

Total: 10 migrations 079–088.

---

## 5. SU items raised during build

**None.** V1.x-A.1 inherits the substrate from V1.x-A (deferrable FK ordering, service-role RPC bypass, tsconfig exclude on scripts/step4-a11y) and applies them cleanly. The only operational surprise was a stale dev server reusing V1.x-A code under Playwright's `reuseExistingServer: true`; killed the process and Playwright restarted a fresh server — not a substrate issue.

Minor migration fix during apply:
- M-079 initially used `DROP TABLE ... ` without CASCADE; the briefs.current_stage_id FK to brief_stages blocked the table drop. Resolved by adding CASCADE to all three table-drop statements. Also removed unsupported `ALTER PUBLICATION ... DROP TABLE IF EXISTS` syntax — table drops automatically remove publication entries via CASCADE.

---

## 6. Deferred to V1.x-B (per locked scope)

- Multi-Brief concurrency (lift the partial unique index; add soft node-reservation warnings).
- Brief amendments (modify a Brief mid-execution rather than cancel+new).
- Stage triggers firing automatically (scheduler watches and invokes Director).
- Per-iteration Director-turn decomposition (V2 §8.1a).
- Stage-2..N workflow auto-planning on stage activation (currently user-prompted between stages).

---

## 7. Verdict

**V1.x-A.1 PASS.** All checkpoint criteria green at the substrate level. 34 Vitest + 8 Playwright tests passing. Shadow Protocol test project preserved through the migration. Director executor unchanged. Director-driven LLM flows gated by user-driven launch test per `project_launch_standard.md`. Five Inviolables intact. Verdigris-use count remains nine.

**The V1.x-A architectural mistake is fully corrected.** The Profile / Brief separation makes downstream phases (V1.x-B scheduler, V1.x-C cost meter, V1.x-D UI) straightforward to design against the right shape. Lesson recorded as `feedback_architectural_lesson_brief_split.md`.

---

## Changelog

**v1.0 — 2026-05-13** Initial V1.x-A.1 Test Report. PASS verdict.
