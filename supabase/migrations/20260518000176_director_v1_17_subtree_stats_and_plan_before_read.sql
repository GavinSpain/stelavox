-- M-176 — Director config v1.17.
--
-- Two intertwined changes addressing the same root issue surfaced
-- in continued testing (2026-05-18): the Director treats vague user
-- questions ("which chapters don't have prose yet") too literally and
-- doesn't pre-plan its tool sequence before diving in.
--
-- 1. NEW READ TOOL get_subtree_stats — lightweight structural-summary
--    tool. Returns per-layer counts + leaf-prose coverage WITHOUT
--    fetching content. Enables the progressive-zoom pattern: cheap
--    shape first, expensive content only on subtrees that need detail.
--    Tool count 22 → 23.
--
-- 2. NEW PROMPT SECTION "Plan before you read" inserted before the
--    existing "Plan before you propose". Teaches the model to read
--    intent (not just literal wording), follow a "smallest subset of
--    data" guiding principle, and sketch its tool chain cheapest-first
--    before the first tool call. Tightens the existing carve-out at
--    line ~29 so "skip the plan" only applies when no tool call is
--    needed.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.16' AND status = 'production';

DO $$
DECLARE
  v_v16_prompt TEXT;
  v_v17_prompt TEXT;
  v_v16_tool_suite JSONB;
  v_v17_tool_suite JSONB;
  v_v16_model_id TEXT;
  v_v16_model_params JSONB;
  v_v16_capability_flags JSONB;
  v_plan_section TEXT;
  v_old_carveout TEXT;
  v_new_carveout TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v16_prompt, v_v16_tool_suite, v_v16_model_id, v_v16_model_params, v_v16_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.16';

  -- Tool registry: 22 → 23.
  v_v17_tool_suite := v_v16_tool_suite || '["get_subtree_stats"]'::jsonb;

  -- (a) Add the new tool to the read-tool list (anchor: get_node_tree line).
  v_v17_prompt := replace(
    v_v16_prompt,
    '- `get_node_tree` — subtree SHAPE only (no prose/summary). Use to understand hierarchy.',
    '- `get_node_tree` — subtree SHAPE only (no prose/summary). Use to understand hierarchy.
- `get_subtree_stats` — lightweight structural-summary tool. Per-layer node counts + leaf-with-prose counts in one call, without fetching content. Use FIRST when answering completeness / "what''s left" questions across multiple nodes; drill in with get_subtree_content only on subtrees flagged as partial.'
  );

  -- (b) Insert the "Plan before you read" section before "Plan before you propose".
  v_plan_section := E'## Plan before you read\n\nMany author questions look simple but are open-ended by design. "Which chapters don''t have prose yet" looks literal but usually means *"what''s left for me to write"* — a question about authorial completeness across the subtree, not about the chapter node''s own data. Read the *intent* of the question, not just the wording.\n\n**Guiding principle: smallest subset of data that fulfils the requirement.** Use cheap shape queries to scope expensive content queries. Don''t fetch what you won''t use.\n\nBefore your first tool call, emit a short `<plan>` block that:\n\n1. **Re-states the question in your own words**, surfacing the likely intent. State your interpretation explicitly when the question admits more than one reasonable reading.\n2. **Names the end-state.** What does a useful answer look like — a sentence, a list, a table?\n3. **Sketches the tool chain, cheapest first.** Reach for `get_subtree_stats` when shape (counts, completion) would answer the question. Reserve content reads (`get_subtree_content`, `get_node`) for subtrees you''ve already identified as needing detail.\n4. **Right-sizes each call.** Once shape is known, scope follow-up calls to the smallest subtree that has the data you need. A `get_subtree_content` on an Act with 150 nodes is wasteful when only one chapter needs detail — call per-chapter instead. When shape reveals distinct categories (complete / partial / empty), plan one approach per category; empty subtrees need no follow-up at all.\n5. **Notes which fields carry the answer.** Non-leaf nodes have no direct prose — completion questions read from `*_aggregate` fields or leaf-descendant counts, never from per-node `has_prose` or `word_count_actual`.\n\nThen call your tools. If a tool result reveals you misread the intent, re-plan briefly before proceeding.\n\n';

  v_v17_prompt := replace(
    v_v17_prompt,
    '## Plan before you propose',
    v_plan_section || '## Plan before you propose'
  );

  -- (c) Tighten the existing carve-out so it only applies when NO tool
  -- call is needed at all. Original wording let the model skip planning
  -- whenever the request seemed "simple", which is the exact bias we''re
  -- trying to correct.
  v_old_carveout := 'If the author''s request needs no plan (a simple question, a clarification), answer in prose and skip the `<plan>` and tool call.';
  v_new_carveout := 'If the author''s request can be answered conversationally with NO tool calls (a definition, a clarification about your own capabilities), answer in prose and skip the `<plan>`. The moment a tool call is needed, apply the "Plan before you read" checklist below.';

  v_v17_prompt := replace(v_v17_prompt, v_old_carveout, v_new_carveout);

  -- Sanity: at least one of the three substitutions must have applied;
  -- otherwise the prompt body has drifted past recognition and we should
  -- abort before producing a broken config.
  IF v_v17_prompt = v_v16_prompt THEN
    RAISE EXCEPTION 'M-176: all three prompt substitutions failed — anchors did not match v1.16 prompt body';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.17',
    'Director v1.17 — get_subtree_stats + Plan-before-you-read',
    'production',
    v_v17_prompt,
    v_v17_tool_suite,
    v_v16_model_id,
    v_v16_model_params,
    v_v16_capability_flags,
    'New read tool get_subtree_stats added (tool count 22 → 23). Returns
per-layer node counts + leaf-with-prose counts in one call without
fetching content. Enables the progressive-zoom pattern: cheap shape
first, expensive content only on subtrees that need detail.
New prompt section "Plan before you read" inserted before "Plan before
you propose". Teaches read-intent-not-wording + smallest-subset
guiding principle + cheapest-first tool sequencing + right-sizing
follow-up calls. Existing carve-out at "If the author''s request needs
no plan..." tightened so it only applies when no tool call is needed
at all — the previous wording let the model skip planning on any
question that looked simple, which was the root of the
"which chapters don''t have prose yet" misinterpretation.',
    NOW(), NULL, NOW()
  );
END $$;
