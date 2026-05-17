-- M-171 — Director config v1.15: add find_context_references read tool +
-- absorb same-day get_node / get_node_tree return-shape enrichments.
--
-- The get_node / get_node_tree / get_nodes_by_layer / get_subtree_content
-- return-shape changes (path on get_node, lock_info, child_count + word
-- counts on tree rows, etc.) don't need a config bump on their own —
-- they're additive data, not new tool definitions. But find_context_references
-- IS a new tool, so it goes through the config-version channel.
--
-- v1.15 tool_suite grows from 21 → 22.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.14' AND status = 'production';

DO $$
DECLARE
  v_v14_prompt TEXT;
  v_v15_prompt TEXT;
  v_v14_tool_suite JSONB;
  v_v15_tool_suite JSONB;
  v_v14_model_id TEXT;
  v_v14_model_params JSONB;
  v_v14_capability_flags JSONB;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v14_prompt, v_v14_tool_suite, v_v14_model_id, v_v14_model_params, v_v14_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.14';

  v_v15_tool_suite := v_v14_tool_suite || '["find_context_references"]'::jsonb;

  -- Append the new tool's one-line description to the read-tool list.
  -- Insertion point: after get_subtree_content (M-170). Best-effort —
  -- if the read-tool list has drifted, the new tool is still wired
  -- through the registry; the LLM sees it in tool definitions regardless.
  v_v15_prompt := replace(
    v_v14_prompt,
    '- `get_subtree_content` — bulk content read across a subtree',
    '- `find_context_references` — reverse lookup: given a context node, list every structural node that references it (use for "where does X appear?" questions).
- `get_subtree_content` — bulk content read across a subtree'
  );

  IF v_v15_prompt = v_v14_prompt THEN
    RAISE NOTICE 'M-171: read-tool list substitution did not match v1.14 prompt body verbatim; tool wired regardless';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.15',
    'Director v1.15 — find_context_references tool',
    'production',
    v_v15_prompt,
    v_v15_tool_suite,
    v_v14_model_id,
    v_v14_model_params,
    v_v14_capability_flags,
    'New read tool find_context_references added (tool count 21 → 22).
Closes the "where does Bracket appear?" gap — reverse lookup on
node_context_links from a context node to every structural node
that references it. Returns each reference with its ancestor path
so the result is self-describing.
Same-day code-only return-shape enrichments absorbed: get_node now
returns ancestor path + updated_at + last_modified_by + word_count_actual
+ rich lock_info; get_node_tree rows now include child_count +
word_count_actual + word_count_target; get_nodes_by_layer rows now
include has_prose + has_summary + status + word counts (M-170);
get_subtree_content NEW (M-170).
Also bug-fixes get_node''s broken context-links lookup (was querying
non-existent table; silently returned linked_context_node_ids:[]).',
    NOW(), NULL, NOW()
  );
END $$;
