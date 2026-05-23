-- M-186 — Director config v1.25: drop the `instruction` drift on
-- the expand step.
--
-- Bug surfaced 2026-05-22 from user-driven testing: the v1.24 system
-- prompt's "## Step shapes" section documented the expand step as
--   `expand` → parameters: { "child_count_target": "integer (1-100)",
--                            "instruction": "string (optional)" }
-- But ExpandStepProposalSchema (lib/director/schemas.ts) and
-- StepSchema (lib/brief/proposalBuilder.ts) only accept
-- `child_count_target` + `parent_layer_target`. The model dutifully
-- sent `instruction` per the prompt; the executor rejected
-- (`Unrecognized key: instruction`); the model recovered via
-- per_step_errors on retry (~2 wasted iterations + visible
-- "I made an error" narration in the conversation).
--
-- Drift predates today's refactor — v1.23 carried the same line,
-- v1.24 carried it forward unchanged. Same family as the V1.x-B.3
-- amendment drifts (prompt promises shape A, schema enforces shape B).
--
-- Fix: drop `instruction` from the expand step's parameter shape
-- documented in the prompt. The "Trust the specialists" section
-- (preserved unchanged from v1.23) already tells the Director to
-- pass through structural constraints via parameters.child_count_target
-- + word_count_target but otherwise default to the specialist's
-- judgment — so `instruction` was misleading anyway.
--
-- If directed-expand support is genuinely useful (author wants
-- "expand into beats but focus on internal conflict, not action"),
-- add it as a follow-up that EXTENDS the schema FIRST and updates
-- the prompt SECOND — not the other way around.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.24' AND status = 'production';

DO $migration$
DECLARE
  v_v24_prompt TEXT;
  v_v25_prompt TEXT;
  v_v24_tool_suite JSONB;
  v_v24_model_id TEXT;
  v_v24_model_params JSONB;
  v_v24_capability_flags JSONB;
  v_substitutions INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v24_prompt, v_v24_tool_suite, v_v24_model_id, v_v24_model_params, v_v24_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.24';

  -- Substitution: drop the ", "instruction": "string (optional)"" part
  -- from the expand line. Keep everything else verbatim.
  v_v25_prompt := replace(
    v_v24_prompt,
    '- `expand` → `parameters: { "child_count_target": "integer (1-100)", "instruction": "string (optional)" }` — expands the target node into children at the next layer down.',
    '- `expand` → `parameters: { "child_count_target": "integer (1-100)" }` — expands the target node into children at the next layer down. The expand specialist reads the target''s summary + context and decides what to produce; do NOT pass a free-text `instruction` parameter (the schema rejects it). To shape expansion, edit the target''s summary or context nodes BEFORE proposing the expand step.'
  );
  IF v_v25_prompt <> v_v24_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  IF v_substitutions <> 1 THEN
    RAISE EXCEPTION 'M-186: prompt substitution failed — expand line anchor not found in v1.24 prompt body. Inspect director_configs.system_prompt to confirm the Step shapes section is intact.';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.25',
    'Director v1.25 — drop the expand `instruction` parameter drift',
    'production',
    v_v25_prompt,
    v_v24_tool_suite,
    v_v24_model_id,
    v_v24_model_params,
    v_v24_capability_flags,
    'Drops the misleading `instruction (optional)` parameter from
the expand step''s shape line. The Zod schemas
(ExpandStepProposalSchema + lib/brief/proposalBuilder.ts:StepSchema)
have never accepted that key; the prompt was lying. The model
dutifully sent it, got rejected, recovered after a few wasted
iterations. Same family of prompt-vs-schema drift bug that
motivated the V1.x-B.3 amendment refactor. Tool count unchanged
at 17.',
    NOW(), NULL, NOW()
  );
END $migration$;
