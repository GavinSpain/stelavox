-- M-175 — Director config v1.16: leaf-layer + word-count-aggregate note.
--
-- Background. 2026-05-18 testing surfaced the Director presenting
-- "chapter 1 word count" as Actual=0 / Target=5,600 for the chapter
-- node — technically true (the chapter has no direct prose; prose only
-- lives at the beat leaf layer) but useless to an author who wants to
-- know if the chapter hit its target. The chapter's 20 child beats
-- summed to 5,357 words; the Director didn't surface that aggregate.
--
-- Tool-side fix (committed alongside this migration): get_node,
-- get_nodes_by_layer, get_subtree_content, get_node_tree all now return
-- two new fields on every node row:
--
--   is_leaf: boolean — whether the node sits at the leaf layer
--   word_count_aggregate: number — sum of descendant word_count_actual
--                                   (equals word_count_actual for leaves)
--
-- This migration adds a thin one-paragraph note to the system prompt
-- so the model knows which field to consult when comparing actuals
-- against targets on chapters / scenes / acts / books. No tool count
-- change (still 22 tools).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.15' AND status = 'production';

DO $$
DECLARE
  v_v15_prompt TEXT;
  v_v16_prompt TEXT;
  v_v15_tool_suite JSONB;
  v_v15_model_id TEXT;
  v_v15_model_params JSONB;
  v_v15_capability_flags JSONB;
  v_note TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v15_prompt, v_v15_tool_suite, v_v15_model_id, v_v15_model_params, v_v15_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.15';

  v_note := E'\n\n**Leaf-only prose + word-count aggregates.** Prose lives only at the leaf layer of the document''s layer stack (typically `beat` for novels). Structural nodes (book / act / chapter / scene in a novel) have no direct prose and so their `word_count_actual` is always 0. When the user asks about the word count of a chapter, scene, or any non-leaf node, use the `word_count_aggregate` field on every tool return — it sums the `word_count_actual` of all descendants and is the meaningful number to compare against `word_count_target`. The `is_leaf` boolean on each row tells you whether the node sits at the leaf layer. Never report `Actual=0` on a non-leaf node as if it were the final word count; always use the aggregate.';

  -- Insert the note after the existing read-tool grounding paragraph.
  -- Best-effort match — if the prompt has drifted around the anchor,
  -- fall back to appending at the end (still gets the rule across).
  v_v16_prompt := replace(
    v_v15_prompt,
    '- `find_context_references` — reverse lookup: given a context node, list every structural node that references it (use for "where does X appear?" questions).',
    '- `find_context_references` — reverse lookup: given a context node, list every structural node that references it (use for "where does X appear?" questions).' || v_note
  );

  IF v_v16_prompt = v_v15_prompt THEN
    -- Anchor didn't match — append to end. Still effective; the model
    -- reads the whole system prompt.
    v_v16_prompt := v_v15_prompt || v_note;
    RAISE NOTICE 'M-175: anchor substitution did not match; note appended at end of prompt';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.16',
    'Director v1.16 — leaf-only prose + word-count aggregate note',
    'production',
    v_v16_prompt,
    v_v15_tool_suite,
    v_v15_model_id,
    v_v15_model_params,
    v_v15_capability_flags,
    'System prompt addition (no new tool, no tool_suite change): teaches
the model that prose lives only at the leaf layer, so structural
nodes have word_count_actual=0 by design. Directs the model to use
the new word_count_aggregate field returned on every node row
(get_node, get_nodes_by_layer, get_subtree_content, get_node_tree)
when comparing chapter/scene/act/book actuals against word_count_target.
Closes the "chapter shows Actual=0" misinterpretation surfaced
2026-05-18 in user testing. Tool count unchanged at 22.',
    NOW(), NULL, NOW()
  );
END $$;
