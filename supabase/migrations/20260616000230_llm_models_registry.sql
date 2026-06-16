-- M-230 — LLM model registry (Model Governance P0, part 1 of 4).
--
-- The single source of truth for "which models exist, their status, and
-- their display identity". Pricing stays in anthropic_pricing (canonical,
-- effective-dated DOLLAR rates); pricing_rates becomes a derived view in
-- M-231 so credits can never diverge from dollars (1M credits = $1).
--
-- Why: today agent_profiles.model_id / director_configs.model_id are free
-- text with no integrity, and an unpriced model meters NOTHING — unlimited
-- free LLM usage on the platform's dime (revenue leakage). This registry +
-- the FK/triggers in M-232 make an unpriced/unknown assignment impossible.
--
-- Source: Model Governance scope (P0) — see docs + CLAUDE.md changelog.

CREATE TABLE llm_models (
  model_id     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'anthropic',
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'deprecated', 'hidden')),
  note         TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE llm_models IS
  'Registry of LLM models. A model is assignable (to an agent profile or the Director) only when status=active AND it has a current anthropic_pricing row — enforced by is_model_assignable() + triggers (M-232).';

ALTER TABLE llm_models ENABLE ROW LEVEL SECURITY;

-- Read-only to any authenticated user (display names + status are not
-- sensitive); all writes go through service-role admin RPCs (M-233 / P1).
CREATE POLICY llm_models_read ON llm_models
  FOR SELECT TO authenticated USING (true);

-- Seed the registry. Every model_id currently present in anthropic_pricing
-- MUST be registered here before the FK below is added. Opus 4.7 is recorded
-- as deprecated (superseded by 4.8) but kept so historical agent_jobs cost
-- lookups and its pricing row stay FK-valid.
INSERT INTO llm_models (model_id, display_name, provider, status, note) VALUES
  ('claude-haiku-4-5-20251001', 'Claude Haiku 4.5',  'anthropic', 'active',     'Default workhorse model'),
  ('claude-sonnet-4-6',         'Claude Sonnet 4.6', 'anthropic', 'active',     'Mid tier'),
  ('claude-opus-4-7',           'Claude Opus 4.7',   'anthropic', 'deprecated', 'Superseded by Opus 4.8'),
  ('claude-opus-4-8',           'Claude Opus 4.8',   'anthropic', 'active',     'Top tier — current Opus')
ON CONFLICT (model_id) DO NOTHING;

-- Price Opus 4.8 (Opus-tier rates; re-verify against Anthropic before launch).
-- Same shape/units as M-132. 1M credits = $1, so the derived credit view
-- (M-231) yields 15M/75M credits-per-Mtok automatically.
INSERT INTO anthropic_pricing
  (model_id, effective_from, input_dollars_per_million, output_dollars_per_million, cache_write_dollars_per_million, cache_read_dollars_per_million, note)
VALUES
  ('claude-opus-4-8', '2026-05-01', 15.00, 75.00, 18.75, 1.50, 'Opus 4.8 — re-verify before launch')
ON CONFLICT (model_id, effective_from) DO NOTHING;

-- Now make anthropic_pricing canonical: every priced model must be a
-- registered model. (All existing model_ids were seeded above.)
ALTER TABLE anthropic_pricing
  ADD CONSTRAINT anthropic_pricing_model_id_fkey
  FOREIGN KEY (model_id) REFERENCES llm_models (model_id);
