-- M-170 — Director config v1.14: add get_subtree_content read tool.
--
-- Background. v1.13 added find_node_by_name to eliminate name-search
-- hallucination. Continued testing immediately surfaced a second
-- inefficiency: the user asked "do all beats in chapter 1 have prose?"
-- and the Director called get_node 25+ times — one per beat — to read
-- each beat's prose field, exhausting iteration count without
-- answering. get_nodes_by_layer was extended in the same change to
-- include has_prose / has_summary / status / word counts on each row,
-- which closes the "completion flags" half. But the other half —
-- bulk content read across a subtree — still needs N get_node calls.
--
-- Fix: a dedicated bulk-content tool. get_subtree_content returns
-- every descendant of a root (plus the root itself) with summary_text
-- + prose_text + completion flags + word counts in one call. Capped at
-- max_nodes (default 50, ceiling 200) with truncated:true when the cap
-- hits.
--
-- v1.14 tool_suite grows from 20 → 21. System prompt amended in two
-- places: the read-tool list gains a line; the existing "get_node_tree
-- — subtree shape" line is clarified to say tree is shape-only and
-- direct the model to get_subtree_content when it needs bulk content.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.13' AND status = 'production';

DO $$
DECLARE
  v_v13_prompt TEXT;
  v_v14_prompt TEXT;
  v_v13_tool_suite JSONB;
  v_v14_tool_suite JSONB;
  v_v13_model_id TEXT;
  v_v13_model_params JSONB;
  v_v13_capability_flags JSONB;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v13_prompt, v_v13_tool_suite, v_v13_model_id, v_v13_model_params, v_v13_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.13';

  v_v14_tool_suite := v_v13_tool_suite || '["get_subtree_content"]'::jsonb;

  -- Amendment: replace the existing get_node_tree line with a two-line
  -- block that clarifies tree=shape, plus the new get_subtree_content
  -- line. Best-effort match — the prompt is large and prior versions
  -- may have drifted around adjacent lines, so we accept a no-op here
  -- if the exact match doesn't apply. The tool itself is still wired
  -- through the registry regardless.
  v_v14_prompt := replace(
    v_v13_prompt,
    '- `get_node_tree` — subtree from a root.',
    '- `get_node_tree` — subtree SHAPE only (no prose/summary). Use to understand hierarchy.
- `get_subtree_content` — bulk content read across a subtree (summary + prose + completion flags + word counts in one call). Use this WHENEVER the question is "read / audit / summarise / aggregate across N nodes" (e.g. "do all beats in chapter 1 have prose?", "review scenes 5-10", "total word count of chapter 3"). Prefer this over N get_node calls. Defaults max_nodes=50 / include_prose=true / include_summary=true.'
  );

  -- v1.14 prompt body is identical to v1.13 if the substitution didn't
  -- land — non-blocking. The registry still wires the tool through so
  -- the LLM sees it in tool definitions either way.
  IF v_v14_prompt = v_v13_prompt THEN
    RAISE NOTICE 'M-170: read-tool list substitution did not match v1.13 prompt body verbatim; tool wired regardless';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.14',
    'Director v1.14 — get_subtree_content tool',
    'production',
    v_v14_prompt,
    v_v14_tool_suite,
    v_v13_model_id,
    v_v13_model_params,
    v_v13_capability_flags,
    'New read tool get_subtree_content added (tool count 20 → 21).
Bulk content read across a subtree in one call — summary_text +
prose_text + has_prose + has_summary + status + word counts +
locked per descendant, capped at max_nodes (default 50, ceiling
200). Eliminates the "N get_node calls to audit a subtree"
pattern observed when the user asked "do all beats in chapter 1
have prose?" — Director walked 25 beats individually and
exhausted iteration count. System prompt amended: get_node_tree
clarified as shape-only; get_subtree_content positioned as the
default for any bulk-content question.',
    NOW(), NULL, NOW()
  );
END $$;
