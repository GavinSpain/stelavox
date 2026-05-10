// Phase 5 agent test fixtures.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §1.3 (test data)
//       Build Checklist T-16.1
//
// Provides:
//   - setupAgentNovelFixture(): a Book→Act→Chapter→Scene→Beat tree
//     with optional Character context node, summary content, prose
//   - seedCompletedJob(): pre-baked completed agent_jobs row for
//     Accept-flow tests that don't need a real LLM call

import type { Database } from '../../lib/types/database'
import { adminClient } from './db'

export interface AgentNovelFixture {
  projectId: string
  documentId: string
  rootId: string         // book
  actId: string
  chapterId: string
  sceneId: string
  beatId: string
  characterContextId?: string
}

interface SetupOpts {
  withSummary?: boolean        // populate chapter & beat summaries
  withProse?: boolean          // populate beat prose (Tiptap)
  withCharacter?: boolean      // create a Character context node
  withCharacterEmpty?: boolean // create EMPTY Character (for generate-context)
}

// summary/prose/notes are TEXT columns storing JSON-stringified Tiptap.
const TIPTAP_DOC = (text: string): string => JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

export async function setupAgentNovelFixture(
  orgId: string,
  prefix: string,
  opts: SetupOpts = {},
): Promise<AgentNovelFixture> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id').single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: `${prefix} doc`,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id
  const rootId = setup.root_node.id

  async function insertChild(parentId: string, nodeType: string, depth: number, layerIndex: number, name: string, summary: string | null = null, prose: string | null = null) {
    const { data } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: parentId, node_category: 'structural', node_type: nodeType,
      order: 1, depth, layer_index: layerIndex, name, status: 'draft', version: 1,
      summary, prose,
    }).select('id').single()
    return data!.id
  }

  // Populate the book root with a richer synopsis when withSummary — gives
  // expand prompts upstream context to ground their output (avoids the
  // model returning narrative prose instead of JSON for minimal seeds).
  if (opts.withSummary) {
    await admin.from('nodes').update({
      summary: TIPTAP_DOC(
        'A literary novel set in a coastal English town in the early 2000s. ' +
        'The story follows Maya Chen, a 32-year-old archivist who returns home ' +
        'after her mother\'s sudden death and discovers a sealed box of letters ' +
        'that contradict everything she thought she knew about her family. ' +
        'As Maya investigates the letters\' origins, she must reconcile the ' +
        'mother she remembers with the stranger the letters describe — and ' +
        'decide whether to share what she finds with her estranged sister.',
      ),
    }).eq('id', rootId)
  }

  const actSummary = opts.withSummary
    ? TIPTAP_DOC('Act 1 establishes Maya\'s return home, the discovery of the box of letters, and her first impulse to investigate.')
    : null
  const actId = await insertChild(rootId, 'act', 1, 1, `${prefix} A1`, actSummary)
  const chSummary = opts.withSummary
    ? TIPTAP_DOC('Chapter 1: Maya arrives at her mother\'s house, walks through empty rooms, and encounters the locked box of letters in the attic. She wrestles with whether to open it.')
    : null
  const chapterId = await insertChild(actId, 'chapter', 2, 2, `${prefix} C1`, chSummary)
  const sceneSummary = opts.withSummary
    ? TIPTAP_DOC('A scene in the attic. Maya finds the box, examines the dust on it, and realises someone has been here recently.')
    : null
  const sceneId = await insertChild(chapterId, 'scene', 3, 3, `${prefix} S1`, sceneSummary)
  const beatSummary = opts.withSummary
    ? TIPTAP_DOC('A short beat where the protagonist hesitates at the threshold of the attic before stepping inside.')
    : null
  const beatProse = opts.withProse
    ? TIPTAP_DOC('She paused, her hand on the door. The wood was cold. She took a breath, and pushed it open.')
    : null
  const beatId = await insertChild(sceneId, 'beat', 4, 4, `${prefix} B1`, beatSummary, beatProse)

  let characterContextId: string | undefined
  if (opts.withCharacter || opts.withCharacterEmpty) {
    const ctxSummary = opts.withCharacterEmpty
      ? null
      : TIPTAP_DOC('Maya is a 32-year-old archivist whose careful detachment hides an unresolved grief.')
    const ctxMetadata = opts.withCharacterEmpty ? {} : { wound: 'parent loss' }
    const { data: ctxNode } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: null, node_category: 'context', node_type: 'character',
      order: 0, depth: 0, layer_index: 0,
      name: opts.withCharacterEmpty ? 'Empty character for review' : 'Maya Chen',
      status: 'draft', version: 1,
      scope: 'document', summary: ctxSummary, metadata: ctxMetadata,
    }).select('id').single()
    characterContextId = ctxNode!.id
  }

  return { projectId: project!.id, documentId: docId, rootId, actId, chapterId, sceneId, beatId, characterContextId }
}

export async function disposeAgentFixture(fix: AgentNovelFixture): Promise<void> {
  await adminClient().from('projects').delete().eq('id', fix.projectId)
}

interface SeedJobArgs {
  orgId: string
  documentId: string
  nodeId: string
  operationType: 'expand' | 'synthesise' | 'refine' | 'generate_context'
  operationClass?: 'single_node' | 'batch'
  profileId: string
  triggeredBy: string
  status?: Database['public']['Tables']['agent_jobs']['Row']['status']
  resultColumns?: {
    result_summary?: string | null
    result_summary_text?: string | null
    result_metadata?: Record<string, unknown> | null
    result_prose?: string | null
    result_notes?: string | null
    result_child_nodes?: unknown[] | null
  }
  tokensInput?: number
  tokensOutput?: number
  costUsd?: number
  targetVersion?: number
  modelId?: string
  contextSnapshot?: Record<string, unknown>
}

type AgentJobInsert = Database['public']['Tables']['agent_jobs']['Insert']
type Json = Database['public']['Tables']['agent_jobs']['Insert']['context_snapshot']

export async function seedCompletedJob(args: SeedJobArgs): Promise<string> {
  const admin = adminClient()
  const status = args.status ?? 'completed'
  const isTerminal = ['completed', 'accepted', 'dismissed', 'cancelled', 'failed'].includes(status)
  const row: AgentJobInsert = {
    organisation_id: args.orgId,
    document_id: args.documentId,
    node_id: args.nodeId,
    operation_type: args.operationType,
    operation_class: args.operationClass ?? 'single_node',
    profile_id: args.profileId,
    status,
    triggered_by: args.triggeredBy,
    target_node_version_at_capture: args.targetVersion ?? 1,
    context_snapshot: (args.contextSnapshot ?? { dynamic: { agent_instruction: '' } }) as Json,
    result_summary: args.resultColumns?.result_summary ?? null,
    result_summary_text: args.resultColumns?.result_summary_text ?? null,
    result_metadata: (args.resultColumns?.result_metadata ?? null) as Json,
    result_prose: args.resultColumns?.result_prose ?? null,
    result_notes: args.resultColumns?.result_notes ?? null,
    result_child_nodes: (args.resultColumns?.result_child_nodes ?? null) as Json,
    tokens_input: args.tokensInput ?? (isTerminal ? 1500 : null),
    tokens_output: args.tokensOutput ?? (isTerminal ? 600 : null),
    cost_usd: args.costUsd ?? (status === 'completed' || status === 'accepted' ? 0.012 : null),
    model_id: args.modelId ?? 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    started_at: isTerminal ? new Date(Date.now() - 5000).toISOString() : null,
    completed_at: isTerminal ? new Date().toISOString() : null,
  }
  const { data } = await admin.from('agent_jobs').insert(row).select('id').single()
  return data!.id
}

// Returns the seeded V1 agent profile ID matching name (e.g. 'expand_chapter_into_scenes').
export async function getProfileId(name: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('agent_profiles').select('id').eq('name', name).single()
  if (error || !data) throw new Error(`profile ${name} not found: ${error?.message}`)
  return data.id
}

// Resolves a test user's auth UID by email.
export async function getUserId(email: string): Promise<string> {
  const { data: users } = await adminClient().auth.admin.listUsers({ perPage: 200 })
  const u = users.users.find(x => x.email === email)
  if (!u) throw new Error(`user ${email} not found`)
  return u.id
}

// H-01 + silent-failure (round-3 audit F-259): use .maybeSingle() so a
// user without an organisation_members row returns clean null rather
// than the PGRST116 error path; throw an informative error naming the
// email instead of the prior `data!` non-null-assertion's cryptic
// "Cannot read properties of null" crash.
export async function getOrgIdForUser(email: string): Promise<string> {
  const userId = await getUserId(email)
  const { data } = await adminClient()
    .from('organisation_members').select('organisation_id').eq('user_id', userId).maybeSingle()
  if (!data) throw new Error(`getOrgIdForUser: user ${email} has no organisation_members row`)
  return data.organisation_id
}
