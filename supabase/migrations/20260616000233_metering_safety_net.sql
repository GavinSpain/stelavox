-- M-233 — metering safety net (Model Governance P0, 4 of 4).
--
-- Defence-in-depth so credit recording is bulletproof even in the
-- should-never-happen edge case (e.g. a pricing row expiring between a
-- job's dispatch and its completion). Three pieces:
--
--   1. Fallback debit rate — when a completed job's model has no current
--      pricing row, the runner debits at this conservative-high rate
--      (Opus-tier by default) instead of writing NULL. The org is
--      OVER-charged + an audit_log critical is raised — never free.
--   2. audit_metering_integrity() — the backstop tripwire: counts
--      completed-but-unmetered jobs and unpriced live assignments. Both
--      must read zero; surfaced in the admin Operations Summary.
--   3. Cleanup of the dead, inconsistent price.anthropic.* config keys
--      (superseded by the anthropic_pricing table in M-132; zero runtime
--      readers; held the stale opus-4-6 id).

-- 1. Fallback debit rate (credits-per-million-tokens). Admin-tunable.
INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'pricing.fallback_credits_per_million_input',
    '15000000',
    'Model Governance — conservative-high INPUT credit rate used to debit a completed job whose model has no current pricing row (should never happen given assignment integrity; over-charge + audit, never free). Default = Opus-tier.',
    'integer'
  ),
  (
    'pricing.fallback_credits_per_million_output',
    '75000000',
    'Model Governance — conservative-high OUTPUT credit rate used to debit a completed job whose model has no current pricing row (over-charge + audit, never free). Default = Opus-tier.',
    'integer'
  )
ON CONFLICT (key) DO NOTHING;

-- 2. Backstop tripwire. unmetered_completed_jobs: platform-route jobs that
-- consumed tokens but never recorded credits (the leak signature).
-- unpriced_*: live assignments pointing at a non-assignable model. All zero
-- in a healthy system.
CREATE OR REPLACE FUNCTION audit_metering_integrity()
RETURNS TABLE (
  unmetered_completed_jobs  BIGINT,
  unpriced_agent_profiles   BIGINT,
  unpriced_director_config  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public   -- H-13
AS $$
  SELECT
    (SELECT count(*) FROM agent_jobs
       WHERE cost_credits IS NULL
         AND route IS DISTINCT FROM 'byok'
         AND (COALESCE(actual_input_tokens, 0) > 0
              OR COALESCE(actual_output_tokens, 0) > 0)),
    (SELECT count(*) FROM agent_profiles
       WHERE NOT is_model_assignable(model_id)),
    (SELECT count(*) FROM director_configs
       WHERE status = 'production'
         AND NOT is_model_assignable(model_id));
$$;

GRANT EXECUTE ON FUNCTION audit_metering_integrity() TO authenticated, service_role;

-- 3. Remove dead, inconsistent pricing config keys (anthropic_pricing table
-- is canonical; these had zero runtime readers and held a stale model id).
DELETE FROM platform_config WHERE key LIKE 'price.anthropic.%';
