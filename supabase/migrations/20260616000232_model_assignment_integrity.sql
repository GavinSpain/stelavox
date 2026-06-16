-- M-232 — model assignment integrity (Model Governance P0, 3 of 4).
--
-- Makes it STRUCTURALLY IMPOSSIBLE to assign a model that won't meter.
-- A model is "assignable" only when it is registered, active, AND has a
-- current pricing row. agent_profiles.model_id and director_configs.model_id
-- (the only two live model knobs — model.<op> config keys have no runtime
-- call sites) get a FK to the registry plus a trigger enforcing assignability.
--
-- Result: the DB rejects assigning an unknown, deprecated, or unpriced model,
-- so an unmetered job can never be dispatched. This is the primary fix for
-- the revenue-leakage hazard.

-- is_model_assignable — registered + active + currently priced.
CREATE OR REPLACE FUNCTION is_model_assignable(p_model_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public   -- H-13
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM llm_models m
      WHERE m.model_id = p_model_id AND m.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM anthropic_pricing p
      WHERE p.model_id = p_model_id
        AND p.effective_from <= CURRENT_DATE
        AND (p.effective_until IS NULL OR p.effective_until > CURRENT_DATE)
    );
$$;

GRANT EXECUTE ON FUNCTION is_model_assignable(TEXT) TO authenticated, service_role;

-- Existence FK: an assigned model must be in the registry.
ALTER TABLE agent_profiles
  ADD CONSTRAINT agent_profiles_model_id_fkey
  FOREIGN KEY (model_id) REFERENCES llm_models (model_id);

ALTER TABLE director_configs
  ADD CONSTRAINT director_configs_model_id_fkey
  FOREIGN KEY (model_id) REFERENCES llm_models (model_id);

-- Assignability trigger: registered isn't enough — must be active + priced.
CREATE OR REPLACE FUNCTION enforce_model_assignable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- H-13
AS $$
BEGIN
  IF NOT is_model_assignable(NEW.model_id) THEN
    RAISE EXCEPTION
      'model_not_assignable: % is not a registered, active, currently-priced model',
      NEW.model_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_profiles_model_assignable
  BEFORE INSERT OR UPDATE OF model_id ON agent_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_model_assignable();

CREATE TRIGGER trg_director_configs_model_assignable
  BEFORE INSERT OR UPDATE OF model_id ON director_configs
  FOR EACH ROW EXECUTE FUNCTION enforce_model_assignable();
