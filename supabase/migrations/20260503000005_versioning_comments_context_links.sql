-- Migration 003 — Versioning, Comments, Context Links
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 003

-- Node versions (every content change creates a row here)
CREATE TABLE node_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  summary TEXT,
  prose TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  changed_by TEXT NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_node_versions_node_id ON node_versions(node_id);
ALTER TABLE node_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_node_versions" ON node_versions
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Editorial comments
CREATE TABLE node_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES node_comments(id),
  author_type TEXT NOT NULL CHECK (author_type IN ('human','agent')),
  author_label TEXT NOT NULL,
  agent_job_id UUID,
  comment_type TEXT NOT NULL
    CHECK (comment_type IN ('instruction','question','note','critique','approval')),
  content TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE node_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_node_comments" ON node_comments
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Context links (structural ↔ context and context ↔ context)
CREATE TABLE node_context_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'structural_to_context'
    CHECK (link_type IN ('structural_to_context','context_to_context')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_node_id, target_node_id)
);
ALTER TABLE node_context_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_context_links" ON node_context_links
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
