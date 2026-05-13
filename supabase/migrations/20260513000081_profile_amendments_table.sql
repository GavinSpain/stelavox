-- Migration 081 — V1.x-A.1: profile_amendments table.
-- Source: stelavox_director_architecture_v2_1_0.md §6.1.2.
--
-- Append-only audit log for Project Profile changes. Writes only via the
-- apply_profile_amendment SECURITY DEFINER RPC (M-086); SELECT-only RLS.

CREATE TABLE profile_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES project_profiles(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('user','director')),
  amendment_type TEXT NOT NULL,
  target_path TEXT,                                -- e.g. 'preferences.constraints'; nullable for goal_text
  before JSONB NOT NULL DEFAULT '{}'::jsonb,
  after JSONB NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profile_amendments_profile_id ON profile_amendments(profile_id, created_at DESC);

ALTER TABLE profile_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_read_profile_amendments" ON profile_amendments
  FOR SELECT USING (
    profile_id IN (
      SELECT id FROM project_profiles p
      WHERE p.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );
