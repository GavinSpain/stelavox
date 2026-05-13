-- Migration 083 — V1.x-A.1: brief_stages table.
-- Source: stelavox_director_architecture_v2_1_0.md §6.2.2.
--
-- A Brief's stages. Stage 1's workflow is planned at Brief proposal time;
-- stages 2..N have nullable workflow_id until the stage activates (the
-- Director plans the workflow just-in-time then). After this table
-- exists, the briefs.current_stage_id FK is added.

CREATE TABLE brief_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL CHECK ("order" >= 1),
  title TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('after_stage','scheduled_at','manual','compound')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','proposing','proposed','approved','scheduled','running','completed','cancelled','skipped')),
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,  -- nullable; just-in-time planning for stages 2..N
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brief_id, "order")
);

CREATE INDEX idx_brief_stages_brief_id ON brief_stages(brief_id, "order");
CREATE INDEX idx_brief_stages_workflow_id ON brief_stages(workflow_id) WHERE workflow_id IS NOT NULL;

ALTER TABLE brief_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_brief_stages" ON brief_stages
  FOR ALL USING (
    brief_id IN (
      SELECT id FROM briefs b
      WHERE b.organisation_id IN (
        SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
      )
    )
  );

ALTER TABLE briefs
  ADD CONSTRAINT briefs_current_stage_id_fk
  FOREIGN KEY (current_stage_id) REFERENCES brief_stages(id) ON DELETE SET NULL;
