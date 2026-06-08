// Phase 8.5b B.1 — Thin RPC wrappers for the rollup endpoints.
//
// Wraps the Postgres functions `get_document_rollup` and `get_project_rollup`
// (M-212) into typed TypeScript helpers. Used by:
//   - app/api/documents/[documentId]/rollup/route.ts
//   - app/api/projects/[projectId]/rollup/route.ts
//   - lib/dashboard/projectAggregates.ts (rewritten in B.1)
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §4
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 work item 6
//       supabase/migrations/20260608000212_document_and_project_rollup_rpcs.sql
//
// Wrapper contract:
//   - Returns the typed shape (`DocumentRollup` / `ProjectRollup`)
//   - RPC always returns exactly one row; we read the first row of the result
//   - Empty/non-existent input returns a zero-filled row (NOT null) per
//     the RPC's COALESCE pattern — caller doesn't need to coalesce
//   - RLS / auth context is inherited from the supabase client passed in
//   - Service-role clients bypass RLS (intended for cross-tenant aggregates)
//   - Anon clients receive RLS-filtered results (empty for cross-org)

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/types/database'
import type { DocumentRollup, ProjectRollup, NodeStatus } from '@/lib/types/api'

type AppSupabase = SupabaseClient<Database>

/**
 * Fetch the document rollup via the Postgres RPC.
 *
 * Always resolves to a `DocumentRollup` (with zeros) — never null, never
 * undefined — so the dashboard ProjectCard render path doesn't have to
 * coalesce missing aggregates into placeholders.
 *
 * Throws on RPC infrastructure error (network, permission, etc.); caller
 * is expected to handle via TanStack Query's error state (see Tier-A §3.7).
 */
export async function getDocumentRollup(
  supabase: AppSupabase,
  documentId: string,
): Promise<DocumentRollup> {
  const { data, error } = await supabase.rpc('get_document_rollup', {
    p_document_id: documentId,
  })
  if (error) {
    throw new Error(`get_document_rollup failed: ${error.message}`)
  }
  // RPC returns TABLE so the row is the first (only) element.
  const row = (data as { document_id: string; words_drafted: number; words_target: number;
    node_count: number; leaf_count: number; status_counts: unknown; last_updated_at: string | null }[])?.[0]
  if (!row) {
    // Defensive — the RPC's COALESCE branch always emits a row, even for
    // empty docs. If we ever see no row, treat as cross-RLS rejection and
    // return zeros under the requested document_id.
    return {
      document_id: documentId,
      words_drafted: 0,
      words_target: 0,
      node_count: 0,
      leaf_count: 0,
      status_counts: {},
      last_updated_at: null,
    }
  }
  return {
    document_id: row.document_id,
    words_drafted: Number(row.words_drafted),
    words_target: Number(row.words_target),
    node_count: Number(row.node_count),
    leaf_count: Number(row.leaf_count),
    status_counts: (row.status_counts as Partial<Record<NodeStatus, number>>) ?? {},
    last_updated_at: row.last_updated_at,
  }
}

/**
 * Fetch the project rollup via the Postgres RPC.
 *
 * Same return-contract guarantees as `getDocumentRollup`.
 */
export async function getProjectRollup(
  supabase: AppSupabase,
  projectId: string,
): Promise<ProjectRollup> {
  const { data, error } = await supabase.rpc('get_project_rollup', {
    p_project_id: projectId,
  })
  if (error) {
    throw new Error(`get_project_rollup failed: ${error.message}`)
  }
  const row = (data as { project_id: string; document_count: number; words_drafted: number;
    words_target: number; node_count: number; leaf_count: number; last_updated_at: string | null }[])?.[0]
  if (!row) {
    return {
      project_id: projectId,
      document_count: 0,
      words_drafted: 0,
      words_target: 0,
      node_count: 0,
      leaf_count: 0,
      last_updated_at: null,
    }
  }
  return {
    project_id: row.project_id,
    document_count: Number(row.document_count),
    words_drafted: Number(row.words_drafted),
    words_target: Number(row.words_target),
    node_count: Number(row.node_count),
    leaf_count: Number(row.leaf_count),
    last_updated_at: row.last_updated_at,
  }
}
