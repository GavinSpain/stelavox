-- Migration 080 — V1.x-A.1: project_profiles table.
-- Source: stelavox_director_architecture_v2_1_0.md §6.1.2.
--
-- Project Profile is the persistent identity artefact: one per document,
-- never completes, mutated only via amendments. Holds voice, constraints,
-- decisions, named entities, optional project goal text. Auto-created
-- when a document is created (extended create_document_with_layer_stack
-- RPC in Migration 085).

CREATE TABLE project_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  goal_text TEXT,                                  -- optional project-level vision
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {voice, constraints[], decisions[], named_entities{}}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_profiles_organisation_id ON project_profiles(organisation_id);
CREATE INDEX idx_project_profiles_document_id ON project_profiles(document_id);

ALTER TABLE project_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_project_profiles" ON project_profiles
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
