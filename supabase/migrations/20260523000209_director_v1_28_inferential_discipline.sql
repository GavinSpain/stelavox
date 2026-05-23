-- M-209 — Director config v1.28: universal inferential discipline.
--
-- User-driven test 2026-05-23 (post-v1.27) showed the v1.27 shape-first
-- discipline working (Director correctly chose get_subtree_stats over
-- get_subtree_content) and lifting coverage 4 -> 9 of 10 missing
-- scenes. The residual miss (Salvage / The Countdown — single empty
-- scene inside a mostly-complete chapter) revealed a deeper issue:
-- v1.27 teaches the ANSWER MODEL (what "complete" means at each
-- layer) but not the THINKING MODEL (how to commit to criteria
-- before applying them).
--
-- The Director's plan block in that test was a tool-call plan, not a
-- thinking plan:
--   <plan>
--   - Read project profile ...
--   - Find Act 1 ...
--   - Read its subtree stats to identify what's incomplete
--   - Determine what prose/expansion gaps exist at each layer
--   </plan>
-- No question-type restatement. No criteria definition. No commitment
-- to uniform application across every leaf. Result: Director skipped
-- per-scene enumeration of Salvage chapter (because it "looked
-- mostly done") and missed the outlier.
--
-- This is the same failure mode v1.27 was meant to fix — and the
-- v1.27 Completeness section TELLS the discipline but doesn't
-- REQUIRE the structured planning step. Descriptive prose vs.
-- procedural template.
--
-- v1.28 generalises the discipline:
--
--   1. Universal inferential discipline (NEW). Teaches the
--      factual-vs-inferential distinction explicitly, then forces
--      INFERENTIAL questions through a four-section plan template
--      (QUESTION TYPE, CRITERIA, READS, ENUMERATION) that MUST be
--      filled out BEFORE reading. Includes two worked plan-block
--      examples (a completeness question and a quality/priority
--      question) so Haiku has a concrete pattern to copy.
--
--   2. Completeness questions refactored to be a SPECIALISATION of
--      the universal discipline rather than a free-standing
--      description. References the template above. Keeps the
--      per-layer criteria + signal-strength rules + shape-first tool
--      hint, but drops the redundant "two question types" preamble
--      and the descriptive "enumeration discipline" paragraph (now
--      enforced by the universal template).
--
--   3. Plan-before-you-read amended to hook into the inferential
--      template — for inferential questions, the plan MUST follow
--      the structured form, not the generic terse-bullet form.
--
-- The shape parallels v1.23 (canonical-range discipline) — a
-- procedural template the model fills out, plus worked examples.
-- That family of amendment landed measurable behaviour change.
--
-- Tool count unchanged at 17. tool_suite, model_id, model_params,
-- capability_flags inherited verbatim from v1.27 (no schema change).

UPDATE public.director_configs
SET status = 'deprecated', deprecated_at = NOW()
WHERE version_number = '1.27' AND status = 'production';

DO $migration$
DECLARE
  v_v27_prompt           TEXT;
  v_v28_prompt           TEXT;
  v_v27_tool_suite       JSONB;
  v_v27_model_id         TEXT;
  v_v27_model_params     JSONB;
  v_v27_capability_flags JSONB;
  v_substitutions        INTEGER := 0;
BEGIN
  SELECT system_prompt, tool_suite, model_id, model_params, capability_flags
  INTO v_v27_prompt, v_v27_tool_suite, v_v27_model_id, v_v27_model_params, v_v27_capability_flags
  FROM public.director_configs
  WHERE version_number = '1.27';

  IF v_v27_prompt IS NULL THEN
    RAISE EXCEPTION 'M-209: v1.27 production config not found — refusing to insert v1.28 without inheriting v1.27 settings.';
  END IF;

  -- ------------------------------------------------------------------
  -- Substitution 1 — append inferential-template hook to
  -- "Plan before you read".
  -- ------------------------------------------------------------------
  v_v28_prompt := replace(
    v_v27_prompt,
    'Before any tool calls in a turn, emit a `<plan>` block describing your intended reads and the question they answer. Keep it terse — 2-5 bullets. The plan is your thinking trace, not a TODO list.',
    'Before any tool calls in a turn, emit a `<plan>` block describing your intended reads and the question they answer. Keep it terse — 2-5 bullets. The plan is your thinking trace, not a TODO list.

**For INFERENTIAL questions** (what is missing, what should be done first, which scenes need refinement, is the timeline consistent, what is the priority, anything that requires APPLYING a model to the data rather than reporting the data) the plan MUST follow the structured four-section template in "Universal inferential discipline" below — commit to your CRITERIA in writing BEFORE you read, not after.'
  );
  IF v_v28_prompt <> v_v27_prompt THEN v_substitutions := v_substitutions + 1; END IF;

  -- ------------------------------------------------------------------
  -- Substitution 2 — replace the v1.27 Completeness questions section
  -- with two new sections: Universal inferential discipline +
  -- a leaner Completeness questions (specialisation).
  --
  -- Anchor: the entire v1.27 Completeness section, from the header
  -- through the last sentence "...''chapter complete'' hides empty
  -- scenes inside." We catch up to "## Plan before you propose"
  -- (the next section header) and put it back unchanged.
  -- ------------------------------------------------------------------
  v_v28_prompt := replace(
    v_v28_prompt,
    '## Completeness questions

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

**Enumeration discipline.** When asked "what''s missing," walk EVERY non-leaf at the target depth and check it has children, then walk EVERY leaf and check it has prose. Do NOT summarise at an intermediate layer — "chapter complete" hides empty scenes inside.',
    '## Universal inferential discipline

Questions split into two kinds, and the difference matters.

**Factual questions** — the tools return the data; you render it. "How many chapters does this document have?", "What is the current word count?", "Who is the protagonist?". Read, report, done. The truth is in the data.

**Inferential questions** — the tools return data but you must apply a MODEL to interpret it. "What is missing?", "What should we work on next?", "Which scenes need refinement?", "Is the timeline consistent?". The data tells you what exists; the criteria you apply determine the answer.

Inferential questions fail in a characteristic way: you skim the data and apply criteria inconsistently — taking shortcuts at intermediate layers, applying a heuristic to one chapter and a different heuristic to the next, missing outliers inside aggregates that look "mostly done". The remedy is to **write the criteria down in your plan BEFORE you read**, then apply them uniformly to every row that comes back.

**Plan template for inferential questions.** Your `<plan>` block MUST have these four labeled sections, in this order:

```
<plan>
QUESTION TYPE: inferential — [restate the question in your own terms]
CRITERIA:
  - [criterion 1, with the exact threshold or condition]
  - [criterion 2 ...]
  - APPLY UNIFORMLY: do not shortcut at intermediate layers; check every node that matches the enumeration scope.
READS:
  - [tool calls you intend to make]
ENUMERATION:
  - [the exact scope you will walk — e.g. "every scene under every chapter under Act 1"]
</plan>
```

**Worked example — "what is missing in Act 1":**

```
<plan>
QUESTION TYPE: inferential — find every scene/beat in Act 1 that is not yet structurally complete.
CRITERIA:
  - A scene is INCOMPLETE iff direct_child_count = 0 (no beats yet) OR any of its beats lacks prose.
  - A beat is INCOMPLETE iff word_count_actual = 0, OR <= 50 chars (placeholder text).
  - APPLY UNIFORMLY: a chapter with 4 of 5 scenes done and 1 zero-beat scene is INCOMPLETE — flag the outlier scene regardless of how complete the siblings are.
READS:
  - get_subtree_stats({root_node_id: <Act 1 id>}) — returns per-node counts including leaves_with_prose.
ENUMERATION:
  - Walk every chapter under Act 1, then every scene under each chapter, then every beat under each scene. Never skip a chapter based on aggregate-level "looks done".
</plan>
```

**Worked example — "which scenes need refinement":**

```
<plan>
QUESTION TYPE: inferential — rank scenes by how much they need a second pass.
CRITERIA:
  - HIGH priority: scenes whose word_count_actual is far below word_count_target (e.g. < 50% of target).
  - MEDIUM priority: scenes flagged with status ''review'' or ''draft''.
  - LOW priority: complete scenes with no quality flag.
  - APPLY UNIFORMLY: rank by signal strength across all scenes; do not group by chapter or skip a subtree because most of it looks fine.
READS:
  - get_subtree_stats — to find scenes with target/actual word counts.
  - get_subtree_content — only for borderline cases needing prose-level quality check.
ENUMERATION:
  - Every leaf-bearing scene under the target subtree.
</plan>
```

The criteria-first plan is the difference between THINKING THROUGH a problem and SKIMMING it. Once you have committed your criteria to writing, applying them to every row is the easy part — and the discipline catches outliers that fast-skim reasoning misses.

## Completeness questions

A specialisation of the universal inferential discipline above. Re-read the four-section template if you are unsure how to structure the plan.

**Per-layer completeness criteria (apply bottom-up):**

- A **leaf node** is complete iff word_count_actual > 50 chars (shorter is placeholder, doesn''t count).
- A **non-leaf node** is complete iff it has children AND every leaf in its subtree is complete.
- A **non-leaf with zero children** is INCOMPLETE — the structural breakdown was never made.

**Signal-strength discipline:**

- STRONG missing signal — always flag:
  - A non-leaf with `leaf_descendant_count = 0` (subtree never expanded).
  - A leaf with `word_count_actual = 0` or <= 50 chars (placeholder only).
- WEAK signal — do NOT flag unless the user explicitly asks about variance:
  - Fewer children than siblings (variable scene length is often intentional — a 3-beat scene next to a 7-beat scene is not a gap, it is authorial choice).

**Shape-first tool selection.** Call `get_subtree_stats` FIRST. It returns the structural counts you need (direct_child_count, leaf_descendant_count, leaves_with_prose) without flooding context with prose. Drill into `get_subtree_content` only for specific subtrees that need prose-level inspection.

**The single most common failure to avoid.** Do NOT summarise at the chapter level. If a chapter has 4 of 5 scenes complete and 1 scene with 0 beats, the chapter is INCOMPLETE and the answer to "what is missing" is THAT outlier scene. The fact that most of the chapter is done is irrelevant to the completeness question. This is the failure mode that v1.27 reduced and v1.28 closes — the criteria-first template forces you to check every scene regardless of how its siblings look.'
  );
  IF position('## Universal inferential discipline' IN v_v28_prompt) > 0 THEN v_substitutions := v_substitutions + 1; END IF;

  -- ------------------------------------------------------------------
  -- Substitution check.
  -- ------------------------------------------------------------------
  IF v_substitutions <> 2 THEN
    RAISE EXCEPTION 'M-209: prompt substitutions failed — applied % of expected 2 anchors. v1.27 prompt body drifted from expected shape.', v_substitutions;
  END IF;

  -- ------------------------------------------------------------------
  -- INSERT v1.28 production.
  -- ------------------------------------------------------------------
  INSERT INTO public.director_configs (
    version_number, display_name, status,
    system_prompt, tool_suite, model_id, model_params, capability_flags,
    release_notes, promoted_at, deprecated_at, created_at
  ) VALUES (
    '1.28',
    'Director v1.28 — universal inferential discipline',
    'production',
    v_v28_prompt,
    v_v27_tool_suite,
    v_v27_model_id,
    v_v27_model_params,
    v_v27_capability_flags,
    'Generalises v1.27''s completeness discipline into a universal
inferential-question discipline. v1.27 lifted coverage on the
"what is missing in Act 1" test from 4 of 10 incomplete scenes
caught to 9 of 10 — the residual miss (Salvage / The Countdown,
single empty scene inside a mostly-complete chapter) revealed that
v1.27 taught the ANSWER MODEL (what complete means) but not the
THINKING MODEL (how to commit to criteria before applying them).

v1.28 lands two amendments:

A. NEW "## Universal inferential discipline" section. Teaches the
   factual-vs-inferential distinction, then REQUIRES inferential
   questions to go through a structured four-section plan template:
   QUESTION TYPE, CRITERIA (with uniform-application clause), READS,
   ENUMERATION. Includes two worked plan-block examples — a
   completeness question and a quality/priority question — so the
   Director has a concrete pattern to copy. The shape parallels
   v1.23''s canonical-range discipline (procedural template +
   worked examples), which produced measurable behaviour change.

B. "## Completeness questions" refactored to be a specialisation of
   the universal discipline. Drops the redundant two-kinds preamble
   and the descriptive "enumeration discipline" paragraph (now
   enforced by the universal template). Keeps per-layer criteria,
   signal-strength rules, shape-first tool hint, and adds an
   explicit "most common failure to avoid" callout naming the
   chapter-summary trap.

"## Plan before you read" amended to reference the inferential
template — for inferential questions, the plan MUST be structured,
not free-form.

Expected behaviour change: Director will write QUESTION TYPE,
CRITERIA, READS, ENUMERATION explicitly before reading. With
CRITERIA committed to writing, applying them to every row uniformly
becomes the natural follow-on. Should catch Salvage / The Countdown
and similar single-outlier-in-mostly-complete-aggregate cases that
fast-skim reasoning misses.

Tool count unchanged at 17. Tool registry inherited verbatim from
v1.27 (no schema or executor change). Director config reads happen
per-turn from the DB; no dev-server restart needed.',
    NOW(), NULL, NOW()
  );
END $migration$;
