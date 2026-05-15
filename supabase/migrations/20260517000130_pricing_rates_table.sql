-- V1.x-C.1 — pricing_rates table.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.1 (numbering revised
-- 129 → 130 because M-129 was claimed by V1.x-B.3 Director config v1.9).
--
-- Append-only; daily-granularity; the rate active on a job's `completed_at`
-- date is authoritative (H-20 mitigation). credits_per_token are the platform's
-- internal accounting unit (opaque to non-BYOK users; surfaces as %allocation).

CREATE TABLE pricing_rates (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_until DATE NULL,
  -- "credits per million input/output tokens" — agent_jobs.cost_credits is in
  -- the same unit; division-by-million happens in compute_cost_credits.
  input_credits_per_million NUMERIC(20,6) NOT NULL,
  output_credits_per_million NUMERIC(20,6) NOT NULL,
  cache_write_credits_per_million NUMERIC(20,6) NULL,
  cache_read_credits_per_million NUMERIC(20,6) NULL,
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (model_id, effective_from)
);

CREATE INDEX pricing_rates_model_effective_idx
  ON pricing_rates(model_id, effective_from DESC);

-- Seed current platform credit rates for V1 supported models. The credit unit
-- is platform-internal — chosen so 1 credit ≈ $0.000001 of platform spend at
-- current Anthropic prices, giving 1M credits ≈ $1. This makes "100k credit
-- trial" intuitive in v1x-c.2 plan-model surfacing.
--
-- Anthropic published prices (as of 2026-05 — re-verify before launch):
--   haiku-4.5      $0.80/M input  / $4.00/M output
--   sonnet-4.6     $3.00/M input  / $15.00/M output
--   opus-4.7       $15.00/M input / $75.00/M output
-- Multiply by 1,000,000 to get credits-per-million-tokens.

INSERT INTO pricing_rates (model_id, effective_from, input_credits_per_million, output_credits_per_million, cache_write_credits_per_million, cache_read_credits_per_million, note) VALUES
  ('claude-haiku-4-5-20251001', '2026-05-01', 800000, 4000000, 1000000, 80000, 'V1 launch rates — Anthropic 2026-05'),
  ('claude-sonnet-4-6', '2026-05-01', 3000000, 15000000, 3750000, 300000, 'V1 launch rates — Anthropic 2026-05'),
  ('claude-opus-4-7', '2026-05-01', 15000000, 75000000, 18750000, 1500000, 'V1 launch rates — Anthropic 2026-05');
