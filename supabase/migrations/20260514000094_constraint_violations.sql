-- Migration 094 — V1.x-B.1.1: constraint_violations telemetry table.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.4
--         + design record §8 (atom-size guardrails).
--
-- Logs every pre-flight rejection of an oversized operation. Becomes
-- the dataset that informs cap tuning as model capabilities evolve.
--
-- violation_type — open enum; B.1.1 uses:
--   tool_result_size_exceeded
--   iterations_per_turn_exceeded
--   profile_size_warned (soft watch — not a rejection in B.1.1)
--
-- attempted_value + configured_cap — same units (bytes / iteration count).
--
-- All rejections map to Class D failure (validation) per design record §8.

CREATE TABLE constraint_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_type TEXT NOT NULL,
  attempted_value BIGINT NOT NULL,
  configured_cap BIGINT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_constraint_violations_type_time
  ON constraint_violations(violation_type, created_at DESC);

CREATE INDEX idx_constraint_violations_org_time
  ON constraint_violations(organisation_id, created_at DESC);

-- Service-role write (lib-side records); admin-only read (future
-- admin dashboard surface). No authenticated-user policy = no access.
ALTER TABLE constraint_violations ENABLE ROW LEVEL SECURITY;
