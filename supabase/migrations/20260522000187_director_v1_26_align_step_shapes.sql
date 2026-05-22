-- M-187 — Director config v1.26: align "## Step shapes" prompt
-- lines with the actual Zod schemas.
--
-- The drift guard at tests/unit/director-prompt-vs-schema-drift.test.ts
-- (added 2026-05-22) walked the v1.25 prompt and found three more
-- prompt-vs-schema drifts beyond the expand-instruction one M-186 fixed:
--
--   1. refine: prompt documents `{ "instruction": "..." }` but the
--      RefineParamsSchema requires BOTH `target_field` AND `instruction`.
--      The model would attempt refine + send only `instruction`, get
--      rejected on the missing target_field, recover via per_step_errors.
--
--   2. comment: prompt documents `{ "comment_text": "..." }` but the
--      CommentParamsSchema requires `comment_type` (enum) + `content`.
--      The model attempting comment would send a nonexistent
--      `comment_text` and be missing both required keys — broken.
--
-- M-186 already fixed expand. M-187 finishes the cleanup by replacing
-- the refine and comment lines verbatim with the schema-accurate shape.
-- node_reorder + node_rename are correct in the prompt; left alone.
--
-- Going forward, the drift guard test prevents this class of bug from
-- recurring — it walks the production prompt's Step shapes section and
-- asserts each documented parameter is accepted by the schema, and
-- each required schema parameter is documented.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.25' AND status = 'production';

DO $migration$
DECLARE
  v_v25_prompt TEXT;
  v_v26_prompt TEXT;
  v_v25_tool_suite JSONB;
  v_v25_model_id TEXT;
  v_v25_model_params JSONB;
  v_v25_capability_flags JSONB;
  v_substitutions INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v25_prompt, v_v25_tool_suite, v_v25_model_id, v_v25_model_params, v_v25_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.25';

  -- Substitution 1: refine line — add target_field as required.
  v_v26_prompt := replace(
    v_v25_prompt,
    '- `refine` → `parameters: { "instruction": "string (required)" }` — applies a directed revision to existing content.',
    '- `refine` → `parameters: { "target_field": "string (required, one of: ''summary'' | ''prose'' | ''notes'' | ''metadata'')", "instruction": "string (required, 1-2000 chars)" }` — applies a directed revision to the named field on the target node.'
  );
  IF v_v26_prompt <> v_v25_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  -- Substitution 2: comment line — replace comment_text with the
  -- actual schema shape (comment_type enum + content text).
  v_v26_prompt := replace(
    v_v26_prompt,
    '- `comment` → `parameters: { "comment_text": "string (required)" }` — adds an inline review comment.',
    '- `comment` → `parameters: { "comment_type": "string (required, one of: ''instruction'' | ''question'' | ''note'' | ''critique'' | ''approval'')", "content": "string (required, 1-5000 chars)" }` — adds an inline review comment of the given type on the target node.'
  );
  IF v_substitutions = 1 AND POSITION('"comment_type"' IN v_v26_prompt) > 0 THEN v_substitutions := 2; END IF;

  IF v_substitutions <> 2 THEN
    RAISE EXCEPTION 'M-187: prompt substitutions failed — applied % of expected 2 anchors. v1.25 prompt body drifted from expected shape.', v_substitutions;
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.26',
    'Director v1.26 — Step shapes prompt aligned with Zod schemas',
    'production',
    v_v26_prompt,
    v_v25_tool_suite,
    v_v25_model_id,
    v_v25_model_params,
    v_v25_capability_flags,
    'Aligns the refine + comment Step shapes lines with the
RefineParamsSchema (target_field + instruction) and
CommentParamsSchema (comment_type + content) in lib/brief/
proposalBuilder.ts. Surfaced by the drift guard test added
2026-05-22 (director-prompt-vs-schema-drift.test.ts). Same
family of prompt-vs-schema drift bug as the expand
`instruction` fix M-186 landed earlier today, and the four
V1.x-B.3 amendment drifts. The drift guard prevents recurrence
by walking the production prompt''s Step shapes section and
asserting each documented parameter is accepted by the
corresponding Zod schema. Tool count unchanged at 17.',
    NOW(), NULL, NOW()
  );
END $migration$;
