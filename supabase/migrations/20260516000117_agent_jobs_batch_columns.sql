-- Migration 117 — V1.x-B.2.3: agent_jobs batch tracking columns.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-117 +
--         Director Architecture v2.0 §4.4 (batched_24h execution intent).
--
-- The execution_intent column + 'batched_24h' value already exist on
-- agent_jobs from M-092 (V1.x-B.1.1 substrate). M-117 adds the tracking
-- columns the batch submitter + poller need:
--
--   batch_id              — Anthropic-returned batch ID once submitted
--   batch_submitted_at    — when the batch was POSTed to Anthropic
--   batch_polled_at       — last successful poll timestamp (for backfill
--                           after gaps — H-24 mitigation)
--
-- Filtered index supports the batch poller's "find all in-flight batched
-- tickets" query.

ALTER TABLE agent_jobs
  ADD COLUMN batch_anthropic_id TEXT NULL;
  -- Note: column name is batch_anthropic_id rather than batch_id because
  -- agent_jobs already has a batch_id column from M-006 (reserved for
  -- "V2 batch operations") that's never been populated. Keeping the
  -- legacy column avoids an in-place rename + dependent index rebuild.

ALTER TABLE agent_jobs
  ADD COLUMN batch_submitted_at TIMESTAMPTZ NULL;

ALTER TABLE agent_jobs
  ADD COLUMN batch_polled_at TIMESTAMPTZ NULL;

CREATE INDEX agent_jobs_batched_pending_idx
  ON agent_jobs(batch_anthropic_id)
  WHERE execution_intent = 'batched_24h'
    AND queue_status IN ('queued', 'dispatched');

-- Index supporting the batch submitter's "what's queued for batching"
-- query — batches accumulate until min_batch_size is reached or
-- max_wait_minutes elapses.
CREATE INDEX agent_jobs_pending_batch_buffer_idx
  ON agent_jobs(execution_intent, traffic_class, queued_at)
  WHERE execution_intent = 'batched_24h'
    AND queue_status = 'queued'
    AND batch_anthropic_id IS NULL;
