import 'server-only'

/**
 * Server-side reader for the Project Profile.
 *
 * Returns the §6.1.3 payload shape (goal_text + preferences + recent
 * amendments). RLS-gated via the standard server Supabase client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectProfile, ProjectProfilePayload } from './types'

const RECENT_AMENDMENTS_LIMIT = 5

export async function getProjectProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<ProjectProfilePayload | null> {
  const { data: profile, error } = await supabase
    .from('project_profiles')
    .select('id, document_id, organisation_id, goal_text, preferences, created_at, updated_at')
    .eq('id', profileId)
    .maybeSingle()
  if (error) throw error
  if (!profile) return null

  const { data: amendments } = await supabase
    .from('profile_amendments')
    .select('amendment_type, target_path, reason, approved_at, proposed_by')
    .eq('profile_id', profileId)
    .order('approved_at', { ascending: false })
    .limit(RECENT_AMENDMENTS_LIMIT)

  const p = profile as unknown as ProjectProfile

  return {
    goal_text: p.goal_text,
    preferences: p.preferences ?? {},
    recent_amendments: (amendments ?? []) as unknown as ProjectProfilePayload['recent_amendments'],
  }
}

/**
 * Convenience: look up Profile by document_id (1:1). Used by the Director
 * tool handler — the model has document_id in session, not profile_id.
 */
export async function getProjectProfileByDocumentId(
  supabase: SupabaseClient,
  documentId: string,
): Promise<ProjectProfilePayload | null> {
  const { data, error } = await supabase
    .from('project_profiles')
    .select('id')
    .eq('document_id', documentId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return getProjectProfile(supabase, (data as { id: string }).id)
}
