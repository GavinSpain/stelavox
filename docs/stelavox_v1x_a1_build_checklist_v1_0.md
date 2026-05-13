# Stelavox — V1.x-A.1 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for V1.x-A.1 build. The architectural correction to V1.x-A that splits the conflated `briefs` table into **Project Profile** (persistent identity) and **Brief** (operation plan). Architectural source: `docs/stelavox_director_architecture_v2_1_0.md` §6 (Project Profile + Brief). Companion to (future) `stelavox_v1x_a1_test_report_v1_0.md`. Source of truth for what gets re-built and in what order.

**Phase:** V1.x-A.1 — Brief substrate re-architecture. Splits the V1.x-A `briefs` table into Project Profile (1:1 with documents, persistent identity, never completes) and Brief (operation plan, one active at a time per document during V1.x-A.1, multiple in V1.x-B+).

**Substrate at V1.x-A.1 start:** master HEAD `6f1063e` (V1.x-A merged 2026-05-13 + Director Architecture v2.1.0 + TA v2.3.2 + CLAUDE.md v1.24 doc rework). Local DB on the busy-colden-6c14b0 worktree has migrations 070–078 applied; data state is 1 document (Shadow Protocol), 60 nodes (incl. 22 beats), 1 empty Brief row from M-074 backfill, 0 brief_stages, 0 brief_amendments. Pre-rework snapshot at `snapshots/stelavox_local_2026-05-13_pre_v1x_a1_rework.dump` (6.7 MB, captured 2026-05-13 19:02).

**Decisions locked in 2026-05-13 conversation:**

1. **Project Profile + Brief separation.** Two artefacts, two tables, two lifecycles.
2. **Naming Option B.** *Brief* = operation plan; *Project Profile* = persistent identity.
3. **Unified single+multi-step path.** Every Director-driven unit of work creates a Brief. The n=1 case (one stage, one workflow, possibly one step) is just a degenerate Brief.
4. **One active Brief per document at a time** during V1.x-A.1. Partial unique index enforces it. Multi-Brief concurrency is V1.x-B work.
5. **No Brief amendments in V1.x-A.1.** To revise a Brief, cancel + propose new.
6. **Clean break on the V1.x-A schema** — no real user data; only Shadow Protocol on local dev. Migrations rip + recreate, preserving the document and its node tree.

---

## 1. Pre-Build Prerequisites

### PB-1 — Worktree and branch

Currently on `claude/busy-colden-6c14b0` (post-V1.x-A merge). V1.x-A.1 work continues on the same worktree.

### PB-2 — Supabase stack health

```
supabase status     # all services healthy
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:54331/auth/v1/health
```

Stop `supabase_vector_stelavox_2` if it appears in `docker ps` — known restart-loop issue (see `feedback_supabase_stop_no_backup.md`).

### PB-3 — Snapshot before any migration runs

Already captured: `snapshots/stelavox_local_2026-05-13_pre_v1x_a1_rework.dump`. Any further snapshot taken mid-build is a no-op insurance.

### PB-4 — V1.x-A.1 spec library in source

```
ls docs/stelavox_director_architecture_v2_1_0.md       # exists; v2.1.0
ls docs/stelavox_technical_architecture_v2_3.md        # v2.3.2 (in-file changelog entry)
grep -m1 "## Version 1.24" CLAUDE.md
diff CLAUDE.md docs/CLAUDE_stelavox_project.md         # empty diff
```

### PB-5 — Type baseline + tests green for V1.x-A

```
npm run type-check     # exit 0 (V1.x-A baseline)
npm run lint           # 0 errors
npm run build          # passes
npm run test:unit -- tests/unit/v1x-a-*.test.ts   # 37 pass
```

This confirms the V1.x-A code is healthy before V1.x-A.1 disassembles it.

### PB-6 — Cheap-model override

Per `feedback_haiku_default.md`, all LLM testing uses Haiku 4.5. Director config v1.4 currently in production; v1.5 will replace it as part of M-088.

---

## 2. Phase Checkpoint Criteria

V1.x-A.1 is COMPLETE when all CKs are green.

### CK-1 — Project Profile is 1:1 with documents

Every document row has a non-null `profile_id` pointing at a `project_profiles` row. Verified via Playwright: existing Shadow Protocol document has a profile; freshly-created documents auto-get a profile via the extended `create_document_with_layer_stack` RPC.

### CK-2 — `get_project_profile` returns the §6.1.3 shape

The Director reads the profile via `get_project_profile`. Returns `{ goal_text, preferences, recent_amendments[] }`. No stages, no brief-level data in the response.

### CK-3 — One Brief at a time per document (V1.x-A.1)

Partial unique index `briefs(document_id) WHERE status IN ('planned','active')` blocks a second active Brief. Test verifies that a second `propose_brief` against the same document while one is already active fails clean (constraint violation surfaced as a structured error).

### CK-4 — Trivial Brief (n=1) flow works

A request like *"refine this scene"* produces a Brief with 1 stage containing 1 workflow with 1 step. The user can approve and execute end-to-end. No special UX paths — just a small Brief.

### CK-5 — Multi-stage Brief (n=2+) flow works

A request like *"create chapters and scenes for act 2"* produces a Brief with 2 stages. Stage 1's workflow is planned in full at proposal time; stage 2's `workflow_id` is null until activated. After stage 1 completes, the user re-prompts (V1.x-A.1 — no scheduler yet); the Director plans stage 2's workflow and attaches it to the Brief.

### CK-6 — Profile amendments work

The Director proposes a `<profile_amendment_proposal>` when the user states a durable preference. On approval, `apply_profile_amendment` writes the audit row and mutates `preferences`.

### CK-7 — Conversation rolling window still works

`agent.director_conversation_window_turns` config carries over from V1.x-A. The Director's prompt includes only the last N turns. Profile + Brief carry the durable load.

### CK-8 — Director executor regression

Existing Director tool-use protocol (SU-47 messages-array) unchanged. Existing tests pass.

### CK-9 — Pre-merge invariants

```
npm run type-check     # exit 0
npm run lint           # 0 errors
npm run build          # passes
diff CLAUDE.md docs/CLAUDE_stelavox_project.md   # empty
```

### CK-10 — Shadow Protocol preserved through migration

Pre-rework: 1 document, 60 nodes, 22 beats with prose, 1 empty Brief row.
Post-rework: 1 document (same UUID), 60 nodes (same), 22 beats with prose (same), 1 empty Project Profile row (new), 0 Briefs (the empty V1.x-A Brief is dropped — it had no semantic content).

### CK-11 — Test Report + close-out

`stelavox_v1x_a1_test_report_v1_0.md` records every CK as PASS or explicit deferral. CLAUDE.md bumps to v1.25 (or stays at v1.24 if doc and code lands in the same version).

---

## 3. Ordered Task List

### 3.1 Migrations — rip V1.x-A schema + create V1.x-A.1 schema

#### T-1.1 — Migration 079: rip V1.x-A schema

`supabase/migrations/20260513000079_v1x_a_schema_drop.sql`:

- DROP `documents_brief_id_fk` constraint.
- ALTER documents DROP COLUMN brief_id (preserves the row; just removes the column + FK).
- DROP TABLE brief_amendments.
- DROP TABLE brief_stages.
- DROP TABLE briefs.
- DROP FUNCTION apply_brief_proposal(...).
- DROP FUNCTION apply_brief_amendment(...).
- REMOVE briefs + brief_stages from supabase_realtime publication.
- Restore `create_document_with_layer_stack` to its pre-M-074 form temporarily (M-085 will re-extend it for Profile).

Comment header explains: V1.x-A.1 architectural correction per Director Architecture v2.1.0; no real user data is lost (Shadow Protocol's V1.x-A Brief was empty).

#### T-1.2 — Migration 080: project_profiles table

Creates the table per §6.1.2 schema. RLS policy `org_members_access_project_profiles` (FOR ALL USING org check, matching existing convention).

#### T-1.3 — Migration 081: profile_amendments table

Creates the table per §6.1.2. RLS read-only via profile→organisation; writes happen through SECURITY DEFINER RPC.

#### T-1.4 — Migration 082: briefs table (new shape)

Creates the table per §6.2.2 schema:
- Includes the partial unique index `briefs_one_active_per_document_uidx ON briefs(document_id) WHERE status IN ('planned','active')`.
- status CHECK constraint admits the new 4-value enum.
- Standard `org_members_access_briefs` RLS.

#### T-1.5 — Migration 083: brief_stages table (revised)

Per §6.2.2. `workflow_id` column is FK to workflows, nullable. Standard RLS via brief→organisation.

#### T-1.6 — Migration 084: documents.profile_id NOT NULL FK (deferrable)

- ADD COLUMN brief_id UUID — wait no, profile_id.
- Backfill: for each existing document, insert a Project Profile row, then UPDATE documents.profile_id.
- ALTER COLUMN profile_id SET NOT NULL.
- ADD CONSTRAINT documents_profile_id_fk REFERENCES project_profiles(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED.
- CREATE UNIQUE INDEX documents_profile_id_unique.

Shadow Protocol gets its Project Profile created here.

#### T-1.7 — Migration 085: extend create_document_with_layer_stack for Profile

Same pattern as M-074 but now creates `project_profiles` instead of `briefs`. Atomic in one transaction; returns `{ document, layer_stack, root_node, project_profile }`.

#### T-1.8 — Migration 086: SECURITY DEFINER RPCs

- `apply_profile_amendment(p_profile_id, p_amendment_type, p_target_path, p_after, p_reason)` — mirrors V1.x-A's apply_brief_amendment but writes to profile_amendments and mutates project_profiles.preferences (or goal_text). Service-role bypass; org-member check for authenticated callers.
- `accept_brief(p_document_id, p_goal_text, p_stages, p_first_stage_workflow_steps)` — atomic: inserts briefs row with status='planned', inserts brief_stages rows, optionally inserts the workflow + workflow_steps for stage 1 (just-in-time planning is fine for stages 2..N).
- `complete_brief_stage(p_stage_id)` — transitions a stage status to 'completed', advances briefs.current_stage_id to the next stage in order, marks Brief 'completed' if last stage.
- `cancel_brief(p_brief_id)` — transitions Brief status to 'cancelled'; releases the partial unique index slot.

#### T-1.9 — Migration 087: realtime publication ADDs

ALTER PUBLICATION supabase_realtime ADD TABLE project_profiles, briefs, brief_stages.

#### T-1.10 — Migration 088: Director config v1.5

- Deprecate v1.4.
- Insert v1.5 with new system prompt body (from `prompts/director_v1_5_system_prompt.md` — see T-2.1).
- tool_suite array: `[get_project_profile, get_brief_state, get_document_state, get_node, get_nodes_by_layer, get_node_tree, assess_downstream_impact, get_workflow_history, create_expand_step, create_synthesise_step, create_refine_step, create_context_step, create_comment_step, create_node_reorder_step, propose_brief, propose_profile_amendment]` — 16 tools.
- Model config carried from v1.4.

#### T-1.11 — Apply migrations + regenerate types

```
supabase migration up --local
supabase gen types typescript --local 2>/dev/null > lib/types/database.ts
npm run type-check
```

Verify Shadow Protocol data state per CK-10.

### 3.2 Director system prompt v1.5

#### T-2.1 — Author `prompts/director_v1_5_system_prompt.md`

Based on v1.4 but with the new tools + Profile/Brief model:

- "The Brief" section split into "The Project Profile" + "The Brief".
- Project Profile: persistent identity; read at every substantive turn; amend via `propose_profile_amendment` when user states durable preferences.
- Brief: operation plan; created for EVERY Director-driven unit of work; trivial n=1 case is just a small Brief; no scope threshold.
- Stage workflow planning: stage 1's workflow planned at proposal time; stages 2..N have triggers but no workflow until activated.
- One Brief at a time during V1.x-A.1 — if `get_brief_state` returns non-null active Brief, the Director either continues that Brief or proposes a cancel-and-replace.

### 3.3 Library module — split lib/brief/ into lib/profile/ + lib/brief/

#### T-3.1 — `lib/profile/types.ts`, `lib/profile/preferencesValidator.ts`, `lib/profile/getProjectProfile.ts`, `lib/profile/applyAmendment.ts`, `lib/profile/proposalBuilder.ts`, `lib/profile/index.ts`

Profile-side helpers. preferencesValidator is lifted from lib/brief/ — same H-18 mitigation.

#### T-3.2 — `lib/brief/types.ts` (revised)

Brief now = operation plan. Schema types match the new briefs/brief_stages.

#### T-3.3 — `lib/brief/cycleDetector.ts`

Carries over unchanged (H-19 mitigation — same logic for stage trigger cycles).

#### T-3.4 — `lib/brief/proposalBuilder.ts` (revised)

`buildBriefProposal` takes operation goal_text + stages[1+] + (optional) first-stage workflow steps. Validates: stage order uniqueness, after_stage refs, trigger cycles. Stage 1's workflow is required; later stages optional (just-in-time).

#### T-3.5 — `lib/brief/getBriefState.ts` (revised)

Returns the currently-active Brief for the document (or null). Joined with brief_stages.

#### T-3.6 — `lib/brief/acceptBrief.ts`, `lib/brief/completeBriefStage.ts`, `lib/brief/cancelBrief.ts`

Thin wrappers around the new RPCs.

### 3.4 Director tool registry V1.5

#### T-4.1 — `lib/director/schemas.ts` revised

- Replace `propose_brief_amendment` with `propose_profile_amendment`.
- Revise `propose_brief` shape (operation-level: goal_text required, stages[1+], stage 1 workflow inline).
- Keep `get_brief_state` schema (revised semantics).
- Add `get_project_profile` schema.
- Update WorkflowProposal / BriefProposal / ProfileAmendmentProposal Zod schemas.

#### T-4.2 — `lib/director/tools/read.ts` revised

- New `execGetProjectProfile` (delegates to lib/profile/getProjectProfile).
- Revised `execGetBriefState` (delegates to lib/brief/getBriefState).

#### T-4.3 — `lib/director/tools/write.ts` revised

- Rename + revise `execProposeBrief` for operation-level shape.
- Replace `execProposeBriefAmendment` with `execProposeProfileAmendment`.
- Verify Profile exists check + active Brief check (one-at-a-time enforcement at planning time).

#### T-4.4 — `lib/director/tools/index.ts` revised

Tool list updated. Tool executors map updated. 16 tools total.

### 3.5 Executor + Suppression updates

#### T-5.1 — `lib/director/executor.ts`

- Replace `brief_amendment_proposal` TurnEvent with `profile_amendment_proposal`.
- Replace `<brief_amendment_proposal>` suppression tag with `<profile_amendment_proposal>`.
- WriteToolResult shape: drop brief_amendment_proposal, add profile_amendment_proposal.

#### T-5.2 — `lib/director/parse-message-proposals.ts`

Replace brief_amendment_proposal parsing with profile_amendment_proposal.

### 3.6 API routes

#### T-6.1 — Profile routes

- `GET /api/profile/[id]` — RLS-gated read, returns Profile state.
- `POST /api/profile/amendments/approve` — applies a `<profile_amendment_proposal>`.

#### T-6.2 — Brief routes (revised semantics)

- `GET /api/brief/[id]` — returns specific Brief by id (operation-level).
- `POST /api/brief/proposals/approve` — accepts a `<brief_proposal>`; calls accept_brief RPC.
- `POST /api/brief/[id]/cancel` — cancels an active Brief (releases the partial unique index slot).
- `POST /api/brief/stages/[id]/complete-workflow` — attaches a just-in-time-planned workflow to a stage that has activated.

#### T-6.3 — Delete old routes

- `app/api/brief/amendments/` directory — removed.
- The old `POST /api/brief/proposals/approve` semantics replaced (now operation-level).

#### T-6.4 — Unchanged

- `POST /api/director/conversation/[conversationId]/clear` — Brief clears conversation, retains Profile + Brief.

### 3.7 UI components

#### T-7.1 — `components/director/ProjectProfileViewer.tsx`

Was `BriefViewer.tsx`. Same surface (project header read-only panel) but now reads from Profile. Realtime subscription on `project_profiles` and `profile_amendments`.

#### T-7.2 — `components/director/ProjectProfileAmendmentCard.tsx`

Was `BriefAmendmentCard.tsx`. Same structure — renders a `<profile_amendment_proposal>` artefact with Approve button (verdigris use #7).

#### T-7.3 — `components/director/BriefProposalCard.tsx` (revised)

New semantics:
- Receives an operation-level Brief proposal (goal_text + stages[1+] + first-stage workflow).
- For trivial n=1 (one stage, one workflow): collapsed UI — shows the workflow steps directly with single Approve.
- For multi-stage (n=2+): shows stage list + first-stage workflow steps; second-and-later stages show title/description/trigger only (no workflow yet).
- Single Approve button (verdigris use #7).

#### T-7.4 — `components/director/BriefViewer.tsx` (NEW — operation-level)

Shows the currently-active Brief. Mounted in the DirectorPanel header (or below Profile in project header — design call). Displays current stage status, stage progression, and surfaces the Cancel option when active.

#### T-7.5 — `components/director/StageCard.tsx`

Carries over largely unchanged. May need small updates for `workflow_id` nullability (stages 2..N show "workflow pending" until activated).

#### T-7.6 — `components/director/ConversationClearButton.tsx`

Unchanged.

#### T-7.7 — `components/director/DirectorPanel.tsx`

- Replace `briefId` prop with `profileId` for Profile context.
- Conversation-thread proposal rendering: now handles `<brief_proposal>` (operation-level) and `<profile_amendment_proposal>`.
- `renderBriefSlot` callback revised; new `renderProfileAmendmentSlot` callback.

#### T-7.8 — Document page

`app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` — replaces BriefViewer with ProjectProfileViewer. New optional BriefViewer mount.

### 3.8 Tests

#### T-8.1 — Vitest unit tests update

- `tests/unit/v1x-a1-preferences-validator.test.ts` (renamed/updated from v1x-a)
- `tests/unit/v1x-a1-cycle-detector.test.ts` (same logic, validates against new schemas)
- `tests/unit/v1x-a1-proposal-builder.test.ts` — both Brief proposal + Profile amendment proposal
- `tests/unit/v1x-a1-parse-message-proposals.test.ts` — three artefact types

Delete the V1.x-A `v1x-a-*.test.ts` files.

#### T-8.2 — Playwright integration test

- `tests/v1x-a1/profile-and-brief-substrate.spec.ts` — comprehensive end-to-end:
  - Profile auto-creation on document creation
  - GET /api/profile/[id] shape
  - apply_profile_amendment RPC
  - accept_brief RPC + partial unique index enforcement (second active Brief blocked)
  - Brief lifecycle: planned → active → completed
  - Stage just-in-time workflow attachment
  - cancel_brief releases the partial index

Delete the V1.x-A `tests/v1x-a/brief-substrate.spec.ts`.

#### T-8.3 — Regression

Run the broader unit suite to confirm V1.x-A.1 doesn't break anything.

### 3.9 Close-out

#### T-9.1 — Test Report

Author `docs/stelavox_v1x_a1_test_report_v1_0.md`.

#### T-9.2 — CLAUDE.md v1.24 → v1.25 (or keep v1.24)

Decision deferred to close-out — depends on whether doc-only v1.24 and code-rework should be one bump or two.

#### T-9.3 — Memory updates

- New `project_v1x_a1_shipped.md`.
- `project_v1x_a_shipped.md` retitled as historical snapshot.
- `feedback_architectural_lesson_brief_split.md` — the lesson learned.

#### T-9.4 — Merge to master

Single merge commit with full V1.x-A.1 summary.

---

## 4. Changelog

**v1.0 — 2026-05-13** Initial version. Frozen for V1.x-A.1 build per Director Architecture v2.1.0 §6 + CLAUDE.md v1.24 changelog entry.
