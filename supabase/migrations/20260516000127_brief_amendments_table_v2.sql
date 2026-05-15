-- Migration 127 — V1.x-B.3: brief_amendments table (V2 shape).
--
-- Source: stelavox_v1x_b_3_build_checklist_v1_0.md §2 M-127 +
--         Director Architecture v2.0 §6 (Brief).
--
-- The original V1.x-A `brief_amendments` table was dropped by V1.x-A.1
-- M-079 (along with the rest of the V1.x-A schema). V1.x-B.3 lands a
-- fresh table with the operation-level amendment shape — Profile
-- amendments stay on `profile_amendments` (V1.x-A.1).
--
-- amendment_type discriminates what the amendment changes:
--   'goal_text'              — UPDATE briefs.goal_text
--   'preferences'            — UPDATE briefs.preferences (deep merge)
--   'add_stage'              — INSERT brief_stages (must be > current_stage_id's order)
--   'modify_pending_stage'   — UPDATE brief_stages WHERE status='planned'
--   'remove_pending_stage'   — DELETE brief_stages WHERE status='planned'
--                              (refused if it would leave zero pending stages)
--
-- Amendments to already-running stages are refused — locked completed
-- stages are immutable per the build checklist's out-of-scope note.
--
-- target_path is a free-text dotted-path or array index into the
-- amendment shape (e.g. 'preferences.voice_rules[2]' for a specific
-- preference rule update). NULL when amendment_type doesn't need a path
-- (e.g. add_stage which appends).
--
-- before/after JSONB carry the diff for UI rendering of the change preview.

CREATE TABLE brief_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proposed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amendment_type TEXT NOT NULL CHECK (amendment_type IN (
    'goal_text', 'preferences', 'add_stage', 'modify_pending_stage', 'remove_pending_stage'
  )),
  target_path TEXT NULL,
  before JSONB NULL,
  after JSONB NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected')),
  approved_at TIMESTAMPTZ NULL,
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX brief_amendments_brief_status_idx
  ON brief_amendments(brief_id, status);

ALTER TABLE brief_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_access_brief_amendments" ON brief_amendments
  FOR ALL USING (
    brief_id IN (
      SELECT id FROM briefs
      WHERE organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE brief_amendments;
