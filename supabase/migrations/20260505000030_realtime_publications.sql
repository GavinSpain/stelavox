-- Migration 030 — Enable real-time publication for Phase 5 tables
-- Source: stelavox_technical_architecture_v1_8.md §10.3
--         "Real-time enabled on nodes, agent_jobs, agent_reports tables"
-- Build Checklist: T-12.1 (manual smoke surfaced this gap; SU-30)
--
-- The supabase_realtime publication exists but no Phase 1-4 migration
-- added tables to it. The Phase 5 useAgentJobsRealtime hook subscribes
-- to agent_jobs change events but received nothing because the table
-- wasn't in the publication. node_comments is added too so the
-- CommentThread updates without manual refresh.
--
-- nodes is added so the tree refreshes when the Accept route inserts
-- child nodes. node_versions stays out for now — version history
-- updates on user navigation, not in real-time.

ALTER PUBLICATION supabase_realtime ADD TABLE agent_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE node_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE nodes;
