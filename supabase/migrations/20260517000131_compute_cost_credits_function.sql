-- V1.x-C.1 — compute_cost_credits SQL function.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.1 M-130 (renumbered to M-131).
-- Looks up the active rate at p_completed_at; returns the cost in credits.
-- Used by agent runner + iteration runner at completion to populate
-- agent_jobs.cost_credits (column already from B.2.1 M-105).
--
-- H-20 mitigation: rate lookup keys on completed_at, not now() — backfill safe.

CREATE OR REPLACE FUNCTION compute_cost_credits(
  p_model_id TEXT,
  p_completed_at TIMESTAMPTZ,
  p_tokens_input INTEGER,
  p_tokens_output INTEGER,
  p_cache_write INTEGER DEFAULT 0,
  p_cache_read INTEGER DEFAULT 0
) RETURNS NUMERIC(20,8)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate RECORD;
  v_completed_date DATE;
  v_credits NUMERIC(20,8);
BEGIN
  v_completed_date := p_completed_at::DATE;

  SELECT
    input_credits_per_million,
    output_credits_per_million,
    cache_write_credits_per_million,
    cache_read_credits_per_million
  INTO v_rate
  FROM pricing_rates
  WHERE model_id = p_model_id
    AND effective_from <= v_completed_date
    AND (effective_until IS NULL OR effective_until > v_completed_date)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Unknown model or no rate — return NULL rather than zero, so the caller
    -- can detect-and-report rather than silently undercharge.
    RETURN NULL;
  END IF;

  v_credits :=
    (COALESCE(p_tokens_input, 0)::NUMERIC * v_rate.input_credits_per_million / 1000000.0) +
    (COALESCE(p_tokens_output, 0)::NUMERIC * v_rate.output_credits_per_million / 1000000.0) +
    (COALESCE(p_cache_write, 0)::NUMERIC * COALESCE(v_rate.cache_write_credits_per_million, v_rate.input_credits_per_million) / 1000000.0) +
    (COALESCE(p_cache_read, 0)::NUMERIC * COALESCE(v_rate.cache_read_credits_per_million, v_rate.input_credits_per_million) / 1000000.0);

  RETURN v_credits;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_cost_credits TO authenticated, service_role;
