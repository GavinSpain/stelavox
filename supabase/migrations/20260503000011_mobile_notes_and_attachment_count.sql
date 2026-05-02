-- Migration 009 — Mobile Notes and Attachment Count Fields
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 009
-- Migration 002 already includes both columns; the IF NOT EXISTS clauses make
-- this migration a no-op when applied on top of an already-current schema.

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS
  mobile_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS
  attachment_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_nodes_mobile_notes
  ON nodes USING GIN(mobile_notes);
