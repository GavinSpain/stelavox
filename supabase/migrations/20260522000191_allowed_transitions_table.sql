-- M-191 — Apollo-grade state machine: allowed_transitions table.
--
-- The canonical source of truth for every legal state transition in the
-- orchestration layer. The BEFORE UPDATE trigger applied to each entity
-- in M-192..M-197 consults this table; if (OLD.state, NEW.state) is not
-- here, the UPDATE is refused with an exception.
--
-- This makes the state machine PHYSICALLY ENFORCED rather than just
-- documented. Application code cannot drift from the spec; bad
-- transitions raise check_violation at the DB layer.
--
-- Source of truth for transition catalogue:
--   docs/stelavox_brief_orchestration_v1_0.md §11 (formal transition tables)
--   docs/stelavox_brief_orchestration_phase0_design_v1_0.md §2 (seed data)
--
-- This migration creates the table + the shared enforcement function +
-- seeds all 53 transitions. The per-entity columns + triggers land in
-- M-192..M-197. (53 transitions: briefs 2 + brief_stages 11 + workflows 9
-- + workflow_steps 6 + agent_jobs 13 + director_turns 3 + director_iterations 9.)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.allowed_transitions (
  entity_name TEXT NOT NULL,
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  event_name  TEXT NOT NULL,
  notes       TEXT,
  PRIMARY KEY (entity_name, from_state, to_state)
);

COMMENT ON TABLE public.allowed_transitions IS
  'Canonical state transition catalogue. Consulted by per-entity BEFORE UPDATE triggers via enforce_legal_transition(). Source of truth: docs/stelavox_brief_orchestration_v1_0.md §11.';

-- Public SELECT — needed so the trigger function (running as the
-- invoker) can read the table. Writes restricted to migrations.
REVOKE ALL ON TABLE public.allowed_transitions FROM PUBLIC;
GRANT SELECT ON TABLE public.allowed_transitions TO PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. Enforcement function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_legal_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  -- Only check when state actually changes (the trigger's WHEN clause
  -- should already filter, but defence-in-depth).
  IF OLD.state IS DISTINCT FROM NEW.state THEN
    IF NOT EXISTS (
      SELECT 1 FROM allowed_transitions
      WHERE entity_name = TG_TABLE_NAME
        AND from_state  = OLD.state
        AND to_state    = NEW.state
    ) THEN
      RAISE EXCEPTION 'illegal_transition: %.% cannot move from "%" to "%"',
        TG_TABLE_NAME, NEW.id, OLD.state, NEW.state
        USING ERRCODE = 'check_violation',
              HINT = 'Either the transition is not in allowed_transitions, or the writer is bypassing the state machine. Check docs/stelavox_brief_orchestration_v1_0.md §11.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_legal_transition() IS
  'BEFORE UPDATE trigger function applied to every entity with a state column. Refuses any transition not listed in allowed_transitions. Raises check_violation with diagnostic.';

REVOKE ALL ON FUNCTION public.enforce_legal_transition() FROM PUBLIC;
-- The trigger function runs as the invoker (no SECURITY DEFINER); the
-- table grant above covers read access.

-- ---------------------------------------------------------------------------
-- 3. Seed transitions
-- ---------------------------------------------------------------------------
--
-- 48 transitions total. Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §2.

-- briefs (2)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('briefs', 'active', 'completed', 'propagate_brief_completion', 'all stages terminal-success'),
  ('briefs', 'active', 'cancelled', 'cancel_brief',                'user or cascade cancellation');

-- brief_stages (11)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('brief_stages', 'planned',   'planning',  'evaluate_ready_stage_triggers', 'push-model trigger fired'),
  ('brief_stages', 'planned',   'ready',     'attach_workflow_initial',       'workflow-bound stage: route INSERTs workflow + UPDATEs state to ready'),
  ('brief_stages', 'planning',  'ready',     'attach_workflow_planned',       'Director emitted propose_workflow; iteration-runner attached'),
  ('brief_stages', 'planning',  'planned',   'planning_failed_retry',         'expected_output_check failed; retries remaining'),
  ('brief_stages', 'planning',  'failed',    'planning_failed_terminal',      'expected_output_check failed; retries exhausted'),
  ('brief_stages', 'ready',     'completed', 'complete_brief_stage_workflow', 'workflow ran to terminal-success'),
  ('brief_stages', 'ready',     'failed',    'workflow_terminal_failure',     'workflow ended cancelled or permanently-failed'),
  ('brief_stages', 'planned',   'cancelled', 'cancel_brief',                  'cascade'),
  ('brief_stages', 'planning',  'cancelled', 'cancel_brief',                  'cascade'),
  ('brief_stages', 'ready',     'cancelled', 'cancel_brief',                  'cascade'),
  ('brief_stages', 'failed',    'planned',   'admin_retry_failed_stage',      'admin manually retries a failed stage');

-- workflows (9)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('workflows', 'draft',    'approved',  'approve_workflow',         'user OR auto-approve'),
  ('workflows', 'draft',    'cancelled', 'cancel',                   'user rejected proposal OR cascade'),
  ('workflows', 'approved', 'running',   'dispatch_first',           'advanceWorkflow dispatched first ready step'),
  ('workflows', 'approved', 'cancelled', 'cancel',                   'cascade'),
  ('workflows', 'running',  'completed', 'all_steps_terminal_success','aggregate complete'),
  ('workflows', 'running',  'paused',    'step_failed_or_budget',    'any step failed or token budget exceeded'),
  ('workflows', 'running',  'cancelled', 'cancel',                   'cascade'),
  ('workflows', 'paused',   'running',   'resume',                   'user clicked resume'),
  ('workflows', 'paused',   'cancelled', 'cancel',                   'cascade');

-- workflow_steps (6)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('workflow_steps', 'pending', 'running',   'dispatch',               'dispatchAgentJobForStep INSERTed agent_job'),
  ('workflow_steps', 'pending', 'skipped',   'stop_request_or_cascade','scheduler stop_request or cascade-cancel'),
  ('workflow_steps', 'pending', 'removed',   'user_deselect',          'user deselected at workflow approve'),
  ('workflow_steps', 'running', 'completed', 'job_terminal_success',   'linked agent_job accepted/completed'),
  ('workflow_steps', 'running', 'failed',    'job_terminal_failure',   'linked agent_job failed/cancelled/dismissed'),
  ('workflow_steps', 'running', 'skipped',   'cascade_cancel',         'workflow or brief cancelled');

-- agent_jobs (13)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('agent_jobs', 'queued',          'dispatched',      'dispatcher_cas_claim',          'dispatcher claimed the row'),
  ('agent_jobs', 'queued',          'running',         'runner_start_bypass',           'workflow-executor bypass path'),
  ('agent_jobs', 'queued',          'cancelled',       'cancel_or_cascade',             'user cancel or brief cascade'),
  ('agent_jobs', 'dispatched',      'running',         'persist_running_start',         'runner began executing'),
  ('agent_jobs', 'dispatched',      'cancelled',       'cancel_mid_dispatch',           'stop request between claim and start'),
  ('agent_jobs', 'dispatched',      'crashed',         'heartbeat_stale_or_stuck_claim','reconcile sweep detected'),
  ('agent_jobs', 'running',         'awaiting_accept', 'llm_ok',                        'LLM call returned successfully'),
  ('agent_jobs', 'running',         'failed',          'llm_fail',                      'LLM error or budget exceeded'),
  ('agent_jobs', 'running',         'cancelled',       'cancel_mid_run',                'user pressed Stop'),
  ('agent_jobs', 'running',         'crashed',         'heartbeat_stale',               'reconcile sweep detected stale heartbeat'),
  ('agent_jobs', 'awaiting_accept', 'accepted',        'author_accept',                 'user OR auto-Accept applied result'),
  ('agent_jobs', 'awaiting_accept', 'dismissed',       'author_dismiss',                'user dismissed'),
  ('agent_jobs', 'awaiting_accept', 'cancelled',       'cancel',                        'cascade cancel of awaiting-accept work');

-- director_turns (3)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('director_turns', 'in_progress', 'completed', 'mark_turn_completed', 'last iteration terminal-success'),
  ('director_turns', 'in_progress', 'failed',    'mark_turn_failed',    'iteration crashed or expected_output_missing'),
  ('director_turns', 'in_progress', 'cancelled', 'mark_turn_cancelled', 'user Stop');

-- director_iterations (9) — pre-staged so M-198 split is clean.
-- (No table yet; constraint will reject these on the trigger side until
-- M-198 creates director_iterations. That's fine — the rows live in
-- allowed_transitions waiting for the table to be created.)
INSERT INTO allowed_transitions (entity_name, from_state, to_state, event_name, notes) VALUES
  ('director_iterations', 'queued',     'dispatched', 'dispatcher_cas_claim',          'dispatcher claimed'),
  ('director_iterations', 'queued',     'cancelled',  'cancel_or_cascade',             'cancel pre-dispatch'),
  ('director_iterations', 'dispatched', 'running',    'iteration_start',               'runner began'),
  ('director_iterations', 'dispatched', 'cancelled',  'cancel_mid_dispatch',           ''),
  ('director_iterations', 'dispatched', 'crashed',    'heartbeat_stale_or_stuck_claim',''),
  ('director_iterations', 'running',    'completed',  'iteration_ok',                  'terminal-success'),
  ('director_iterations', 'running',    'failed',     'iteration_error_or_missing',    'LLM error OR expected_output_missing (Q-D)'),
  ('director_iterations', 'running',    'cancelled',  'cancel_mid_run',                ''),
  ('director_iterations', 'running',    'crashed',    'heartbeat_stale',               '');

-- ---------------------------------------------------------------------------
-- 4. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM allowed_transitions;
  IF v_count <> 53 THEN
    RAISE EXCEPTION 'allowed_transitions seed mismatch: expected 53 rows, got %', v_count;
  END IF;

  -- Spot-check critical transitions are present.
  IF NOT EXISTS (SELECT 1 FROM allowed_transitions WHERE entity_name='agent_jobs' AND from_state='running' AND to_state='awaiting_accept') THEN
    RAISE EXCEPTION 'critical agent_jobs transition missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM allowed_transitions WHERE entity_name='briefs' AND from_state='active' AND to_state='completed') THEN
    RAISE EXCEPTION 'critical briefs transition missing';
  END IF;
END;
$$;

COMMIT;
