-- Migration 060 — WORD COUNT BUDGET cascade across expand profiles.
--
-- Finding 2026-05-12 (during top-down rebuild Phase 1 review):
--   The `nodes.word_count_target` column has existed since Phase 1,
--   and every expand profile produces it on child nodes. BUT — the
--   context-assembler's formatCurrentNode never rendered it. So the
--   synthesise agent never saw a beat's word_count_target, and each
--   expand agent never saw its target node's budget either.
--
-- The "200-word target" we'd been "softening" via Migration 056 was
-- a phantom anchor — the agent never received the field. The
-- expand_book_into_acts agent in Phase 1 picked 80/120/100k act
-- targets summing to 300k because no upstream budget existed to
-- constrain the choice.
--
-- This migration pairs with a code change in lib/llm/context-assembler.ts
-- that adds `<word_count_target>` to the current_node XML when set.
-- With that change, the field IS visible. This migration teaches the
-- six expand profiles to USE it: when the target node carries a
-- word_count_target, treat it as the prose budget for everything
-- below this node, and allocate it across the children produced —
-- the sum of child word_count_target values should equal (or closely
-- approximate) the parent's.
--
-- For books: cascade to acts (~25-30 / 40-50 / 25-30 typical 3-act).
-- For acts: cascade to chapters (weighted by chapter dramatic mass).
-- For chapters: cascade to scenes (weighted by scene dramatic mass).
-- For scenes: cascade to beats (weighted by beat dramatic mass).
-- For stories: cascade to scenes.
-- For series: cascade to books.
--
-- One inserted section per profile, anchored on the unique closing
-- line of the SCOPE AND OVERLAP section (or, for scene→beats which
-- predates SCOPE AND OVERLAP, the closing of OUTPUT FORMAT block).
-- Placement: between SCOPE AND OVERLAP and OUTPUT FORMAT.
--
-- No schema change. Builds on Mig 058/059. Does not alter
-- synthesise_beat — that prompt already mentions word_count_target;
-- now that the field actually appears in current_node, the existing
-- "informational, not binding" framing remains valid until we see
-- how the agent honours the now-visible cascaded budget.

BEGIN;

-- ─── expand_book_into_acts ──────────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'collapsing them produces upper-tier bloat that cascades through chapters, scenes, and beats below.\n\nOUTPUT FORMAT',
  E'collapsing them produces upper-tier bloat that cascades through chapters, scenes, and beats below.\n\nWORD COUNT BUDGET\n\nIf the target book carries a `<word_count_target>` (the author-specified total prose length for the finished novel), that is the BUDGET you must allocate across the acts you create. The sum of each act''s `word_count_target` should equal (or closely approximate) the book''s target.\n\nWeight by dramatic mass. Conventional three-act structure gives Act 2 roughly 40-50% of the total (it carries the longest stretch of escalating complications); Acts 1 and 3 share the remainder, with Act 1 typically slightly smaller than Act 3. Adjust for the specific story''s shape — a setup-heavy book may give Act 1 ~30%; a climactic-arc book may give Act 3 ~35%. Read THIS book''s dramatic curve and allocate accordingly.\n\nIf no `<word_count_target>` is set on the book, use your craft judgement to suggest reasonable per-act lengths (typical adult novel: 80-120k total).\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_book_into_acts' AND is_system_profile = true;

-- ─── expand_act_into_chapters ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'collapsing them produces upper-tier bloat that cascades into scene-level and beat-level over-rendering below.\n\nOUTPUT FORMAT',
  E'collapsing them produces upper-tier bloat that cascades into scene-level and beat-level over-rendering below.\n\nWORD COUNT BUDGET\n\nIf the target act carries a `<word_count_target>` (the act''s prose budget, set by the book-expansion that produced it), that is the BUDGET you must allocate across the chapters you create. The sum of chapter `word_count_target` values should equal (or closely approximate) the act''s target.\n\nWeight by dramatic mass. Chapters carrying turning points, midpoint reversals, or major reveals typically claim more budget than transition or breather chapters. The opening and closing chapters of an act usually carry slightly more weight than middle chapters because they bear the act''s opening and closing turning points respectively.\n\nIf no `<word_count_target>` is set on the act, use your craft judgement.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes ─────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'collapsing them forces the scene-expand and beat-synthesise agents below to spread one unit''s worth of attention across multiple compressed dramatic moments, producing the over-rendering pattern we have been fighting.\n\nOUTPUT FORMAT',
  E'collapsing them forces the scene-expand and beat-synthesise agents below to spread one unit''s worth of attention across multiple compressed dramatic moments, producing the over-rendering pattern we have been fighting.\n\nWORD COUNT BUDGET\n\nIf the target chapter carries a `<word_count_target>` (the chapter''s prose budget, set by the act-expansion that produced it), that is the BUDGET you must allocate across the scenes you create. The sum of scene `word_count_target` values should equal (or closely approximate) the chapter''s target.\n\nWeight by dramatic mass. The climactic scene of a chapter — the scene that delivers the chapter''s turning point or reversal — typically claims more budget than the chapter''s setup, transition, or release scenes. Interiority-heavy scenes (a character processing a reveal) and complex multi-character scenes both claim more than simple expository or transitional scenes.\n\nIf no `<word_count_target>` is set on the chapter, use your craft judgement.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_scene_into_beats ────────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'"word_count_target": integer (suggested prose word count for this beat, typically 50–300 words depending on beat complexity)',
  E'"word_count_target": integer (suggested prose word count for this beat — see WORD COUNT BUDGET below)'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every choice you make is a reading of what THIS scene requires.\n\nYou may also receive the summary of the immediately succeeding scene',
  E'every choice you make is a reading of what THIS scene requires.\n\nWORD COUNT BUDGET\n\nIf the target scene carries a `<word_count_target>` (the scene''s prose budget, set by the chapter-expansion that produced it), that is the BUDGET you must allocate across the beats you create. The sum of beat `word_count_target` values should equal (or closely approximate) the scene''s target.\n\nWeight by dramatic mass. A beat that is the scene''s turning point — the moment of reveal, the moment of commitment, the moment the central conflict pivots — typically claims more budget than an opening or release beat. Pure-dialogue beats often need less than interior-reckoning beats. Use the beat''s position in the scene arc and its dramatic function to allocate.\n\nIf no `<word_count_target>` is set on the scene, use your craft judgement (typical beat: 50-300 words, but scene-dependent).\n\nYou may also receive the summary of the immediately succeeding scene'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- ─── expand_story_into_scenes ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'compressing two scenes into one is the most common reason short fiction feels unfocused.\n\nOUTPUT FORMAT',
  E'compressing two scenes into one is the most common reason short fiction feels unfocused.\n\nWORD COUNT BUDGET\n\nIf the target story carries a `<word_count_target>` (the story''s total prose budget), that is the BUDGET you must allocate across the scenes you create. The sum of scene `word_count_target` values should equal (or closely approximate) the story''s target.\n\nWeight by dramatic mass. Short fiction lives or dies on proportion. The climactic scene typically claims the most budget; the opening scene usually claims about half that. Interiority-heavy and resolution scenes tend to need slightly more room than transitions.\n\nIf no `<word_count_target>` is set, use your craft judgement (typical short story: 3-10k total).\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

-- ─── expand_series_into_books ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'series readers can handle multiple books, but they cannot handle a single book trying to be three.\n\nOUTPUT FORMAT',
  E'series readers can handle multiple books, but they cannot handle a single book trying to be three.\n\nWORD COUNT BUDGET\n\nIf the target series carries a `<word_count_target>` (the series'' total prose budget across all books), that is the BUDGET you must allocate across the books you create. The sum of book `word_count_target` values should equal (or closely approximate) the series'' target.\n\nWeight by dramatic mass. Series structure typically gives the opening and closing books slightly less mass than the middle books (which carry the bulk of plot escalation and complication), though this varies by series shape — a trilogy with a sprawling middle book may give Book 2 ~40% of the total. Use your reading of the series arc.\n\nIf no `<word_count_target>` is set on the series, use your craft judgement (typical adult trilogy: 250-400k total).\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_series_into_books' AND is_system_profile = true;

COMMIT;
