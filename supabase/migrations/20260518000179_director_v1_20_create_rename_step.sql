-- M-179 — Director config v1.20: add create_rename_step tool.
--
-- 2026-05-18 testing surfaced a real gap: when the user asked the
-- Director to suggest distinct names for three nodes all called
-- "The Countdown", the Director correctly read its toolkit and
-- reported it had no rename capability — sending the user back to
-- the UI to perform the renames manually.
--
-- The capability gap was real: write-tool registry covered expand /
-- synthesise / refine / generate_context / comment / node_reorder
-- but NOT rename. The API supports renames natively
-- (PATCH /api/nodes/[id] with the `name` field), so this is purely
-- a Director-surface gap.
--
-- create_rename_step ships in the same commit as a propose-only
-- write tool (per H-08): the Director proposes the rename, the user
-- approves the Brief, the workflow executor performs the
-- UPDATE nodes SET name=... synchronously (no agent_jobs row, no
-- LLM call — same lifecycle pattern as comment + node_reorder).
--
-- Rename is metadata, not content. The M-023 version-bump trigger
-- deliberately ignores `name` changes (matches TC-A-47); renames
-- don't bump version or write node_versions rows.
--
-- Tool count 23 → 24.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.19' AND status = 'production';

DO $$
DECLARE
  v_v19_prompt TEXT;
  v_v20_prompt TEXT;
  v_v19_tool_suite JSONB;
  v_v20_tool_suite JSONB;
  v_v19_model_id TEXT;
  v_v19_model_params JSONB;
  v_v19_capability_flags JSONB;
  v_substitutions_count INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v19_prompt, v_v19_tool_suite, v_v19_model_id, v_v19_model_params, v_v19_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.19';

  -- Tool registry: 23 → 24.
  v_v20_tool_suite := v_v19_tool_suite || '["create_rename_step"]'::jsonb;

  -- v1.19 prompt structure: the "create_*" per-tool bullet list was
  -- rewritten away in v1.5 (V1.x-A.1 Brief-aware framing). Only anchor
  -- that survives is the "Step shapes by operation_type" cheatsheet,
  -- which is the place the model actually learns what each step looks
  -- like — so getting node_rename into that list is what matters.
  v_v20_prompt := replace(
    v_v19_prompt,
    '- `node_reorder` → `parameters: { "new_order": 1+, "parent_id"?: "uuid" }`',
    '- `node_reorder` → `parameters: { "new_order": 1+, "parent_id"?: "uuid" }`
- `node_rename` → `parameters: { "new_name": "string (1-200 chars, trimmed)" }` — metadata operation; does NOT bump the node''s content version. Use for renaming nodes (disambiguating duplicates, fixing typos, restructuring naming).'
  );

  IF v_v20_prompt = v_v19_prompt THEN
    RAISE EXCEPTION 'M-179: Step shapes anchor did not match v1.19 prompt body — tool still registered via tool_suite but the model has no guidance on parameters';
  END IF;

  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.20',
    'Director v1.20 — create_rename_step',
    'production',
    v_v20_prompt,
    v_v20_tool_suite,
    v_v19_model_id,
    v_v19_model_params,
    v_v19_capability_flags,
    'New write tool create_rename_step added (tool count 23 → 24).
Closes the "Director cannot rename nodes" gap surfaced 2026-05-18
when the user asked the Director to propose distinct names for
three nodes all called "The Countdown" — the Director correctly
reported the gap rather than wedging the request into the wrong
tool. Rename is propose-only per H-08; the workflow executor
performs UPDATE nodes SET name=... synchronously (no agent_jobs
row, no LLM call) when the user approves the Brief — same
lifecycle as comment + node_reorder. Metadata operation (not
content): the M-023 version-bump trigger deliberately ignores
name changes per TC-A-47.',
    NOW(), NULL, NOW()
  );
END $$;
