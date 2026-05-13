-- Migration 070 — V1.x-A Brief table.
-- Source: stelavox_director_architecture_v2_0.md §6.2 + stelavox_technical_architecture_v2_3.md §3.6.
--
-- The Brief is the Director's canonical durable memory for the life of a
-- project. Holds the user's macro-intent in structured, queryable form:
-- goal, stage roadmap (in brief_stages, Migration 071), voice preferences,
-- project-level constraints, named design decisions, completion history.
--
-- Schema is hybrid relational + JSONB. Top-level scalars for indexing and
-- state machines; JSONB for evolving model-friendly content.
--
-- One Brief per document, enforced both via UNIQUE on briefs.document_id
-- here and via UNIQUE on documents.brief_id in Migration 073. Backfill of
-- existing documents into Briefs also lands in Migration 073; the empty-
-- Brief-on-document-creation path is wired in Migration 074.
--
-- current_stage_id is created without an FK reference because brief_stages
-- doesn't exist yet — the FK is added in Migration 071 (deferrable).
--
-- Single RLS policy "org_members_access_briefs" with FOR ALL USING the
-- standard organisation-membership check. Writes are gated through the
-- SECURITY DEFINER RPCs in Migration 075 (apply_brief_proposal,
-- apply_brief_amendment) — the RLS policy is the read gate plus a
-- defence-in-depth check against ad-hoc INSERT/UPDATE via the anon key.

CREATE TABLE briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','cancelled','archived')),
  goal_text TEXT,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_stage_id UUID,                          -- FK added in Migration 071
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_briefs_organisation_id ON briefs(organisation_id);
CREATE INDEX idx_briefs_document_id ON briefs(document_id);

ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_briefs" ON briefs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
