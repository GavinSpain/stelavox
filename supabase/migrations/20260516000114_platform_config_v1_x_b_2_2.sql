-- Migration 114 — V1.x-B.2.2: platform_config keys for WFQ + buckets +
--                              reserved slots + dispatcher tick + aging.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-114 +
--         Director Architecture v2.0 §9 (throttling).
--
-- Per H-12, no hardcoded operational values in TypeScript. All values
-- live in platform_config and are read via getConfig().
--
-- 12 new keys for V1.x-B.2.2 spanning WFQ weights, bucket sizing per
-- pool, Class 1 reserved slot config, dispatcher tick parameters,
-- failure-class retry budget, reservation TTL, and aging promotion.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  -- WFQ class weights (sum doesn't have to equal 100; ratios are what matter).
  ('agent.wfq_class_weights',
   '{"1": 50, "2": 25, "3": 20, "4": 5}'::jsonb,
   'Weighted Fair Queueing weights per traffic class. 1=interactive Director, 2=author-foreground workflow, 3=background batch, 4=scheduled/parked. Higher weight = more dispatch share.',
   'object'),

  -- Platform bucket (shared Anthropic key) sizing.
  ('agent.platform_bucket_size_tokens',
   '200000'::jsonb,
   'Platform-pool token bucket capacity. Tune per Anthropic tier. Larger = more burst tolerance; same steady-state throughput.',
   'integer'),

  ('agent.platform_bucket_refill_per_sec',
   '666.67'::jsonb,
   'Platform-pool refill rate in tokens/second. 666.67 ≈ 40k tokens/min default. Should reflect Anthropic ITPM/OTPM headroom.',
   'number'),

  -- BYOK bucket (per-user) defaults.
  ('agent.byok_bucket_size_tokens',
   '100000'::jsonb,
   'Default BYOK-per-user token bucket capacity. Per-user override rows can be inserted into user_throttle_buckets directly.',
   'integer'),

  ('agent.byok_bucket_refill_per_sec',
   '333.33'::jsonb,
   'Default BYOK-per-user refill rate (tokens/sec). 333.33 ≈ 20k tokens/min. Smaller than platform default reflecting individual-user expected throughput.',
   'number'),

  -- Class 1 reserved slot config (concurrent connections, distinct from token bucket).
  ('agent.class_1_reserved_slots_total',
   '3'::jsonb,
   'Number of concurrent-connection slots reserved for Class 1 (interactive Director) tickets. Must equal class_1_reserved_slots.total_slots.',
   'integer'),

  ('agent.class_1_max_concurrent_total',
   '5'::jsonb,
   'Cap on total concurrent Class 1 connections (reserved + overflow). Beyond this, Class 1 tickets re-queue.',
   'integer'),

  -- Dispatcher tick parameters.
  ('agent.dispatcher_tick_interval_ms',
   '1000'::jsonb,
   'Dispatcher tick cadence in ms. pg_cron schedule + LISTEN-driven invocations both fire at this rate (LISTEN is opportunistic; pg_cron is the safety floor).',
   'integer'),

  ('agent.dispatcher_max_per_tick',
   '20'::jsonb,
   'Maximum agent_jobs the dispatcher can claim+handoff in one tick. Caps transaction duration; prevents long FOR UPDATE locks under load spikes.',
   'integer'),

  -- Failure-class retry budget.
  ('agent.failure_class_a_max_retries',
   '3'::jsonb,
   'Maximum auto-retry attempts for Class A (transient) failures. After exhaustion, ticket fails permanently and surfaces to user.',
   'integer'),

  -- Reservation TTL (carry-over from V1.x-B.1.1; explicit key here for B.2.2 buckets).
  ('agent.reservation_ttl_seconds',
   '300'::jsonb,
   'Throttle reservation TTL in seconds. After expiry the recovery sweep refunds the reserved tokens to the bucket. Default 5 minutes.',
   'integer'),

  -- Aging promotion threshold (prevents starvation of class 4).
  ('agent.aging_promotion_ms',
   '60000'::jsonb,
   'A queued ticket waiting longer than this gets a one-class promotion (4→3, 3→2, 2→1) for the WFQ VFT calc only. Persistent traffic_class on agent_jobs unchanged. Prevents class-4 starvation under sustained heavy load.',
   'integer');
