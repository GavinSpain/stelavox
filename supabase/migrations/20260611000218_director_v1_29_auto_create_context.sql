-- M-218 — Director config v1.29: auto-create-and-link context teaching
-- (V1 Deliverables Register DR-051, work package D).
--
-- Background
-- ----------
-- The executor at `lib/director/workflow-executor.ts` lines 496-578 has
-- already shipped the SU-J11-2 Option B path: when the Director plans
-- `generate_context` against a structural node, the executor (a) creates
-- a new context node with the requested context_type, (b) inserts a
-- `node_context_links` row of type `structural_to_context` from the
-- structural target to the new context node, (c) re-targets the
-- workflow_step at the new context node, and (d) dispatches the
-- agent_job against the new node so Accept writes content to the right
-- place.
--
-- The Director's prompt has not learned this. The Step shapes line says
-- generate_context's only parameter is `context_type` and the
-- Trust-the-specialists block tells the model "context node must
-- pre-exist; if not, the workflow needs an earlier step that creates
-- it". The model can avoid emitting generate_context against structural
-- targets even though the executor handles it cleanly.
--
-- This text has carried unchanged from v1.24 (M-184) through v1.25/26/27/28
-- (M-186 / M-187 / M-208 / M-209). The discovery that the current prompt
-- production is v1.28 (not v1.24, as CLAUDE.md indicated) surfaced during
-- the work package D apply pass; M-218 deprecates v1.28 and inserts v1.29.
-- Tool registry preserved exactly. Model + model_params + capability_flags
-- inherited. This is a prompt-only revision targeting exactly two passages.
--
-- Drift guard
-- -----------
-- `tests/unit/director-prompt-vs-schema-drift.test.ts` records
-- `seed_content` as an optional accepted key on generate_context's
-- ParamsSchema. v1.24 .. v1.28 omit it from the Step shapes line
-- (under-documentation; allowed by the guard because it only flags
-- "documented ⊄ accepted"). v1.29 closes the gap by listing seed_content
-- explicitly.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.28' AND status = 'production';

DO $migration$
DECLARE
  v_v28_prompt TEXT;
  v_v28_tool_suite JSONB;
  v_v28_model_id TEXT;
  v_v28_model_params JSONB;
  v_v28_capability_flags JSONB;
  v_v29_prompt TEXT;
  v_old_step_line TEXT;
  v_new_step_line TEXT;
  v_old_specialist_block TEXT;
  v_new_specialist_block TEXT;
BEGIN
  -- Inherit everything from v1.28.
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v28_prompt, v_v28_tool_suite, v_v28_model_id, v_v28_model_params, v_v28_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.28';

  IF v_v28_prompt IS NULL THEN
    RAISE EXCEPTION 'M-218: v1.28 director_configs row not found (run M-209 first)';
  END IF;

  -- ---------------------------------------------------------------
  -- Edit 1: Step shapes line for generate_context.
  -- ---------------------------------------------------------------
  v_old_step_line := '- `generate_context` → `parameters: { "context_type": "string (required, must match a project profile context type)" }` — generates a context node''s content.';

  v_new_step_line := '- `generate_context` → `parameters: { "context_type": "string (required, must match a project profile context type)", "seed_content": "string (optional, ≤10000 chars)" }` — generates a context node''s content. **You may target a structural node directly: the system auto-creates a context node of the chosen `context_type`, links it to the structural target via a `structural_to_context` link, and runs the specialist against the new node. `seed_content` seeds the new node''s name and initial summary; the specialist then authors its full content.** Target an existing context node instead when one already exists in the right spot.';

  IF POSITION(v_old_step_line IN v_v28_prompt) = 0 THEN
    RAISE EXCEPTION 'M-218: could not locate the v1.28 generate_context Step shapes line for replacement. Prompt may have drifted.';
  END IF;

  v_v29_prompt := REPLACE(v_v28_prompt, v_old_step_line, v_new_step_line);

  -- ---------------------------------------------------------------
  -- Edit 2: Trust the specialists — Context-generation specialist paragraph.
  -- ---------------------------------------------------------------
  v_old_specialist_block := '**Context-generation specialist (`generate_context`).** Targets an existing context node (already created with the right node_type). The specialist authors that node''s content. If a context node doesn''t exist at the right spot, the workflow needs an earlier step that creates it (use `expand` or a manual structural step the user authors).';

  v_new_specialist_block := '**Context-generation specialist (`generate_context`).** Authors the content of a context node. You may target either (a) an existing context node — the specialist writes its content — or (b) a structural node, in which case the system creates a new context node of the requested `context_type`, links it to the structural target via a `structural_to_context` link, and runs the specialist against the new node. The new node''s name and initial summary are derived from `seed_content` (or a sensible default when `seed_content` is absent). Use option (a) when the right context node already exists in the document; use option (b) when the document needs a new context node and the structural target is where to attach it.';

  IF POSITION(v_old_specialist_block IN v_v29_prompt) = 0 THEN
    RAISE EXCEPTION 'M-218: could not locate the v1.28 Context-generation specialist paragraph for replacement. Prompt may have drifted.';
  END IF;

  v_v29_prompt := REPLACE(v_v29_prompt, v_old_specialist_block, v_new_specialist_block);

  -- ---------------------------------------------------------------
  -- Insert v1.29 row.
  -- ---------------------------------------------------------------
  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.29',
    'Director v1.29 — auto-create-and-link context teaching',
    'production',
    v_v29_prompt,
    v_v28_tool_suite,
    v_v28_model_id,
    v_v28_model_params,
    v_v28_capability_flags,
    'Phase 9 work package D (DR-051). Prompt-only revision teaching
the Director that generate_context against a structural target is
supported end-to-end: the system auto-creates a context node of
the requested context_type, inserts a structural_to_context link
back to the structural target, and runs the specialist against
the new node. The executor at workflow-executor.ts lines 496-578
has shipped this path since Mars-series 2026-05-08 (SU-J11-2);
v1.29 brings the prompt into parity so the model can plan
generate_context steps directly against structural targets
instead of avoiding the path because the prior prompt warned it
off. Step shapes line for generate_context also documents the
optional seed_content parameter (which the Zod schema already
accepts — seed_content is the source of the auto-created node''s
name + initial summary). Tool registry unchanged at 17 (12 read
+ 5 write). Model + model_params + capability_flags inherited
from v1.28.',
    NOW(), NULL, NOW()
  );
END $migration$;
