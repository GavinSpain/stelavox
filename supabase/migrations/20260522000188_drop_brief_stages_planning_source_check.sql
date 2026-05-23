-- M-188 — drop brief_stages_planning_source_check.
--
-- The CHECK constraint added in M-183 fires too early: accept_brief
-- inserts brief_stages rows BEFORE the workflow row exists (workflow
-- creation happens after, in the /api/brief/proposals/approve route
-- handler — at which point brief_stages.workflow_id is UPDATEd to
-- point at the freshly-created workflow). For workflow-bound stages
-- the transient state is:
--
--     status='planned' AND workflow_id IS NULL AND prompt IS NULL
--
-- which violates the constraint. User surfaced this on the first
-- Approve click against a real Brief proposal on 2026-05-22 with the
-- error "new row for relation 'brief_stages' violates check
-- constraint 'brief_stages_planning_source_check'".
--
-- Options considered:
--   (a) Rewrite accept_brief to create workflows inline so workflow_id
--       is set at INSERT time. Atomic; cleanest. But invasive — the
--       RPC body grows substantially and the route handler simplifies.
--   (b) Make the CHECK DEFERRABLE. PostgreSQL doesn't support
--       deferred CHECK constraints natively.
--   (c) Add a placeholder prompt for workflow-bound stages at INSERT
--       and clear it after workflow_id lands. Hacky; introduces
--       sentinel values into a real column.
--   (d) DROP the constraint. The XOR-or-set invariant is already
--       enforced at the application layer by:
--           - lib/director/schemas.ts:_ProposalStageSchema (.refine)
--           - lib/brief/proposalBuilder.ts:StageInputSchema (.refine)
--       Drift between the two is now caught by the round-trip test
--       at tests/unit/v1x-a1-proposal-builders.test.ts.
--
-- Going with (d) for now. (a) is the right answer for the polish
-- phase — it removes a multi-statement flow from the route handler
-- and makes accept_brief atomic. Tracked as follow-up.

BEGIN;

ALTER TABLE public.brief_stages
  DROP CONSTRAINT IF EXISTS brief_stages_planning_source_check;

-- Documentation: the invariant the constraint enforced is preserved
-- in application code:
--
-- A non-terminal brief_stages row (status not in 'completed',
-- 'cancelled', 'skipped') must have at least one of:
--   - workflow_id IS NOT NULL  → the stage's workflow exists, ready
--     to dispatch when its trigger fires
--   - prompt IS NOT NULL       → the stage is prompt-deferred; the
--     push-model evaluator invokes the Director with the prompt
--     when the trigger fires, and the Director responds with
--     propose_workflow
--
-- Both lib/director/schemas.ts:BriefProposalV1xA1Schema and
-- lib/brief/proposalBuilder.ts:ProposeBriefInputSchema apply a Zod
-- .refine() implementing the XOR. The /api/brief/proposals/approve
-- route runs BOTH schemas before calling accept_brief.

COMMIT;
