// Spec: stelavox_phase4_test_plan_v1_0.md §1.4 (Tooling)
//       stelavox_phase4_build_checklist_v1_0.md §3.8 T-7.2 / test infrastructure
//
// Fixtures for the Phase 4 tests. Service-role wrappers around the
// nodes table for fast, RLS-free seeding. Tests that exercise the
// API surface (Sidebar/Picker UI flows, validation, RLS) call these
// to set up state, then exercise the API.

import { adminClient } from './db'
import type { Database } from '../../lib/types/database'
import type { ContextNodeType } from '../../lib/context/types'

export interface ContextFixtureOpts {
  org_id:        string
  project_id:    string
  document_id?:  string | null
  scope:         'project' | 'document'
  node_type:     ContextNodeType
  name:          string
  metadata?:     Record<string, unknown>
}

export async function createContextNodeFixture(opts: ContextFixtureOpts) {
  const insert: Database['public']['Tables']['nodes']['Insert'] = {
    organisation_id: opts.org_id,
    project_id:      opts.project_id,
    document_id:     opts.document_id ?? null,
    parent_id:       null,
    node_category:   'context',
    node_type:       opts.node_type,
    scope:           opts.scope,
    name:            opts.name,
    metadata:        (opts.metadata ?? {}) as never,
    status:          'draft',
    version:         1,
  }
  const { data, error } = await adminClient()
    .from('nodes')
    .insert(insert)
    .select()
    .single()
  if (error || !data) throw new Error(`createContextNodeFixture failed: ${error?.message}`)
  return data
}

export async function linkContextFixture(sourceId: string, targetId: string, orgId: string) {
  const { data, error } = await adminClient()
    .from('node_context_links')
    .insert({
      source_node_id:  sourceId,
      target_node_id:  targetId,
      organisation_id: orgId,
      link_type:       'structural_to_context',
    })
    .select()
    .single()
  if (error || !data) throw new Error(`linkContextFixture failed: ${error?.message}`)
  return data
}

export async function shorthandCharacter(orgId: string, projectId: string, name: string) {
  return createContextNodeFixture({
    org_id: orgId, project_id: projectId, scope: 'project',
    node_type: 'character', name,
    metadata: { role: 'protagonist' },
  })
}
