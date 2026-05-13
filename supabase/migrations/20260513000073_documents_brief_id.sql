-- Migration 073 — V1.x-A documents.brief_id FK + backfill + NOT NULL.
-- Source: stelavox_director_architecture_v2_0.md §6.2 (one Brief per
-- document, 1:1 in both directions).
--
-- This migration enforces the "every document has exactly one Brief"
-- invariant. Four steps:
--
--   1. Add briefs_id as nullable.
--   2. Backfill: for every existing document without a Brief, INSERT a
--      new empty Brief row, then UPDATE documents.brief_id to match.
--      The Shadow Protocol test document in the V1.x-LB snapshot is the
--      backfill target on local; any documents in stelavox-dev cloud get
--      the same treatment when the migration applies there.
--   3. Set NOT NULL on documents.brief_id.
--   4. Add FK to briefs(id) ON DELETE RESTRICT (because deleting a Brief
--      should never silently orphan its document) and UNIQUE (to enforce
--      1:1 in this direction; briefs.document_id UNIQUE handles the other).
--
-- The empty-Brief-at-document-creation path for NEW documents lands in
-- Migration 074 by extending create_document_with_layer_stack.

-- Step 1: add column nullable.
ALTER TABLE documents ADD COLUMN brief_id UUID;

-- Step 2: backfill. INSERT an empty Brief for any document that has none.
INSERT INTO briefs (document_id, organisation_id, status, preferences)
SELECT d.id, d.organisation_id, 'active', '{}'::jsonb
FROM documents d
WHERE NOT EXISTS (
  SELECT 1 FROM briefs b WHERE b.document_id = d.id
);

-- Then point documents.brief_id at the just-inserted (or pre-existing) Brief.
UPDATE documents d
SET brief_id = b.id
FROM briefs b
WHERE b.document_id = d.id AND d.brief_id IS NULL;

-- Step 3: lock down NOT NULL now that all rows are populated.
ALTER TABLE documents ALTER COLUMN brief_id SET NOT NULL;

-- Step 4: FK + unique. ON DELETE RESTRICT prevents orphaning a document
-- by deleting its Brief — the Brief's own ON DELETE CASCADE on document_id
-- (Migration 070) handles the inverse case where a document is deleted.
ALTER TABLE documents
  ADD CONSTRAINT documents_brief_id_fk
  FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX documents_brief_id_unique ON documents(brief_id);
