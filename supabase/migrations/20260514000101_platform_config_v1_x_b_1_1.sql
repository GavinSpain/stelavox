-- Migration 101 — V1.x-B.1.1: new platform_config keys.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.11
--         + Director Architecture v2.0 §17.4 + design record §8.
--
-- Per H-12, no hardcoded operational values in TypeScript. All values
-- live in platform_config and are read via getConfig().
--
-- Nine new keys for V1.x-B.1.1 spanning scheduler / throttle / atom-
-- size guardrails / Director iteration timing.
--
-- Existing M-046 key `agent.director_max_concurrent_dispatch` remains
-- in place for backwards compatibility; the new
-- `throttle.platform_concurrent_dispatch_cap` is the V1.x-B canonical
-- name. lib/scheduler/ reads the new key; old code paths continue to
-- read the old key until the executor refactor lands in session 2.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  -- Scheduler tick + sweep cadence (used by lib/scheduler/ + pg_cron in session 2).
  ('scheduler.tick_interval_ms',
   '1000'::jsonb,
   'pg_cron + lib/scheduler/ tick body cadence (ms). Default 1s. Lower = faster dispatch, higher DB load.',
   'integer'),
  ('scheduler.recovery_sweep_interval_ms',
   '30000'::jsonb,
   'Heartbeat-stale detection sweep cadence (ms). Default 30s — gives stale iterations time to recover before being marked interrupted.',
   'integer'),

  -- Throttle (H-17 reservation TTL + B.1.1 trivial cap=1 platform policy).
  ('throttle.reservation_ttl_seconds',
   '60'::jsonb,
   'TTL for throttle reservations (H-17 mitigation). Reservations not consumed within this window are released by the sweep.',
   'integer'),
  ('throttle.platform_concurrent_dispatch_cap',
   '1'::jsonb,
   'B.1.1 platform-route concurrent dispatch cap. Replaces M-046 agent.director_max_concurrent_dispatch. B.2 swaps to WFQ + per-user buckets.',
   'integer'),

  -- Atom-size guardrails (design record §8 — Class D rejection + telemetry).
  ('constraints.max_tool_result_bytes',
   '524288'::jsonb,
   'Per-tool result-size cap (bytes). Default 512 KB. Exceeding triggers Class D rejection + constraint_violations log entry.',
   'integer'),
  ('constraints.max_iterations_per_turn',
   '20'::jsonb,
   'Max Director iterations per turn. Matches existing agent.director_max_tool_iterations initial value. Exceeding triggers Class D rejection.',
   'integer'),
  ('constraints.max_profile_size_bytes',
   '65536'::jsonb,
   'Soft watch on Project Profile size (bytes). Default 64 KB. B.1.1 logs violations but does not reject. Profile-summarisation candidate is V2.',
   'integer'),

  -- Per-iteration Director-turn execution (Director Arch v2.0 §8.1a).
  ('director.iteration_timeout_seconds',
   '120'::jsonb,
   'Per-iteration function timeout safety margin (s). Vercel ceiling is 300s; we cap iterations at 120s to leave headroom.',
   'integer'),
  ('director.iteration_heartbeat_interval_seconds',
   '10'::jsonb,
   'Heartbeat write cadence within an iteration (s). Default 10s — enables 60s stale-detection threshold.',
   'integer')
ON CONFLICT (key) DO NOTHING;

-- Mark M-046's agent.director_max_concurrent_dispatch description as
-- deprecated. Keep the row for any code path that still reads it.
UPDATE platform_config
SET description = description || ' [DEPRECATED in V1.x-B.1.1 — see throttle.platform_concurrent_dispatch_cap]'
WHERE key = 'agent.director_max_concurrent_dispatch'
  AND description NOT LIKE '%[DEPRECATED in V1.x-B.1.1%';
