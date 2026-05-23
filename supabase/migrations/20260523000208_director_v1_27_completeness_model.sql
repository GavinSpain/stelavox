-- M-208 — Director config v1.27: completeness-question discipline.
--
-- User-driven test 2026-05-23 surfaced an inferential gap. When the
-- user asked "check the hierarchy of act 1 and tell me what is missing"
-- the Director called get_subtree_content (returned 160k chars of
-- prose), then summarised at the CHAPTER level — marking a chapter
-- "complete" when at least one scene in it had prose. The 6 zero-beat
-- scenes scattered across First Contact / The Crew / Salvage went
-- unflagged. The follow-up "complete all parts of act 1 that are
-- missing" proposed a brief covering only 4 of the actual 10
-- incomplete scenes.
--
-- The data was there; the Director's analytical discipline wasn't:
--
--   1. Tool-selection: chose the content-heavy tool for a structure
--      question. get_subtree_stats exists and is the right tool — its
--      OWN description (sent to Anthropic via input_schema) literally
--      reads "Use this FIRST when answering completeness / coverage /
--      'what's left' questions." But the system prompt's "Tools you
--      have" bullet at line 125 lumps get_subtree_stats with the
--      content tools ("context and content reads"). The Director read
--      the prompt's inventory before drilling into per-tool descriptions
--      and reached for the wrong family.
--
--   2. Inference model: nothing in the prompt described what
--      "complete" means at each layer or distinguished STRONG missing
--      signals (zero children at a non-leaf) from WEAK ones (fewer
--      children than siblings — often intentional). The Director
--      applied the strong signal in some places (Hunted/The Pattern)
--      and missed it in others (First Contact/The Bar on Vesta) — the
--      signature of an inconsistent ad-hoc model.
--
-- v1.27 lands three amendments:
--
--   A. Reclassify the tool inventory bullet at line 125. Separate the
--      structural-shape tool (get_subtree_stats) from the content tools
--      (get_subtree_content, find_context_references) with an explicit
--      "use FIRST" directive for completeness questions.
--
--   B. Insert a "## Completeness questions" section between "Plan
--      before you read" and "Plan before you propose". Teaches the
--      two-question-types distinction ("what is there" vs "what is
--      missing"), per-layer completeness criteria, strong-vs-weak
--      signal asymmetry, and enumeration discipline.
--
--   C. (no separate substitution — the new section absorbs the
--      shape-first-discipline content.)
--
-- Tool count unchanged at 17. tool_suite, model_id, model_params,
-- capability_flags inherited verbatim from v1.26.

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.26' AND status = 'production';

DO $migration$
DECLARE
  v_v26_prompt           TEXT;
  v_v27_prompt           TEXT;
  v_v26_tool_suite       JSONB;
  v_v26_model_id         TEXT;
  v_v26_model_params     JSONB;
  v_v26_capability_flags JSONB;
  v_substitutions        INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v26_prompt, v_v26_tool_suite, v_v26_model_id, v_v26_model_params, v_v26_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.26';

  IF v_v26_prompt IS NULL THEN
    RAISE EXCEPTION 'M-208: v1.26 production config not found — refusing to insert v1.27 without inheriting v1.26 settings.';
  END IF;

  -- ------------------------------------------------------------------
  -- Substitution A — reclassify the tool inventory bullet.
  -- ------------------------------------------------------------------
  v_v27_prompt := replace(
    v_v26_prompt,
    '- `get_subtree_content`, `find_context_references`, `get_subtree_stats` — context and content reads.',
    '- `get_subtree_stats` — STRUCTURAL shape read (per-layer counts + leaves-with-prose count; no content fetched). **Use FIRST for completeness / coverage / "what''s missing" questions** — see "Completeness questions" section below.
- `get_subtree_content`, `find_context_references` — CONTENT reads (return prose payloads and grow context fast). Use AFTER you''ve narrowed scope with stats.'
  );
  IF v_v27_prompt <> v_v26_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  -- ------------------------------------------------------------------
  -- Substitution B — insert "## Completeness questions" section
  -- between the "Plan before you read" section and the "Plan before
  -- you propose" header.
  --
  -- Anchor: the last sentence of "Plan before you read" + the header
  -- of "Plan before you propose". Replace with the same sentence +
  -- the new section + the same header.
  -- ------------------------------------------------------------------
  v_v27_prompt := replace(
    v_v27_prompt,
    'The plan is your thinking trace, not a TODO list.

## Plan before you propose',
    'The plan is your thinking trace, not a TODO list.

## Completeness questions

Two kinds of structural question are different in kind, not degree.

- **"What is there"** is a factual question. The tools return the data; render it.
- **"What is missing"** is an inferential question. The data tells you what exists; it does NOT tell you what should exist. You have to apply per-layer completeness criteria and compare.

**Shape-first discipline.** For coverage / completeness / "what''s missing" questions, call `get_subtree_stats` FIRST. It returns per-node `direct_child_count`, `leaf_descendant_count`, and `leaves_with_prose` — exactly the counts you need to categorise nodes. Drill into `get_subtree_content` only after you''ve narrowed scope to the subtrees that need prose detail. Reaching for the content tool first floods the iteration with prose and obscures the structural gaps.

**Per-layer completeness criteria (apply bottom-up):**

- A **leaf node** is complete iff it has prose (`leaves_with_prose` increments for it; word_count_actual > 0). Empty placeholder text (≤ ~50 chars) is NOT complete.
- A **non-leaf node** is complete iff it has children AND every leaf in its subtree is complete.
- A **non-leaf node with zero children** (`leaf_descendant_count = 0` for the subtree) is INCOMPLETE — the structural breakdown was never made.

**Signal-strength discipline:**

- STRONG missing signal — always flag:
  - A non-leaf node with `leaf_descendant_count = 0` (subtree never expanded).
  - A leaf with `word_count_actual = 0` (no prose) or ≤ ~50 chars (placeholder only).
- WEAK signal — do NOT flag unless the user explicitly asks about variance:
  - A node has fewer children than its siblings (variable scene length is often intentional — a 3-beat scene next to a 7-beat scene is not a gap).

**Enumeration discipline.** When asked "what''s missing," walk EVERY non-leaf at the target depth and check it has children, then walk EVERY leaf and check it has prose. Do NOT summarise at an intermediate layer — "chapter complete" hides empty scenes inside.

## Plan before you propose'
  );
  IF position('## Completeness questions' IN v_v27_prompt) > 0 THEN v_substitutions := v_substitutions + 1; END IF;

  -- ------------------------------------------------------------------
  -- Substitution check.
  -- ------------------------------------------------------------------
  IF v_substitutions <> 2 THEN
    RAISE EXCEPTION 'M-208: prompt substitutions failed — applied % of expected 2 anchors. v1.26 prompt body drifted from expected shape.', v_substitutions;
  END IF;

  -- ------------------------------------------------------------------
  -- INSERT v1.27 production.
  -- ------------------------------------------------------------------
  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.27',
    'Director v1.27 — completeness-question discipline',
    'production',
    v_v27_prompt,
    v_v26_tool_suite,
    v_v26_model_id,
    v_v26_model_params,
    v_v26_capability_flags,
    'Two prompt amendments addressing the inferential gap surfaced by
the 2026-05-23 user test ("check the hierarchy of act 1 and tell me
what is missing" / "complete all parts of act 1 that are missing").
The Director correctly identified 4 of 10 incomplete scenes; missed
6 because it (a) chose the content-heavy get_subtree_content tool
for a structure question and (b) summarised at the chapter level,
treating a chapter as complete when at least one scene had prose.

Amendment A reclassifies the get_subtree_stats bullet in the "Tools
you have" inventory — it was lumped with content tools; it''s now
its own line marked "STRUCTURAL shape read" with a "Use FIRST for
completeness / coverage / what''s missing questions" directive that
matches the tool''s own input_schema description.

Amendment B inserts a new "## Completeness questions" section
between "Plan before you read" and "Plan before you propose". It
teaches: the two-question-types distinction (factual "what is
there" vs inferential "what is missing"); the shape-first
tool-selection rule; per-layer completeness criteria (leaf complete
iff prose; non-leaf complete iff children + all leaves complete;
non-leaf with zero children is always incomplete); the
strong-vs-weak signal asymmetry (zero children = always flag; fewer
children than siblings = usually intentional, do not flag); and the
enumeration discipline (walk every leaf, do not summarise at
chapter level).

Tool count unchanged at 17. Tool registry inherited verbatim from
v1.26 (no schema change). Same family of small-prompt amendment as
v1.23 (canonical-range discipline) — narrow scope, clear behavioural
shift, no schema or executor work.',
    NOW(), NULL, NOW()
  );
END $migration$;
