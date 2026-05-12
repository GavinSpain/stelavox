-- Migration 062 — PLAN BEFORE YOU EXPAND: chain-of-thought planning
-- preamble inserted at the top of each of the 6 expand profiles.
--
-- Source: Phase 2 of top-down rebuild 2026-05-12. The expand_act_into_chapters
-- agent received Act 1's 28k budget cleanly but allocated 46k across 11
-- chapters — a 64% budget overshoot AND atomization (11 vs typical 5-7
-- for setup acts). Root cause: the model jumped straight from "here is
-- the target" to "emit the JSON array" with no structural planning step.
-- It thought locally (each crew member is a chapter, each Europa visit
-- is a chapter) and never sanity-checked the gestalt.
--
-- This migration inserts a PLAN BEFORE YOU EXPAND section right after
-- each profile's intro paragraphs and before WHAT A GREAT X DOES.
-- Modelled on chain-of-thought prompting practice: ask the model to
-- think structurally before writing, including arithmetic verification,
-- so failures get caught DURING reasoning rather than at validation.
--
-- The planning text becomes scratchpad output preceding the JSON array;
-- the existing JSON extractor (lib/agent/operations/expand.ts) takes
-- only the array, so the scratchpad is discarded by the runtime.
--
-- Coexists with Mig 058/060: SCOPE AND OVERLAP and WORD COUNT BUDGET
-- remain as tactical disciplines. Planning is the strategy layer that
-- gives the model a chance to apply them before generation.
--
-- Tier-specific dimensional guidance baked into each profile's step 3.

BEGIN;

-- ─── expand_book_into_acts ──────────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nWHAT A GREAT ACT DOES',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any act summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target book. This is your total prose budget for the finished novel. If no target is set, you have author discretion.\n\n2. **Name the book''s role and shape.** What genre and scale is this — literary, commercial, epic? What is its central question? Does the synopsis suggest a conventional three-act shape or something less standard?\n\n3. **Dimension realistically.** Adult novels typically have 3 acts. Four or five acts is rare and appropriate only when the work''s structure genuinely calls for it (epic / multi-thread / Shakespearean tragedy). Pick the act count BEFORE deciding act sizes. For a 3-act structure, Act 2 typically claims 40-50% of the budget; Acts 1 and 3 share the remainder with Act 3 slightly larger than Act 1 in conventional shape.\n\n4. **Sketch each act in one sentence** — the dramatic phase each represents, not the content yet.\n\n5. **Sanity-check arithmetic.** Sum your intended per-act sizes against the book budget. If they don''t match within ±5%, revise — adjust the proportional weights, not the act count (act count should be driven by structure, not arithmetic). The sum is your contract with the author.\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each act''s `word_count_target` must match the size you sketched in step 5.\n\nWHAT A GREAT ACT DOES'
)
WHERE name = 'expand_book_into_acts' AND is_system_profile = true;

-- ─── expand_act_into_chapters ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nWHAT CHAPTERS MUST DO WITHIN AN ACT',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any chapter summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target act. This is your total prose budget for the chapters you will produce.\n\n2. **Name the act''s role.** Is this act setup, complication, or resolution? What are its opening and closing turning points? Where does it fit in the book''s overall shape?\n\n3. **Dimension realistically.** Adult fiction chapters typically run 3,000-6,000 words. For an act of N words: budget ÷ 5,000 gives a typical chapter count; ±2 for variance. A 28,000-word setup act fits 5-7 chapters comfortably. A 50,000-word complication act fits 9-13. The ENTIRE act should be 4-12 chapters in most cases — more than 12 means you are atomizing (one event per chapter) rather than recognising coherent multi-event movements. Pick the count BEFORE naming chapters.\n\n4. **Sketch each chapter in one sentence** — the dramatic role each fills (a turning point, a complication, a breather, a setup for the next reveal), not the content yet.\n\n5. **Sanity-check arithmetic.** Sum your intended per-chapter sizes against the act budget. If they don''t match within ±5%, revise. If you find yourself needing to add more chapters to fit the budget, recognise that you may be over-thinning — chapters can contain multiple events of one coherent movement.\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each chapter''s `word_count_target` must match the size you sketched in step 5.\n\nWHAT CHAPTERS MUST DO WITHIN AN ACT'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes ─────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nWHAT A GREAT SCENE DOES',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any scene summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target chapter. This is your total prose budget for the scenes you will produce.\n\n2. **Name the chapter''s role.** What chapter-level question does it open with? What turning point or release does it deliver? Where does it sit in its act?\n\n3. **Dimension realistically.** Scenes typically run 500-1,500 words. A 4,000-word chapter holds 3-5 scenes; a 6,000-word chapter holds 4-7. Pick the count BEFORE naming scenes. Recognise scene boundaries by location-change, meaningful time-passage, or central-conflict pivot — not by mood shifts within one envelope.\n\n4. **Sketch each scene in one sentence** — its dramatic envelope (location + time + central conflict), not the content yet.\n\n5. **Sanity-check arithmetic.** Sum your intended per-scene sizes against the chapter budget. If they don''t match within ±5%, revise — adjust scene weights, not the count (count is driven by scene-boundary logic).\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each scene''s `word_count_target` must match the size you sketched in step 5.\n\nWHAT A GREAT SCENE DOES'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_scene_into_beats ────────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nTHE ANATOMY OF A BEAT',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any beat summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target scene. This is your total prose budget for the beats you will produce.\n\n2. **Name the scene''s shape.** What is the scene''s opening state? What is its closing state (its turning point or release)? Map the arc from one to the other.\n\n3. **Dimension realistically.** Beats typically run 100-400 words depending on density. A 1,000-word scene holds 4-7 beats; a 1,500-word scene holds 5-9. Tight confrontational scenes may have 3-5 short beats. Layered interior scenes may have 7-10. Pick the count BEFORE writing summaries.\n\n4. **Sketch each beat in one sentence** — the single change it produces (a power-shift, a recognition, a decision, a reveal), not its content yet.\n\n5. **Sanity-check arithmetic.** Sum your intended per-beat sizes against the scene budget. If they don''t match within ±5%, revise — typically you have one or two too many beats (atomisation), or one beat is sized for content that should be split.\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each beat''s `word_count_target` must match the size you sketched in step 5.\n\nTHE ANATOMY OF A BEAT'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- ─── expand_story_into_scenes ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nWHAT A SHORT-STORY SCENE DOES',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any scene summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target story. This is your total prose budget for the scenes you will produce.\n\n2. **Name the story''s shape.** What is its central question and resolution? Is the structure linear, framed, or fragmented?\n\n3. **Dimension realistically.** Short fiction has variable scene density. A 5,000-word story typically holds 3-5 scenes; a 10,000-word story holds 5-8. Short fiction is unforgiving of overlap or padding — fewer, sharper scenes usually outperform more, shorter ones.\n\n4. **Sketch each scene in one sentence** — its dramatic envelope, not the content.\n\n5. **Sanity-check arithmetic.** Sum your intended per-scene sizes against the story budget. If they don''t match within ±5%, revise.\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each scene''s `word_count_target` must match the size you sketched in step 5.\n\nWHAT A SHORT-STORY SCENE DOES'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

-- ─── expand_series_into_books ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nWHAT A GREAT SERIES BOOK DOES',
  E'\n\nPLAN BEFORE YOU EXPAND\n\nBefore you generate any book summaries, work through a brief planning pass in your output. Treat this as your scratchpad — the parser ignores everything before the JSON array.\n\n1. **Read the budget.** Look at `<word_count_target>` on the target series. This is your total prose budget across all books in the series.\n\n2. **Name the series'' shape.** Is this a trilogy, quartet, or longer arc? Where is the series'' midpoint? How does each book contribute to the larger arc?\n\n3. **Dimension realistically.** Series typically have 3-5 books (trilogy is the most common). For a series of N total words: divide by typical novel length (80,000-150,000) to get the book count. A trilogy of 300,000 total fits 3 books of ~100,000 each. Series consistency in book length is common but not required.\n\n4. **Sketch each book in one sentence** — its dramatic phase in the series arc.\n\n5. **Sanity-check arithmetic.** Sum your intended per-book sizes against the series budget. If they don''t match within ±5%, revise.\n\n6. **Now write the full JSON array** following OUTPUT FORMAT below. Each book''s `word_count_target` must match the size you sketched in step 5.\n\nWHAT A GREAT SERIES BOOK DOES'
)
WHERE name = 'expand_series_into_books' AND is_system_profile = true;

COMMIT;
