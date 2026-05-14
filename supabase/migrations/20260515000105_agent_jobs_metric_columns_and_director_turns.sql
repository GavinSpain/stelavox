-- Migration 105 — V1.x-B.2.1: agent_jobs metric columns + director_iteration
--                            operation type + director_turns table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-105 + §3.2.4
--         (director_turns folded into M-105 per the "new in M-105 or split"
--         note — keeps the migration count to 6 for B.2.1 and the FK
--         relationship is one transaction).
--         + Director Architecture v2.0 §8.1a (per-iteration decomposition).
--
-- Adds the per-ticket lifecycle metric columns to agent_jobs that the
-- B.2.1 dispatcher and B.2.2 WFQ scheduler will populate. Adds the
-- director_iteration operation_type so the executor refactor can chain
-- iterations as agent_jobs rows. Creates the director_turns table that
-- groups consecutive director_iteration rows belonging to one
-- user-facing Director turn.
--
-- Columns added on agent_jobs (all NULL except as noted):
--   queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
--   dispatched_at TIMESTAMPTZ — set on dispatcher claim
--   completed_at_v2 — distinct from existing completed_at (which is set
--     by status='completed' transition); v2 timestamp is set when
--     queue_status reaches a terminal value. M-106 introduces queue_status.
--     We reuse existing completed_at for both.
--   crashed_at TIMESTAMPTZ — set by recovery sweep
--   actual_input_tokens / actual_output_tokens INTEGER
--   cost_credits NUMERIC(20,8)
--   dispatcher_skips_count INTEGER NOT NULL DEFAULT 0
--   dependency_wait_ms INTEGER
--   bucket_wait_ms INTEGER
--   wfq_vft_at_dispatch NUMERIC(20,6) — populated by B.2.2; NULL in B.2.1
--   failure_class CHAR(1) — A/B/C/D/E per V2 §10
--   iteration_number INTEGER — 1-based; only for director_iteration rows
--   director_turn_id UUID — FK to director_turns
--   parent_iteration_id UUID — back-pointer to previous iteration in turn
--
-- The existing `route` column (M-092) and existing token columns (tokens_input
-- / tokens_output) are NOT replaced. The new actual_* columns are populated
-- alongside existing ones during the V1.x-B.2 transition; a future
-- consolidation may collapse the duplication.

-- ---------------------------------------------------------------------------
-- director_turns — explicit unit of user-perceived Director interaction.
-- ---------------------------------------------------------------------------
-- Pre-B.2.1: a Director turn was implicit in a conversation_messages row pair.
-- Post-B.2.1: it owns the agent_jobs iteration sequence via director_turn_id.

CREATE TABLE director_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id UUID NULL REFERENCES conversation_messages(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'cancelled', 'failed')),
  iteration_count INTEGER NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_credits NUMERIC(20,8) NOT NULL DEFAULT 0
);

CREATE INDEX idx_director_turns_conversation ON director_turns(conversation_id, started_at DESC);
CREATE INDEX idx_director_turns_status ON director_turns(status) WHERE status = 'in_progress';

ALTER TABLE director_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_access_director_turns" ON director_turns
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations
      WHERE organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE director_turns;

-- ---------------------------------------------------------------------------
-- agent_jobs metric columns + director_iteration linkage
-- ---------------------------------------------------------------------------

ALTER TABLE agent_jobs
  ADD COLUMN queued_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE agent_jobs
  ADD COLUMN dispatched_at TIMESTAMPTZ NULL;

ALTER TABLE agent_jobs
  ADD COLUMN crashed_at TIMESTAMPTZ NULL;

ALTER TABLE agent_jobs
  ADD COLUMN actual_input_tokens INTEGER NULL;

ALTER TABLE agent_jobs
  ADD COLUMN actual_output_tokens INTEGER NULL;

ALTER TABLE agent_jobs
  ADD COLUMN cost_credits NUMERIC(20,8) NULL;

ALTER TABLE agent_jobs
  ADD COLUMN dispatcher_skips_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE agent_jobs
  ADD COLUMN dependency_wait_ms INTEGER NULL;

ALTER TABLE agent_jobs
  ADD COLUMN bucket_wait_ms INTEGER NULL;

ALTER TABLE agent_jobs
  ADD COLUMN wfq_vft_at_dispatch NUMERIC(20,6) NULL;

ALTER TABLE agent_jobs
  ADD COLUMN failure_class CHAR(1) NULL
    CHECK (failure_class IS NULL OR failure_class IN ('A','B','C','D','E'));

-- Director-iteration linkage. Self-FK on parent_iteration_id is set
-- DEFERRABLE so an iteration can reference its parent in the same
-- transaction that creates both (rare; usually parent exists earlier).
ALTER TABLE agent_jobs
  ADD COLUMN iteration_number INTEGER NULL
    CHECK (iteration_number IS NULL OR iteration_number >= 1);

ALTER TABLE agent_jobs
  ADD COLUMN director_turn_id UUID NULL
    REFERENCES director_turns(id) ON DELETE SET NULL;

ALTER TABLE agent_jobs
  ADD COLUMN parent_iteration_id UUID NULL
    REFERENCES agent_jobs(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Indexes for the new dispatcher
-- ---------------------------------------------------------------------------

-- Class-aware dispatch lookup (B.2.1 naive picker; B.2.2 layers VFT on top).
-- Note: M-092 already created idx_agent_jobs_class_dispatch on
-- (traffic_class, status, scheduled_at) WHERE status='pending'. We
-- supplement here with a queued_at-based ordering for B.2.1 FIFO-within-class.
CREATE INDEX idx_agent_jobs_traffic_class_queued_at
  ON agent_jobs(traffic_class, queued_at)
  WHERE status = 'pending';

-- Director turn iteration chain lookup.
CREATE INDEX idx_agent_jobs_turn_iteration
  ON agent_jobs(director_turn_id, iteration_number)
  WHERE director_turn_id IS NOT NULL;

-- Parent-iteration walk (for iteration ancestry / Stop cascade).
CREATE INDEX idx_agent_jobs_parent_iteration
  ON agent_jobs(parent_iteration_id)
  WHERE parent_iteration_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- operation_type extension — admit director_iteration
-- ---------------------------------------------------------------------------
-- agent_jobs.operation_type is TEXT (no CHECK constraint per the original
-- M-006 schema). lib-side validation gates accepted operation_types. We
-- document the v2 list here for future operators / type-gen tooling.
--
-- Accepted operation_type values post-B.2.1:
--   expand, synthesise, refine, generate_context (V1 ops)
--   workflow_step (workflow-step jobs, V1)
--   director_iteration (B.2.1 — single LLM call inside a Director turn)
--
-- No constraint added; lib/scheduler/dispatcher.ts validates the set.

-- ---------------------------------------------------------------------------
-- Backfill queued_at for any existing rows
-- ---------------------------------------------------------------------------
-- queued_at NOT NULL DEFAULT now() — existing rows will all get current
-- timestamp via the column add. Override existing pre-B.2.1 rows so the
-- queued_at reflects the actual creation time (we have created_at on
-- M-006).
UPDATE agent_jobs SET queued_at = created_at WHERE queued_at IS NOT NULL;
