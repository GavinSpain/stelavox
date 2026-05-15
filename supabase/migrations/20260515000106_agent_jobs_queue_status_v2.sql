-- Migration 106 — V1.x-B.2.1: agent_jobs queue_status column (v2 lifecycle).
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-106
--         + Director Architecture v2.0 §8 (universal scheduler) + §10
--         (failure taxonomy).
--
-- Adds the queue_status column to agent_jobs distinct from the existing
-- `status` column.
--
--   status (existing, M-006) — business outcome: pending → running →
--     completed | failed. Preserved unchanged for backwards compatibility
--     with V1.x-A.1 / V1.x-B.1.1 paths that read it.
--
--   queue_status (NEW, M-106) — queue lifecycle: queued → dispatched →
--     running → completed | failed | crashed | cancelled | skipped.
--     Owned by the dispatcher (lib/scheduler/dispatcher.ts).
--
-- The two columns evolve independently. status='running' AND
-- queue_status='running' is the steady-state during execution. A crashed
-- job has status='failed' AND queue_status='crashed'. A user-cancelled
-- job has status='failed' AND queue_status='cancelled'.
--
-- Per the build checklist: "Old `'skipped_no_capacity'` collapses into
-- `'queued'` with `dispatcher_skips_count++`". There is no existing
-- skipped_no_capacity status in the schema (it would have been a status
-- value); the build checklist text was anticipating one. The dispatcher
-- treats temporary capacity exhaustion by leaving queue_status='queued'
-- and incrementing dispatcher_skips_count (column added in M-105).

ALTER TABLE agent_jobs
  ADD COLUMN queue_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (queue_status IN (
      'queued',
      'dispatched',
      'running',
      'completed',
      'failed',
      'crashed',
      'cancelled',
      'skipped'
    ));

-- Backfill queue_status for existing rows from status. Pre-B.2.1 rows
-- have status in {pending, running, completed, failed}; map to
-- queue_status as follows:
--   pending  → queued
--   running  → running
--   completed → completed
--   failed   → failed
UPDATE agent_jobs SET queue_status = CASE
  WHEN status = 'pending' THEN 'queued'
  WHEN status = 'running' THEN 'running'
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'failed' THEN 'failed'
  ELSE 'queued'
END;

-- Primary dispatcher index: queued tickets ordered by class then queued_at.
-- Already covered partially by M-092's idx_agent_jobs_class_dispatch
-- (which used status). Add a queue_status-aware index for the dispatcher.
CREATE INDEX idx_agent_jobs_queue_status_class
  ON agent_jobs(traffic_class, queued_at)
  WHERE queue_status = 'queued';

-- Index for the recovery sweep — find dispatched/running rows whose
-- heartbeat is stale.
CREATE INDEX idx_agent_jobs_active_for_recovery
  ON agent_jobs(queue_status, last_heartbeat_at)
  WHERE queue_status IN ('dispatched','running');
