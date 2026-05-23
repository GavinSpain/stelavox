-- M-207 — director_turns rollup trigger fires on `state` transitions.
--
-- M-205 follow-on. The rollup trigger
-- `trg_director_turns_rollup_iteration` was defined in M-109 as
-- `AFTER UPDATE OF queue_status`. Post-Apollo (M-191..M-205) the
-- orchestration library writes the `state` column directly; the
-- auto-derive BEFORE trigger then derives `queue_status` as a
-- side-effect. But Postgres's column-restricted trigger
-- (`UPDATE OF queue_status`) checks the issued SET list of the UPDATE
-- statement, NOT the post-trigger NEW row. Since `state` is the only
-- column in the SET list, the rollup trigger never fires — every
-- director_turns row stays at `iteration_count = 0` and zero token
-- totals despite the per-iteration agent_jobs rows being correctly
-- populated.
--
-- Surfaced 2026-05-23 by a user-driven brief test
-- ("The Threshold in Act Three") completing cleanly but leaving both
-- director_turns rows at iteration_count = 0.
--
-- Fix: column-restrict on `state` instead. The WHEN clause filters to
-- the success path's terminal-ish state (`awaiting_accept`, where
-- the runner stamps tokens) and the failure paths (`failed`,
-- `crashed`, `cancelled`). The subsequent `awaiting_accept → accepted`
-- transition is NOT in the WHEN list, so we don't double-count
-- successful iterations.
--
-- The function body is unchanged — it reads NEW.actual_input_tokens
-- / NEW.actual_output_tokens / NEW.cost_credits which the runner
-- populates in the same UPDATE that transitions state to
-- awaiting_accept.

BEGIN;

DROP TRIGGER IF EXISTS trg_director_turns_rollup_iteration ON public.agent_jobs;

CREATE TRIGGER trg_director_turns_rollup_iteration
  AFTER UPDATE OF state ON public.agent_jobs
  FOR EACH ROW
  WHEN (
    NEW.operation_type = 'director_iteration'
    AND NEW.director_turn_id IS NOT NULL
    AND NEW.state IN ('awaiting_accept', 'failed', 'crashed', 'cancelled')
    AND OLD.state IS DISTINCT FROM NEW.state
  )
  EXECUTE FUNCTION director_turns_rollup_iteration();

COMMENT ON TRIGGER trg_director_turns_rollup_iteration ON public.agent_jobs IS
  'Apollo M-207: aggregates per-iteration tokens + cost into director_turns. '
  'Fires AFTER UPDATE OF state (post-Apollo, the orchestration library writes '
  'state directly; the M-109 column-restriction on queue_status never matched '
  'because UPDATE OF checks the issued SET list, not post-trigger NEW). The '
  'function body itself is unchanged from M-109.';

COMMIT;
