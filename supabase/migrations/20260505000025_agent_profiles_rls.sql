-- Migration 025 — agent_profiles RLS policy
-- Source: stelavox_phase5_api_contract_v1_0.md v1.2 §1.4 + Q4
-- Build Checklist: T-1.1
--
-- Phase 1's Migration 003 enabled RLS on agent_profiles with no policy
-- (no policy = no user-session access). Phase 5 adds a SELECT policy
-- admitting (a) system profiles (organisation_id IS NULL) and (b)
-- own-organisation profiles. INSERT/UPDATE/DELETE remain admin-only —
-- no policies for those operations. Migration 027 seeds rows via
-- service-role which bypasses RLS regardless.
--
-- This unblocks the AgentTab profile picker (Component Spec §5.9) and
-- GET /api/agent-profiles (API Contract v1.2 §3.15).

CREATE POLICY "agent_profiles_read_system_and_own_org" ON agent_profiles
  FOR SELECT USING (
    organisation_id IS NULL
    OR organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy in V1 — admin-only via service-role.
-- V2 adds per-organisation custom profiles with appropriate write policies
-- alongside the agent profile lifecycle (SU-24).
