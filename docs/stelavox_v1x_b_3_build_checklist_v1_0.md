# Stelavox V1.x-B.3 — Tier-B Build Checklist
## Concurrent multi-Brief + Brief amendments
## Version 1.0

> **Status: DRAFT.** Authored 2026-05-16 alongside V1.x-C/D/E/F checklists in lockstep, immediately after V1.x-B.2 ship to master at `02dcbd7`. Tighter form than B.2's checklist (B.2 carved out the per-CK-boundary-case enumeration; B.3 inherits the same pattern for the in-scope features only).

---

## §1 — Scope and goals

V1.x-B.3 lifts two locked V1.x-B.1.1 holding-pattern constraints:

1. **Multi-Brief concurrency**. V1.x-B.1.1 enforced one-Brief-at-a-time per document via the partial unique index `briefs(document_id) WHERE status IN ('planned','active')`. V1.x-B.3 drops that constraint. Multiple Briefs may be `active` on the same document concurrently. Soft node-reservation warnings surface at proposal time when two active Briefs target overlapping nodes (Director sees "node X is already in active Brief Y; proceeding will create concurrent edits").
2. **Brief amendments**. V1.x-B.1.1 supported `propose_brief` (create) but not `propose_brief_amendment` (modify in-flight). V1.x-B.3 ships the amendment RPC + Director tool + UI surface for editing an active Brief's `goal_text` / `preferences` / pending-stage roadmap.

### What V1.x-B.3 does NOT ship

- Cross-document Brief concurrency (already supported — V1 always allowed one Brief per doc; the constraint was per-doc not per-org)
- Brief amendments that retroactively edit completed stages (out of scope; locked completed stages are immutable)
- UI surfaces for choosing between concurrent Briefs in DirectorPanel (deferred to V1.x-D — DirectorPanel currently shows the most-recent Brief; B.3 keeps that behavior)

### Sequencing

V1.x-B.3 is **single sub-phase** (no internal split). One worktree branch (`claude/v1x-b-3-multibrief`), one merge to master with `--no-ff`. Estimated 1-2 sessions.

---

## §2 — Migrations (3, 126-128)

- **M-126 — `briefs_drop_one_active_index`**:
  ```sql
  DROP INDEX IF EXISTS briefs_one_active_per_document_idx;
  ```
  The partial unique index from M-091 enforced `WHERE status='active'` uniqueness per document_id. Drops it. The `accept_brief` RPC's pre-check for "another_brief_active" (M-097/M-098) is removed in M-128 — V1.x-B.3 intentionally allows concurrent Briefs.

- **M-127 — `brief_amendments_table_v2`**:
  ```sql
  CREATE TABLE brief_amendments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    proposed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    amendment_type TEXT NOT NULL CHECK (amendment_type IN (
      'goal_text', 'preferences', 'add_stage', 'modify_pending_stage', 'remove_pending_stage'
    )),
    target_path TEXT NULL,
    before JSONB NULL,
    after JSONB NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
    approved_at TIMESTAMPTZ NULL,
    approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
  );
  CREATE INDEX brief_amendments_brief_status_idx
    ON brief_amendments(brief_id, status);
  ALTER TABLE brief_amendments ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "org_members_access_brief_amendments" ON brief_amendments
    FOR ALL USING (
      brief_id IN (
        SELECT id FROM briefs
        WHERE organisation_id IN (
          SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
        )
      )
    );
  ALTER PUBLICATION supabase_realtime ADD TABLE brief_amendments;
  ```
  Note: V1.x-A had a `brief_amendments` table dropped by V1.x-A.1 M-079. This is a fresh table with the V1.x-B.3 shape (operation-level amendments only; profile-level amendments stay on `profile_amendments`).

- **M-128 — `apply_brief_amendment_rpc + accept_brief_revised`**:
  - `apply_brief_amendment(p_amendment_id UUID) RETURNS JSONB` SECURITY DEFINER — applies an `approved` amendment to the parent Brief atomically. For `goal_text`/`preferences`: UPDATE briefs SET ...; for `add_stage`: INSERT brief_stages; for `modify_pending_stage`/`remove_pending_stage`: UPDATE/DELETE brief_stages WHERE status='planned' (already-running stages immutable).
  - `accept_brief` revised: drop the `another_brief_active` pre-check; allow multiple active Briefs per document. The function still INSERTs new Briefs in 'active' status when no Brief is currently active, OR 'queued' when one IS active **AND the user explicitly opted into queueing** (preserves V1.x-B.1.1 sequential queue UX as an option). Actually no — for B.3 we drop the queue concept entirely; concurrent Briefs are first-class. Queued status stays in the enum for backward compat but no longer auto-promoted.
  - All include `SET search_path = public` per H-13.

---

## §3 — Library

- **NEW `lib/brief/amendments.ts`** — types + proposal builder + RPC wrappers (`proposeAmendment`, `applyAmendment`); validation:
  - `goal_text`: max 4096 chars
  - `preferences`: shape-validated against the same H-18-compliant validator as M-097 brief preferences
  - `add_stage`: stage `order` must be > current_stage_id's order; stage shape valid
  - `modify_pending_stage`: target stage must exist + status='planned'
  - `remove_pending_stage`: same; refuse if it's the only remaining stage (defensive)

- **MODIFY `lib/director/tool-definitions.ts`** — add `propose_brief_amendment` write-tool (Director registry version V1.9 — 18 tools = V1.8's 17 + propose_brief_amendment). Same propose-only invariant as other write tools (H-08): the tool returns `WriteToolResult` with `brief_amendment_proposal` artefact; the user approves via UI before `apply_brief_amendment` RPC fires.

- **MODIFY `lib/director/iteration-runner.ts`** — accumulator + end-of-turn parser handles `brief_amendment_proposal` artefact analogous to existing `brief_proposal` / `profile_amendment_proposal` / `brief_cancellation_proposal` paths.

- **NEW `lib/brief/nodeReservationWarnings.ts`** — soft warning helper. At `propose_brief` validation time, the proposal-builder checks each stage's workflow steps for `target_node_id`; if any node is already a target of any active Brief on the same document, attach a `concurrent_edit_warning` field to the proposal artefact so the Director surfaces it to the user pre-approval.

- **MODIFY `lib/brief/proposalBuilder.ts`** — call `nodeReservationWarnings` during validation; include the warning in the returned `BriefProposalArtefact`.

---

## §4 — UI

- **NEW `components/director/BriefAmendmentCard.tsx`** — renders in conversation thread when iteration emits `brief_amendment_proposal`. Single Approve button (verdigris use #7 — affirmative-action triggers family, no broadening). Shows before/after diff for the targeted field. POST `/api/brief/amendments/approve` on click.

- **MODIFY `components/director/BriefViewer.tsx`** — show "Concurrent Briefs" indicator when >1 active Brief on document (subtle banner: "2 active Briefs — view all in scheduler"). Click → `/projects/[id]/documents/[id]/scheduler` with active-Briefs filter.

- **MODIFY `components/scheduler/SchedulerPanel.tsx`** — Active Briefs section already shows the most-recent Brief; in B.3 it shows ALL active Briefs, each with its current stage + agent_jobs.

---

## §5 — API routes

- **NEW `POST /api/brief/amendments/propose`** — accepts the proposal artefact from a Director write tool execution; INSERTs into brief_amendments at status='proposed'.
- **NEW `POST /api/brief/amendments/[id]/approve`** — calls `apply_brief_amendment` SECURITY DEFINER RPC; returns the resulting Brief state.
- **NEW `POST /api/brief/amendments/[id]/reject`** — sets status='rejected'.

---

## §6 — Tests

- 6 unit tests on `lib/brief/amendments.ts` validators (goal_text length; preferences shape; add_stage order; modify/remove_pending_stage status check; nodeReservationWarnings concurrent-Brief detection)
- 8 Playwright integration: M-126 drop verified (insert two active Briefs on same doc succeeds); M-127 brief_amendments CRUD; M-128 apply_brief_amendment for each amendment_type (goal_text update + preferences merge + add_stage + modify_pending_stage + remove_pending_stage); accept_brief revised allows concurrent active Briefs; nodeReservationWarnings surfaces in BriefProposalArtefact

---

## §7 — Acceptance criteria (per CK)

| CK | What it proves | Method |
|---|---|---|
| CK-1 | M-126 drops the index — two active Briefs allowed | Insert two Briefs with status='active' on same doc → both succeed |
| CK-2 | apply_brief_amendment(goal_text) updates the Brief atomically | RPC + read-back |
| CK-3 | apply_brief_amendment(add_stage) appends a new stage | RPC + brief_stages count |
| CK-4 | apply_brief_amendment refuses to modify already-running stage | RPC returns error; stage row unchanged |
| CK-5 | propose_brief surfaces concurrent-edit warnings | proposal artefact contains `concurrent_edit_warning` |
| CK-6 | BriefAmendmentCard renders + approve flow works | Playwright: render + click + POST + Brief state updates |
| CK-7 | Type-check / lint / build clean; V1.x-B.2 regression PASS | CI |
| CK-Inviol | Verdigris use count = 9 | Audit (BriefAmendmentCard Approve falls under existing use #7) |

---

## §8 — Sign-off

V1.x-B.3 PASSES when:
1. Migrations 126-128 applied locally without error
2. CK-1 through CK-7 + CK-Inviol all green
3. Type-check + lint + build green; V1.x-A.1 + V1.x-B.1.1 + V1.x-B.1.2 + V1.x-B.2 regression intact
4. Test Report `stelavox_v1x_b_3_test_report_v1_0.md` PASS verdict
5. Tier-A docs bumped: TA v2.4 → v2.5 (in-file changelog); Director Architecture v2.2 → v2.3 (multi-Brief + amendments paragraph in §6); Component Spec v2.11 → v2.12 (BriefAmendmentCard + BriefViewer concurrent indicator); CLAUDE.md → v1.30
6. Merge to master with `--no-ff`; tag `v1.x-b.3`
7. MEMORY.md updated with `project_v1x_b_3_shipped.md`

---

## Changelog

**v1.0 — 2026-05-16** Initial draft. Authored alongside V1.x-C/D/E/F checklists in lockstep after V1.x-B.2 ship.
