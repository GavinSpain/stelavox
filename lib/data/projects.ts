import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

export async function getOrgId(supabase: Client): Promise<string | null> {
  const { data } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .limit(1)
    .maybeSingle()
  return data?.organisation_id ?? null
}

export async function createProject(
  supabase: Client,
  orgId: string,
  fields: { name: string; description?: string | null; default_document_type?: string | null }
) {
  return supabase
    .from('projects')
    .insert({ organisation_id: orgId, ...fields })
    .select('id, organisation_id, name, description, default_document_type, metadata, created_at, updated_at')
    .single()
}

export async function listProjects(supabase: Client) {
  return supabase
    .from('projects')
    .select('id, organisation_id, name, description, default_document_type, metadata, created_at, updated_at')
    .order('created_at', { ascending: false })
}

export async function getProject(supabase: Client, projectId: string) {
  return supabase
    .from('projects')
    .select('id, organisation_id, name, description, default_document_type, metadata, created_at, updated_at')
    .eq('id', projectId)
    .maybeSingle()
}

export async function updateProject(
  supabase: Client,
  projectId: string,
  fields: Record<string, unknown>
) {
  return supabase
    .from('projects')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', projectId)
    .select('id, organisation_id, name, description, default_document_type, metadata, created_at, updated_at')
    .single()
}

export async function deleteProject(supabase: Client, projectId: string) {
  return supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
}
