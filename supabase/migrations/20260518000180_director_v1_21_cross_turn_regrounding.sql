-- M-180 — Director config v1.21 + cross-turn node_id re-grounding rule.
--
-- 2026-05-18 testing surfaced a NEW hallucination class the existing
-- grounding rules don't catch: when the user approves a plan
-- suggested in a prior turn ("yes, go with the names"), the model
-- assembles propose_brief with target_node_ids it "remembers" from
-- the prior turn — but those IDs are confabulations, because the
-- conversation rolling window may not re-feed the prior turn's
-- find_node_by_name tool_result to the current iteration. The
-- "remembered" UUIDs are plausibly-formed hex (no sentinel pattern),
-- so the M-177 placeholder_uuid_rejected guard doesn't catch them
-- either. The model "remembers" three IDs like
-- 7a5e55c5-1bb0-4ebc-9234-a9b97e8f0b8f, 3d5f4e72-..., 9c8e2b1a-...
-- that don't exist in the database at all.
--
-- Two-part fix, shipped together:
--
-- A. THIS MIGRATION: prompt v1.20 -> v1.21 sharpens the existing
--    tool-result grounding paragraph to explicitly forbid relying
--    on IDs from prior turns. Adds a "Cross-turn re-grounding"
--    paragraph that names the failure shape and the fix.
--
-- B. Companion code change (same commit): execProposeBrief now
--    verifies every target_node_id in every workflow step exists
--    in the session's organisation+document at proposal time. If
--    any are missing, returns target_node_ids_not_found with the
--    list of missing IDs and a teaching reason. Catches both
--    cross-turn hallucinations AND any other case where the model
--    hand-rolls a propose_brief payload with bad IDs (bypassing
--    the per-step create_*_step tools' verifyTargetNode guards).
--
-- Tool registry unchanged (still 24).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.20' AND status = 'production';

DO $$
DECLARE
  v_v20_prompt TEXT;
  v_v21_prompt TEXT;
  v_v20_tool_suite JSONB;
  v_v20_model_id TEXT;
  v_v20_model_params JSONB;
  v_v20_capability_flags JSONB;
  v_substitutions INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v20_prompt, v_v20_tool_suite, v_v20_model_id, v_v20_model_params, v_v20_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.20';

  -- Substitution 1: sharpen the existing third bullet to explicitly
  -- forbid cross-turn-remembered IDs.
  v_v21_prompt := replace(
    v_v20_prompt,
    '- Pass a node_id to `get_node` / `propose_brief` / any write tool unless that exact id was just returned by a read tool in your current iteration chain.',
    '- Pass a node_id to `get_node` / `propose_brief` / any write tool unless that exact id was just returned by a read tool in your **current turn''s** iteration chain. IDs you "remember" from prior turns may be confabulations — the conversation rolling window often does NOT re-feed prior turn tool_result blocks into your current context. If the rolling window only contains the prose summary you wrote in a prior turn, the IDs are gone. **Treat any id not present in your current iteration''s tool_result blocks as not-yet-grounded — call find_node_by_name (or another read tool) to re-fetch before any write call.**'
  );
  IF v_v21_prompt <> v_v20_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  -- Substitution 2: insert a dedicated "Cross-turn re-grounding"
  -- paragraph right after the Ambiguity handling section.
  v_v21_prompt := replace(
    v_v21_prompt,
    'Surface the candidates by their full paths, e.g. *"Did you mean ''The Visions'' the scene in Hunted, or ''The Visions'' the beat under Salvage > The Bonding?"* Don''t pick blindly.',
    'Surface the candidates by their full paths, e.g. *"Did you mean ''The Visions'' the scene in Hunted, or ''The Visions'' the beat under Salvage > The Bonding?"* Don''t pick blindly.

  **Cross-turn re-grounding (mandatory before any write).** When the user approves a plan you suggested in a prior turn ("yes", "go ahead", "do it") OR refers to nodes you discussed in a prior turn, the target node_ids for any write tool MUST be re-grounded in THIS turn''s tool results. The conversation rolling window may include only the prose summary from your prior turn, not the underlying tool_result blocks that carried the actual ids — so "remembered" ids are at high risk of confabulation. Before calling propose_brief, propose_brief_amendment, or any create_*_step tool, run find_node_by_name (or whichever read tool surfaces the target) again in the current turn. The cost of one extra read is trivial compared to a destructive or failed write. If propose_brief returns `target_node_ids_not_found`, that is the runtime catching this exact failure mode — re-call find_node_by_name to get the real ids and retry.'
  );
  IF v_substitutions = 1 AND POSITION('Cross-turn re-grounding' IN v_v21_prompt) > 0 THEN
    v_substitutions := 2;
  END IF;

  IF v_substitutions = 0 THEN
    RAISE EXCEPTION 'M-180: neither prompt substitution applied — v1.20 prompt body drifted from expected anchors';
  END IF;
  IF v_substitutions < 2 THEN
    RAISE NOTICE 'M-180: only % of 2 prompt substitutions applied — partial update', v_substitutions;
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.21',
    'Director v1.21 — cross-turn node_id re-grounding',
    'production',
    v_v21_prompt,
    v_v20_tool_suite,
    v_v20_model_id,
    v_v20_model_params,
    v_v20_capability_flags,
    'Two related fixes for cross-turn target_node_id hallucination,
shipped together with the companion execProposeBrief FK-verification
guard (lib/director/tools/write.ts, M-180 code change).
Prompt-side: sharpens the third bullet in the tool-result grounding
list to explicitly forbid relying on ids "remembered" from prior
turns; adds a dedicated Cross-turn re-grounding paragraph that names
the failure shape (rolling window may not include prior tool_result
blocks) and the fix (re-call find_node_by_name before any write).
Tool count unchanged (24).',
    NOW(), NULL, NOW()
  );
END $$;
