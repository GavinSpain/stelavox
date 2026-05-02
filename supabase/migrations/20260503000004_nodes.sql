-- Migration 002 — Nodes
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 002

CREATE TABLE nodes (
  -- Identity & Hierarchy
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_category TEXT NOT NULL CHECK (node_category IN ('structural','context')),
  node_type TEXT NOT NULL,
  parent_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL DEFAULT 1,
  depth INTEGER NOT NULL DEFAULT 0,
  layer_index INTEGER,
  scope TEXT CHECK (scope IN ('project','document')),

  -- Versioning & Audit
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL DEFAULT 'user',
  last_modified_by TEXT NOT NULL DEFAULT 'user',

  -- Naming & Description
  name TEXT,
  short_description TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Content
  summary TEXT,
  prose TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  -- Editorial & Workflow
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_review','approved','locked')),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason TEXT,
  locked_at TIMESTAMPTZ,
  locked_version INTEGER,
  agent_instruction TEXT,
  word_count_target INTEGER,
  word_count_actual INTEGER,

  -- Mobile & Attachments
  mobile_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachment_count INTEGER NOT NULL DEFAULT 0,

  -- Export & Integration
  export_include BOOLEAN NOT NULL DEFAULT TRUE,
  export_heading_override TEXT,
  export_page_break_before BOOLEAN NOT NULL DEFAULT FALSE,
  external_ref TEXT
);

CREATE INDEX idx_nodes_document_id ON nodes(document_id);
CREATE INDEX idx_nodes_project_id ON nodes(project_id);
CREATE INDEX idx_nodes_parent_id ON nodes(parent_id);
CREATE INDEX idx_nodes_organisation_id ON nodes(organisation_id);
CREATE INDEX idx_nodes_node_type ON nodes(node_type);
CREATE INDEX idx_nodes_mobile_notes ON nodes USING GIN(mobile_notes);

ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_nodes" ON nodes
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organisation_members om ON om.organisation_id = p.organisation_id
      WHERE om.user_id = auth.uid()
    )
  );
