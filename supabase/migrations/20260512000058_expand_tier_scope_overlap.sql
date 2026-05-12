-- Migration 058 — mirror the Mig 055 one-change-per-unit and no-adjacent-
-- overlap disciplines upward through the structural expand profiles.
--
-- Source: Lever C editorial assessment 2026-05-12. Migration 055 tightened
-- expand_scene_into_beats specifically; the other expand profiles still
-- carry the original looser scope language. Hypothesis: tighter content
-- discipline at the upper tiers (acts, chapters, scenes) will produce
-- tighter content all the way down, reducing the ancestor gravity that
-- pulls synthesise prose past its beat's scope.
--
-- Pattern applied to each of the 5 affected profiles (expand_book_into_acts,
-- expand_act_into_chapters, expand_chapter_into_scenes, expand_story_into_scenes,
-- expand_series_into_books): insert a new "SCOPE AND OVERLAP" section right
-- before OUTPUT FORMAT (after the Mig 054 destination-horizon paragraph).
--
-- The new section establishes for each tier:
--   1. Each unit is ONE cohesive thing at this tier (one act-movement, one
--      chapter-arc, one scene-conflict).
--   2. Adjacent units share no content — Unit N ends at the change-state;
--      Unit N+1 starts AFTER that state, not re-rendering it.
--   3. Where applicable, the "single function value" rule (no compound
--      thematic_function on acts).
--
-- This is the structural-tier analog of Migration 055's beat discipline.
-- The wording mirrors that migration's "if you find yourself trying to fit
-- approach + arrival + contact + revelation into one beat, those are four
-- beats" failure-mode example — applied at the new tier's scale.
--
-- No schema change. Builds on Mig 053/054 (bilateral context already
-- present in all 5 profiles) and is independent of Mig 056/057 (which
-- only affect synthesise_beat).

BEGIN;

-- ─── expand_book_into_acts ──────────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'For a standalone novel, no succeeding book exists — the book must close on its own terms.\n\nOUTPUT FORMAT',
  E'For a standalone novel, no succeeding book exists — the book must close on its own terms.\n\nSCOPE AND OVERLAP\n\nEach act is ONE phase of the story. Not a phase plus prologue. Not a phase plus transition to the next. A single emotional and narrative state, bounded by its opening turning point and its closing turning point — and nothing else.\n\nAdjacent acts do not share content. Act 2 cannot open in the emotional state Act 1 closed in — that state IS Act 1''s closing turning point. Act 2 opens in the state AFTER, the state Act 1''s turning point produced. If you find an act''s opening and the previous act''s closing describing the same character state, the same set of conditions, or the same dramatic moment from a different angle, you are double-rendering a turning point. Each turning point belongs to one act only.\n\nThe `thematic_function` field in metadata must be a SINGLE function — "setup", "complication", "crisis", "resolution", "denouement", etc. Never a compound like "setup / complication". An act that genuinely needs two functions is two acts; split.\n\nIf an act summary describes multiple distinct narrative movements — say, a setup AND a midpoint reversal AND a low point — you have recognised at least two acts. Split. The reader needs each as its own structural phase; collapsing them produces upper-tier bloat that cascades through chapters, scenes, and beats below.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_book_into_acts' AND is_system_profile = true;

-- ─── expand_act_into_chapters ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every chapter decision is a reading of what THIS act requires.\n\nOUTPUT FORMAT',
  E'every chapter decision is a reading of what THIS act requires.\n\nSCOPE AND OVERLAP\n\nEach chapter is ONE coherent movement within the act''s arc. A chapter has a question it opens with and a question it closes with (or the same question turned). Multiple discrete movements compressed into one chapter is two chapters. Recognise the split.\n\nAdjacent chapters do not share content. The transition from chapter N to chapter N+1 is a beat the reader feels — a closing image and an opening image that do not redundantly describe the same moment from different angles. If chapter N closes with "Kael''s silhouette in the airlock door," chapter N+1 cannot open with "Kael standing in the airlock doorway." Same image, twice, signals one chapter mistakenly spread across two summaries.\n\nIf a chapter summary describes multiple distinct narrative movements — a meeting AND a fight AND a discovery — you have at least three chapters packed into one. Split. The reader needs each as its own coherent movement; collapsing them produces upper-tier bloat that cascades into scene-level and beat-level over-rendering below.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes ─────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every decision is a reading of what THIS chapter requires.\n\nOUTPUT FORMAT',
  E'every decision is a reading of what THIS chapter requires.\n\nSCOPE AND OVERLAP\n\nEach scene is ONE unit of dramatic action — one envelope of location, time, and central conflict. When the location changes, when meaningful time passes off-page, or when the central conflict pivots, you are at a scene boundary. Inside a scene, those three (location, time, central conflict) hold steady; one of them shifting marks the end of the scene.\n\nAdjacent scenes do not share content. The end of scene N is the change-state the scene produced; the start of scene N+1 is what happens AFTER that change-state — not a re-rendering of the change itself from a different angle. If scene N closes with "Kael''s hand on the device, the runes flaring," scene N+1 cannot open with "the device''s runes burned blue in Kael''s palm" — that''s the same image twice.\n\nIf a scene summary contains multiple distinct dramatic units — an arrival AND a confrontation AND a departure — recognise that you have multiple scenes. Split. The reader needs each scene as its own dramatic envelope; collapsing them forces the scene-expand and beat-synthesise agents below to spread one unit''s worth of attention across multiple compressed dramatic moments, producing the over-rendering pattern we have been fighting.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_story_into_scenes ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every scene decision is a reading of what THIS story requires.\n\nOUTPUT FORMAT',
  E'every scene decision is a reading of what THIS story requires.\n\nSCOPE AND OVERLAP\n\nEach scene is ONE unit of dramatic action — one envelope of location, time, and central conflict. Short fiction is unforgiving: there is no room for overlap or padding. The transition from scene N to scene N+1 must produce a change worth the page-turn.\n\nAdjacent scenes do not share content. The end of scene N is the change-state; scene N+1 begins AFTER that state. If two scene summaries describe the same moment from different angles, you have one scene mistakenly spread across two.\n\nIf a scene summary contains multiple distinct dramatic units, split. Short stories live or die on the precision of their scene boundaries; compressing two scenes into one is the most common reason short fiction feels unfocused.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

-- ─── expand_series_into_books ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'When no succeeding book exists yet (the usual case during initial series planning), close on the book''s own stated outcome.\n\nOUTPUT FORMAT',
  E'When no succeeding book exists yet (the usual case during initial series planning), close on the book''s own stated outcome.\n\nSCOPE AND OVERLAP\n\nEach book is ONE complete narrative arc within the series — a beginning, middle, and end that stand on their own while contributing to the larger series arc. A book that is "half a story" is either two books that need splitting or one book that needs consolidation.\n\nAdjacent books do not share content. Book N closes on its turning point; Book N+1 opens AFTER. If two book summaries describe the same climactic moment or the same character state at their boundary, the series structure is fragmenting; consolidate.\n\nIf a book summary describes multiple distinct major arcs — an origin AND a quest AND a confrontation that could each stand alone — you may have two or three books packed into one. Split deliberately; series readers can handle multiple books, but they cannot handle a single book trying to be three.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_series_into_books' AND is_system_profile = true;

COMMIT;
