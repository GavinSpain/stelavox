-- Migration 119 — V1.x-B.2.3: failure_taxonomy_samples table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-119 +
--         Director Architecture v2.0 §10 (5-class failure taxonomy).
--
-- Per-failure observability. Every runner that catches an error writes
-- a row here after calling classify_failure. Together with
-- agent_jobs.failure_class (the per-job stamp) this gives us:
--   - per-class failure rate over time (admin dashboard)
--   - auto-recovery rate (Class A retries succeeding)
--   - which operation_types contribute most failures
--   - time-to-resolution for Class B interrupted jobs (recovery sweep
--     reclaim → user resume / abandonment ratio — V1.x-D telemetry)
--
-- requires_user_action — true for Class B/D/E (resumable, validation,
-- hard system); false for Class A/C (auto-recovered or throttle-driven
-- without user surface).
--
-- error_summary — short human-readable. The full error message lives
-- on agent_jobs.error_message; this is a cheap read column for the
-- admin dashboard's incident list.

CREATE TABLE failure_taxonomy_samples (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failure_class CHAR(1) NOT NULL CHECK (failure_class IN ('A','B','C','D','E')),
  operation_type TEXT NOT NULL,
  pool_key TEXT NOT NULL,
  agent_job_id UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  auto_recovered BOOLEAN NOT NULL DEFAULT FALSE,
  requires_user_action BOOLEAN NOT NULL DEFAULT FALSE,
  error_summary TEXT NULL
);

CREATE INDEX failure_taxonomy_samples_class_time_idx
  ON failure_taxonomy_samples(failure_class, occurred_at DESC);

CREATE INDEX failure_taxonomy_samples_op_time_idx
  ON failure_taxonomy_samples(operation_type, occurred_at DESC);

ALTER TABLE failure_taxonomy_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_failure_taxonomy_samples" ON failure_taxonomy_samples
  FOR ALL USING (FALSE);
