-- Migration 108 — V1.x-B.2.1: stop_requests table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-108
--         + Director Architecture v2.0 §13 (Stop semantics).
--
-- A Stop request is a durable record. Inserted by:
--   - POST /api/director/turns/[turnId]/stop  (single Director turn)
--   - POST /api/scheduler/stop                (generic: turn / workflow / brief)
--
-- Consumed by:
--   - lib/scheduler/dispatcher.ts — at every tick, refuses to dispatch
--     any ticket whose ancestry includes an active stop_request
--   - lib/director/iteration-runner.ts — checks before each LLM call and
--     on response receipt; aborts cooperatively if Stop is active
--
-- Cascade semantics:
--   target_kind='director_turn' — cancels in-flight + queued iterations
--     for that director_turn_id
--   target_kind='workflow' — cancels in-flight + queued workflow_step
--     agent_jobs for that workflow_id (lib/director/workflow-executor.ts)
--   target_kind='brief' — cancels in-flight + queued work for any active
--     workflow under any stage of the brief (B.2.1 implements basic
--     fan-out; richer cascade preview deferred to B.2.4 polish)
--
-- completed_at is set by the dispatcher when the Stop fully cascades
-- (all matching tickets have reached a terminal queue_status).

CREATE TABLE stop_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('director_turn','workflow','brief')),
  target_id UUID NOT NULL,
  reason TEXT NULL,
  cascade_count INTEGER NULL,
  completed_at TIMESTAMPTZ NULL,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE
);

CREATE INDEX stop_requests_active_idx
  ON stop_requests(target_kind, target_id)
  WHERE completed_at IS NULL;

CREATE INDEX stop_requests_org_recent_idx
  ON stop_requests(organisation_id, requested_at DESC);

ALTER TABLE stop_requests ENABLE ROW LEVEL SECURITY;

-- RLS — org members can read; INSERT goes through service-role API routes
-- that have already verified user identity + org membership.
CREATE POLICY "org_members_read_stop_requests" ON stop_requests
  FOR SELECT USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE stop_requests;
