-- Migration 001b — Phase 1 RLS policies
-- Source: stelavox_technical_architecture_v1_3.md §3.3 (RLS templates) and §5 H-02
-- Build Checklist: T-3.15
-- Establishes RLS on every Phase 1 user-data table:
--   organisations, organisation_members, projects, documents, layer_stacks
-- The organisation_members policy uses auth.uid() directly to avoid the
-- self-referential recursion failure mode documented in H-02.

ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_see_their_orgs" ON organisation_members
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "users_self_insert_membership" ON organisation_members
  FOR INSERT WITH CHECK (user_id = auth.uid());
-- No UPDATE/DELETE policy in Phase 1 — admin operations are V2.

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members_see_their_orgs_orgs" ON organisations
  FOR SELECT USING (
    id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  );
-- No INSERT policy — organisations are created exclusively by the SECURITY DEFINER
-- handle_new_user() trigger from Migration 001a.
-- No UPDATE/DELETE policy in Phase 1 — V2 introduces owner-only update.

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_projects" ON projects
  FOR ALL USING (
    organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  );

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_members_access_documents" ON documents
  FOR ALL USING (
    organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  );

ALTER TABLE layer_stacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "layer_stacks_access" ON layer_stacks
  FOR ALL USING (
    organisation_id IS NOT NULL
    AND organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  )
  WITH CHECK (
    organisation_id IS NOT NULL
    AND organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
  );
-- The is_template = TRUE rows have organisation_id IS NULL and are deliberately
-- excluded from user-session reads. They are read by the API route via the
-- service-role client when forking a layer stack into a new document.

ALTER TABLE organisation_invites ENABLE ROW LEVEL SECURITY;
-- No Phase 1 policy — invitation flow is V2. The table exists so subsequent
-- migrations and seeds reference a stable schema, but is unreadable to users
-- in Phase 1 (RLS enabled, no policies = no access).

ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
-- agent_profiles has organisation_id IS NULL for system profiles. Phase 1 has
-- no agent code; the table exists for Phase 5 to read. No policy in Phase 1
-- means no user access until Phase 5 adds one.
