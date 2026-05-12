-- Migration 053 — preceding-sibling continuity context for content-generation
-- specialists (synthesise + 6 expand profiles).
--
-- Source: chapter-1 prose synthesis analysis 2026-05-12. The synthesise
-- agent ran stateless per beat — beat 6's job had no knowledge of beats
-- 1-5's prose, breaking within-scene continuity. The sequential dispatch
-- (concurrency=1) was specifically architected to support beat-N-depends-
-- on-beat-(N-1), but the context-assembler never queried for sibling
-- rows. This migration closes the gap by:
--
--   1. Adding `preceding_sibling_count: 3` to context_rules for the 7
--      affected profiles. The context-assembler reads this and fetches
--      N preceding canonical-layer nodes for the target.
--   2. Appending one new paragraph to each profile's system_prompt
--      explaining the purpose of the new <preceding_siblings> block
--      and the discipline for using it.
--
-- The principle: agents already consume parent ancestors, character
-- profiles, and style guides without being tempted to mimic them
-- mechanically. The same applies to preceding siblings — provided the
-- prompt explains the *role* the block plays. Each paragraph below ends
-- with the same discipline statement: "every X decision is a reading of
-- what THIS Y requires" — mirroring the v1.3 Director prompt's
-- "Trust the specialists" framing.
--
-- Scope: synthesise (beat prose continuity) + 6 expand profiles
-- (act, book, chapter, scene, story, series — every structural layer
-- that produces children). refine and generate_context don't apply —
-- they don't produce content based on the current node + canonical
-- predecessors; they transform a target or generate a new context node
-- from an instruction.
--
-- Tuning: per-profile via context_rules.preceding_sibling_count.
-- Set to 0 to disable for a specific profile without code changes.

BEGIN;

-- ─── context_rules.preceding_sibling_count = 3 across all 7 profiles ──

UPDATE agent_profiles
SET context_rules = jsonb_set(
  COALESCE(context_rules, '{}'::jsonb),
  '{preceding_sibling_count}',
  '3'::jsonb,
  true
)
WHERE is_system_profile = true
  AND operation_type IN ('synthesise', 'expand')
  AND name IN (
    'synthesise_beat',
    'expand_scene_into_beats',
    'expand_chapter_into_scenes',
    'expand_act_into_chapters',
    'expand_book_into_acts',
    'expand_story_into_scenes',
    'expand_series_into_books'
  );

-- ─── synthesise_beat — insert before "THE STYLE GUIDE" ──────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nTHE STYLE GUIDE\n',
  E'\n\nYou will often also receive the prose of the immediately preceding beats — the beats the reader has just read. This is not background; it is the live state of the page the reader is leaving as they enter your beat. Use it for continuity that no summary can specify: the rhythm of the prose so far, the voice as it has been established, the physical and emotional position the POV character is in at the end of the last beat. Your opening sentence is a continuation, not a restart. The reader''s eye left the page mid-flow; meet them there. If a preceding beat shows only its summary because its prose has not yet been written, treat it as a stage direction — the events of that beat happened, the prose will catch up later.\n\nTHE STYLE GUIDE\n'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

-- ─── expand_scene_into_beats — insert before "OUTPUT FORMAT" ────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding scenes — the scenes the reader has just lived through before arriving at this one. These tell you the rhythm of the work as it has unfolded so far: the way scenes have been arriving and resolving, the density of dramatic moments, the granularity at which beats have been emerging. Read the preceding scenes to understand the reading-experience you are extending. Then decide what THIS scene''s beats need to be. The preceding scenes are the reader''s accumulated expectation; honour it when the scene warrants, break it when the scene demands. What you must not do is hit a beat count that matches them, or vary arbitrarily — every choice you make is a reading of what THIS scene requires.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes — insert before "OUTPUT FORMAT" ─────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding chapters — the chapters the reader has just travelled through before arriving here. These tell you the established pacing and shape of the work: typical chapter lengths, the rate at which the story is opening up, how scene structures have been working. Read them to feel the rhythm you are joining. Then decide what THIS chapter''s scenes need to be. The preceding chapters are the reader''s accumulated expectation; honour it deliberately, break it deliberately. Mechanical imitation is as wrong as arbitrary variation — every decision is a reading of what THIS chapter requires.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_act_into_chapters — insert before "OUTPUT FORMAT" ───────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding acts. These tell you the macro-structural arc of the work to this point: the way the prior acts have been built, their chapter counts, their thematic centres. Read them to understand the movement of the whole. Then decide what THIS act''s chapters need to be. The preceding acts are the structural rhythm you are extending — match it when the act earns it, break it when the act calls for a different shape. Mechanical or arbitrary choices read on the page as authorial drift; every chapter decision is a reading of what THIS act requires.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_book_into_acts — insert before "OUTPUT FORMAT" ──────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding books (in a series). These tell you the architectural pattern the series has established: act counts, prologue conventions, the macro-shape of each prior book. Read them to understand the series-level structure you are extending. Then decide what THIS book''s acts need to be. Series consistency matters, and series variety matters; balance both deliberately. For a standalone novel, no preceding books exist — rely on the book summary and the genre conventions implied. Either way, every act decision is a reading of what THIS book requires.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_book_into_acts' AND is_system_profile = true;

-- ─── expand_story_into_scenes — insert before "OUTPUT FORMAT" ───────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding stories (in a collection). These tell you the rhythm and length the author has been working at in short form: scene counts, story arcs, the kinds of resolutions the collection has been producing. Read them to feel the rhythm you are joining. Then decide what THIS story''s scenes need to be. Short fiction is unforgiving — preceding stories inform your choices but never dictate them. Each story has its own shape; every scene decision is a reading of what THIS story requires.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

-- ─── expand_series_into_books — insert before "OUTPUT FORMAT" ───────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nOUTPUT FORMAT\n',
  E'\n\nYou may also receive summaries of the immediately preceding books in the series. These tell you what the series has built so far: the architectural pattern of prior books, the kinds of stories each has told, the macro-rhythm the series has established. Read them to understand the work you are extending. Then decide what THIS book needs to be structurally and thematically. Series consistency builds trust; series variety keeps the work alive. Balance both deliberately — every book-level decision is a reading of what the series requires next, not a copy of what came before.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_series_into_books' AND is_system_profile = true;

COMMIT;
