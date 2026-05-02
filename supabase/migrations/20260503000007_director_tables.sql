-- Migration 005 — Director Tables
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 005

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  conversation_summary TEXT,
  summary_covers_through INTEGER,     -- sequence number of last summarised message
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id)                 -- one conversation per document
);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_conversations" ON conversations
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  tool_calls JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_conversation_messages_conversation_id
  ON conversation_messages(conversation_id, sequence);
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_conversation_messages" ON conversation_messages
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations c
      WHERE c.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  title TEXT NOT NULL,
  description TEXT,
  impact_summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','running','paused','completed','cancelled')),
  estimated_total_minutes INTEGER,
  locked_nodes_requiring_unlock TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_workflows" ON workflows
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  target_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
  parameters JSONB DEFAULT '{}',
  description TEXT,
  estimated_duration_seconds INTEGER,
  depends_on_step_orders INTEGER[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','skipped','removed')),
  agent_job_id UUID REFERENCES agent_jobs(id),
  result_summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_workflow_steps" ON workflow_steps
  FOR ALL USING (
    workflow_id IN (
      SELECT id FROM workflows w
      WHERE w.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );
