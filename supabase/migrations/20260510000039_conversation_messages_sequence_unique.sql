-- Migration 039 — UNIQUE(conversation_id, sequence) on conversation_messages
-- (round-3 audit B4.2, F-266).
--
-- Pre-fix the table had a non-unique index on (conversation_id, sequence).
-- The application's `nextSequence` helper (F-96) computes
-- `MAX(sequence) + 1` and INSERTs, so two concurrent appends to the same
-- conversation can both compute the same sequence number and both
-- succeed. Downstream readers ordering by sequence then see ambiguous
-- ordering — message history breaks.
--
-- Adding the UNIQUE constraint at the DB layer makes the duplicate
-- physically impossible. The application's retry path (F-99-style:
-- catch UNIQUE violation, re-read max, retry once) becomes the correct
-- handling of the race rather than a missing guard.
--
-- Not DEFERRABLE: there is no multi-row UPDATE pattern on this table
-- analogous to move_node. INSERTs are append-only; the constraint can
-- be checked immediately.

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_conversation_sequence_unique
  UNIQUE (conversation_id, sequence);
