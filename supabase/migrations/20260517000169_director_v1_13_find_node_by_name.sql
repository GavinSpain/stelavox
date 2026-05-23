-- M-169 — Director config v1.13: add find_node_by_name read tool.
--
-- Background. v1.12 added a tool-result grounding rule to the system
-- prompt, but Haiku (and even Sonnet on a bad day) continued to
-- hallucinate node pairings when forced to find a user-named node
-- without a resolved @-mention id. The only available search path was:
--
--   1. Guess which layer the name lives in
--   2. Call get_nodes_by_layer(N) — returns dozens of rows
--   3. Visually pick a match
--
-- Step 3 is where the model fabricated "I found 'The Visions' scene"
-- against rows that did not contain that name, then called get_node
-- with an unrelated row's id. Five iterations chasing a misgrounded
-- claim. The prompt rule alone could not prevent it.
--
-- Fix: give the Director a tool that does the right search server-side
-- and returns each match with its full ancestor path. find_node_by_name
-- removes the "pick a row from a list" step entirely — the tool returns
-- definitively matched rows with paths like
-- "Shadow Protocol > Act One > Salvage > The Bonding > The Visions"
-- so there's nothing to hallucinate.
--
-- v1.13 tool_suite grows from 19 → 20 tools. System prompt amended to
-- (a) describe the new tool, (b) tell the Director to call it FIRST
-- when the user names a node by name (not @-mention id).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.12' AND status = 'production';

DO $$
DECLARE
  v_v12_prompt TEXT;
  v_v13_prompt TEXT;
  v_v12_tool_suite JSONB;
  v_v13_tool_suite JSONB;
  v_v12_model_id TEXT;
  v_v12_model_params JSONB;
  v_v12_capability_flags JSONB;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v12_prompt, v_v12_tool_suite, v_v12_model_id, v_v12_model_params, v_v12_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.12';

  -- Append the new tool name to the tool_suite array.
  v_v13_tool_suite := v_v12_tool_suite || '["find_node_by_name"]'::jsonb;

  -- Prompt amendment #1: replace the v1.12 "When the user references a
  -- node by name and your read tools don't return a matching row…"
  -- guidance with a direct instruction to call find_node_by_name first.
  v_v13_prompt := replace(
    v_v12_prompt,
    'When the user references a node by name and your read tools don''t return a matching row at the expected layer, try the next plausible layer (e.g. user says "scene X" but no scene matches → try beat layer; or vice-versa). If no layer surfaces a match, say so plainly in your prose summary AND ask the user to clarify or use the @-mention picker. Do NOT guess at an id and proceed — guessing wastes 4+ iterations chasing a name that doesn''t exist at the layer you searched.',
    'When the user references a node by name (not @-mention id), call `find_node_by_name({ query: "<name>" })` FIRST. The tool searches across ALL layers and returns each match with its full ancestor path — no need to guess the layer, no need to pick a row from a list. If the tool returns zero matches, say so plainly in your prose summary AND ask the user to clarify or use the @-mention picker. Do NOT guess at an id and proceed — guessing wastes 4+ iterations chasing a name that doesn''t exist.'
  );

  -- Prompt amendment #2: add a line to the read-tool list describing
  -- the new tool. We append after the existing get_nodes_by_layer
  -- description line for natural ordering.
  v_v13_prompt := replace(
    v_v13_prompt,
    '- `get_nodes_by_layer` — list nodes at a specific layer (scenes, beats, etc).',
    '- `get_nodes_by_layer` — list nodes at a specific layer (scenes, beats, etc).
- `find_node_by_name` — case-insensitive substring search by name across ALL layers; returns each match with its full ancestor path (e.g. "Shadow Protocol > Act One > Salvage > The Bonding > The Visions"). Use this FIRST whenever the user names a node and you don''t have its id from the @-mention picker.'
  );

  -- The read-tool list line may not match v1.12 verbatim if any later
  -- prompt drift changed it; we accept that and just do best-effort.
  -- The grounding-rule replacement is the critical one — it must apply.
  IF v_v13_prompt = v_v12_prompt THEN
    RAISE EXCEPTION 'M-169: no substitution applied — v1.12 prompt body drifted from the expected shape';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.13',
    'Director v1.13 — find_node_by_name tool',
    'production',
    v_v13_prompt,
    v_v13_tool_suite,
    v_v12_model_id,
    v_v12_model_params,
    v_v12_capability_flags,
    'New read tool find_node_by_name added (tool count 19 → 20).
Implements ranked case-insensitive substring search across all
node layers, returning each match with its full ancestor path.
Eliminates the "guess layer, list, pick row from list" path that
Haiku was hallucinating on. System prompt amended to instruct
calling find_node_by_name FIRST when the user names a node without
an @-mention id.',
    NOW(), NULL, NOW()
  );
END $$;
