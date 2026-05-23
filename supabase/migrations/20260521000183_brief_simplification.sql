-- M-183 — Director simplification: drop the amendment surface.
--
-- Discovery context (2026-05-20 → 2026-05-21):
--   Four schema-vs-code drift bugs in 48 hours, all in the V1.x-B.3
--   amendment surface. Every push-model stage trigger silently failed
--   for five days because `propose_brief_amendment` was unreliable:
--     - briefs.preferences column drift (yesterday)
--     - target_path UUID-vs-stage_order drift (this morning)
--     - target_path UUID-vs-dotted-JSONPath drift (this afternoon)
--     - silent error swallowing that masked all of the above
--
--   The amendment surface had too much surface area: 5 amendment_types,
--   target_path with 3+ valid forms per the original doc-comment, 2
--   parallel approval card paths, an auto-approve flag that only
--   covered one of them. The LLM couldn't reliably hit the contract;
--   the author couldn't fit the model in their head.
--
-- New model:
--   - One active brief per document (restore the strict partial unique
--     index dropped in M-126).
--   - Each brief_stages row is either:
--       (a) workflow-bound at brief-proposal time (workflow_id set,
--           prompt NULL) — Director planned the workflow upfront
--           because all targets exist
--       (b) prompt-deferred (workflow_id NULL, prompt set) — the
--           stage's targets only become known once earlier stages
--           complete; the system plans this stage's workflow when
--           its trigger fires
--   - Workflow planning for prompt-deferred stages happens via a new
--     `propose_workflow` write tool (added in M-184 / Director v1.24).
--     The system intercepts the artefact, attaches it to brief_stages,
--     and (if brief.auto_approve_workflow_proposals = true) auto-
--     approves + dispatches. No amendment tool, no amendment table,
--     no second approval card surface.
--   - Trigger types narrowed to ('after_stage', 'manual') — drops
--     'scheduled_at' and 'compound' (never exercised in V1.x). The
--     trigger_config JSONB column stays so 'scheduled_at' can land
--     post-V1 without a schema change.
--
-- Database wipe before this migration: all scheduler/brief tables
-- were truncated (agent_jobs, director_turns, conversation_messages,
-- workflows, brief_amendments, brief_stages, briefs, etc.). Author
-- writing data (nodes, node_versions, projects, documents, context_*)
-- is preserved. Snapshot captured at
-- snapshots/stelavox_local_2026-05-21_pre_simplification.dump.

BEGIN;

-- 1. Drop the apply_brief_amendment RPC. Authored by M-128 (V1.x-B.3).
DROP FUNCTION IF EXISTS public.apply_brief_amendment(uuid);

-- 2. Drop the brief_amendments table. RLS policies + indexes + triggers
--    cascade. No FK from other tables (the amendments table is a leaf).
DROP TABLE IF EXISTS public.brief_amendments CASCADE;

-- 3. brief_stages — add `prompt` column for the deferred-planning case.
--    Nullable; the new CHECK constraint requires non-null when
--    workflow_id is null at planning time.
ALTER TABLE public.brief_stages ADD COLUMN IF NOT EXISTS prompt TEXT;

-- 4. brief_stages — add CHECK constraint: a non-completed stage must
--    have AT LEAST ONE of (workflow_id, prompt). Completed/cancelled/
--    skipped stages are exempt because legacy rows (pre-M-183) had no
--    prompt column. The application layer ensures the constraint is
--    met for new rows.
ALTER TABLE public.brief_stages
  ADD CONSTRAINT brief_stages_planning_source_check
  CHECK (
    status IN ('completed', 'cancelled', 'skipped')
    OR workflow_id IS NOT NULL
    OR prompt IS NOT NULL
  );

-- 5. brief_stages — narrow trigger_type CHECK to (after_stage, manual).
ALTER TABLE public.brief_stages
  DROP CONSTRAINT IF EXISTS brief_stages_trigger_type_check;
ALTER TABLE public.brief_stages
  ADD CONSTRAINT brief_stages_trigger_type_check
  CHECK (trigger_type IN ('after_stage', 'manual'));

-- 6. brief_stages — narrow status CHECK. The amendment-era 'proposing'
--    state is now redundant (no amendment workflow); replace it with a
--    single 'planning' state for prompt-deferred stages whose workflow
--    is being planned by the system. Other states unchanged.
--
--    'proposing'  → 'planning'  (terminology aligns with the new model)
--    Other states retained: planned, approved, scheduled, running,
--                           completed, cancelled, skipped.
--
--    (Wipe ensured no rows in 'proposing' state survive this migration.)
ALTER TABLE public.brief_stages
  DROP CONSTRAINT IF EXISTS brief_stages_status_check;
ALTER TABLE public.brief_stages
  ADD CONSTRAINT brief_stages_status_check
  CHECK (status IN (
    'planned',
    'planning',
    'approved',
    'scheduled',
    'running',
    'completed',
    'cancelled',
    'skipped'
  ));

-- 7. Restore strict-one-active partial unique index on briefs. M-126
--    dropped this for V1.x-B.3's multi-active feature; the simplified
--    model is one active brief per document.
CREATE UNIQUE INDEX IF NOT EXISTS briefs_strict_one_active_per_document_uidx
  ON public.briefs (document_id)
  WHERE status IN ('planned', 'active');

-- 8. Drop the dispatcher's now-stale referential constraint to
--    brief_amendments if it exists. Belt and braces — the CASCADE on
--    step 2 should have handled this.
--    (No-op if no such constraint.)

COMMIT;
