-- Migration 113 — V1.x-B.2.2: class_1_reserved_slots singleton.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-113 +
--         Director Architecture v2.0 §9.5 (Class 1 reserved slots).
--
-- Class 1 (interactive Director turns the user is watching) gets
-- reserved concurrent-connection slots that no other class can take.
-- Distinct from token bucket: this counts CONCURRENT CONNECTIONS to
-- Anthropic, not tokens.
--
-- Three states a Class 1 dispatch attempt can land in:
--   'reserved' — claimed a reserved slot (in_use < total_slots)
--   'overflow' — reserved slots full but non-class-1 hasn't filled its
--                cap; took an overflow slot
--   'denied'   — both reserved + overflow exhausted; ticket re-queued
--
-- Released at runner completion or recovery sweep (lib/scheduler/reserved-slots.ts).
--
-- Default total_slots=3 per platform_config M-114.

CREATE TABLE class_1_reserved_slots (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  total_slots INTEGER NOT NULL CHECK (total_slots >= 0),
  in_use INTEGER NOT NULL DEFAULT 0 CHECK (in_use >= 0)
);

INSERT INTO class_1_reserved_slots (id, total_slots) VALUES (1, 3);

ALTER TABLE class_1_reserved_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_class_1_reserved_slots" ON class_1_reserved_slots
  FOR ALL USING (FALSE);
