-- Migration 055 — tighten expand_scene_into_beats discipline.
--
-- Source: editorial assessment of chapter-1 synthesis output 2026-05-12.
-- Diagnosis: the synthesise agent's 1,288-word beat 4 ("The Chamber")
-- was not over-rendering; it was faithfully rendering an over-stuffed
-- beat summary containing four discrete dramatic units (enter + approach
-- + contact/ignition + bonding/recognition). Beat 5 then ALSO contained
-- a data-flood paragraph — adjacent-beat content overlap on top of the
-- intra-beat density problem.
--
-- The fix is upstream of synthesise: the expand_scene_into_beats agent
-- must produce beats that each contain ONE change, with no overlap
-- between adjacent beats. The synthesise agent's job becomes tractable
-- because the unit it is given to render is a single dramatic moment,
-- not a compressed mini-scene.
--
-- Three coupled prompt changes:
--   1. THE ANATOMY OF A BEAT — strengthen "one change per beat" with
--      an explicit failure-mode example.
--   2. BEAT SUMMARIES — add a no-overlap bullet, tighten summary length
--      from 60-120w to 50-90w, replace generic "state the action" with
--      "state the SINGLE action".
--   3. OUTPUT FORMAT — update the summary word range; constrain
--      beat_function to a single value (no compound "escalate /
--      turning point" composites).
--
-- word_count_target is intentionally LEFT ALONE per author direction
-- 2026-05-12. The synthesise agent treats it as informational anyway
-- (Migration 054); the expand agent's existing 50-300 typical range
-- continues unchanged. If summary tightening produces proportionally
-- tighter prose, the word_count_target issue may fix itself; if not,
-- a follow-up migration can revisit.
--
-- No schema change. No code change.

BEGIN;

-- 1. THE ANATOMY OF A BEAT — strengthen "one change per beat".

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'A beat is not a moment. A beat is a change. Something shifts — in the power dynamic between characters, in a character''s emotional state, in what is known or unknown, in what is possible or foreclosed. If nothing changes, there is no beat.',
  E'A beat is not a moment. A beat is a SINGLE change. Something shifts — in the power dynamic between characters, in a character''s emotional state, in what is known or unknown, in what is possible or foreclosed. If nothing changes, there is no beat. If MORE than one meaningful change occurs, you have more than one beat — split it.\n\nA common failure mode: trying to compress "approach + arrival + first contact + revelation" into a single beat. Those are four beats. The reader needs each as its own moment to feel the dramatic weight; collapsing them into one forces the prose agent to spread a single beat''s worth of attention across four dramatic units, producing over-rendered prose where every paragraph carries too much. The remedy is upstream: split.'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- 2. BEAT SUMMARIES — strengthen single-action, add no-overlap, tighten length.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'Each beat summary must:\n— State the action clearly and specifically (not "they talk" but "Elena asks about the fire; Marsh deflects with a question about her father")\n— Identify the change produced by this beat\n— Be written from the POV character''s perspective — we experience the beat through their perception, not omnisciently',
  E'Each beat summary must:\n— State the SINGLE action this beat performs (not "they talk" but "Elena asks about the fire; Marsh deflects with a question about her father" — one exchange, one action)\n— Identify the ONE change produced by this beat\n— Be written from the POV character''s perspective — we experience the beat through their perception, not omnisciently\n— NOT overlap with the next beat''s territory. If beat N ends with "Kael''s hand touches the crystal," beat N+1 cannot also describe that touch — pick which beat owns the moment and let the other beat start from its consequence\n— Stay tight: 50-90 words. A summary that runs longer than 90 words is almost always packing two or more beats into one — split.'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- 3a. OUTPUT FORMAT — summary word range 60-120 → 50-90.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'"summary": string (60–120 words: the action, the change, the POV experience)',
  E'"summary": string (50–90 words: the SINGLE action, the ONE change, the POV experience — see BEAT SUMMARIES above)'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

-- 3b. OUTPUT FORMAT — beat_function must be a single value.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'"metadata": object with "beat_function", "characters_present", "emotional_shift" (e.g., "suspicion rises", "trust fractures", "relief, briefly"), "pov_character"',
  E'"metadata": object with "beat_function" (a SINGLE function — one of: "establish", "inciting incident", "escalate", "turning point", "reveal", "release"; do not use compound functions like "escalate / turning point" — choose the dominant function, or recognise that you are looking at two beats and split), "characters_present", "emotional_shift" (e.g., "suspicion rises", "trust fractures", "relief, briefly"), "pov_character"'
)
WHERE name = 'expand_scene_into_beats' AND is_system_profile = true;

COMMIT;
