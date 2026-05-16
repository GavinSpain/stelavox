// Data-integrity tests for Phase 4 — DB-level invariants.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-D-01..TC-D-08

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import {
  createContextNodeFixture, linkContextFixture, shorthandCharacter,
} from '../helpers/context-fixtures'

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find(u => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

async function setupProject(orgId: string, name: string) {
  const { data } = await adminClient()
    .from('projects').insert({ organisation_id: orgId, name }).select().single()
  return data!
}

async function setupNovelDocument(projectId: string, orgId: string, name: string) {
  const { data } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id: projectId, p_organisation_id: orgId, p_name: name,
    p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  return data as { document: { id: string; root_node_id: string }; root_node: { id: string } }
}

test('TC-D-01 nodes.scope is non-NULL for every context node', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-01-project')
  await shorthandCharacter(orgId, project.id, 'Elena')

  const { data, error } = await adminClient()
    .from('nodes')
    .select('id, scope, node_category')
    .eq('node_category', 'context')
    .eq('project_id', project.id)
  expect(error).toBeNull()
  for (const row of data ?? []) {
    expect(row.scope).not.toBeNull()
    expect(['project', 'document']).toContain(row.scope)
  }
})

test('TC-D-02 nodes.scope is NULL for every structural node', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-02-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-02-doc')
  // setup.root_node is structural.

  const { data, error } = await adminClient()
    .from('nodes')
    .select('id, scope, node_category')
    .eq('node_category', 'structural')
    .eq('id', setup.root_node.id)
  expect(error).toBeNull()
  for (const row of data ?? []) {
    expect(row.scope).toBeNull()
  }
})

test('TC-D-03 UNIQUE(source, target) prevents double-link', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-03-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-03-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  await linkContextFixture(setup.root_node.id, elena.id, orgId)

  const { error } = await adminClient()
    .from('node_context_links')
    .insert({
      source_node_id:  setup.root_node.id,
      target_node_id:  elena.id,
      organisation_id: orgId,
      link_type:       'structural_to_context',
    })
  expect(error).not.toBeNull()
  expect(error?.code).toBe('23505')  // PostgreSQL unique_violation
})

test('TC-D-04 Cascade delete on context node removes the link', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-04-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-04-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  const link = await linkContextFixture(setup.root_node.id, elena.id, orgId)

  await adminClient().from('nodes').delete().eq('id', elena.id)

  const { data } = await adminClient()
    .from('node_context_links').select('id').eq('id', link.id)
  expect(data ?? []).toEqual([])
})

test('TC-D-05 Cascade delete on structural node removes the link', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-05-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-05-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  // Insert a child so we have a non-root structural to delete.
  const { data: child } = await adminClient().from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Act 1',
    status: 'draft', version: 1, metadata: {} as never,
  }).select().single()

  const link = await linkContextFixture(child!.id, elena.id, orgId)

  await adminClient().from('nodes').delete().eq('id', child!.id)

  const { data } = await adminClient()
    .from('node_context_links').select('id').eq('id', link.id)
  expect(data ?? []).toEqual([])
})

test('TC-D-06 Cascade delete on project removes context nodes and links', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-06-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-06-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  const link = await linkContextFixture(setup.root_node.id, elena.id, orgId)

  await adminClient().from('projects').delete().eq('id', project.id)

  // Project, document, structural root, context node, and link are all gone.
  const checks = await Promise.all([
    adminClient().from('projects')           .select('id').eq('id', project.id),
    adminClient().from('nodes')              .select('id').eq('id', elena.id),
    adminClient().from('nodes')              .select('id').eq('id', setup.root_node.id),
    adminClient().from('node_context_links') .select('id').eq('id', link.id),
  ])
  for (const c of checks) expect(c.data ?? []).toEqual([])
})

test('TC-D-07 Document-scoped context cascades with its document', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-07-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-D-07-doc')
  const atrium = await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: setup.document.id,
    node_type: 'location', name: 'Atrium',
  })
  // Project-scoped Elena is NOT cascaded.
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  await adminClient().from('documents').delete().eq('id', setup.document.id)

  const { data: atriumGone } = await adminClient()
    .from('nodes').select('id').eq('id', atrium.id)
  expect(atriumGone ?? []).toEqual([])

  const { data: elenaStill } = await adminClient()
    .from('nodes').select('id').eq('id', elena.id)
  expect((elenaStill ?? []).length).toBe(1)
})

test('TC-D-08 Migration 023 trigger fires on context-node content changes', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-D-08-project')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  expect(elena.version).toBe(1)

  await adminClient()
    .from('nodes')
    .update({ summary: 'Updated' })
    .eq('id', elena.id)

  const { data } = await adminClient()
    .from('nodes').select('version, summary').eq('id', elena.id).single()
  expect(data?.version).toBe(2)
  expect(data?.summary).toBe('Updated')
})
