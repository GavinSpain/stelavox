-- M-168 — Director config v1.12: tool-result grounding rule.
--
-- Background. v1.11 added interpretation transparency + corrected
-- propose-then-approve semantics. It did NOT address a third
-- behavioural failure surfaced during continued testing:
--
--   The Director read a list of nodes via get_nodes_by_layer, then
--   asserted in conversation "I found 'The Visions' scene" — but the
--   tool result contained NO node named "The Visions". The Director
--   then called get_node with an id from a different row in the list
--   (the chapter "Signal Cascade", node_id 1cf0cadf...), confidently
--   labelling it "The Visions". The next iteration got back
--   name="Signal Cascade", realised "That's a chapter", and kept
--   searching — burning 5+ iterations on the misgrounded chase.
--
-- Root cause: the LLM picked a name (from the user's request) and an
-- id (from a tool result row) and combined them without checking that
-- the pairing matched. Classic confabulation.
--
-- v1.12 adds an explicit rule to the Commit step: every node reference
-- in prose or tool input must come from a tool result row that paired
-- the cited name AND id together. No remembering an id from row 7 and
-- pairing it with a name the user wrote.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.11' AND status = 'production';

DO $$
DECLARE
  v_v11_prompt TEXT;
  v_v12_prompt TEXT;
  v_v11_tool_suite JSONB;
  v_v11_model_id TEXT;
  v_v11_model_params JSONB;
  v_v11_capability_flags JSONB;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v11_prompt, v_v11_tool_suite, v_v11_model_id, v_v11_model_params, v_v11_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.11';

  -- Append the grounding rule to the "Interpretation transparency"
  -- paragraph from v1.11. The match string is the v1.11 closing line
  -- of the Commit step's added block.
  v_v12_prompt := replace(
    v_v11_prompt,
    '**Don''t claim work is queued/active until the user approves.** `propose_brief` does NOT write the briefs row — accept_brief does, when the user clicks Approve in the proposal card. In your prose summary, say "I''ll propose…" / "Here''s a proposed Brief…" — NEVER "I''ve queued…" or "Done." A successful propose_brief tool call means the proposal has been emitted; the user still has to click Approve.',
    '**Don''t claim work is queued/active until the user approves.** `propose_brief` does NOT write the briefs row — accept_brief does, when the user clicks Approve in the proposal card. In your prose summary, say "I''ll propose…" / "Here''s a proposed Brief…" — NEVER "I''ve queued…" or "Done." A successful propose_brief tool call means the proposal has been emitted; the user still has to click Approve.

  **Tool-result grounding (mandatory).** Every node you reference in prose AND every node_id you pass to a tool MUST be sourced from a tool result row that paired the exact name and id together. NEVER:

  - Assert "I found X" when no tool result row has `name = "X"`.
  - Combine a node_id from one row with a name from another row, from your memory, or from the user''s request.
  - Pass a node_id to `get_node` / `propose_brief` / any write tool unless that exact id was just returned by a read tool in your current iteration chain.

  When the user references a node by name and your read tools don''t return a matching row at the expected layer, try the next plausible layer (e.g. user says "scene X" but no scene matches → try beat layer; or vice-versa). If no layer surfaces a match, say so plainly in your prose summary AND ask the user to clarify or use the @-mention picker. Do NOT guess at an id and proceed — guessing wastes 4+ iterations chasing a name that doesn''t exist at the layer you searched.

  If the user uses the @-mention picker, the `mentioned_node_ids` array in `iteration_state.user_message` carries the resolved ids. Always check that array FIRST; it''s authoritative. If the user typed `@name` manually without using the picker, `mentioned_node_ids` will be empty — fall back to name-search across all layers, never invent an id.'
  );

  IF v_v12_prompt = v_v11_prompt THEN
    RAISE EXCEPTION 'M-168: no substitution applied — v1.11 prompt body drifted from the expected shape; review and fix before re-applying';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.12',
    'Director v1.12 — tool-result grounding',
    'production',
    v_v12_prompt,
    v_v11_tool_suite,
    v_v11_model_id,
    v_v11_model_params,
    v_v11_capability_flags,
    'Mandatory tool-result grounding rule appended to the Commit step.
Discovered 2026-05-17 mid-testing — Director read a list of nodes,
then asserted finding a node whose name did NOT appear in the list,
and passed an unrelated row''s id to get_node. The grounding rule
forbids combining names and ids that didn''t come from the same tool
result row, and tells the Director what to do when the user-named
node isn''t found (try other layers, then ask — never guess).
Also tells the Director to check iteration_state.user_message.mentioned_node_ids
first when the user uses the @-mention picker. Tool registry unchanged (19 tools).',
    NOW(), NULL, NOW()
  );
END $$;
