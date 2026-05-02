-- Migration 011 — Director Config and Scheduler
-- Source: stelavox_technical_architecture_v1_3.md §3.6 Migration 011

CREATE TABLE director_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'production'
    CHECK (status IN ('production','deprecated')),
  system_prompt TEXT NOT NULL,
  tool_suite JSONB NOT NULL DEFAULT '[]',
  model_id TEXT NOT NULL DEFAULT 'claude-opus-4-6',
  model_params JSONB NOT NULL DEFAULT '{}',
  capability_flags JSONB NOT NULL DEFAULT '{}',
  release_notes TEXT,
  promoted_at TIMESTAMPTZ DEFAULT NOW(),
  deprecated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce single production config at all times
CREATE UNIQUE INDEX idx_director_configs_one_production
  ON director_configs(status) WHERE status = 'production';

-- Per TA §3.3 ("every table has RLS enabled"). The §3.6 Migration 011 listing
-- omits this; flagged for SU follow-up. director_configs is a global registry
-- of Director versions, not user data — RLS is enabled with no user-facing
-- policy, so reads happen via the service-role client only (Phase 5+).
ALTER TABLE director_configs ENABLE ROW LEVEL SECURITY;

-- Document-level Director version pin.
-- The director_config_id COLUMN is declared in Migration 001; here we add the FK
-- now that director_configs exists. (TA v1.3 §3.6 Migration 011 wrote this as
-- `ADD COLUMN ... REFERENCES ...` which fails because the column already
-- exists. Spec-error fix flagged in the Phase 1 test report for SU follow-up.)
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_director_config_id_fkey;
ALTER TABLE documents
  ADD CONSTRAINT documents_director_config_id_fkey
  FOREIGN KEY (director_config_id) REFERENCES director_configs(id) ON DELETE SET NULL;

-- Scheduled jobs
CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'document_operation','director_workflow','context_regeneration','backup'
  )),
  job_config JSONB NOT NULL DEFAULT '{}',
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once','recurring')),
  run_at TIMESTAMPTZ NOT NULL,
  cron_expression TEXT,              -- for recurring jobs
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','complete','failed','cancelled')),
  run_count INTEGER NOT NULL DEFAULT 0,
  defer_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_scheduled_jobs" ON scheduled_jobs
  FOR ALL USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Seed: Director v1.0 production config
-- The system_prompt is a placeholder until Phase 5; the placeholder is stored
-- verbatim per Build Checklist T-3.11 so the row exists and the unique-production
-- index is populated.
INSERT INTO director_configs (version_number, display_name, status, system_prompt, tool_suite, model_id, model_params, capability_flags)
VALUES (
  '1.0',
  'Director v1.0 — Production',
  'production',
  '-- loaded from supabase/seed/director-v1.0.txt --',
  '["get_document_state","get_node","get_nodes_by_layer","get_node_tree","assess_downstream_impact","get_conversation_history","get_workflow_history","create_expand_step","create_synthesise_step","create_refine_step","create_context_step","create_comment_step","create_document_operation_step"]'::jsonb,
  'claude-opus-4-6',
  '{"temperature": 0.7, "max_tokens": 8192, "extended_thinking": false}'::jsonb,
  '{"research_enabled": false, "multi_step_enabled": true, "proactive_observations_enabled": false, "batch_operations_enabled": false}'::jsonb
);
