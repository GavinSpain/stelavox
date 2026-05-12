-- Migration 054 — succeeding-sibling destination horizon + length-
-- discipline refinement on synthesise_beat.
--
-- Source: chapter-1 synthesise A/B testing 2026-05-12. Three runs at
-- preceding_sibling_count = 1, 2, 3 against the same fixture (Shadow
-- Protocol, "The Drift", 6 beats). The data exposed a systemic length-
-- inflation problem: the synthesise agent produced 3.3×-4.4× the stated
-- word_count_target (180-200 per beat → 658-873 average across runs),
-- with the LAST beat (no succeeding constraint) inflating most across
-- all three runs. Diagnosis: the synthesise_beat OUTPUT FORMAT block's
-- "the story decides" clause was being read as a license to override
-- word_count_target, and the preceding-siblings block (Migration 053)
-- was being misread as a length pacing signal.
--
-- The fix is content-driven, not constraint-driven. Adding the
-- succeeding sibling's summary as a destination horizon tells the agent
-- "stop where the next beat begins" — a content boundary, not a number.
-- Combined with prompt revisions that defang the "story decides"
-- escape clause and explicitly disclaim length-mimicry from preceding
-- prose, the length-inflation problem should resolve without imposing
-- a hard cap (which would fight the dramaturge instinct).
--
-- Three coupled changes on synthesise_beat:
--   1. OUTPUT FORMAT length paragraph rewritten — word_count_target is
--      informational, not binding; length anchor is content + handoff.
--   2. Preceding-siblings paragraph gains a "not a length signal" line.
--   3. New "destination horizon" paragraph explaining the succeeding-
--      beat summary block.
--
-- Plus: 6 expand profiles get a succeeding-sibling paragraph in the
-- same architectural pattern (next-layer summary as the closure horizon).
-- succeeding_sibling_count = 1 on all 7 profiles (start point — testable).
--
-- No schema change.

BEGIN;

-- ─── context_rules.succeeding_sibling_count = 1 across all 7 profiles ──

UPDATE agent_profiles
SET context_rules = jsonb_set(
  COALESCE(context_rules, '{}'::jsonb),
  '{succeeding_sibling_count}',
  '1'::jsonb,
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

-- ─── synthesise_beat — three coupled prompt changes ─────────────────

-- 1. Replace the OUTPUT FORMAT length paragraph with content-driven
--    length discipline.
UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'Target the word count suggested in the beat metadata (the `word_count_target` field on the beat node). If no word count is given, produce what the beat genuinely requires — no more, no less. A beat that is one exchange of dialogue might be 60 words. A beat that is a character''s interior reckoning might be 350 words. The story decides.',
  E'Each beat carries a `word_count_target` set when it was created. Treat it as informational, not binding — the expand agent set this number without seeing the prose it would shape. Your real length anchor is the beat''s content and its handoff to the next beat (see "destination horizon" below). Render the beat at the length its content and continuity demand. Do not pad to fill space; do not compress to hit a number. A beat that is one exchange of dialogue might be 60 words. A beat that is a character''s interior reckoning might be 350 words. The content of THIS beat and its handoff to the next beat together decide.'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

-- 2. Append the "not a length signal" sentence to the preceding-
--    siblings paragraph (Migration 053).
UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'If a preceding beat shows only its summary because its prose has not yet been written, treat it as a stage direction — the events of that beat happened, the prose will catch up later.',
  E'If a preceding beat shows only its summary because its prose has not yet been written, treat it as a stage direction — the events of that beat happened, the prose will catch up later. Treat the preceding beats as a continuity and voice signal — not as a length signal. The beats they show may be longer or shorter than yours; your length is decided by your content and your handoff, not by matching theirs.'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

-- 3. Insert the destination-horizon paragraph immediately after the
--    preceding-siblings paragraph (before "THE STYLE GUIDE").
UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'\n\nTHE STYLE GUIDE\n',
  E'\n\nYou may also receive the summary of the immediately succeeding beat — the beat the reader will land in next. This is your **destination horizon**. Your prose must end at the state where the succeeding beat naturally begins. If the next beat opens with "Kael''s hand finds the comms panel," your beat must end in the moment before that action — with the hand still suspended, the decision still suspended. Drive toward the handoff; do not cross it. The succeeding beat is not a quota; it is a horizon.\n\nIf you are the LAST beat of a scene (no succeeding beat is provided), close on the scene''s resolution: the dramatic shift the scene summary names as its outcome. The scene''s end is your destination boundary. The last beat is not licence to ramble; it is the obligation to land.\n\nTHE STYLE GUIDE\n'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

-- ─── expand_scene_into_beats — destination horizon for chapter→scenes
--     handoff. Append after preceding-siblings paragraph; insert before
--     OUTPUT FORMAT.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every choice you make is a reading of what THIS scene requires.\n\nOUTPUT FORMAT\n',
  E'every choice you make is a reading of what THIS scene requires.\n\nYou may also receive the summary of the immediately succeeding scene — the scene the reader will land in next. This is your destination horizon: the LAST beat of THIS scene must end in a state that opens the succeeding scene cleanly. The succeeding scene is not a quota for your beat count; it shapes how this scene closes, not how many beats it contains.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes — destination horizon for act→chapter
--     handoff.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every decision is a reading of what THIS chapter requires.\n\nOUTPUT FORMAT\n',
  E'every decision is a reading of what THIS chapter requires.\n\nYou may also receive the summary of the immediately succeeding chapter — the chapter the reader will land in next. This is your destination horizon: the LAST scene of THIS chapter must close in a way that opens the succeeding chapter''s first scene. The succeeding chapter shapes how the chapter ends, not how many scenes it contains.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_act_into_chapters — destination horizon for book→act.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every chapter decision is a reading of what THIS act requires.\n\nOUTPUT FORMAT\n',
  E'every chapter decision is a reading of what THIS act requires.\n\nYou may also receive the summary of the immediately succeeding act. This is your destination horizon: the FINAL chapter of THIS act must close the act''s arc in a way that propels the reader into the next act. The succeeding act shapes how the act resolves, not how many chapters it contains.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_book_into_acts — destination horizon for series→book.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every act decision is a reading of what THIS book requires.\n\nOUTPUT FORMAT\n',
  E'every act decision is a reading of what THIS book requires.\n\nYou may also receive the summary of the immediately succeeding book (in a series). This is your destination horizon: the FINAL act of THIS book must close the book''s arc in a way that compels the reader into the next book. For a standalone novel, no succeeding book exists — the book must close on its own terms.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_book_into_acts' AND is_system_profile = true;

-- ─── expand_story_into_scenes — destination horizon for collection→story.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every scene decision is a reading of what THIS story requires.\n\nOUTPUT FORMAT\n',
  E'every scene decision is a reading of what THIS story requires.\n\nYou may also receive the summary of the immediately succeeding story (in a collection). This is your destination horizon: the FINAL scene of THIS story must close in a way that the next story can stand against — sometimes that means contrast, sometimes echo, sometimes silence. The succeeding story shapes how this story ends, not how many scenes it contains.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

-- ─── expand_series_into_books — destination horizon (usually no
--     succeeding book exists at planning time).

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'every book-level decision is a reading of what the series requires next, not a copy of what came before.\n\nOUTPUT FORMAT\n',
  E'every book-level decision is a reading of what the series requires next, not a copy of what came before.\n\nYou may also receive the summary of the immediately succeeding book in the series. When present, this is your destination horizon: THIS book''s final act must close in a way that opens the next book''s opening act. When no succeeding book exists yet (the usual case during initial series planning), close on the book''s own stated outcome.\n\nOUTPUT FORMAT\n'
)
WHERE name = 'expand_series_into_books' AND is_system_profile = true;

COMMIT;
