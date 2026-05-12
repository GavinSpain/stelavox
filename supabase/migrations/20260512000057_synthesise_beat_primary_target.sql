-- Migration 057 — synthesise_beat: PRIMARY TARGET vs SUPPORTING CONTEXT.
--
-- Source: Lever 1 (Migration 056) editorial assessment 2026-05-12.
-- Migration 056 successfully addressed within-beat bloat reflexes
-- (three-variants, explain-the-image, not-taken-options) on interior
-- and decision beats (1, 3, 7). But sensory beats (4, 5, 6) actually
-- got LONGER. Reading beat 6's prose revealed the real problem: the
-- synthesise agent is not respecting beat SCOPE.
--
-- Beat 6's summary describes one moment ("enter chamber, observe
-- architecture"). Beat 7's summary describes the next moment ("approach
-- device, threshold of touch"). The expand agent split these correctly.
-- But the synthesise agent for beat 6 rendered: the touch + the data
-- flood + the disconnect + the return to the ship + the "I need a crew"
-- decision. Four-to-five future beats' worth of content compressed into
-- one beat.
--
-- The agent is reading the ancestor summaries (which describe the full
-- scene/chapter/book arc, including all events of which any given beat
-- is just one moment) and treating that arc as content to render in
-- each beat. The ancestor gravity overrides the beat summary's stated
-- scope.
--
-- The fix is a hierarchy declaration at the top of the prompt:
-- PRIMARY TARGET = the beat summary; SUPPORTING CONTEXT = everything
-- else (ancestors, context nodes, preceding-prose, succeeding-summary,
-- style guide). Each supporting block has a specific role (world,
-- voice, continuity, boundary, manner) — and none of them authorise
-- rendering content beyond the beat summary's scope.
--
-- Plus a reinforcement inside the existing CONTEXT section that
-- repeats the principle when the agent reaches the supporting-context
-- material.
--
-- No schema change. Builds on Migration 056. Does not undo any prior
-- prompt language; pure addition.

BEGIN;

-- 1. Insert PRIMARY TARGET vs SUPPORTING CONTEXT section right after
--    the task statement, before the existing craft sections.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'Your task is to write the final prose for a single narrative beat. This prose will appear in the finished novel. Write accordingly.\n\nTHE CRAFT OF GREAT PROSE AT THE BEAT LEVEL',
  E'Your task is to write the final prose for a single narrative beat. This prose will appear in the finished novel. Write accordingly.\n\nPRIMARY TARGET vs SUPPORTING CONTEXT\n\nYou will receive multiple blocks of input. They are not equal. Treat them with strict hierarchy.\n\n1. **The BEAT SUMMARY (inside `<current_node>`) is your PRIMARY target.** This is the ONE thing you are rendering. It names what happens in this beat — a single change, a single moment — and your prose must render that and only that.\n\n2. **Everything else is SUPPORTING CONTEXT — never primary content.** Each block plays a specific supporting role:\n— Ancestor summaries (book, act, chapter, scene) establish the WORLD the beat inhabits and the LARGER ARC it belongs to. They describe the arc; they do not instruct you to render it.\n— Context nodes (characters, locations, themes, plot threads) establish who these people are and what they want, fear, refuse. Voice and decision consistency come from here.\n— Preceding-beat prose establishes the VOICE, RHYTHM, and IMMEDIATE STATE the reader is leaving as they enter your beat. Continuity comes from here.\n— Succeeding-beat summary establishes the BOUNDARY where your beat must end. The horizon comes from here.\n— Style guide establishes the author''s craft conventions. Manner comes from here.\n\nNone of this supporting context authorises you to write events beyond your beat summary''s scope. None of it is content for you to render.\n\nA specific failure mode to resist: ancestor summaries describe the FULL dramatic arc of the scene, chapter, and book. Your beat summary describes ONE moment inside that arc. If the scene summary names ten events but your beat summary describes only event three, you render only event three. Events one, two, four, five, and ten happen in OTHER BEATS. Render only what your beat summary describes. Trust the structural decomposition that produced your beat — if it gave you one moment, the other moments are not yours to write.\n\nA test before you write: read your beat summary. Name the action it describes. If any sentence of your prose renders an event that is NOT in the beat summary, that sentence belongs in a different beat. Cut it.\n\nTHE CRAFT OF GREAT PROSE AT THE BEAT LEVEL'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

-- 2. Reinforce inside the CONTEXT section.

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'You have been given the full context of this beat: the scene summary, the chapter summary, the act summary, the book synopsis, and all relevant character and location context nodes. This context is not decoration — it is the oxygen the prose breathes. The characters'' histories, wounds, and desires should be present in every line, not as exposition but as the invisible force shaping every word they choose.',
  E'You have been given the full context of this beat: the scene summary, the chapter summary, the act summary, the book synopsis, and all relevant character and location context nodes. This context is not decoration — it is the oxygen the prose breathes. The characters'' histories, wounds, and desires should be present in every line, not as exposition but as the invisible force shaping every word they choose.\n\nRemember the hierarchy from PRIMARY TARGET vs SUPPORTING CONTEXT above: this material is here to GROUND your prose, not to direct its content. The scene/chapter/book summaries name a complete arc; your beat summary names ONE moment of that arc. Render only your moment. The rest of the arc belongs to other beats — they will be rendered by other synthesise calls, each with their own beat summary as primary target.'
)
WHERE name = 'synthesise_beat' AND is_system_profile = true;

COMMIT;
