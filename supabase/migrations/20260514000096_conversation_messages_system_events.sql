-- Migration 096 — V1.x-B.1.1: conversation_messages system-event extensions.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.6
--         + design record §11 + §12 (tiered system event surfacing).
--
-- The Director conversation extends from strict user-prompts-Director-
-- replies to a two-way model that admits system-initiated turns. The
-- mechanism is a single new role ('system') with typed event metadata.
--
-- Two rendering modes for system rows (decided client-side per event_type):
--   - Lightweight inline message ("Brief B activated · 2:14pm") for
--     events that just need acknowledgement: brief_activated,
--     brief_completed, cancel_cascade, stop, resume.
--   - Full Director turn (with subtle SystemTurnHeader cause label and
--     normal PlanCard etc.) for stage_trigger_fired — the system event
--     prompts the Director to plan the activated stage's workflow.
--
-- Routine parameter edits (reschedule, intent toggle) emit NO system
-- row — design record §12 explicit. Director picks them up via
-- get_scheduler_state on its next turn.

-- 1. Drop the existing 2-value role CHECK.
ALTER TABLE conversation_messages DROP CONSTRAINT conversation_messages_role_check;

-- 2. Add the 3-value CHECK admitting 'system'.
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_role_check
  CHECK (role IN ('user','assistant','system'));

-- 3. Add the typed event metadata columns.
ALTER TABLE conversation_messages
  ADD COLUMN event_type TEXT
    CHECK (event_type IS NULL OR event_type IN (
      'stage_trigger_fired',
      'brief_activated',
      'brief_completed',
      'stage_completed',
      'cancel_cascade',
      'stop',
      'resume',
      'failure_class_b',
      'failure_class_c',
      'failure_class_d',
      'failure_class_e'
    ));

ALTER TABLE conversation_messages
  ADD COLUMN event_payload JSONB;

ALTER TABLE conversation_messages
  ADD COLUMN cause TEXT;
  -- 'user_action' | 'scheduler_trigger' | 'system_recovery' | 'workflow_complete' | etc.
  -- Free-text + structured; lib-side validates at write time.

-- 4. Invariant: role='system' iff event_type IS NOT NULL.
ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_system_requires_event
  CHECK (
    (role = 'system' AND event_type IS NOT NULL) OR
    (role <> 'system' AND event_type IS NULL)
  );

-- Realtime publication already includes conversation_messages — no change.
-- Index for system-event lookups on the conversation timeline.
CREATE INDEX idx_conversation_messages_system_events
  ON conversation_messages(conversation_id, sequence)
  WHERE role = 'system';
