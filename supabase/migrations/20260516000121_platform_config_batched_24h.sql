-- Migration 121 — V1.x-B.2.3: platform_config keys for batched_24h.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-121.
--
-- Per H-12, no hardcoded operational values in TypeScript.
--
-- 4 new keys for batched_24h Anthropic Batch API integration.
--
-- Eligibility: only ops where the Director isn't waiting for the result
-- in real-time. Director iterations themselves are NEVER batched (the
-- whole point of Class 1 is interactive latency). Workflow steps are
-- candidates because they're often background work.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  ('agent.batched_24h_eligible_operations',
   '["expand","synthesise","refine","generate_context"]'::jsonb,
   'Operation types eligible for batched_24h execution intent. Director iterations are NEVER batched (interactive). Workflow steps with these op types may be batched if the user explicitly elected the intent.',
   'object'),  -- value_type CHECK constraint admits 'object' (covers arrays + objects)

  ('agent.batched_24h_min_batch_size',
   '5'::jsonb,
   'Minimum number of batched_24h tickets accumulated before submitting to Anthropic Batch API. Anthropic accepts batches of 1+ but smaller batches lose batching efficiency. Smaller batches still submit if max_wait_minutes elapses.',
   'integer'),

  ('agent.batched_24h_max_wait_minutes',
   '30'::jsonb,
   'Maximum time a batched_24h ticket waits in the buffer before submission, regardless of min_batch_size. Default 30 min: balances batch efficiency against user expectations of "tomorrow at the latest."',
   'integer'),

  ('agent.batched_24h_poll_interval_minutes',
   '5'::jsonb,
   'How often the batch poller polls Anthropic for in-progress batch status. Real-world Anthropic Batch completions are typically minutes; 5 min keeps cost low without significantly delaying result write-back.',
   'integer');
