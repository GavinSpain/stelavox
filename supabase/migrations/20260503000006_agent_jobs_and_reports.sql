-- Migration 004 — Agent Jobs and Reports
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 004

CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL,
  operation_class TEXT NOT NULL DEFAULT 'single_node'
    CHECK (operation_class IN ('single_node','document_operation')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  triggered_by TEXT NOT NULL,         -- user ID, 'scheduled', or 'workflow_step'
  tokens_input INTEGER,
  tokens_output INTEGER,
  tokens_cache_write INTEGER DEFAULT 0,
  tokens_cache_read INTEGER DEFAULT 0,
  model_id TEXT,
  provider TEXT,
  context_snapshot JSONB,             -- full assembled prompt stored for auditability
  result_summary TEXT,
  result_report_id UUID,              -- for document operations
  batch_id TEXT,                      -- for Batch API jobs (V2)
  job_progress JSONB DEFAULT '{}',    -- for document operations: chunk progress
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_agent_jobs_organisation_id ON agent_jobs(organisation_id);
CREATE INDEX idx_agent_jobs_node_id ON agent_jobs(node_id);
CREATE INDEX idx_agent_jobs_status ON agent_jobs(status);
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_agent_jobs" ON agent_jobs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE agent_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  agent_job_id UUID REFERENCES agent_jobs(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  findings JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dismissed')),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE agent_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_agent_reports" ON agent_reports
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );
