-- M-182 — Director config v1.23: canonical step-order discipline.
--
-- Issue 1 fix (2026-05-20). User-driven 2-stage Brief test produced a
-- workflow with 4 expand steps targeting sibling scenes at canonical
-- positions 2, 4, 1, 3 (out of canonical order in the workflow.steps
-- array). The workflow executor runs steps strictly in array order
-- (persistDraftWorkflow assigns `order = i + 1`); the work executed
-- out of narrative sequence.
--
-- The v1.22 prompt has a "Canonical range discipline" section telling
-- the model to plan a contiguous canonical range, but never explicitly
-- says the steps within workflow.steps MUST be EMITTED in canonical
-- order. This migration adds that bullet.
--
-- A server-side sort in execProposeBrief (lib/director/tools/write.ts
-- sortWorkflowStepsByCanonicalPosition) is the backstop — it sorts
-- contiguous same-op-type runs by canonical position. The prompt
-- teaches the discipline so the model self-corrects and so the title /
-- impact_summary match what actually executes. Without the prompt,
-- a model could emit `title: "Expand scenes 1-4"` followed by a
-- shuffled steps array, and the user's PlanCard would show the sort-
-- corrected order while the model's description claimed a different
-- shape.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.22' AND status = 'production';

DO $$
DECLARE
  v_v22_prompt TEXT;
  v_v23_prompt TEXT;
  v_v22_tool_suite JSONB;
  v_v22_model_id TEXT;
  v_v22_model_params JSONB;
  v_v22_capability_flags JSONB;
  v_substitutions INTEGER := 0;
  v_canonical_anchor TEXT;
  v_canonical_replacement TEXT;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v22_prompt, v_v22_tool_suite, v_v22_model_id, v_v22_model_params, v_v22_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.22';

  -- Substitution 1: extend the "Canonical range discipline" section
  -- with explicit step-array-order guidance. Anchor on the existing
  -- third bullet (about steps targeting a contiguous canonical range).
  v_canonical_anchor := '- The **steps** target a contiguous canonical range. `get_nodes_by_layer` returns nodes in canonical depth-first order.';
  v_canonical_replacement := '- The **steps** target a contiguous canonical range. `get_nodes_by_layer` returns nodes in canonical depth-first order.
- The **steps array order MUST match canonical position**. If your workflow expands scenes at canonical positions 1, 2, 3, 4, the `workflow.steps` array MUST list them in that order: `[step for pos 1, step for pos 2, step for pos 3, step for pos 4]`. The executor runs steps strictly in the array order you emit; a shuffled steps array runs out of narrative order. When you have the `get_nodes_by_layer` result in hand, emit one step per target in the same order the tool returned them. The server will sort contiguous same-op-type runs by canonical position as a backstop, but if your title or impact_summary refers to "scenes 1-4 in order", the steps array must actually be in that order — otherwise your description and the execution diverge.';

  v_v23_prompt := replace(v_v22_prompt, v_canonical_anchor, v_canonical_replacement);
  IF v_v23_prompt <> v_v22_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  IF v_substitutions < 1 THEN
    RAISE EXCEPTION 'M-182: prompt substitution failed — anchor "%" not found in v1.22 prompt body. Inspect director_configs.system_prompt to confirm the Canonical range discipline section is intact.', v_canonical_anchor;
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.23',
    'Director v1.23 — canonical step-order discipline',
    'production',
    v_v23_prompt,
    v_v22_tool_suite,
    v_v22_model_id,
    v_v22_model_params,
    v_v22_capability_flags,
    'Issue 1 fix (2026-05-20). Adds an explicit bullet to the Canonical
range discipline section stating the workflow.steps array MUST be in
canonical position order. The workflow executor runs steps strictly in
array order; without the bullet a model could emit shuffled steps
that executed out of narrative sequence (the 2026-05-20 user test hit
this with scenes at positions 2, 4, 1, 3). A server-side sort in
execProposeBrief (sortWorkflowStepsByCanonicalPosition in
lib/director/tools/write.ts) is the predictability backstop —
contiguous same-op-type runs are sorted by canonical position before
the BriefProposalCard renders. The prompt teaches the discipline so
the model self-corrects and so title/impact_summary references match
the actual execution order.',
    NOW(), NULL, NOW()
  );
END $$;
