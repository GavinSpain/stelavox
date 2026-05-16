/**
 * V1.x-F.3 — synthetic probe fixture seeder.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §3 +
 *         docs/wireframes/wireframe_admin_dashboard_v1.html §07
 *         (Synthetic probes section).
 *
 * Idempotent. Seeds the minimum DB substrate the V1.x-F.3 probes need:
 *   - A dedicated probe organisation (deterministic name +
 *     `_stelavox_probes` slug; created lazily via the test user's auto-
 *     org if missing).
 *   - A probe project + document with a tiny Book → Act → Chapter
 *     structure.
 *   - One expand target: a Chapter node with NO children + leaf=false
 *     (per H-15 derivation from layer_index < max).
 *   - One refine target: a leaf Scene with prose populated, so the
 *     refine pipeline has something to work with.
 *
 * After creating the rows, the script writes the deterministic IDs
 * back into `platform_config` under the keys:
 *   - probe.fixture.organisation_id
 *   - probe.fixture.document_id
 *   - probe.fixture.expand_target_node_id
 *   - probe.fixture.refine_target_node_id
 *
 * The probe runners (lib/admin/probes/workflow-expand.ts +
 * lib/admin/probes/refine-accept.ts) read these keys to find their
 * targets. When the keys are absent the probes return the F.3-era
 * `probe_fixtures_not_seeded` failure so admin operators see clearly
 * why they're skipping.
 *
 * Re-runs do NOT duplicate: project lookup is by name. Pass --reset to
 * tear down + re-create.
 *
 * Usage:
 *   npm run script scripts/seed-probe-fixtures.ts
 *   npm run script scripts/seed-probe-fixtures.ts -- --reset
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const PROBE_USER_EMAIL = '_stelavox_probes@stelavox.local'
const PROBE_USER_PASSWORD = 'ProbeFixture!1234'
const PROBE_PROJECT_NAME = '_stelavox_probes'
const PROBE_DOCUMENT_NAME = 'Synthetic probe fixture'
const PROBE_DOCUMENT_TYPE = 'novel'

const EXPAND_TARGET_TITLE = '__probe_expand_target_chapter'
const REFINE_TARGET_TITLE = '__probe_refine_target_scene'

const REFINE_TARGET_PROSE = [
  'The night air carried the scent of rain on stone. ',
  'She stepped through the threshold, eyes adjusting to the candle-dim interior. ',
  'Three figures sat at the long table; none rose to meet her. ',
  'The silence that followed was not hostile, only watchful — the silence of a verdict yet to be cast.',
].join('')

const REFINE_TARGET_SUMMARY = 'A late-night meeting; the protagonist enters a room of strangers who will decide her fate.'

function toTiptapDoc(text: string): { type: string; content: unknown[] } {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

const args = process.argv.slice(2)
const reset = args.includes('--reset')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('error: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function ensureProbeUser(): Promise<string> {
  const { data: existing } = await admin.auth.admin.listUsers()
  const user = existing?.users?.find((u) => u.email === PROBE_USER_EMAIL)
  if (user) return user.id
  const { data: created, error } = await admin.auth.admin.createUser({
    email: PROBE_USER_EMAIL,
    password: PROBE_USER_PASSWORD,
    email_confirm: true,
  })
  if (error || !created.user) {
    console.error('error: failed to create probe user:', error?.message)
    process.exit(1)
  }
  return created.user.id
}

async function getOrgId(userId: string): Promise<string> {
  // H-03 trigger auto-creates an org on auth.users INSERT. Look it up.
  const { data, error } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    console.error('error: failed to resolve probe org:', error?.message)
    process.exit(1)
  }
  return data.organisation_id
}

async function teardownExisting(orgId: string): Promise<void> {
  // Find any prior probe project for the org and cascade-delete.
  const { data: projects } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('name', PROBE_PROJECT_NAME)
  if (!projects?.length) return
  for (const p of projects) {
    // Documents cascade to nodes; projects cascade to documents.
    await admin.from('projects').delete().eq('id', p.id)
  }
  // Also clear the platform_config pointers so the runner reports
  // probe_fixtures_not_seeded until reseed completes.
  await admin
    .from('platform_config')
    .delete()
    .in('key', [
      'probe.fixture.organisation_id',
      'probe.fixture.document_id',
      'probe.fixture.expand_target_node_id',
      'probe.fixture.refine_target_node_id',
    ])
}

async function findExistingProject(orgId: string): Promise<string | null> {
  const { data } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('name', PROBE_PROJECT_NAME)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function createProject(orgId: string, _ownerId: string): Promise<string> {
  const { data, error } = await admin
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: PROBE_PROJECT_NAME,
      description: 'Synthetic probe fixture project — DO NOT EDIT. Created by V1.x-F.3 scripts/seed-probe-fixtures.ts.',
      default_document_type: PROBE_DOCUMENT_TYPE,
    })
    .select('id')
    .single()
  if (error || !data) {
    console.error('error: failed to create probe project:', error?.message)
    process.exit(1)
  }
  return data.id
}

interface DocumentSetup {
  document_id: string
  root_node_id: string
}

async function createDocument(projectId: string, orgId: string): Promise<DocumentSetup> {
  const { data, error } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: PROBE_DOCUMENT_NAME,
    p_description: null as unknown as string,
    p_document_type: PROBE_DOCUMENT_TYPE,
    p_authors: [],
  })
  if (error || !data) {
    console.error('error: create_document_with_layer_stack failed:', error?.message)
    process.exit(1)
  }
  const setup = data as unknown as {
    document: { id: string }
    root_node: { id: string }
  }
  return {
    document_id: setup.document.id,
    root_node_id: setup.root_node.id,
  }
}

interface NodeRow {
  id: string
  layer_index: number
}

async function insertChild(
  parentId: string,
  documentId: string,
  orgId: string,
  projectId: string,
  layerIndex: number,
  depth: number,
  nodeType: string,
  name: string,
  summary: string | null,
  prose: string | null,
  order: number,
): Promise<NodeRow> {
  const { data, error } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      document_id: documentId,
      project_id: projectId,
      parent_id: parentId,
      layer_index: layerIndex,
      depth,
      node_type: nodeType,
      node_category: 'structural',
      name,
      summary: summary ? toTiptapDoc(summary) : null,
      prose: prose ? toTiptapDoc(prose) : null,
      order,
    })
    .select('id, layer_index')
    .single()
  if (error || !data) {
    console.error(`error: failed to insert node ${name}:`, error?.message)
    process.exit(1)
  }
  return { id: data.id, layer_index: data.layer_index }
}

interface LayerSpec {
  index: number
  node_type: string
  label: string
}

async function getDocumentLayerStack(documentId: string): Promise<{ stackId: string; layers: LayerSpec[]; maxIndex: number }> {
  const { data: doc } = await admin
    .from('documents')
    .select('layer_stack_id')
    .eq('id', documentId)
    .single()
  const { data: stack } = await admin
    .from('layer_stacks')
    .select('layers')
    .eq('id', doc!.layer_stack_id)
    .single()
  const layers = (stack!.layers as LayerSpec[]).sort((a, b) => a.index - b.index)
  return { stackId: doc!.layer_stack_id, layers, maxIndex: layers[layers.length - 1].index }
}

async function writeFixtureConfig(keys: Record<string, string>): Promise<void> {
  // Upsert each pointer so re-runs refresh without conflict.
  // supabase-js auto-serialises JS strings into JSONB string values;
  // calling JSON.stringify here would double-quote the value.
  const rows = Object.entries(keys).map(([key, value]) => ({
    key,
    value,
    description: `V1.x-F.3 probe fixture pointer (seeded by scripts/seed-probe-fixtures.ts).`,
    value_type: 'string',
  }))
  for (const row of rows) {
    await admin
      .from('platform_config')
      .upsert(row, { onConflict: 'key' })
  }
}

async function main(): Promise<void> {
  console.log('▸ Stelavox V1.x-F.3 — probe fixture seeder')
  const userId = await ensureProbeUser()
  console.log(`  probe user:   ${userId.slice(0, 8)}… (${PROBE_USER_EMAIL})`)
  const orgId = await getOrgId(userId)
  console.log(`  probe org:    ${orgId.slice(0, 8)}…`)

  if (reset) {
    console.log('  --reset: tearing down prior probe project + config pointers')
    await teardownExisting(orgId)
  }

  let projectId = await findExistingProject(orgId)
  if (projectId) {
    console.log(`  reusing existing probe project ${projectId.slice(0, 8)}… (pass --reset to recreate)`)
  } else {
    projectId = await createProject(orgId, userId)
    console.log(`  created project ${projectId.slice(0, 8)}…`)
  }

  // Find the existing probe document under the project (if reused).
  const { data: existingDocs } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', PROBE_DOCUMENT_NAME)
    .limit(1)

  let documentId: string
  let rootNodeId: string
  if (existingDocs && existingDocs.length > 0) {
    documentId = existingDocs[0].id
    const { data: root } = await admin
      .from('nodes')
      .select('id')
      .eq('document_id', documentId)
      .is('parent_id', null)
      .single()
    rootNodeId = root!.id
    console.log(`  reusing existing document ${documentId.slice(0, 8)}… + root ${rootNodeId.slice(0, 8)}…`)
  } else {
    const setup = await createDocument(projectId, orgId)
    documentId = setup.document_id
    rootNodeId = setup.root_node_id
    console.log(`  created document ${documentId.slice(0, 8)}… + root ${rootNodeId.slice(0, 8)}…`)
  }

  const { stackId, layers, maxIndex } = await getDocumentLayerStack(documentId)
  console.log(`  layer stack ${stackId.slice(0, 8)}…, max_index=${maxIndex} (${layers.length} layers)`)
  const layerType = (idx: number) => layers.find((l) => l.index === idx)!.node_type

  // Probe targets — find by name if present (idempotent), else create.
  const { data: expandExisting } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', documentId)
    .eq('name', EXPAND_TARGET_TITLE)
    .limit(1)
    .maybeSingle()

  let expandTargetId: string
  if (expandExisting) {
    expandTargetId = expandExisting.id
    // Defensive: clear any prior expand children so the probe runs on
    // an empty target.
    await admin.from('nodes').delete().eq('parent_id', expandTargetId)
    console.log(`  reusing expand target ${expandTargetId.slice(0, 8)}… (children cleared)`)
  } else {
    // Build root (layer 0) → Act (1) → Chapter (2). The expand target is
    // at layer maxIndex-1 so the expansion produces children at the leaf.
    const actLayerIndex = 1
    const chapterLayerIndex = Math.min(2, maxIndex - 1)

    const act = await insertChild(
      rootNodeId,
      documentId,
      orgId,
      projectId,
      actLayerIndex,
      1,
      layerType(actLayerIndex),
      '__probe_act_1',
      'Probe-only Act used as parent of the expand target chapter.',
      null,
      1,
    )
    const chapter = await insertChild(
      act.id,
      documentId,
      orgId,
      projectId,
      chapterLayerIndex,
      2,
      layerType(chapterLayerIndex),
      EXPAND_TARGET_TITLE,
      'A chapter that the synthetic probe expands into scenes. The probe inserts an agent_jobs expand row, awaits inline completion, and cleans up the generated children.',
      null,
      1,
    )
    expandTargetId = chapter.id
    console.log(`  created expand target ${expandTargetId.slice(0, 8)}…`)
  }

  // Refine target: a leaf Scene with prose populated.
  const { data: refineExisting } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', documentId)
    .eq('name', REFINE_TARGET_TITLE)
    .limit(1)
    .maybeSingle()

  let refineTargetId: string
  if (refineExisting) {
    refineTargetId = refineExisting.id
    // Defensive: reset prose to the canonical seed so probe runs start
    // from a known baseline.
    await admin
      .from('nodes')
      .update({
        summary: toTiptapDoc(REFINE_TARGET_SUMMARY),
        prose: toTiptapDoc(REFINE_TARGET_PROSE),
      })
      .eq('id', refineTargetId)
    console.log(`  reusing refine target ${refineTargetId.slice(0, 8)}… (prose reset to baseline)`)
  } else {
    // Leaf scene: a leaf is at the max layer. Build act → chapter →
    // scene (leaf). For minimal scope use a separate Act sibling.
    const actLayerIndex = 1
    const chapterLayerIndex = Math.min(2, maxIndex - 1)
    const sceneLayerIndex = maxIndex

    const act2 = await insertChild(
      rootNodeId,
      documentId,
      orgId,
      projectId,
      actLayerIndex,
      1,
      layerType(actLayerIndex),
      '__probe_act_2',
      'Probe-only Act parent of the refine target scene.',
      null,
      2,
    )
    const chapter2 = await insertChild(
      act2.id,
      documentId,
      orgId,
      projectId,
      chapterLayerIndex,
      2,
      layerType(chapterLayerIndex),
      '__probe_chapter_for_refine',
      'Probe-only chapter parent of the refine target scene.',
      null,
      1,
    )
    const scene = await insertChild(
      chapter2.id,
      documentId,
      orgId,
      projectId,
      sceneLayerIndex,
      sceneLayerIndex,
      layerType(sceneLayerIndex),
      REFINE_TARGET_TITLE,
      REFINE_TARGET_SUMMARY,
      REFINE_TARGET_PROSE,
      1,
    )
    refineTargetId = scene.id
    console.log(`  created refine target ${refineTargetId.slice(0, 8)}… (leaf scene with prose)`)
  }

  await writeFixtureConfig({
    'probe.fixture.organisation_id': orgId,
    'probe.fixture.document_id': documentId,
    'probe.fixture.expand_target_node_id': expandTargetId,
    'probe.fixture.refine_target_node_id': refineTargetId,
  })
  console.log('  platform_config fixture pointers written.')

  console.log('▸ Done. The V1.x-F.3 probes can now run end-to-end.')
}

main().catch((e: unknown) => {
  console.error('error:', e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
