-- Migration M-214: Realtime publication completeness + REPLICA IDENTITY FULL
--
-- Diagnosed 2026-06-10. The B.5/B.5b/B.5c multiplexed realtime channel
-- architecture has been silently dropping ~all postgres_changes UPDATE
-- events since it shipped. The Test Reports passed because Vitest mocked
-- Supabase end-to-end — there was no real broker round-trip in the test
-- harness. Symptom that surfaced: export progress chip never advances
-- past "queued" despite the runner completing the job.
--
-- Root cause is structural, not architectural — the multi-binding
-- multiplex pattern works correctly once the database is configured
-- right. Diagnostic test
-- (tests/diagnostic/realtime-binding-threshold.spec.ts) confirmed
-- 10/10 tested bindings deliver events on a single 12-binding channel
-- once the conditions below are met.
--
-- TWO required conditions for Supabase Realtime + postgres_changes:
--
-- 1. EVERY table the client subscribes to MUST be in the
--    `supabase_realtime` publication. A subscription to a table not in
--    the publication is silently accepted (no CHANNEL_ERROR) but
--    delivers no events.
--
-- 2. EVERY table with a non-PK filter, AND every table whose RLS
--    policy references non-PK columns of the changed row, MUST have
--    REPLICA IDENTITY FULL. With REPLICA IDENTITY DEFAULT, the WAL
--    UPDATE/DELETE record only carries the PK in the OLD row. The
--    Realtime broker uses the row's column values to evaluate the
--    filter and the RLS policy; if the values aren't in WAL it can't
--    evaluate and the event is dropped.
--
-- This migration brings every table in REALTIME_TOPICS (lib/realtime/
-- demuxer.ts) into compliance.
--
-- Refs:
--   docs/stelavox_document_load_architecture_v1_0.md §5
--   https://supabase.com/docs/guides/realtime/postgres-changes
--   https://supabase.com/docs/guides/realtime/architecture
--   tests/diagnostic/realtime-binding-threshold.spec.ts

-- ─── Step 1: ensure every realtime topic table is in the publication ──
--
-- Add the three tables that were missed by prior migrations.
-- Guarded with DO blocks so the migration is idempotent (the table may
-- already be in the publication on environments where it landed via a
-- different path).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversation_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE conversation_messages';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profile_amendments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE profile_amendments';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'organisations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE organisations';
  END IF;
END $$;

-- ─── Step 2: REPLICA IDENTITY FULL on every realtime topic table ──
--
-- ALTER TABLE ... REPLICA IDENTITY FULL is idempotent — re-running has
-- no effect if already set.

ALTER TABLE public.nodes                REPLICA IDENTITY FULL;
ALTER TABLE public.agent_jobs           REPLICA IDENTITY FULL;
ALTER TABLE public.briefs               REPLICA IDENTITY FULL;
ALTER TABLE public.brief_stages         REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_messages REPLICA IDENTITY FULL;
ALTER TABLE public.director_turns       REPLICA IDENTITY FULL;
ALTER TABLE public.export_jobs          REPLICA IDENTITY FULL;
ALTER TABLE public.project_profiles     REPLICA IDENTITY FULL;
ALTER TABLE public.profile_amendments   REPLICA IDENTITY FULL;
ALTER TABLE public.organisations        REPLICA IDENTITY FULL;
ALTER TABLE public.workflows            REPLICA IDENTITY FULL;
ALTER TABLE public.workflow_steps       REPLICA IDENTITY FULL;

COMMENT ON PUBLICATION supabase_realtime IS
  'Realtime CDC publication. REALTIME_TOPICS in lib/realtime/demuxer.ts must be a strict subset of the tables here. M-214 (2026-06-10) brought conversation_messages, profile_amendments, organisations into the publication and set REPLICA IDENTITY FULL on every topic table (required for filtered bindings + RLS evaluation in Realtime context).';
