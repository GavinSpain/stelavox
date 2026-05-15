-- Migration 118 — V1.x-B.2.3: anthropic_batches table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-118 +
--         Director Architecture v2.0 §4.4 (batched_24h Anthropic Batch API).
--
-- One row per submitted Anthropic batch. The submitter inserts on
-- POST /v1/messages/batches success; the poller updates status +
-- completed_count + polled_at on each poll cycle.
--
-- pool_key — which token bucket the batch was submitted under. The
-- Anthropic Batch API charges the calling key, so a batch submitted on
-- the platform key counts against the platform pool, and a BYOK batch
-- counts against that user's BYOK pool.
--
-- status mirrors Anthropic's processing_status field:
--   in_progress — batch accepted, processing
--   ended       — Anthropic returned all results (we then fetch + write back)
--   failed      — batch-level failure (whole batch unusable)
--   cancelled   — admin cancelled the batch via Anthropic console
--
-- Note Anthropic uses 'ended' (not 'completed'). When status='ended'
-- AND we've successfully read + applied all results, our poller updates
-- completed_at + leaves status='ended'. completed_at therefore tracks
-- "all results processed by us" not "Anthropic finished processing".

CREATE TABLE anthropic_batches (
  id TEXT PRIMARY KEY,
  -- ^ Anthropic-returned batch ID. Format: "msgbatch_<token>".
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Last time we polled the batch's status from Anthropic.
  polled_at TIMESTAMPTZ NULL,
  -- When all per-request results were retrieved + written back to
  -- agent_jobs by us. Distinct from Anthropic's 'ended' transition.
  completed_at TIMESTAMPTZ NULL,
  poll_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'ended', 'failed', 'cancelled')),
  request_count INTEGER NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  pool_key TEXT NOT NULL
);

CREATE INDEX anthropic_batches_in_progress_idx
  ON anthropic_batches(status, submitted_at)
  WHERE status = 'in_progress';

ALTER TABLE anthropic_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_anthropic_batches" ON anthropic_batches
  FOR ALL USING (FALSE);
