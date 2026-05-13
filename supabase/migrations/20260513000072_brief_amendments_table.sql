-- Migration 072 — V1.x-A Brief amendments table.
-- Source: stelavox_director_architecture_v2_0.md §6.2.
--
-- Append-only audit + replay log. Every Brief mutation (initial proposal,
-- subsequent deltas) writes a row here. The before/after JSONB pair
-- captures the change for replay and audit. Existing rows are never
-- updated or deleted; the table is INSERT-only via the SECURITY DEFINER
-- RPCs in Migration 075.
--
-- For initial Brief proposals (apply_brief_proposal): proposed_by is
-- 'director' (since the Director's tool produced the proposal), before is
-- {} (empty), after is the full proposed Brief state at the goal_text +
-- preferences + stages level. amendment_type is 'initial_brief'.
--
-- For delta amendments (apply_brief_amendment): proposed_by is 'director'
-- when surfaced via the Director's propose_brief_amendment tool, 'user'
-- when (future) direct-edit paths land. amendment_type is a short
-- identifier (add_constraint, update_voice, rename_protagonist,
-- insert_stage, etc.). target_path is the dotted JSONB path being changed.
--
-- approved_at + approved_by_user_id are populated at write time by the RPC
-- — there is no "draft" state for amendments in V1.x-A. A proposal that
-- the user has not approved lives in the conversation_messages content
-- (as a <brief_amendment_proposal> block) and never reaches this table.
-- Only approved amendments are persisted here.
--
-- RLS: read-only via FOR SELECT (no FOR ALL — writes happen through the
-- SECURITY DEFINER RPCs which bypass RLS).

CREATE TABLE brief_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('user','director')),
  amendment_type TEXT NOT NULL,
  target_path TEXT,                               -- nullable for 'initial_brief'
  before JSONB NOT NULL DEFAULT '{}'::jsonb,
  after JSONB NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brief_amendments_brief_id ON brief_amendments(brief_id, created_at DESC);

ALTER TABLE brief_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_read_brief_amendments" ON brief_amendments
  FOR SELECT USING (
    brief_id IN (
      SELECT id FROM briefs b
      WHERE b.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );
