-- Migration 056 — synthesise_beat anti-bloat disciplines.
--
-- Source: editorial assessment of Step-2 prose 2026-05-12. Migration 055
-- (tighter expand prompt) reduced total scene wordage 33% by fixing the
-- beat-structure problem, but the synthesise agent still inflates 4-5×
-- against word_count_target on chamber/sensory/threshold beats. The
-- editorial assessment identified three specific over-rendering reflexes:
--
--   1. THREE-VARIANTS REFLEX — rendering the same observation in three
--      different ways instead of choosing the strongest version.
--      Example from Step-2 beat 7: "He could still turn around. That
--      option was still theoretically available... He would not do any
--      of these things... But that man was already dead. Had been dead
--      since the moment the beacon first called." Three renditions of
--      one realization.
--
--   2. EXPLAIN-WHAT-WAS-SHOWN — after a strong image, adding a paragraph
--      that names what the image meant. Example: "Everything that had
--      happened since was simply the formality of that choice being made
--      manifest." The image already worked; the explanation undoes it.
--
--   3. NOT-TAKEN-OPTIONS — on thresholds and decisions, dwelling on
--      paths not taken instead of rendering the commitment. Example:
--      "He could walk back to the Iron Ghost, seal the airlock, and
--      burn hard for the outer rim. Leave the probe and its coordinates
--      and its countdown to drift alone in the dark... He would not do
--      any of these things." Dilutes the actual moment of choice.
--
-- These are craft-level failures the current prompt's "every word must
-- earn its place" rule does not specifically forbid. Migration 056 adds
-- three bullets to the THE CRAFT OF GREAT PROSE section directly
-- targeting each failure mode.
--
-- No schema change. No expand-agent change. No model change.

BEGIN;

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'— There is no summarising what has already been established. Trust the context. Do not re-explain who these people are or what has already happened.',
  E'— There is no summarising what has already been established. Trust the context. Do not re-explain who these people are or what has already happened.\n— Render each observation ONCE. If you have written a line about a character''s fear, do not write another line about that same fear in different words two paragraphs later. If you have established that the chamber is vast, do not re-establish it. The reader retains what you have shown; re-establishing dilutes. When you find yourself reaching for a second or third rendition of the same realization, choose the strongest version and cut the others.\n— Do not explain what you have just shown. After a strong image, do not add a paragraph that names what the image meant. ("This was the moment when..." / "Everything that had happened since was simply the formality of..." / "He understood now that...") The image worked because the reader felt it. The explanatory paragraph undoes the image. Trust the image.\n— On thresholds and moments of commitment, render the commitment — not the not-taken options. One sentence of hesitation is enough; the protagonist''s body has already chosen. Multiple paragraphs of "he could still walk away" / "but he would not" drag the moment of choice into deliberation, when the moment of choice IS the action. Render the action; the absence of deliberation IS the deliberation.'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

COMMIT;
