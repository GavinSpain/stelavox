-- Migration 071 — V1.x-A Brief stages table.
-- Source: stelavox_director_architecture_v2_0.md §6.2 + §6.5.
--
-- A Brief's roadmap is a sequence of stages. Each stage has a trigger that
-- controls when it advances:
--   - after_stage   — run when stage N completes (default series case)
--   - scheduled_at  — fixed time
--   - manual        — parked; user releases explicitly
--   - compound      — multiple conditions combined (after_stage AND ...)
--
-- V1.x-A ships the stage data model and lets stages be displayed and
-- manually approved. **Triggers do not fire in V1.x-A.** The scheduler that
-- evaluates triggers and invokes the Director (V2 doc §8.4) is V1.x-B's
-- responsibility. Stages will reach the 'approved' status via the StageCard
-- approval action and sit there until V1.x-B's scheduler picks them up.
--
-- order is quoted because it is a reserved keyword (same pattern as
-- workflow_steps."order" in Migration 005). UNIQUE (brief_id, "order")
-- enforces deduplication of stage positions within a Brief.
--
-- After this table exists, we add the FK on briefs.current_stage_id back
-- to brief_stages.id with ON DELETE SET NULL — a stage removal nulls the
-- pointer instead of cascading to delete the Brief. SET NULL also covers
-- the case where the only stage in a Brief is deleted.

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
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brief_id, "order")
);

CREATE INDEX idx_brief_stages_brief_id ON brief_stages(brief_id, "order");

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
