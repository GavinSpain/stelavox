-- Migration 026 — agent_jobs schema extensions for the agent lifecycle
-- Source: stelavox_phase5_api_contract_v1_0.md v1.2 §1.4 + Q5 + G-7 + G-11
-- Build Checklist: T-1.2
--
-- Phase 5 introduces a full agent-job lifecycle (pending → running →
-- completed → accepted | dismissed; cancelled; failed) plus a result_*
-- column set capturing the agent's proposed output until the author
-- Accepts. The pre-Phase-1 result_summary column is renamed to
-- result_summary_text (G-7) so the agent's proposed summary takes the
-- natural name. result_notes is added (G-11) so refine target_field='notes'
-- has somewhere to land. parent_comment_id gains ON DELETE CASCADE so
-- deleting a top-level comment cleans up replies (per Component Spec §5.10
-- delete-confirmation flow).

-- 1. Status enum extension: add 'accepted', 'dismissed', 'cancelled'
--    Phase 1 enum: ('pending','running','completed','failed')
--    Phase 5 enum: ('pending','running','completed','accepted','dismissed','cancelled','failed')
ALTER TABLE agent_jobs DROP CONSTRAINT agent_jobs_status_check;
ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_status_check
  CHECK (status IN ('pending','running','completed','accepted','dismissed','cancelled','failed'));

-- 2. Rename Phase 1's result_summary (the document-operation human-readable
--    report summary, post-V1 path) to result_summary_text. The new
--    result_summary holds the agent's proposed summary content for refine
--    and generate-context single-node operations.
ALTER TABLE agent_jobs RENAME COLUMN result_summary TO result_summary_text;

-- 3. Result columns for single-node agent operations
ALTER TABLE agent_jobs ADD COLUMN result_summary TEXT;
ALTER TABLE agent_jobs ADD COLUMN result_prose TEXT;
ALTER TABLE agent_jobs ADD COLUMN result_notes TEXT;
ALTER TABLE agent_jobs ADD COLUMN result_metadata JSONB;
ALTER TABLE agent_jobs ADD COLUMN result_child_nodes JSONB;

-- 4. Concurrency state for the Accept transactional path (API Contract §3.7)
ALTER TABLE agent_jobs ADD COLUMN target_node_version_at_capture INTEGER;

COMMENT ON COLUMN agent_jobs.result_summary IS
  'Agent-proposed summary content for refine/generate-context. Plain TEXT; converted to Tiptap JSON by the Accept route via plainTextToTiptap() before writing to nodes.summary.';
COMMENT ON COLUMN agent_jobs.result_prose IS
  'Agent-proposed prose content for synthesise/refine-prose. Plain TEXT; converted to Tiptap JSON by the Accept route before writing to nodes.prose.';
COMMENT ON COLUMN agent_jobs.result_notes IS
  'Agent-proposed notes content for refine-notes. Plain TEXT; converted to Tiptap JSON by the Accept route before writing to nodes.notes.';
COMMENT ON COLUMN agent_jobs.result_metadata IS
  'Agent-proposed metadata for generate-context. JSONB object; merged into nodes.metadata on Accept (preserves existing keys not in the proposed object).';
COMMENT ON COLUMN agent_jobs.result_child_nodes IS
  'Agent-proposed child nodes for expand. JSONB array of { name, short_description, summary, metadata, word_count_target, position }. Inserted as new nodes rows on Accept.';
COMMENT ON COLUMN agent_jobs.target_node_version_at_capture IS
  'The target node version at the moment the API route created this job. Used by Accept to detect concurrent author edits via 409 target_version_mismatch.';
COMMENT ON COLUMN agent_jobs.result_summary_text IS
  'Renamed from result_summary in Phase 5. Reserved for document-operation human-readable report summary (post-V1). Not used by single-node operations.';

-- 5. node_comments parent_comment_id cascade fix
--    Phase 1 declared the FK without ON DELETE — deleting a parent comment
--    leaves orphan replies. Component Spec §5.10's delete-confirmation flow
--    expects the cascade. API Contract §3.14 validates cascade in TC-A-51.
ALTER TABLE node_comments DROP CONSTRAINT node_comments_parent_comment_id_fkey;
ALTER TABLE node_comments ADD CONSTRAINT node_comments_parent_comment_id_fkey
  FOREIGN KEY (parent_comment_id) REFERENCES node_comments(id) ON DELETE CASCADE;
