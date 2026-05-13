-- Migration 084 — V1.x-A.1: documents.profile_id FK + backfill + NOT NULL.
-- Source: stelavox_director_architecture_v2_1_0.md §6.1.2.
--
-- One Project Profile per document, enforced by UNIQUE on
-- project_profiles.document_id and a UNIQUE index on documents.profile_id.
--
-- FK is DEFERRABLE INITIALLY DEFERRED so the create_document_with_layer_stack
-- RPC (extended in M-085) can insert documents + project_profiles in
-- either order within one transaction.
--
-- Backfill: for each existing document (Shadow Protocol on local dev),
-- insert an empty Project Profile and set documents.profile_id.

ALTER TABLE documents ADD COLUMN profile_id UUID;

-- Backfill: insert empty Profile for any document without one (idempotent).
INSERT INTO project_profiles (document_id, organisation_id, preferences)
SELECT d.id, d.organisation_id, '{}'::jsonb
FROM documents d
WHERE NOT EXISTS (
  SELECT 1 FROM project_profiles p WHERE p.document_id = d.id
);

UPDATE documents d
SET profile_id = p.id
FROM project_profiles p
WHERE p.document_id = d.id AND d.profile_id IS NULL;

ALTER TABLE documents ALTER COLUMN profile_id SET NOT NULL;

ALTER TABLE documents
  ADD CONSTRAINT documents_profile_id_fk
  FOREIGN KEY (profile_id) REFERENCES project_profiles(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX documents_profile_id_unique ON documents(profile_id);
