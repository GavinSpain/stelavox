import { adminClient } from './db'

/**
 * Phase 5d test-data isolation helper. Per QA Strategy §4 — every Phase 5d test
 * owns its own document; cleans up regardless of pass/fail. SU-50 was the lesson.
 *
 * Usage:
 *   const { docId, projectId, cleanup } = await createIsolatedDoc({
 *     organisationId,
 *     ownerName: 'TC-J3-01',
 *     documentType: 'novel',
 *   })
 *   try {
 *     // ... exercise the journey
 *   } finally {
 *     await cleanup()
 *   }
 *
 * Or in a Playwright fixture-style test:
 *   let cleanup: () => Promise<void>
 *   test.afterEach(async () => { await cleanup?.() })
 *   test('TC-J3-01 ...', async () => {
 *     const seeded = await createIsolatedDoc({ organisationId, ownerName: 'TC-J3-01' })
 *     cleanup = seeded.cleanup
 *     // ...
 *   })
 *
 * The cleanup deletes the project, which cascades to the document, all nodes,
 * and all agent_jobs / workflows / comments / context_links via the existing
 * FK ON DELETE CASCADE chain.
 */

export interface IsolatedDocOpts {
  organisationId: string
  ownerName?: string
  documentType?: 'novel' | 'short_story' | 'series'
  projectName?: string
}

export interface IsolatedDoc {
  projectId: string
  docId: string
  layerStackId: string
  cleanup: () => Promise<void>
}

export async function createIsolatedDoc(opts: IsolatedDocOpts): Promise<IsolatedDoc> {
  const admin = adminClient()
  const tag = opts.ownerName ?? 'p5d'
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const { data: project, error: projErr } = await admin
    .from('projects')
    .insert({
      organisation_id: opts.organisationId,
      name: opts.projectName ?? `${stamp}-project`,
    })
    .select('id')
    .single()
  if (projErr || !project) throw new Error(`createIsolatedDoc: project insert failed — ${projErr?.message}`)

  const { data: docResult, error: docErr } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project.id,
    p_organisation_id: opts.organisationId,
    p_name: `${stamp}-doc`,
    p_description: null as unknown as string,
    p_document_type: opts.documentType ?? 'novel',
    p_authors: [],
  })
  if (docErr || !docResult) throw new Error(`createIsolatedDoc: document RPC failed — ${docErr?.message}`)

  const result = docResult as { document: { id: string; layer_stack_id: string } }

  return {
    projectId: project.id,
    docId: result.document.id,
    layerStackId: result.document.layer_stack_id,
    cleanup: async () => {
      // Cascade-delete via project removal. Foreign keys handle the rest.
      await admin.from('projects').delete().eq('id', project.id)
    },
  }
}

/**
 * Resolve the organisation_id for a user's seed-membership row. Used by tests
 * that want to operate inside an existing user's org without hardcoding it.
 */
export async function getOrganisationIdForUser(userId: string): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .limit(1)
    .single()
  if (error || !data) throw new Error(`getOrganisationIdForUser(${userId}): ${error?.message ?? 'no row'}`)
  return data.organisation_id
}

/**
 * Look up an auth user by email. Used by tests that create a fresh user via
 * the signup flow and need the user_id for downstream cleanup.
 */
export async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const admin = adminClient()
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (data?.users ?? []).find(u => u.email === email)
  return user ? { id: user.id } : null
}

export async function deleteUserByEmail(email: string): Promise<void> {
  const admin = adminClient()
  const u = await findUserByEmail(email)
  if (u) await admin.auth.admin.deleteUser(u.id)
}
