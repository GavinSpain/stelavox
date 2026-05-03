// Spec: stelavox_phase3_api_contract_v1_0.md §3.2, §3.3
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.8
//
// Thin Supabase wrappers for the Phase 3 versions endpoints.
// RLS on node_versions (Migration 005) is the cross-tenancy boundary; no
// user_id filter here.
//
// listVersions:
//   - Order: version DESC, created_at DESC (G-5 — stable under future
//     out-of-band inserts).
//   - Selects all columns except `summary`/`prose`/`notes`/`metadata` —
//     the list view omits content (size optimisation, §2.13).
//   - Uses .range() for offset/limit; .select(..., {count: 'exact'}) gives
//     the RLS-filtered total in one round trip.
//
// getVersion:
//   - Full version body including content fields (drives the hover diff).

import type {
  PostgrestMaybeSingleResponse,
  PostgrestResponse,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>
type VersionRow = Database['public']['Tables']['node_versions']['Row']

const VERSION_LIST_SELECT = [
  'id', 'node_id', 'version',
  'changed_by', 'change_reason', 'created_at',
].join(', ')

const VERSION_FULL_SELECT = [
  'id', 'node_id', 'version',
  'summary', 'prose', 'notes', 'metadata',
  'changed_by', 'change_reason', 'created_at',
].join(', ')

export async function listVersions(
  supabase: Client,
  nodeId: string,
  limit: number,
  offset: number,
) {
  return supabase
    .from('node_versions')
    .select(VERSION_LIST_SELECT, { count: 'exact' })
    .eq('node_id', nodeId)
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1) as unknown as Promise<PostgrestResponse<VersionRow>>
}

export async function getVersion(
  supabase: Client,
  nodeId: string,
  versionNumber: number,
): Promise<PostgrestMaybeSingleResponse<VersionRow>> {
  // H-01: zero rows is a valid result here (the version_not_found path).
  return supabase
    .from('node_versions')
    .select(VERSION_FULL_SELECT)
    .eq('node_id', nodeId)
    .eq('version', versionNumber)
    .maybeSingle() as unknown as PostgrestMaybeSingleResponse<VersionRow>
}
