/**
 * Phase 7 — export_profiles RPC wrappers + queries.
 *
 * Routes call these instead of direct .from('export_profiles') CRUD
 * so SECURITY DEFINER membership + is_builtin invariant checks always
 * run via M-160 RPCs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportFormat, ProfileConfig } from './types'

export interface ExportProfile {
  id: string
  organisation_id: string | null
  project_id: string | null
  name: string
  format: ExportFormat
  config: ProfileConfig
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export async function listProfilesForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ExportProfile[]> {
  // Union of built-in (is_builtin=TRUE) + this project's author-saved.
  // RLS handles cross-org visibility.
  const { data, error } = await supabase
    .from('export_profiles')
    .select('*')
    .or(`is_builtin.eq.true,project_id.eq.${projectId}`)
    .order('is_builtin', { ascending: false })
    .order('format')
    .order('name')

  if (error) throw new Error(`listProfilesForProject: ${error.message}`)
  return (data ?? []) as unknown as ExportProfile[]
}

export async function getProfileById(
  supabase: SupabaseClient,
  profileId: string,
): Promise<ExportProfile | null> {
  const { data } = await supabase
    .from('export_profiles')
    .select('*')
    .eq('id', profileId)
    .maybeSingle()
  return (data as ExportProfile | null) ?? null
}

export async function saveExportProfile(
  supabase: SupabaseClient,
  args: { projectId: string; name: string; format: ExportFormat; config: ProfileConfig },
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('save_export_profile', {
    p_project_id: args.projectId,
    p_name: args.name,
    p_format: args.format,
    p_config: args.config,
  })
  if (error) throw new Error(error.message)
  return data as { id: string }
}

export async function updateExportProfile(
  supabase: SupabaseClient,
  args: { id: string; name: string; config: ProfileConfig },
): Promise<void> {
  const { error } = await supabase.rpc('update_export_profile', {
    p_id: args.id,
    p_name: args.name,
    p_config: args.config,
  })
  if (error) throw new Error(error.message)
}

export async function deleteExportProfile(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.rpc('delete_export_profile', { p_id: id })
  if (error) throw new Error(error.message)
}
