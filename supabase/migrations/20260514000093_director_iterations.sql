-- Migration 093 — V1.x-B.1.1: director_iterations table.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.3
--         + Director Architecture v2.0 §8.1a (per-iteration decomposition)
--         + design record §6.
--
-- Per-iteration substrate for Director-turn execution. Each Director
-- conversational turn decomposes into N iteration jobs, each:
--   - One Anthropic streaming call (atomic).
--   - State persisted at iteration end (messages_snapshot,
--     accumulated_proposals).
--   - Heartbeat written every director.iteration_heartbeat_interval_seconds.
--   - On completion: enqueue iteration N+1 if more needed; exit.
--
-- Crash recovery is automatic at iteration boundaries: a stale heartbeat
-- + status=running → status=interrupted (recovery sweep), and the
-- scheduler re-enqueues the same iteration_number (idempotent — see
-- design record §6 idempotency invariant).
--
-- failure_class — 5-class taxonomy as data shape (Director Arch §10):
--   A — transient (auto-recoverable)
--   B — interrupted (resumable)
--   C — capacity (Director-acknowledged) — empty in B.1.1; lights up in B.2
--   D — validation / safety
--   E — hard system

CREATE TABLE director_iterations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  iteration_number INTEGER NOT NULL CHECK (iteration_number >= 1),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','interrupted','cancelled')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  failure_class TEXT
    CHECK (failure_class IS NULL OR failure_class IN ('A','B','C','D','E')),
  failure_message TEXT,
  messages_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  accumulated_proposals JSONB NOT NULL DEFAULT '[]'::jsonb,
  tokens_in BIGINT,
  tokens_out BIGINT,
  cost_credits BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (turn_id, iteration_number)
);

CREATE INDEX idx_director_iterations_turn
  ON director_iterations(turn_id, iteration_number);

-- Recovery sweep query support — find stale-heartbeat running iterations.
CREATE INDEX idx_director_iterations_recovery_sweep
  ON director_iterations(status, last_heartbeat_at)
  WHERE status = 'running';

ALTER TABLE director_iterations ENABLE ROW LEVEL SECURITY;

-- RLS scoped via turn_id → agent_jobs → organisation.
CREATE POLICY "org_members_access_director_iterations" ON director_iterations
  FOR ALL USING (
    turn_id IN (
      SELECT id FROM agent_jobs aj
      WHERE aj.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE director_iterations;
