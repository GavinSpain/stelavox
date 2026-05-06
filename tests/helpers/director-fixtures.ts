// Phase 5b test fixtures — projects, documents, conversations,
// workflows, workflow_steps. Uses the admin client to bypass RLS during
// setup. Tests use the user clients to exercise the API surface.
//
// Source: stelavox_phase5b_api_contract_v1_0.md §2.12-2.15.

import { adminClient } from './db'

export interface DirectorFixture {
  organisationId: string
  projectId: string
  documentId: string
  documentName: string
  rootNodeId: string
  /** Created lazily — `seedNodes()` populates these. */
  actId?: string
  chapterIds: string[]
  sceneIds: string[]
}

export async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)
  if (!user) throw new Error(`user not found: ${email}`)
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

export async function getUserId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)
  if (!user) throw new Error(`user not found: ${email}`)
  return user.id
}

export async function setupDocument(
  organisationId: string,
  prefix: string,
): Promise<DirectorFixture> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: organisationId, name: `${prefix} project` })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: organisationId,
    p_name: `${prefix} doc`,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const setup = rpc as {
    document: { id: string; name: string }
    root_node: { id: string }
  }
  return {
    organisationId,
    projectId: project!.id,
    documentId: setup.document.id,
    documentName: setup.document.name,
    rootNodeId: setup.root_node.id,
    chapterIds: [],
    sceneIds: [],
  }
}

/** Add an act + 2 chapters + 2 scenes per chapter under the document root. */
export async function seedNodes(f: DirectorFixture): Promise<DirectorFixture> {
  const admin = adminClient()
  const { data: act } = await admin
    .from('nodes')
    .insert({
      organisation_id: f.organisationId,
      project_id: f.projectId,
      document_id: f.documentId,
      parent_id: f.rootNodeId,
      node_category: 'structural',
      node_type: 'act',
      order: 1,
      depth: 1,
      layer_index: 1,
      name: 'Act 1',
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  f.actId = act!.id
  for (let c = 1; c <= 2; c++) {
    const { data: chap } = await admin
      .from('nodes')
      .insert({
        organisation_id: f.organisationId,
        project_id: f.projectId,
        document_id: f.documentId,
        parent_id: act!.id,
        node_category: 'structural',
        node_type: 'chapter',
        order: c,
        depth: 2,
        layer_index: 2,
        name: `Chapter ${c}`,
        status: 'draft',
        version: 1,
      })
      .select('id')
      .single()
    f.chapterIds.push(chap!.id)
    for (let s = 1; s <= 2; s++) {
      const { data: sc } = await admin
        .from('nodes')
        .insert({
          organisation_id: f.organisationId,
          project_id: f.projectId,
          document_id: f.documentId,
          parent_id: chap!.id,
          node_category: 'structural',
          node_type: 'scene',
          order: s,
          depth: 3,
          layer_index: 3,
          name: `Chapter ${c} Scene ${s}`,
          status: 'draft',
          version: 1,
        })
        .select('id')
        .single()
      f.sceneIds.push(sc!.id)
    }
  }
  return f
}

export async function lockNode(nodeId: string): Promise<void> {
  await adminClient().from('nodes').update({ locked: true }).eq('id', nodeId)
}

export async function dispose(f: DirectorFixture): Promise<void> {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

export interface ConversationSeed {
  conversationId: string
  userMessageIds: string[]
  assistantMessageIds: string[]
}

export async function seedConversation(
  f: DirectorFixture,
  authorUserId: string,
  pairs: Array<{ user: string; assistant: string }> = [],
): Promise<ConversationSeed> {
  const admin = adminClient()
  const { data: conv } = await admin
    .from('conversations')
    .insert({ organisation_id: f.organisationId, document_id: f.documentId })
    .select('id')
    .single()
  const seed: ConversationSeed = {
    conversationId: conv!.id,
    userMessageIds: [],
    assistantMessageIds: [],
  }
  let seq = 1
  for (const p of pairs) {
    const { data: u } = await admin
      .from('conversation_messages')
      .insert({
        conversation_id: conv!.id,
        role: 'user',
        content: p.user,
        sequence: seq++,
        author_user_id: authorUserId,
        tool_calls: [],
        turn_state: 'final',
      })
      .select('id')
      .single()
    seed.userMessageIds.push(u!.id)
    const { data: a } = await admin
      .from('conversation_messages')
      .insert({
        conversation_id: conv!.id,
        role: 'assistant',
        content: p.assistant,
        sequence: seq++,
        tool_calls: [],
        turn_state: 'final',
      })
      .select('id')
      .single()
    seed.assistantMessageIds.push(a!.id)
  }
  return seed
}

export interface WorkflowSeed {
  workflowId: string
  stepIds: string[]
}

export interface SeedStep {
  operation_type:
    | 'expand'
    | 'synthesise'
    | 'refine'
    | 'generate_context'
    | 'comment'
    | 'node_reorder'
  target_node_id: string
  description: string
  parameters: Record<string, unknown>
  estimated_duration_seconds?: number
  status?:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'removed'
}

export async function seedDraftWorkflow(
  f: DirectorFixture,
  conversationId: string,
  steps: SeedStep[],
  opts: {
    title?: string
    impact?: string
    locked_node_ids?: string[]
  } = {},
): Promise<WorkflowSeed> {
  const admin = adminClient()
  const { data: wf } = await admin
    .from('workflows')
    .insert({
      organisation_id: f.organisationId,
      document_id: f.documentId,
      conversation_id: conversationId,
      title: opts.title ?? 'Test plan',
      description: 'Test description',
      impact_summary: opts.impact ?? 'Test impact',
      status: 'draft',
      estimated_total_minutes: 1,
      locked_nodes_requiring_unlock: opts.locked_node_ids ?? [],
    })
    .select('id')
    .single()
  const stepIds: string[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const { data } = await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: i + 1,
        operation_type: s.operation_type,
        target_node_id: s.target_node_id,
        parameters: s.parameters as never,
        description: s.description,
        estimated_duration_seconds: s.estimated_duration_seconds ?? 30,
        depends_on_step_orders: [],
        status: s.status ?? 'pending',
      })
      .select('id')
      .single()
    stepIds.push(data!.id)
  }
  return { workflowId: wf!.id, stepIds }
}
