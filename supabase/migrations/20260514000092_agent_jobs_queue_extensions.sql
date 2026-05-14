-- Migration 092 — V1.x-B.1.1: agent_jobs queue extensions.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.2
--         + Director Architecture v2.0 §8 (universal scheduler) + §9 (throttle).
--
-- Adds the columns the V1.x-B scheduler needs to dispatch every job
-- through one universal queue (no special cases). The interface lands
-- in B.1.1; the policy (WFQ + per-user buckets + Class 1 reserved
-- slots) lands in B.2 — the schema accommodates both.
--
-- traffic_class (1-4) — strict-priority class (Director Arch §9.3):
--   1 = interactive Director turn user is watching
--   2 = workflow just approved, user watching (B.1.1 default)
--   3 = background batch (large auto-split, user moved on)
--   4 = scheduled / parked, opportunistic
--
-- execution_intent — user-elected dispatch shape (Director Arch §4.4):
--   immediate — submitted to scheduler with no constraint
--   parked — queued without start time; awaiting user release
--   scheduled — runs at scheduled_at; normal speed
--   batched_24h — Anthropic Batch API (B.2 implements; column ready)
--
-- route — platform vs BYOK separation (design record §9). B.1.1 policy:
--   platform → cap=1 (preserves M-046 holding pattern)
--   byok → pass-through (no platform-side throttle ever)
--
-- reservation_id — FK to throttle_reservations (M-095) for H-17
-- mitigation. NULL for jobs that haven't reserved capacity yet.

ALTER TABLE agent_jobs
  ADD COLUMN traffic_class INTEGER NOT NULL DEFAULT 2
    CHECK (traffic_class BETWEEN 1 AND 4);

ALTER TABLE agent_jobs
  ADD COLUMN execution_intent TEXT NOT NULL DEFAULT 'immediate'
    CHECK (execution_intent IN ('immediate','parked','scheduled','batched_24h'));

ALTER TABLE agent_jobs
  ADD COLUMN scheduled_at TIMESTAMPTZ NULL;

ALTER TABLE agent_jobs
  ADD COLUMN cause TEXT NULL;
  -- Free-text + structured event types: 'director_iteration',
  -- 'workflow_step', 'stage_trigger', 'system_recovery'. No CHECK
  -- constraint to keep extensible; lib-side validates at dispatch.

ALTER TABLE agent_jobs
  ADD COLUMN route TEXT NOT NULL DEFAULT 'platform'
    CHECK (route IN ('platform','byok'));

ALTER TABLE agent_jobs
  ADD COLUMN reservation_id UUID NULL;
  -- FK added in M-095 after throttle_reservations exists.

-- Queue-lookup index — primary scheduler dispatch query.
CREATE INDEX idx_agent_jobs_queue_lookup
  ON agent_jobs(status, scheduled_at)
  WHERE status IN ('pending','running');

-- Class-aware dispatch index — supports B.2 WFQ scheduler.
CREATE INDEX idx_agent_jobs_class_dispatch
  ON agent_jobs(traffic_class, status, scheduled_at)
  WHERE status = 'pending';
