-- Migration 087 — V1.x-A.1: realtime publication for Profile + Brief.
-- Source: stelavox_director_architecture_v2_1_0.md §6 + TA v2.3.2 §3.6.
--
-- UI components subscribe to these channels for live updates after
-- Director-proposed changes are approved.

ALTER PUBLICATION supabase_realtime ADD TABLE project_profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE briefs;
ALTER PUBLICATION supabase_realtime ADD TABLE brief_stages;
