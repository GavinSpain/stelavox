-- M-178 — Director config v1.19.
--
-- When find_node_by_name returns multiple matches at the same top
-- quality rank (e.g. two nodes literally named "The Visions"), the
-- model previously had no explicit guidance on how to disambiguate.
-- Risk: silently pick the first array entry, or ask the user even
-- when conversation context makes the answer obvious.
--
-- Companion tool change (same commit): find_node_by_name response now
-- carries:
--   ambiguous: boolean  — true when 2+ matches share the top rank
--   ambiguity_reason: 'multiple_exact_matches' | 'multiple_prefix_matches'
--                   | 'multiple_substring_matches' | null
--
-- This migration appends an "Ambiguity handling" paragraph to the
-- existing find_node_by_name guidance, teaching the model:
--   - If ambiguous=false, proceed normally (single result OR clear winner).
--   - If ambiguous=true AND conversation context disambiguates,
--     proceed with the contextually-implied match and state the
--     interpretation transparently in the prose lead-in.
--   - If ambiguous=true AND context doesn't disambiguate, ask the
--     user — show candidates by full path; don't pick blindly.
--
-- Tool registry unchanged (still 23).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.18' AND status = 'production';

DO $$
DECLARE
  v_v18_prompt TEXT;
  v_v19_prompt TEXT;
  v_v18_tool_suite JSONB;
  v_v18_model_id TEXT;
  v_v18_model_params JSONB;
  v_v18_capability_flags JSONB;
  v_old_para TEXT;
  v_new_para TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v18_prompt, v_v18_tool_suite, v_v18_model_id, v_v18_model_params, v_v18_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.18';

  v_old_para := 'When the user references a node by name (not @-mention id), call `find_node_by_name({ query: "<name>" })` FIRST. The tool searches across ALL layers and returns each match with its full ancestor path — no need to guess the layer, no need to pick a row from a list. If the tool returns zero matches, say so plainly in your prose summary AND ask the user to clarify or use the @-mention picker. Do NOT guess at an id and proceed — guessing wastes 4+ iterations chasing a name that doesn''t exist.';

  v_new_para := 'When the user references a node by name (not @-mention id), call `find_node_by_name({ query: "<name>" })` FIRST. The tool searches across ALL layers and returns each match with its full ancestor path. If the tool returns zero matches, say so plainly in your prose summary AND ask the user to clarify or use the @-mention picker. Do NOT guess at an id and proceed.

  **Ambiguity handling.** `find_node_by_name` carries an `ambiguous: boolean` flag plus an `ambiguity_reason` on the response. It is true when two or more matches share the top quality rank (e.g. two nodes literally named "The Visions"). When `ambiguous: false`, the result is unambiguous — proceed with the top match. When `ambiguous: true`:
  1. First check whether conversation context clearly identifies which match the user meant (recent references, currently-focused node, layer implied by the request type — e.g. "synthesise" implies a leaf beat, "expand" implies a non-leaf). If yes, proceed with that match and STATE THE INTERPRETATION in your prose lead-in: *"Two nodes named ''The Visions'' exist; I''ll work with the beat under Salvage based on our recent discussion."* Don''t pick silently.
  2. If context doesn''t clearly disambiguate, ASK the user. Surface the candidates by their full paths, e.g. *"Did you mean ''The Visions'' the scene in Hunted, or ''The Visions'' the beat under Salvage > The Bonding?"* Don''t pick blindly.';

  v_v19_prompt := replace(v_v18_prompt, v_old_para, v_new_para);

  IF v_v19_prompt = v_v18_prompt THEN
    RAISE EXCEPTION 'M-178: find_node_by_name paragraph substitution failed — prompt body drifted from expected shape';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.19',
    'Director v1.19 — find_node_by_name ambiguity handling',
    'production',
    v_v19_prompt,
    v_v18_tool_suite,
    v_v18_model_id,
    v_v18_model_params,
    v_v18_capability_flags,
    'Adds an "Ambiguity handling" paragraph to the find_node_by_name
guidance. Pairs with the tool-side ambiguous + ambiguity_reason
fields shipping in the same commit. Teaches: proceed unambiguously
when ambiguous=false; consult conversation context first when
ambiguous=true; state interpretation explicitly when proceeding
from context; ask the user with full paths when context doesn''t
disambiguate. Tool count unchanged (23).',
    NOW(), NULL, NOW()
  );
END $$;
