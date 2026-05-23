-- M-205 — Apollo iteration-fork fix.
--
-- Closes a bug class surfaced 2026-05-23 by a successful 2-stage brief
-- test: the proposal turn's iteration tree forked. Iteration 2 of the
-- turn spawned two children, both with the same parent_iteration_id,
-- each independently running its own Anthropic LLM call. Same fork
-- appeared again one iteration deeper. Net cost: ~70% extra input
-- tokens, two parallel tool-execution branches that happened to
-- converge on the same workflow proposal in this run — convergence by
-- luck, not design.
--
-- Root cause was two structural failures combining:
--
--   (1) The route handler at /api/director/message runs
--       runIteration(currentJobId) directly in a loop AND the
--       dispatcher also runs runIteration via the INSERT-trigger
--       handoff path. Two consumers race for every iteration row.
--
--   (2) The iteration-runner's claim guard
--       (transitionAgentJob(running)) returns ok=false when the second
--       runner attacks an already-claimed row, but the TS code
--       doesn't check ok — it falls through and runs the LLM anyway.
--       The state machine's CAS verdict is being ignored.
--
-- The Apollo fix has three concentric layers, all of which this
-- migration sets up at the schema level (the TS-side claim guard is
-- the only piece that lives outside the DB; it lands in the same
-- branch as this migration). After the fix, dual consumers are
-- structurally impossible, the spawn-next decision moves into the
-- state machine, and a partial unique index on parent_iteration_id
-- catches any future regression that tries to fork the tree.
--
-- Layered design:
--
--   LAYER 1 (in TS code, NOT this migration) — runIteration honours
--   the CAS verdict: on illegal_transition return ok=false, the
--   generator yields a typed event and returns. No LLM call, no
--   spawn, no further writes.
--
--   LAYER 2 — consumer_kind column partitions iteration rows by
--   owner. 'inline_route' rows are owned by the route handler's
--   inline loop; 'dispatcher' rows are owned by the scheduler.
--   Default is 'dispatcher' (covers push-model planning turns, which
--   are the autonomous path). The route handler explicitly sets
--   'inline_route' when starting an interactive turn; the spawn-next
--   trigger from layer 3 propagates the value from parent to child
--   so the entire chain inherits ownership.
--
--   The INSERT NOTIFY trigger (M-203) is updated to skip
--   inline_route rows. The dispatcher's candidate query (in
--   lib/scheduler/dispatcher.ts) filters them out as defence-in-
--   depth. Net effect: the dispatcher never sees inline rows; only
--   one consumer can possibly attack them.
--
--   LAYER 3 — spawn-next becomes a state-machine action. The
--   runner stamps stop_reason on the running → awaiting_accept
--   transition. A new AFTER UPDATE trigger inserts the child row
--   atomically when stop_reason='tool_use'. Two partial unique
--   indices enforce the chain shape: (parent_iteration_id) and
--   (director_turn_id, iteration_number). Even if a future code
--   path tries to fork, the second INSERT errors with 23505.
--
--   AUDIT — a new I9 invariant in audit_orchestration_state()
--   reports any director_iteration parent with more than one child.
--   The unique index makes this impossible in steady state; the
--   audit row exists for forensics if the index is ever bypassed.
--
-- Source: stelavox_brief_orchestration_v1_0.md §11.6 (Apollo
-- iteration-fork follow-up; spec amendment lands in the same branch
-- as this migration).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. consumer_kind column
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_jobs
  ADD COLUMN consumer_kind TEXT NOT NULL DEFAULT 'dispatcher';

ALTER TABLE public.agent_jobs
  ADD CONSTRAINT agent_jobs_consumer_kind_check
  CHECK (consumer_kind IN ('inline_route', 'dispatcher'));

COMMENT ON COLUMN public.agent_jobs.consumer_kind IS
  'Apollo M-205: partition key for execution surface. ''inline_route'' = '
  'owned by /api/director/message inline loop (interactive Director). '
  '''dispatcher'' = owned by lib/scheduler/dispatcher (push-model planning, '
  'workflow agents, batched_24h — everything else). Propagated from parent '
  'to child by trg_agent_jobs_spawn_next_iteration. Used by the INSERT '
  'NOTIFY trigger (M-203) and by the dispatcher candidate query to ensure '
  'exactly one consumer per row.';

-- ---------------------------------------------------------------------------
-- 2. stop_reason column
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_jobs
  ADD COLUMN stop_reason TEXT NULL;

COMMENT ON COLUMN public.agent_jobs.stop_reason IS
  'Apollo M-205: LLM stop_reason from the Anthropic API response. '
  'Stamped by the runner on the running → awaiting_accept transition. '
  'Values: ''tool_use'', ''end_turn'', ''stop_sequence'', '
  '''max_iterations_reached'', ''stop_requested''. The '
  'trg_agent_jobs_spawn_next_iteration trigger uses stop_reason=''tool_use'' '
  'as the signal to insert the next iteration row.';

-- ---------------------------------------------------------------------------
-- 3. One-time cleanup of pre-existing forks
-- ---------------------------------------------------------------------------
--
-- The 2026-05-23 user-test produced two parent_iteration_id forks in
-- the proposal turn (iteration 2's child 5e7d2edb spawned both
-- 623a52b5 and b08b8b54; iteration 3's child b08b8b54 spawned both
-- b3e7e329 and 3a403596). The unique index below would refuse to
-- create with those rows present.
--
-- Cleanup policy: keep the earliest-started child per parent as the
-- canonical chain owner. NULL the parent_iteration_id on later
-- "loser" children — they keep all their row data (tokens,
-- iteration_state, completed_at) for forensics, but they no longer
-- claim a place in the chain. error_message records the original
-- parent for traceability.
--
-- This is a one-time historical correction. Post-M-205 the spawn
-- trigger + unique index make new forks impossible.

DO $$
DECLARE
  v_orphaned INT := 0;
BEGIN
  -- A fork can produce diverging sub-trees, not just isolated sibling
  -- pairs. The cleanup must walk the entire loser sub-tree so that
  -- (director_turn_id, iteration_number) is also unique after we're
  -- done. Recursive CTE:
  --   1. Identify the initial losers — any child past the first when
  --      ranking siblings by (started_at, id).
  --   2. Expand to include every descendant of an initial loser.
  --   3. NULL parent_iteration_id + iteration_number on the full set,
  --      preserving original values in error_message for forensics.
  WITH RECURSIVE
    initial_losers AS (
      SELECT id, parent_iteration_id, iteration_number
      FROM (
        SELECT id, parent_iteration_id, iteration_number,
               ROW_NUMBER() OVER (PARTITION BY parent_iteration_id ORDER BY started_at NULLS LAST, id) AS rn
        FROM agent_jobs
        WHERE parent_iteration_id IS NOT NULL
          AND operation_type = 'director_iteration'
      ) ranked
      WHERE rn > 1
    ),
    loser_tree AS (
      SELECT id, parent_iteration_id, iteration_number FROM initial_losers
      UNION ALL
      SELECT aj.id, aj.parent_iteration_id, aj.iteration_number
      FROM agent_jobs aj
      JOIN loser_tree lt ON aj.parent_iteration_id = lt.id
      WHERE aj.operation_type = 'director_iteration'
    ),
    updated AS (
      UPDATE agent_jobs aj
      SET parent_iteration_id = NULL,
          iteration_number   = NULL,
          error_message = COALESCE(aj.error_message, '') ||
            format(' [M-205 orphaned: original parent_iteration_id=%s, original iteration_number=%s; sibling-fork detected, earliest sibling kept as canonical chain owner]',
                   lt.parent_iteration_id,
                   lt.iteration_number)
      FROM loser_tree lt
      WHERE aj.id = lt.id
      RETURNING aj.id
    )
  SELECT COUNT(*) INTO v_orphaned FROM updated;
  IF v_orphaned > 0 THEN
    RAISE NOTICE 'M-205 cleanup: orphaned % rows from pre-existing iteration-tree forks (initial losers + descendants)', v_orphaned;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Partial unique indices (Layer 3 belt)
-- ---------------------------------------------------------------------------

-- The iteration tree must be a chain: each parent has at most one child.
-- This index makes any duplicate-INSERT attempt fail with 23505.
CREATE UNIQUE INDEX agent_jobs_parent_iteration_unique
  ON public.agent_jobs (parent_iteration_id)
  WHERE parent_iteration_id IS NOT NULL;

COMMENT ON INDEX public.agent_jobs_parent_iteration_unique IS
  'Apollo M-205: enforces "iteration tree is a chain" — every parent has '
  'at most one child. Catches any code path that tries to fork the chain. '
  'Audit invariant I9 reports violations (impossible while this index '
  'exists; the row exists for forensics).';

-- Different angle on the same invariant: no two iterations share a
-- number within a turn.
CREATE UNIQUE INDEX agent_jobs_turn_iteration_unique
  ON public.agent_jobs (director_turn_id, iteration_number)
  WHERE operation_type = 'director_iteration' AND director_turn_id IS NOT NULL;

COMMENT ON INDEX public.agent_jobs_turn_iteration_unique IS
  'Apollo M-205: enforces "no two iterations share a number within a turn". '
  'Belt-and-suspenders alongside agent_jobs_parent_iteration_unique.';

-- ---------------------------------------------------------------------------
-- 5. Spawn-next trigger (Layer 3 suspenders)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_jobs_spawn_next_iteration()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The runner stamps stop_reason in the same UPDATE that transitions
  -- running → awaiting_accept. The trigger inserts the next iteration
  -- row atomically inside the same transaction. Conditions:
  --   - operation_type is director_iteration
  --   - new state is awaiting_accept (the LLM call finished cleanly)
  --   - the state actually changed (defence-in-depth; the trigger's
  --     WHEN clause already filters)
  --   - stop_reason is tool_use (the LLM wants to continue the loop)
  --
  -- Anything else — end_turn, max_iterations_reached, stop_requested,
  -- failed/crashed/cancelled — produces no spawn. The runner ends the
  -- turn, the route handler finalises the assistant message, done.

  INSERT INTO agent_jobs (
    organisation_id,
    document_id,
    operation_type,
    state,
    traffic_class,
    route,
    cause,
    triggered_by,
    director_turn_id,
    parent_iteration_id,
    iteration_number,
    iteration_state,
    consumer_kind
  ) VALUES (
    NEW.organisation_id,
    NEW.document_id,
    'director_iteration',
    'queued',
    1,
    NEW.route,
    'director_iteration',
    'iteration_chain',
    NEW.director_turn_id,
    NEW.id,
    NEW.iteration_number + 1,
    NEW.iteration_state,
    NEW.consumer_kind
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_jobs_spawn_next_iteration ON public.agent_jobs;
CREATE TRIGGER trg_agent_jobs_spawn_next_iteration
  AFTER UPDATE OF state ON public.agent_jobs
  FOR EACH ROW
  WHEN (
    NEW.operation_type = 'director_iteration'
    AND NEW.state = 'awaiting_accept'
    AND OLD.state IS DISTINCT FROM NEW.state
    AND NEW.stop_reason = 'tool_use'
  )
  EXECUTE FUNCTION agent_jobs_spawn_next_iteration();

COMMENT ON TRIGGER trg_agent_jobs_spawn_next_iteration ON public.agent_jobs IS
  'Apollo M-205: spawns the next iteration row when an iteration ends in '
  'tool_use. Replaces lines 919-973 of lib/director/iteration-runner.ts. '
  'Spawn responsibility moves from runner code (which could be executed '
  'twice in race conditions) to the state machine (fires exactly once '
  'because the state transition is CAS-guarded). The unique index on '
  'parent_iteration_id is the final guard: if the trigger somehow fires '
  'twice, the second INSERT errors with 23505.';

-- ---------------------------------------------------------------------------
-- 6. Update agent_jobs_notify_insert to skip inline_route rows
-- ---------------------------------------------------------------------------
--
-- The dispatcher listens on dispatcher_tick_request and runs a tick
-- when notified. Inline-route rows are owned by the route handler;
-- the dispatcher must not consider them. Suppressing the NOTIFY for
-- inline rows means the dispatcher's listener never wakes for them,
-- and the dispatcher's tick query also filters them out (defence-in-
-- depth, see lib/scheduler/dispatcher.ts).

CREATE OR REPLACE FUNCTION public.agent_jobs_notify_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.state = 'queued' AND NEW.consumer_kind = 'dispatcher' THEN
    PERFORM pg_notify('dispatcher_tick_request',
      jsonb_build_object('requested_at', NOW(), 'cause', 'agent_jobs_insert', 'job_id', NEW.id)::TEXT);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agent_jobs_notify_insert() IS
  'Apollo M-205: notifies the dispatcher on every queued INSERT EXCEPT '
  'inline_route rows. Inline-route iterations are owned by the route '
  'handler at /api/director/message; the dispatcher must not pick them. '
  'Suppressing NOTIFY at INSERT time is the schema-level half of the '
  'consumer_kind partition; lib/scheduler/dispatcher.ts adds the same '
  'filter to its tick candidate query as defence-in-depth.';

-- ---------------------------------------------------------------------------
-- 7. Add I9 invariant to audit_orchestration_state
-- ---------------------------------------------------------------------------
--
-- The parent_iteration_id unique index makes this impossible to violate
-- in practice; I9 exists for forensics. If a future migration ever drops
-- the index or a code path bypasses it, the audit log will record the
-- offending parent_iteration_id with the child count.

CREATE OR REPLACE FUNCTION public.audit_orchestration_state()
RETURNS TABLE(
  invariant_id  TEXT,
  entity_table  TEXT,
  entity_id     UUID,
  violation     TEXT,
  details       JSONB
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- I1: completed_at agrees with state.
  RETURN QUERY
  SELECT 'I1'::TEXT, 'agent_jobs'::TEXT, aj.id,
    'state and completed_at disagree'::TEXT,
    jsonb_build_object('state', aj.state, 'completed_at', aj.completed_at)
  FROM agent_jobs aj
  WHERE (aj.state IN ('queued','dispatched','running') AND aj.completed_at IS NOT NULL)
     OR (aj.state IN ('accepted','dismissed','failed','crashed','cancelled') AND aj.completed_at IS NULL);
  -- I3: workflow_step completed iff linked agent_job is terminal-success.
  RETURN QUERY
  SELECT 'I3'::TEXT, 'workflow_steps'::TEXT, ws.id,
    format('step completed but linked agent_job.state=%s', aj.state)::TEXT,
    jsonb_build_object('agent_job_id', aj.id, 'agent_job_state', aj.state)
  FROM workflow_steps ws
  JOIN agent_jobs aj ON aj.id = ws.agent_job_id
  WHERE ws.state = 'completed' AND aj.state NOT IN ('accepted','awaiting_accept');
  -- I4: workflow completed only if all steps terminal-success.
  RETURN QUERY
  SELECT 'I4'::TEXT, 'workflows'::TEXT, w.id,
    'workflow completed but has non-terminal-success steps'::TEXT,
    jsonb_build_object('pending_step_ids', (SELECT array_agg(id) FROM workflow_steps WHERE workflow_id = w.id AND state NOT IN ('completed','skipped','removed')))
  FROM workflows w
  WHERE w.state = 'completed' AND EXISTS (SELECT 1 FROM workflow_steps WHERE workflow_id = w.id AND state NOT IN ('completed','skipped','removed'));
  -- I5: brief completed only if all stages terminal.
  RETURN QUERY
  SELECT 'I5'::TEXT, 'briefs'::TEXT, b.id,
    'brief completed but has non-terminal stages'::TEXT,
    jsonb_build_object('non_terminal_stages', (SELECT array_agg(id) FROM brief_stages WHERE brief_id = b.id AND state NOT IN ('completed','cancelled','failed')))
  FROM briefs b
  WHERE b.state = 'completed' AND EXISTS (SELECT 1 FROM brief_stages WHERE brief_id = b.id AND state NOT IN ('completed','cancelled','failed'));
  -- I6: at most one active brief per document.
  RETURN QUERY
  SELECT 'I6'::TEXT, 'briefs'::TEXT, b1.id,
    'multiple active briefs on the same document'::TEXT,
    jsonb_build_object('document_id', b1.document_id)
  FROM briefs b1
  WHERE b1.state = 'active' AND EXISTS (SELECT 1 FROM briefs b2 WHERE b2.document_id = b1.document_id AND b2.state = 'active' AND b2.id <> b1.id);
  -- I7: non-terminal stages have either a workflow or a prompt.
  RETURN QUERY
  SELECT 'I7'::TEXT, 'brief_stages'::TEXT, bs.id,
    'non-terminal stage missing both workflow_id and prompt'::TEXT,
    jsonb_build_object('state', bs.state, 'workflow_id', bs.workflow_id, 'has_prompt', bs.prompt IS NOT NULL)
  FROM brief_stages bs
  WHERE bs.state IN ('planned','planning','ready') AND bs.workflow_id IS NULL AND bs.prompt IS NULL;
  -- I8: at most one in-progress director_turn per conversation.
  RETURN QUERY
  SELECT 'I8'::TEXT, 'director_turns'::TEXT, t1.id,
    'multiple in_progress turns on the same conversation'::TEXT,
    jsonb_build_object('conversation_id', t1.conversation_id)
  FROM director_turns t1
  WHERE t1.state = 'in_progress' AND EXISTS (SELECT 1 FROM director_turns t2 WHERE t2.conversation_id = t1.conversation_id AND t2.state = 'in_progress' AND t2.id <> t1.id);
  -- I9 (NEW Apollo M-205): every iteration parent has at most one child.
  -- The unique index agent_jobs_parent_iteration_unique enforces this;
  -- the audit row exists for forensics if the index is ever bypassed.
  RETURN QUERY
  SELECT 'I9'::TEXT, 'agent_jobs'::TEXT, parent_iteration_id,
    'iteration parent has multiple children'::TEXT,
    jsonb_build_object('child_count', count(*), 'child_ids', array_agg(id ORDER BY started_at NULLS LAST, id))
  FROM agent_jobs
  WHERE parent_iteration_id IS NOT NULL
    AND operation_type = 'director_iteration'
  GROUP BY parent_iteration_id
  HAVING count(*) > 1;
  -- I12: running step must have an agent_job_id.
  RETURN QUERY
  SELECT 'I12'::TEXT, 'workflow_steps'::TEXT, ws.id,
    'step running but agent_job_id NULL'::TEXT,
    jsonb_build_object('state', ws.state)
  FROM workflow_steps ws
  WHERE ws.state = 'running' AND ws.agent_job_id IS NULL;
END;
$$;

COMMENT ON FUNCTION public.audit_orchestration_state() IS
  'Apollo: scans the orchestration tables for invariant violations. '
  'Returns one row per violation. M-205 adds I9 (no parent has multiple '
  'children) for the new iteration-chain invariant — should never fire '
  'while agent_jobs_parent_iteration_unique exists; logged anyway for '
  'forensics.';

COMMIT;
