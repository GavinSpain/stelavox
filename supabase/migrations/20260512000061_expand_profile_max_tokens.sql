-- Migration 061 — raise max_tokens on expand profiles to 16384.
--
-- Source: Phase 2 (Act 1 → chapters) hit the 4096 output cap mid-JSON
-- array. Diagnosis: the cumulative Mig 053/054/058/060 additions
-- (preceding-siblings paragraph, succeeding-siblings paragraph, SCOPE
-- AND OVERLAP, WORD COUNT BUDGET) instruct each expand operation to
-- produce richer per-child summaries with more metadata. For a 5-7
-- chapter expansion at the new prompt's expressive density, output
-- needed ~6000+ tokens — easily over the 4096 cap.
--
-- 4096 was conservative for the pre-discipline prompts. 16384 (×4)
-- gives generous headroom for the new structured output without
-- expensive over-allocation (Haiku 4.5 supports up to 64k output
-- tokens; we're staying well below that). The runtime safety cap
-- against unlimited output stays implicit in the model's natural
-- truncation behaviour.
--
-- Applied to all 6 expand profiles for consistency, even though
-- expand_scene_into_beats produces fewer/smaller children — raising
-- it doesn't cost anything when the model produces less.

UPDATE agent_profiles
SET max_tokens = 16384
WHERE is_system_profile = true
  AND operation_type = 'expand'
  AND name IN (
    'expand_book_into_acts',
    'expand_act_into_chapters',
    'expand_chapter_into_scenes',
    'expand_scene_into_beats',
    'expand_story_into_scenes',
    'expand_series_into_books'
  );
