-- Migration 059 — Mig 058 follow-up: fix anchors for 3 expand profiles.
--
-- Mig 058's REPLACE anchors used the closing line of Mig 053's preceding-
-- siblings paragraph, but Mig 054 added a succeeding-sibling paragraph
-- after that. The anchors no longer matched in three profiles (act,
-- chapter, story). The SCOPE AND OVERLAP section landed on book and
-- series profiles only. This migration applies it to the remaining
-- three using the Mig 054 closing lines as the anchor.

BEGIN;

-- ─── expand_act_into_chapters ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'The succeeding act shapes how the act resolves, not how many chapters it contains.\n\nOUTPUT FORMAT',
  E'The succeeding act shapes how the act resolves, not how many chapters it contains.\n\nSCOPE AND OVERLAP\n\nEach chapter is ONE coherent movement within the act''s arc. A chapter has a question it opens with and a question it closes with (or the same question turned). Multiple discrete movements compressed into one chapter is two chapters. Recognise the split.\n\nAdjacent chapters do not share content. The transition from chapter N to chapter N+1 is a beat the reader feels — a closing image and an opening image that do not redundantly describe the same moment from different angles. If chapter N closes with "Kael''s silhouette in the airlock door," chapter N+1 cannot open with "Kael standing in the airlock doorway." Same image, twice, signals one chapter mistakenly spread across two summaries.\n\nIf a chapter summary describes multiple distinct narrative movements — a meeting AND a fight AND a discovery — you have at least three chapters packed into one. Split. The reader needs each as its own coherent movement; collapsing them produces upper-tier bloat that cascades into scene-level and beat-level over-rendering below.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_act_into_chapters' AND is_system_profile = true;

-- ─── expand_chapter_into_scenes ─────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'The succeeding chapter shapes how the chapter ends, not how many scenes it contains.\n\nOUTPUT FORMAT',
  E'The succeeding chapter shapes how the chapter ends, not how many scenes it contains.\n\nSCOPE AND OVERLAP\n\nEach scene is ONE unit of dramatic action — one envelope of location, time, and central conflict. When the location changes, when meaningful time passes off-page, or when the central conflict pivots, you are at a scene boundary. Inside a scene, those three (location, time, central conflict) hold steady; one of them shifting marks the end of the scene.\n\nAdjacent scenes do not share content. The end of scene N is the change-state the scene produced; the start of scene N+1 is what happens AFTER that change-state — not a re-rendering of the change itself from a different angle. If scene N closes with "Kael''s hand on the device, the runes flaring," scene N+1 cannot open with "the device''s runes burned blue in Kael''s palm" — that''s the same image twice.\n\nIf a scene summary contains multiple distinct dramatic units — an arrival AND a confrontation AND a departure — recognise that you have multiple scenes. Split. The reader needs each scene as its own dramatic envelope; collapsing them forces the scene-expand and beat-synthesise agents below to spread one unit''s worth of attention across multiple compressed dramatic moments, producing the over-rendering pattern we have been fighting.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_chapter_into_scenes' AND is_system_profile = true;

-- ─── expand_story_into_scenes ───────────────────────────────────────

UPDATE agent_profiles
SET system_prompt = REPLACE(
  system_prompt,
  E'The succeeding story shapes how this story ends, not how many scenes it contains.\n\nOUTPUT FORMAT',
  E'The succeeding story shapes how this story ends, not how many scenes it contains.\n\nSCOPE AND OVERLAP\n\nEach scene is ONE unit of dramatic action — one envelope of location, time, and central conflict. Short fiction is unforgiving: there is no room for overlap or padding. The transition from scene N to scene N+1 must produce a change worth the page-turn.\n\nAdjacent scenes do not share content. The end of scene N is the change-state; scene N+1 begins AFTER that state. If two scene summaries describe the same moment from different angles, you have one scene mistakenly spread across two.\n\nIf a scene summary contains multiple distinct dramatic units, split. Short stories live or die on the precision of their scene boundaries; compressing two scenes into one is the most common reason short fiction feels unfocused.\n\nOUTPUT FORMAT'
)
WHERE name = 'expand_story_into_scenes' AND is_system_profile = true;

COMMIT;
