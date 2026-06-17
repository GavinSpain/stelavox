-- M-231 — pricing_rates becomes a derived VIEW (Model Governance P0, 2 of 4).
--
-- pricing_rates (credits) and anthropic_pricing (dollars) were two separate
-- tables seeded in parity (credits = dollars x 1,000,000). Nothing kept them
-- in sync — a model priced for dollars but not for credits (or vice-versa)
-- would mis-meter. We collapse to ONE source of truth: anthropic_pricing
-- (dollars), and derive pricing_rates as a view (credits = dollars x 1e6).
--
-- 1 credit = $0.000001, so $1 of Anthropic cost = 1,000,000 credits. The
-- derivation is exact and structural; the two can no longer drift.
--
-- All existing readers are untouched: lib/cost/pricing.ts lookupRate and the
-- compute_cost_credits() plpgsql function SELECT the same column names from
-- pricing_rates — now served by the view. plpgsql late-binds table refs, so
-- the function resolves the view at next call with no redefinition needed.
--
-- Pre-check: the live pricing_rates rows are already byte-equal to
-- anthropic_pricing x 1e6 (verified), so the view returns identical data.

DROP TABLE IF EXISTS pricing_rates;

CREATE VIEW pricing_rates AS
SELECT
  id,
  model_id,
  effective_from,
  effective_until,
  (input_dollars_per_million       * 1000000)::NUMERIC(20,6) AS input_credits_per_million,
  (output_dollars_per_million      * 1000000)::NUMERIC(20,6) AS output_credits_per_million,
  (cache_write_dollars_per_million * 1000000)::NUMERIC(20,6) AS cache_write_credits_per_million,
  (cache_read_dollars_per_million  * 1000000)::NUMERIC(20,6) AS cache_read_credits_per_million,
  note,
  created_at
FROM anthropic_pricing;

COMMENT ON VIEW pricing_rates IS
  'Derived credit view of anthropic_pricing (credits = dollars x 1,000,000). Single source of truth is anthropic_pricing; credits cannot diverge from dollars. Readers: lib/cost/pricing.ts + compute_cost_credits().';

GRANT SELECT ON pricing_rates TO authenticated, service_role;
