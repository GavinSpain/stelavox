-- M-181 — Director config v1.22.
--
-- Phase 2 of the create_*_step deprecation refactor (Phase 1 landed
-- 2026-05-19, additive — strengthened propose_brief's validation).
-- This migration:
--
--   • Removes 7 create_*_step tool names from tool_suite (24 → 17):
--       create_expand_step, create_synthesise_step, create_refine_step,
--       create_context_step, create_comment_step,
--       create_node_reorder_step, create_rename_step
--
--   • Adds a "Workflow steps embed inside propose_brief" section to
--     the system prompt right after Step shapes — the architectural
--     statement of the new single-write pattern.
--
--   • Fixes a false-parallelism the M-180 paragraph introduced — it
--     listed "propose_brief, propose_brief_amendment, or any
--     create_*_step tool" as parallel ways to write. With the
--     create_*_step tools gone, the list is wrong; it also contributed
--     to today's "model called create_*_step thinking it had proposed"
--     failure.
--
-- The Phase 1 propose_brief validator already enforces per-op-type
-- parameter shape via the discriminated-union StepSchema. The
-- per-step lock check and target-id verification also live there.
-- So the runtime contract is the same; we're just deleting the
-- redundant tool surface.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.21' AND status = 'production';

DO $$
DECLARE
  v_v21_prompt TEXT;
  v_v22_prompt TEXT;
  v_v21_tool_suite JSONB;
  v_v22_tool_suite JSONB;
  v_v21_model_id TEXT;
  v_v21_model_params JSONB;
  v_v21_capability_flags JSONB;
  v_deprecated_tools TEXT[] := ARRAY[
    'create_expand_step',
    'create_synthesise_step',
    'create_refine_step',
    'create_context_step',
    'create_comment_step',
    'create_node_reorder_step',
    'create_rename_step'
  ];
  v_t TEXT;
  v_substitutions INTEGER := 0;
  v_embed_section TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v21_prompt, v_v21_tool_suite, v_v21_model_id, v_v21_model_params, v_v21_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.21';

  -- Remove the deprecated tool names from tool_suite. Use jsonb '-'
  -- operator (string overload) which removes a top-level element.
  v_v22_tool_suite := v_v21_tool_suite;
  FOREACH v_t IN ARRAY v_deprecated_tools LOOP
    v_v22_tool_suite := v_v22_tool_suite - v_t;
  END LOOP;

  -- Sanity-check the count.
  IF jsonb_array_length(v_v22_tool_suite) <> jsonb_array_length(v_v21_tool_suite) - 7 THEN
    RAISE EXCEPTION 'M-181: tool_suite count after removal is %, expected %',
      jsonb_array_length(v_v22_tool_suite),
      jsonb_array_length(v_v21_tool_suite) - 7;
  END IF;

  -- Substitution 1: insert the "Workflow steps embed inside propose_brief"
  -- section right after Step shapes. The Step shapes reference list
  -- stays — it's still useful as a per-op-type parameter cheatsheet.
  v_embed_section := E'\n## Workflow steps embed inside propose_brief\n\nThere is only one way to surface an approvable card: call a write tool. There is no separate per-step "build a step" call. To execute work on N nodes, build N step objects inline inside `propose_brief({ stages: [{ workflow: { steps: [...N step objects...] } }] })`. The trivial single-step case is just one step in the array.\n\nEvery `propose_brief` step is validated server-side at the proposal boundary:\n  - The discriminated-union StepSchema rejects malformed parameters per op_type. A `refine` step missing `parameters.instruction`, an `expand` step with a non-integer `child_count_target`, etc. — all surface as `invalid_step_shape` in `per_step_errors`.\n  - Target node ids that don\\''t exist in this document surface as `target_node_not_found` in `per_step_errors`.\n  - Target nodes that are author-locked surface as `node_locked` in `per_step_errors`.\n\nIf `propose_brief` returns `{ ok: false, error: \"invalid_brief_proposal\", per_step_errors: [...] }`, every problematic step is named with `(stage_order, step_index)` so you can fix them all and retry in one call. **Read every per_step_errors entry before retrying — don\\''t fix one error at a time.**\n';

  v_v22_prompt := replace(
    v_v21_prompt,
    '- `node_rename` → `parameters: { "new_name": "string (1-200 chars, trimmed)" }` — metadata operation; does NOT bump the node''s content version. Use for renaming nodes (disambiguating duplicates, fixing typos, restructuring naming).',
    '- `node_rename` → `parameters: { "new_name": "string (1-200 chars, trimmed)" }` — metadata operation; does NOT bump the node''s content version. Use for renaming nodes (disambiguating duplicates, fixing typos, restructuring naming).' || v_embed_section
  );
  IF v_v22_prompt <> v_v21_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  -- Substitution 2: fix the false-parallelism in the M-180 paragraph.
  -- "Before calling propose_brief, propose_brief_amendment, or any
  -- create_*_step tool" → list only the card-surfacing tools.
  v_v22_prompt := replace(
    v_v22_prompt,
    'Before calling propose_brief, propose_brief_amendment, or any create_*_step tool, run find_node_by_name',
    'Before calling any write tool (propose_brief, propose_brief_amendment, cancel_brief, propose_profile_amendment), run find_node_by_name'
  );
  IF v_substitutions = 1 AND POSITION('any write tool (propose_brief' IN v_v22_prompt) > 0 THEN
    v_substitutions := 2;
  END IF;

  -- Substitution 3: the older Tool-result grounding bullet at line ~23
  -- still references propose_brief in passing — that's fine, but
  -- update the error code reference from M-180's old name to the
  -- Phase 1 unified shape.
  v_v22_prompt := replace(
    v_v22_prompt,
    'If propose_brief returns `target_node_ids_not_found`, that is the runtime catching this exact failure mode — re-call find_node_by_name to get the real ids and retry.',
    'If propose_brief returns per_step_errors with `target_node_not_found`, that is the runtime catching this exact failure mode for specific steps — re-call find_node_by_name to get the real ids and retry.'
  );

  IF v_substitutions < 2 THEN
    RAISE EXCEPTION 'M-181: prompt substitutions failed — applied % of expected 2 anchors. v1.21 prompt body drifted from expected shape', v_substitutions;
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.22',
    'Director v1.22 — single-write-pattern (create_*_step removed)',
    'production',
    v_v22_prompt,
    v_v22_tool_suite,
    v_v21_model_id,
    v_v21_model_params,
    v_v21_capability_flags,
    'Phase 2 of the create_*_step deprecation refactor. Removes 7
per-step tool names from tool_suite (count 24 -> 17):
create_expand_step, create_synthesise_step, create_refine_step,
create_context_step, create_comment_step, create_node_reorder_step,
create_rename_step. Workflow steps now embed directly inside
propose_brief''s workflow.steps array. Phase 1 (committed earlier
this date) strengthened propose_brief''s validation to absorb the
shape, lock, and existence checks that previously lived per-step.
Prompt updated with a new "Workflow steps embed inside propose_brief"
section, plus the M-180 false-parallelism fix removing create_*_step
from the cross-turn re-grounding list.',
    NOW(), NULL, NOW()
  );
END $$;
