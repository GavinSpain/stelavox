-- Migration 046 — seed agent.director_max_concurrent_dispatch
-- (launch-test session 2026-05-10 fanout-rate-limit fix).
--
-- The workflow-executor previously had no concurrency cap on dispatch.
-- A Director-approved workflow with N independent steps (e.g.
-- "Expand all 14 chapters into scenes") would enter a single
-- dispatchable batch and fire all N agent_jobs near-simultaneously
-- via waitUntil(runAgentJob), exceeding the Anthropic concurrent-
-- connections limit on the platform key.
--
-- This config caps the number of agent_jobs that may be in
-- 'running' status per workflow at any moment. As running steps
-- complete and call advanceWorkflow(), the next slot is filled.
--
-- Default 1 — purely sequential. Conservative because the platform
-- Anthropic key is shared across ALL non-BYOK users; what's safe per
-- workflow could still starve the system in aggregate. The proper
-- multi-tenant throttle (per-user + global, with throttle-not-deny
-- semantics) is queued for the Director architecture deep review;
-- this config is a holding pattern.
--
-- Tunable per-deployment via platform_config; raise once the
-- multi-tenant throttle layer lands.

INSERT INTO platform_config (key, value, description, value_type)
VALUES (
  'agent.director_max_concurrent_dispatch',
  '1',
  'Maximum agent_jobs allowed in running status per workflow at any moment. Holding pattern until the multi-tenant throttle layer lands. Default 1 = sequential.',
  'integer'
)
ON CONFLICT (key) DO NOTHING;
