-- Migration 049 — raise agent.director_tool_call_rate_limit_per_60s 30 → 90.
--
-- V1.x-LB fix-pack follow-up (B2 smoke surfacing).
--
-- The B2 smoke against the 114-scene launch-test novel revealed that the
-- existing per-conversation tool-call rate limit (30 per 60s) is below
-- the budget a single Director turn at full iteration count can spend:
-- 20 iterations (agent.director_max_tool_iterations) × average ~3 tool
-- calls per iteration = ~60 tool calls per turn. The Director hit the
-- 30/60s ceiling mid-planning, surfaced the cap to the user transparently
-- (good — B2 prompt did its job), but could not complete a single batch.
--
-- Raising to 90 gives a single full-iteration turn (~60 calls) ~50%
-- headroom while still capping degenerate spirals. This is a holding
-- pattern. The proper fix — per-user and global traffic engineering
-- with throttle-not-deny semantics — lives in V1.x-B per
-- docs/stelavox_director_architecture_v2_0.md §9 and tracks alongside
-- the multi-tenant scheduler redesign. The ideal numerical value will
-- be derived empirically from probe-runner cost data and live-traffic
-- patterns once V1 has author volume.
--
-- Tunable per-deployment via platform_config. Raise/lower without a
-- migration once the rate-limit redesign lands.

UPDATE platform_config
SET value = '90',
    description = 'Maximum tool calls per conversation per 60s sliding window. Interim cap raised from 30 (Migration 049) so a single Director turn at full iteration budget completes without rate-limit interruption. Proper per-user + global throttle layer lands in V1.x-B.'
WHERE key = 'agent.director_tool_call_rate_limit_per_60s';
