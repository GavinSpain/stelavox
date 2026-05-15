-- V1.x-C.1 — anthropic_pricing table (BYOK $-per-token reference).
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.1 M-131 (renumbered to M-132).
-- BYOK users see real Anthropic dollars (not platform credits). This table mirrors
-- pricing_rates but stores Anthropic's published $ rates so the cost meter can
-- surface "$0.0042 spent" against the user's own Anthropic bill.

CREATE TABLE anthropic_pricing (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE NULL,
  input_dollars_per_million NUMERIC(10,4) NOT NULL,
  output_dollars_per_million NUMERIC(10,4) NOT NULL,
  cache_write_dollars_per_million NUMERIC(10,4) NULL,
  cache_read_dollars_per_million NUMERIC(10,4) NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, effective_from)
);

CREATE INDEX anthropic_pricing_model_effective_idx
  ON anthropic_pricing(model_id, effective_from DESC);

-- Seed Anthropic's published $/M token rates for V1 supported models.
-- Re-verify before launch and on any Anthropic price change.

INSERT INTO anthropic_pricing (model_id, effective_from, input_dollars_per_million, output_dollars_per_million, cache_write_dollars_per_million, cache_read_dollars_per_million, note) VALUES
  ('claude-haiku-4-5-20251001', '2026-05-01', 0.80, 4.00, 1.00, 0.08, 'Anthropic published 2026-05'),
  ('claude-sonnet-4-6', '2026-05-01', 3.00, 15.00, 3.75, 0.30, 'Anthropic published 2026-05'),
  ('claude-opus-4-7', '2026-05-01', 15.00, 75.00, 18.75, 1.50, 'Anthropic published 2026-05');

-- Parallel SQL function for BYOK $ computation. Same shape as compute_cost_credits
-- but returns real dollars.
CREATE OR REPLACE FUNCTION compute_anthropic_dollars(
  p_model_id TEXT,
  p_completed_at TIMESTAMPTZ,
  p_tokens_input INTEGER,
  p_tokens_output INTEGER,
  p_cache_write INTEGER DEFAULT 0,
  p_cache_read INTEGER DEFAULT 0
) RETURNS NUMERIC(12,6)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate RECORD;
  v_completed_date DATE;
  v_dollars NUMERIC(12,6);
BEGIN
  v_completed_date := p_completed_at::DATE;

  SELECT
    input_dollars_per_million,
    output_dollars_per_million,
    cache_write_dollars_per_million,
    cache_read_dollars_per_million
  INTO v_rate
  FROM anthropic_pricing
  WHERE model_id = p_model_id
    AND effective_from <= v_completed_date
    AND (effective_until IS NULL OR effective_until > v_completed_date)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RETURN NULL;
  END IF;

  v_dollars :=
    (COALESCE(p_tokens_input, 0)::NUMERIC * v_rate.input_dollars_per_million / 1000000.0) +
    (COALESCE(p_tokens_output, 0)::NUMERIC * v_rate.output_dollars_per_million / 1000000.0) +
    (COALESCE(p_cache_write, 0)::NUMERIC * COALESCE(v_rate.cache_write_dollars_per_million, v_rate.input_dollars_per_million) / 1000000.0) +
    (COALESCE(p_cache_read, 0)::NUMERIC * COALESCE(v_rate.cache_read_dollars_per_million, v_rate.input_dollars_per_million) / 1000000.0);

  RETURN v_dollars;
END;
$$;

GRANT EXECUTE ON FUNCTION compute_anthropic_dollars TO authenticated, service_role;
