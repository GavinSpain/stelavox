import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type Client = SupabaseClient<Database>

const DOC_SELECT = 'id, organisation_id, project_id, name, description, document_type, layer_stack_id, root_node_id, status, export_settings, authors, director_config_id, created_at, updated_at'

export async function createDocumentWithLayerStack(
  supabase: Client,
  args: {
    project_id: string
    organisation_id: string
    name: string
    description: string | null
    document_type: string
    authors: string[]
  }
) {
  return supabase.rpc('create_document_with_layer_stack', {
    p_project_id:      args.project_id,
    p_organisation_id: args.organisation_id,
    p_name:            args.name,
    p_description:     (args.description ?? null) as string,
    p_document_type:   args.document_type,
    p_authors:         args.authors,
  })
}

export async function listDocuments(supabase: Client, projectId: string, status?: string) {
  let query = supabase
    .from('documents')
    .select(DOC_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  return query
}

export async function getDocument(supabase: Client, documentId: string) {
  return supabase
    .from('documents')
    .select(DOC_SELECT)
    .eq('id', documentId)
    .maybeSingle()
}

// H-01 (round-3 audit F-148): .maybeSingle() — zero rows is a valid
// outcome here (concurrent delete between the route's pre-check and
// this UPDATE). Caller MUST treat data === null as not_found.
export async function updateDocument(
  supabase: Client,
  documentId: string,
  fields: Record<string, unknown>
) {
  return supabase
    .from('documents')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', documentId)
    .select(DOC_SELECT)
    .maybeSingle()
}

export async function deleteDocument(supabase: Client, documentId: string) {
  return supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
}
