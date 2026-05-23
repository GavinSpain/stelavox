-- M-204 — drop briefs.status legacy DEFAULT.
--
-- The DEFAULT was 'planned' from M-082 (pre-Apollo). With the
-- bidirectional auto-derive trigger from M-202, leaving 'planned' as
-- the default means INSERTs that specify state explicitly but omit
-- status end up with the trigger interpreting the DEFAULT as "caller
-- wants planned state" and override-flipping NEW.state to 'planned',
-- which then fails the briefs_state_check ('active' / 'completed' /
-- 'cancelled' only). Surfaced 2026-05-23 by the Apollo simulator's
-- seedBriefScaffold test fixture.
--
-- Briefs.status will be dropped entirely in Phase 0.D (V2 cleanup);
-- this is the interim fix.

BEGIN;

ALTER TABLE public.briefs ALTER COLUMN status DROP DEFAULT;

COMMIT;
