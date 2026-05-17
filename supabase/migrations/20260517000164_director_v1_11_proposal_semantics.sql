-- M-164 — Director config v1.11: correct propose-then-approve semantics
-- in the system prompt + add interpretation-transparency rule.
--
-- Background. v1.10 (M-146) shipped with two prompt-level bugs that
-- surfaced during the pre-Phase-8 test pass review:
--
--   1. The write-tool list described propose_brief as "Becomes active
--      immediately if no other active Brief exists; otherwise queues."
--      This is misleading — propose_brief is propose-only per the H-08
--      invariant. The briefs row is created by accept_brief RPC ONLY
--      when the user clicks Approve in the BriefProposalCard. The
--      misleading prompt led the LLM to claim "Done. I've queued a
--      two-stage Brief" in conversation copy even though no Brief row
--      existed.
--
--   2. The "Commit" step didn't address the case where the user's typed
--      reference and an @-mentioned node disagree on type. v1.10 left
--      the LLM free to silently re-interpret. The fix isn't to force a
--      clarification round-trip (a reasonable interpretation IS often
--      the best move) — it's to require the LLM to SURFACE the
--      interpretation in its lead-in so the user can immediately spot
--      a misinterpretation and correct course.
--
-- v1.11 amends three sections of the prompt body. No tool registry
-- changes; no model_params changes.

-- 1. Deprecate v1.10.
UPDATE public.director_configs
SET status = 'deprecated',
    deprecated_at = NOW()
WHERE version_number = '1.10' AND status = 'production';

-- 2. Insert v1.11. The system prompt is the v1.10 body with three
--    surgical replacements applied via the DO block below.
DO $$
DECLARE
  v_v10_prompt TEXT;
  v_v11_prompt TEXT;
  v_v10_tool_suite JSONB;
  v_v10_model_id TEXT;
  v_v10_model_params JSONB;
  v_v10_capability_flags JSONB;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v10_prompt, v_v10_tool_suite, v_v10_model_id, v_v10_model_params, v_v10_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.10';

  -- Replacement 1: write-tool list line. Replace the "Becomes active
  -- immediately" misleading semantics with the actual propose-then-approve flow.
  v_v11_prompt := replace(
    v_v10_prompt,
    '- `propose_brief` — propose a Brief (1+ stages). Becomes active immediately if no other active Brief exists; otherwise queues.',
    '- `propose_brief` — emit a Brief proposal (1+ stages). PROPOSAL ONLY: the briefs row is NOT created by this tool call. The user sees a BriefProposalCard and clicks Approve, at which point accept_brief inserts the row and (depending on whether another Brief is already active at THAT moment) activates it or queues it.'
  );

  -- Replacement 2: Commit step. Add an interpretation-transparency rule.
  v_v11_prompt := replace(
    v_v11_prompt,
    '3. **Commit** — write a brief user-visible prose summary (one or two sentences) of what you''re going to do, then call the write tool (`propose_brief`, `propose_profile_amendment`, or `cancel_brief`). The tool call IS the proposal — the structured card appears in the UI from your tool call''s contents.',
    '3. **Commit** — write a brief user-visible prose summary (one or two sentences) of what you''re going to do, then call the write tool (`propose_brief`, `propose_profile_amendment`, or `cancel_brief`). The tool call IS the proposal — the structured card appears in the UI from your tool call''s contents.

  **Interpretation transparency.** If the author''s typed wording and the actual node state disagree (e.g. they typed "chapter X" but @X resolves to a scene), choose the most reasonable interpretation AND state the mismatch + your interpretation explicitly in your prose lead-in — one sentence is enough. Example: *"You said chapter, but @X is a scene; I''ll expand it into beats."* The user can then redirect in one click if you''ve interpreted wrong. Do NOT silently re-interpret; do NOT halt to ask unless the intent is genuinely unrecoverable.

  **Don''t claim work is queued/active until the user approves.** `propose_brief` does NOT write the briefs row — accept_brief does, when the user clicks Approve in the proposal card. In your prose summary, say "I''ll propose…" / "Here''s a proposed Brief…" — NEVER "I''ve queued…" or "Done." A successful propose_brief tool call means the proposal has been emitted; the user still has to click Approve.'
  );

  -- Sanity check: both replacements must have landed. If either string
  -- wasn't found, the prompt body has drifted since v1.10 was written —
  -- fail loudly rather than silently install a degraded v1.11.
  IF v_v11_prompt = v_v10_prompt THEN
    RAISE EXCEPTION 'M-164: no substitutions applied — v1.10 prompt body drifted from the expected shape; review and fix before re-applying';
  END IF;

  INSERT INTO public.director_configs (
    version_number,
    display_name,
    status,
    system_prompt,
    tool_suite,
    model_id,
    model_params,
    capability_flags,
    release_notes,
    promoted_at,
    deprecated_at,
    created_at
  ) VALUES (
    '1.11',
    'Director v1.11 — proposal semantics + interpretation transparency',
    'production',
    v_v11_prompt,
    v_v10_tool_suite,        -- tool registry unchanged from v1.10 (19 tools)
    v_v10_model_id,          -- claude-haiku-4-5-20251001
    v_v10_model_params,      -- max_tokens 8192 / temperature 0.7 / extended_thinking true
    v_v10_capability_flags,
    'Two prompt-body fixes surfaced in pre-Phase-8 test pass review:
  1. Replace the misleading "Becomes active immediately" description of propose_brief
     with the actual propose-then-approve semantics (the briefs row is created by
     accept_brief RPC on user approval, not by the propose_brief tool call).
  2. Add an "Interpretation transparency" rule to the Commit step: when the user''s
     typed wording and the @-mentioned node disagree on type, choose the best
     interpretation AND surface the mismatch in the prose lead-in. Don''t silently
     re-interpret; don''t halt to ask unless the intent is genuinely unrecoverable.
  3. Add an explicit "don''t claim work is queued/active until approval" rule to
     the same Commit step — same root cause as fix #1, separately enforced.
Tool registry unchanged (19 tools).',
    NOW(),
    NULL,
    NOW()
  );
END $$;
