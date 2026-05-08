-- Migration 032 — Default all model_id selections to Haiku 4.5 (V1.x dev default)
--
-- Source: Phase 5c follow-up — user-directed dev default model.
-- Companion to: edits in Migrations 001 (agent_profiles default), 013
-- (director_configs default + seed), and 027 (platform_config model.* keys)
-- which set the same defaults for fresh-deploy environments. This migration
-- catches environments already past those earlier migrations (local + cloud
-- stelavox-dev as of 2026-05-08).
--
-- Rationale: throughout V1.x development the project runs against Haiku 4.5
-- by default to keep iteration costs low. The launch-model decision will be
-- captured by a future migration that updates these values to whatever V1
-- production runs on (Sonnet 4.6 or Opus 4.6/4.7 are the candidates).
--
-- Idempotent: re-running this migration is a no-op when the values are
-- already Haiku.

UPDATE platform_config
SET value = '"claude-haiku-4-5-20251001"'
WHERE key LIKE 'model.%'
  AND value <> '"claude-haiku-4-5-20251001"';

UPDATE agent_profiles
SET model_id = 'claude-haiku-4-5-20251001'
WHERE is_system_profile = true
  AND model_id <> 'claude-haiku-4-5-20251001';

UPDATE director_configs
SET model_id = 'claude-haiku-4-5-20251001'
WHERE model_id <> 'claude-haiku-4-5-20251001';
