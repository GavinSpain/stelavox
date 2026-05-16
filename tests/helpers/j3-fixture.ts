import { adminClient } from './db'

/**
 * J3 fixture helper. Builds a Novel doc with Act→Chapter→Scene→Beat
 * hierarchy under a fresh isolated project. The Beat is the leaf
 * targeted by most TC-J3-* cases (autosave + ProseEditor leaf-only
 * mounting).
 *
 * Cleanup: cascade-delete via project removal.
 */
export interface J3Fixture {
  projectId: string
  docId: string
  rootId: string
  actId: string
  actName: string
  chapterId: string
  chapterName: string
  sceneId: string
  sceneName: string
  beatId: string
  beatName: string
  cleanup: () => Promise<void>
}

export async function setupJ3Fixture(orgId: string, prefix: string, opts: { lockedBeat?: boolean } = {}): Promise<J3Fixture> {
  const admin = adminClient()
  const stamp = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: `${stamp}-project` })
    .select('id')
    .single()
  if (!project) throw new Error('setupJ3Fixture: project insert failed')

  const { data: rpcResult } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project.id,
    p_organisation_id: orgId,
    p_name:            `${stamp}-doc`,
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpcResult as { document: { id: string }; root_node: { id: string } }

  const actName = `${stamp}-Act`
  const { data: act } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: actName, status: 'draft', version: 1,
  }).select('id').single()

  const chapterName = `${stamp}-Chap`
  const { data: chapter } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: chapterName, status: 'draft', version: 1,
  }).select('id').single()

  const sceneName = `${stamp}-Scene`
  const { data: scene } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: chapter!.id, node_category: 'structural', node_type: 'scene',
    order: 1, depth: 3, layer_index: 3, name: sceneName, status: 'draft', version: 1,
  }).select('id').single()

  const beatName = `${stamp}-Beat`
  const { data: beat } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: scene!.id, node_category: 'structural', node_type: 'beat',
    order: 1, depth: 4, layer_index: 4, name: beatName,
    status: 'draft', version: 1,
  }).select('id').single()

  if (opts.lockedBeat) {
    // Phase 6: nodes.locked dropped; use node_author_locks.
    const { data: member } = await admin
      .from('organisation_members').select('user_id')
      .eq('organisation_id', orgId).limit(1).single()
    if (member?.user_id) {
      await admin.from('node_author_locks').insert({
        node_id: beat!.id, organisation_id: orgId,
        locked_by_user_id: member.user_id, lock_reason: 'fixture lock',
      })
    }
  }

  return {
    projectId: project.id,
    docId: setup.document.id,
    rootId: setup.root_node.id,
    actId: act!.id,
    actName,
    chapterId: chapter!.id,
    chapterName,
    sceneId: scene!.id,
    sceneName,
    beatId: beat!.id,
    beatName,
    cleanup: async () => {
      await admin.from('projects').delete().eq('id', project.id)
    },
  }
}
