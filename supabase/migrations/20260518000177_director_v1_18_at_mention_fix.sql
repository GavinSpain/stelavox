-- M-177 — Director config v1.18.
--
-- Three intertwined fixes addressing the same testing failure
-- (2026-05-18): user typed `@the ghost burns dark` without using the
-- @-mention picker; the Director called get_node with a hallucinated
-- sentinel UUID (`ffffffff-ffff-ffff-ffff-ffffffffffff`) instead of
-- calling find_node_by_name with the @-stripped query.
--
-- Root cause: the v1.12 prompt told the model to read
-- `iteration_state.user_message.mentioned_node_ids` — but that path
-- doesn't exist. The actual shape has `mentioned_node_ids` as a
-- TOP-LEVEL property of `iteration_state`, sibling to `user_message`.
-- The model dutifully looked at the wrong path, found nothing, and
-- fell back to hallucinating an id rather than calling
-- find_node_by_name as v1.13 instructed.
--
-- Companion code changes (same commit):
--   1. find_node_by_name strips a leading `@` from the query so the
--      model can pass the raw @-mention text directly.
--   2. get_node rejects sentinel/placeholder UUIDs at the entry
--      point, returning an explicit teaching error that names
--      find_node_by_name as the right next move.
--
-- Tool registry unchanged (still 23).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.17' AND status = 'production';

DO $$
DECLARE
  v_v17_prompt TEXT;
  v_v18_prompt TEXT;
  v_v17_tool_suite JSONB;
  v_v17_model_id TEXT;
  v_v17_model_params JSONB;
  v_v17_capability_flags JSONB;
  v_old_at_mention TEXT;
  v_new_at_mention TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v17_prompt, v_v17_tool_suite, v_v17_model_id, v_v17_model_params, v_v17_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.17';

  -- Replace the v1.12 @-mention paragraph wholesale.
  v_old_at_mention := 'If the user uses the @-mention picker, the `mentioned_node_ids` array in `iteration_state.user_message` carries the resolved ids. Always check that array FIRST; it''s authoritative. If the user typed `@name` manually without using the picker, `mentioned_node_ids` will be empty — fall back to name-search across all layers, never invent an id.';

  v_new_at_mention := 'When the user''s message contains `@<text>`, treat the `<text>` as a node name. The picker, if used, resolves ids into `iteration_state.mentioned_node_ids` — this is a TOP-LEVEL array on `iteration_state`, NOT nested under `iteration_state.user_message`. Check that top-level array first; if it''s non-empty, use those ids. If it''s empty (or doesn''t cover the @-text), the user typed `@name` manually — strip the leading `@` and call `find_node_by_name({ query: "<text>" })` immediately. **Never invent or guess a node_id.** Sentinel UUIDs (all-zeros, all-fs, repeated digits) are an anti-pattern — `get_node` rejects them at the entry point with a `placeholder_uuid_rejected` error directing you back to `find_node_by_name`. Every node_id you pass to any tool MUST come from a prior tool result.';

  v_v18_prompt := replace(v_v17_prompt, v_old_at_mention, v_new_at_mention);

  IF v_v18_prompt = v_v17_prompt THEN
    RAISE EXCEPTION 'M-177: @-mention paragraph substitution failed — prompt body drifted from expected shape';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.18',
    'Director v1.18 — @-mention path fix + sentinel-UUID guard',
    'production',
    v_v18_prompt,
    v_v17_tool_suite,
    v_v17_model_id,
    v_v17_model_params,
    v_v17_capability_flags,
    'Rewrites the v1.12 @-mention paragraph. The original wording pointed
the model at iteration_state.user_message.mentioned_node_ids — a path
that doesn''t exist (actual path is iteration_state.mentioned_node_ids,
a top-level sibling of user_message). The model looked at the wrong
path, found nothing, and fell back to hallucinating sentinel UUIDs
(observed: ffffffff-ffff-ffff-ffff-ffffffffffff) instead of calling
find_node_by_name.
New wording corrects the path AND adds the explicit "strip @ and call
find_node_by_name immediately" instruction AND warns about
get_node''s new sentinel-UUID rejection at the entry point.
Companion code changes ship in the same commit: find_node_by_name
strips leading @ in the query; get_node rejects placeholder UUIDs
with placeholder_uuid_rejected error that names the correct next
tool. Tool count unchanged (23).',
    NOW(), NULL, NOW()
  );
END $$;
