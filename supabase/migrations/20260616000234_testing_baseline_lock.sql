-- M-234 — testing baseline lock: plan allocations + recommended model split.
--
-- After the founding-discount + first-principles review, the author locked
-- these as the testing baseline (tunable via /admin/models once real
-- telemetry comes in from the Operations Summary).
--
-- 1. Plan allocations (sized to "heavy month + safety", recommended mix):
--      Writer  2,500,000 credits = $2.50 max COGS = 12.5% of $20 plan
--      Author  6,000,000 credits = $6.00 max COGS = 12%   of $50 plan
--      Pro    22,000,000 credits = $22    max COGS = 18%  of $120 plan
--    Pro is sized to comfortably absorb a 120k-word peak-heavy month
--    ("never runs out" principle); Author runs out under heavy use; Writer
--    suits casual + is uncomfortable for a pro.
--
-- 2. Recommended model split — Sonnet for the reasoning surfaces, Haiku
--    for the bulk surfaces:
--      Director (production config)   -> Sonnet 4.6
--      Expand (book/act/series/chapter/scene/story, 6 profiles) -> Sonnet 4.6
--      Synthesise + Refine + Generate-context (16 profiles)     -> Haiku 4.5 (unchanged)
--    The enforce_model_assignable trigger (M-232) validates every UPDATE;
--    Sonnet 4.6 and Haiku 4.5 are both registered+active+priced, so all
--    assignments pass.
--
-- 3. Backfill: any existing orgs already on writer/author/pro pick up the
--    new allocations (test continuity). Trial / BYOK orgs untouched.
--
-- These values can be re-tuned via /admin/models without another migration;
-- the migration just locks the starting point for testing.

-- 1. Plan allocations.
UPDATE platform_config
   SET value = '2500000'::jsonb, updated_at = now()
 WHERE key = 'plan.writer_token_allocation_credits';

UPDATE platform_config
   SET value = '6000000'::jsonb, updated_at = now()
 WHERE key = 'plan.author_token_allocation_credits';

UPDATE platform_config
   SET value = '22000000'::jsonb, updated_at = now()
 WHERE key = 'plan.pro_token_allocation_credits';

-- 2. Model assignments. Trigger enforce_model_assignable validates each row.
UPDATE director_configs
   SET model_id = 'claude-sonnet-4-6'
 WHERE status = 'production';

UPDATE agent_profiles
   SET model_id = 'claude-sonnet-4-6'
 WHERE operation_type = 'expand';

-- 3. Backfill org-level allocations for any test orgs already on these plans.
UPDATE organisations SET token_allocation_credits = 2500000  WHERE plan = 'writer';
UPDATE organisations SET token_allocation_credits = 6000000  WHERE plan = 'author';
UPDATE organisations SET token_allocation_credits = 22000000 WHERE plan = 'pro';
