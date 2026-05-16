// Phase 2 tree fixture helpers.
// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.9 T-9.1
//
// Used by api/, boundary/, integrity/, and ui/ tests to set up
// document + tree fixtures via the service-role admin client.

import type { Database } from '../../lib/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminClient } from './db'

type AdminClient = SupabaseClient<Database>

export interface DocFixture {
  projectId: string
  docId: string
  rootId: string
}

export async function setupNovelDoc(
  orgId: string,
  projectName = 'Tree fixture project',
  docName = 'Tree fixture doc',
): Promise<DocFixture> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: projectName })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            docName,
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  return { projectId: project!.id, docId: setup.document.id, rootId: setup.root_node.id }
}

interface InsertNodeArgs {
  orgId: string
  projectId: string
  docId: string
  parentId: string
  nodeType: string
  order: number
  depth: number
  layerIndex: number
  name?: string
  // Phase 6: nodes.locked column dropped. Author Lock state lives in
  // node_author_locks. Pass `locked: true` to make this helper also
  // insert a node_author_locks row after creating the node (the org's
  // first member is used as the locker for fixture convenience).
  locked?: boolean
}

export async function insertNode(
  args: InsertNodeArgs,
  admin: AdminClient = adminClient(),
): Promise<string> {
  const { data } = await admin
    .from('nodes')
    .insert({
      organisation_id: args.orgId,
      project_id:      args.projectId,
      document_id:     args.docId,
      parent_id:       args.parentId,
      node_category:   'structural',
      node_type:       args.nodeType,
      order:           args.order,
      depth:           args.depth,
      layer_index:     args.layerIndex,
      name:            args.name ?? null,
      status:          'draft',
      version:         1,
    })
    .select('id')
    .single()
  const nodeId = data!.id

  if (args.locked) {
    // Pick the org's first member as the locker.
    const { data: member } = await admin
      .from('organisation_members')
      .select('user_id')
      .eq('organisation_id', args.orgId)
      .limit(1)
      .single()
    if (member?.user_id) {
      await admin.from('node_author_locks').insert({
        node_id: nodeId,
        organisation_id: args.orgId,
        locked_by_user_id: member.user_id,
        lock_reason: 'test fixture',
      })
    }
  }
  return nodeId
}

export async function disposeFixture(fix: DocFixture) {
  await adminClient().from('projects').delete().eq('id', fix.projectId)
}

// Asserts that a parent's children have dense, 1-indexed `order`
// values [1..N] AND in the supplied name sequence. Throws if either
// invariant is violated.
export async function expectTreeShape(
  parentId: string,
  expected: { name: string; order: number }[],
): Promise<void> {
  const { data } = await adminClient()
    .from('nodes')
    .select('name, "order"')
    .eq('parent_id', parentId)
    .order('order')
  const actual = (data ?? []).map(r => ({ name: r.name, order: r.order }))
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Tree shape mismatch under parent ${parentId}:\n` +
      `  expected ${JSON.stringify(expected)}\n` +
      `  actual   ${JSON.stringify(actual)}`,
    )
  }
}
