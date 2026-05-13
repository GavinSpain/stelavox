-- Migration 082 — V1.x-A.1: briefs table (operation-level).
-- Source: stelavox_director_architecture_v2_1_0.md §6.2.2.
--
-- Brief is the operation plan artefact. Multiple per document over time
-- (in V1.x-B+); ONE active at a time per document during V1.x-A.1,
-- enforced by a partial unique index on status IN ('planned','active').
--
-- status enum: planned (proposed, awaiting user approval) → active
-- (approved, stages executing) → completed (all stages done) or
-- cancelled (user cancelled).
--
-- current_stage_id is added without an FK here because brief_stages
-- doesn't exist yet — added in M-083.

CREATE TABLE briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  goal_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','active','completed','cancelled')),
  current_stage_id UUID,                          -- FK added in M-083
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_briefs_document_id ON briefs(document_id, created_at DESC);
CREATE INDEX idx_briefs_organisation_id ON briefs(organisation_id);

-- V1.x-A.1 one-at-a-time constraint. The partial unique index allows
-- multiple completed/cancelled Briefs per document but only one active.
-- Lifts in V1.x-B alongside multi-Brief coordination.
CREATE UNIQUE INDEX briefs_one_active_per_document_uidx
  ON briefs(document_id)
  WHERE status IN ('planned','active');

ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_briefs" ON briefs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
