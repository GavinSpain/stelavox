-- V1.x-E.1 — synthetic_probe_runs table.
--
-- Source: Component Spec §17.5 §7 (Synthetic probe history) ·
-- wireframe_admin_dashboard_v1.html §05 M-144.
--
-- Each canned operation that exercises the agent pipeline records its
-- pass/fail + duration + token usage here. The admin dashboard reads
-- the most-recent row per probe to render the probe-status section,
-- and the recent history for trend.
--
-- V1.x-E ships three probes (probe_id values):
--   - 'director_small'      — Director turn with 2 iterations
--   - 'workflow_expand'     — Workflow with synthesise + expand steps
--   - 'refine_accept'       — Refine + accept_agent_job round-trip
--
-- Probe trigger paths:
--   1. Manual via POST /api/admin/probe/[probe_id]/run (V1.x-E ships)
--   2. pg_cron auto-run on a schedule (V1.x-E follow-up polish or V1.x-F)
--
-- 30-day retention (probes are infrequent + low-volume; longer history
-- helps spot regressions). No purge cron in V1.x-E; storage is bounded
-- by probe frequency × 30d × 4 metric rows per probe per row, ~1k
-- rows/year typical.
--
-- The table is admin-scoped; RLS denies user reads.

CREATE TABLE synthetic_probe_runs (
  id BIGSERIAL PRIMARY KEY,
  probe_id TEXT NOT NULL CHECK (
    probe_id IN ('director_small', 'workflow_expand', 'refine_accept')
  ),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual', 'cron')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL,
  outcome TEXT NULL CHECK (outcome IN ('pass', 'fail') OR outcome IS NULL),
  duration_ms INTEGER NULL,
  tokens_input INTEGER NULL,
  tokens_output INTEGER NULL,
  cost_credits NUMERIC(20,8) NULL,
  -- Capture the underlying agent_job / director_turn for forensics.
  agent_job_id UUID NULL,
  director_turn_id UUID NULL,
  -- Failure details when outcome = 'fail'.
  failure_class TEXT NULL,
  error_message TEXT NULL,
  -- Free-form metadata for probe-specific context (e.g. iteration_count,
  -- step counts, child node counts). Probe-runner writes these.
  metadata JSONB NULL
);

CREATE INDEX synthetic_probe_runs_probe_completed_idx
  ON synthetic_probe_runs (probe_id, completed_at DESC NULLS LAST);

CREATE INDEX synthetic_probe_runs_triggered_at_idx
  ON synthetic_probe_runs (triggered_at DESC);

ALTER TABLE synthetic_probe_runs ENABLE ROW LEVEL SECURITY;
-- No user-facing read policy: admin reads via service-role client only.

COMMENT ON TABLE synthetic_probe_runs IS
  'V1.x-E.1 — pass/fail history for canned operations exercising the agent pipeline. Admin dashboard reads the most-recent row per probe for status; recent history surfaces in trend view. Probe trigger via POST /api/admin/probe/[probe_id]/run (manual) or pg_cron (V1.x-E polish).';
