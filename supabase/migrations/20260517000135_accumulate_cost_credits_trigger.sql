-- V1.x-C.2 — atomic usage-tracking trigger.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.2 M-135 + §6 CK-5.
--
-- AFTER UPDATE trigger on agent_jobs firing when cost_credits transitions
-- from NULL to a non-NULL value (the runner's terminal write in V1.x-C.1.b).
-- Body atomically increments organisations.token_usage_credits.
--
-- Atomicity: a single `UPDATE organisations SET x = x + N WHERE id = ?`
-- statement is row-locked by Postgres for the duration of the transaction.
-- Concurrent agent_job completions on different jobs that all share the
-- same organisation_id will serialise on the org row's lock, producing
-- a correct sum. CK-5 stress-tests 100+ concurrent updates.
--
-- H-13: SET search_path = public on every SECURITY DEFINER body.

CREATE OR REPLACE FUNCTION accumulate_cost_credits_into_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when cost_credits transitions NULL → non-NULL. Subsequent
  -- updates (cancellation overwrites, manual corrections) do not double-
  -- count. The WHEN clause in the trigger declaration also enforces this
  -- guard at the planner level — the function body's IF is a defence-in-
  -- depth check in case the trigger is ever invoked manually.
  IF OLD.cost_credits IS NULL AND NEW.cost_credits IS NOT NULL THEN
    UPDATE organisations
    SET token_usage_credits = token_usage_credits + NEW.cost_credits
    WHERE id = NEW.organisation_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accumulate_cost_credits_after_update
AFTER UPDATE OF cost_credits ON agent_jobs
FOR EACH ROW
WHEN (OLD.cost_credits IS NULL AND NEW.cost_credits IS NOT NULL)
EXECUTE FUNCTION accumulate_cost_credits_into_org();

COMMENT ON FUNCTION accumulate_cost_credits_into_org IS
  'V1.x-C.2 — fires from accumulate_cost_credits_after_update trigger. Atomically increments organisations.token_usage_credits when an agent_job''s cost_credits transitions NULL → non-NULL. Concurrent updates serialise on the org row''s lock (CK-5 stress).';
