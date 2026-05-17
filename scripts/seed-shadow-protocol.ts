/**
 * Shadow Protocol corpus seeder.
 *
 * Reads fixtures/shadow-protocol/shadow_protocol_corpus_v1.json and
 * rehydrates the Shadow Protocol novel into the current-schema live
 * database as `author@stelavox.local`.
 *
 * Usage:
 *   npm run script scripts/seed-shadow-protocol.ts
 *   npm run script scripts/seed-shadow-protocol.ts --reset
 *
 * Without --reset, refuses if a project named "Shadow Protocol" already
 * exists for the test user. --reset deletes the existing project (and
 * its document + nodes via FK cascade) before reseeding.
 *
 * Pattern mirrors scripts/seed-director-fixture.ts.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const ARCHIVE_PATH = join(
  process.cwd(),
  'fixtures',
  'shadow-protocol',
  'shadow_protocol_corpus_v1.json',
)
const TEST_EMAIL = 'author@stelavox.local'
const TEST_PASSWORD = 'Test1234!Test1234!'

interface ArchiveNode {
  id: string
  parent_id: string | null
  node_category: 'structural' | 'context'
  node_type: string
  order: number
  depth: number
  layer_index: number | null
  scope: 'project' | 'document' | null
  version: number
  name: string | null
  short_description: string | null
  tags: string[]
  summary: unknown | null
  prose: unknown | null
  notes: unknown | null
  metadata: Record<string, unknown>
  status: 'draft' | 'approved'
  status_original: string
  agent_instruction: string | null
  word_count_target: number | null
  word_count_actual: number | null
  mobile_notes: unknown
  export_include: boolean
  export_heading_override: string | null
  export_page_break_before: boolean
  external_ref: string | null
  content_revision: number
}

interface ArchiveNodeVersion {
  id: string
  node_id: string
  version: number
  summary: unknown | null
  prose: unknown | null
  notes: unknown | null
  metadata: Record<string, unknown>
  changed_by: string
  change_reason: string | null
  content_revision: number | null
  created_at: string
}

interface ArchiveContextLink {
  id: string
  source_node_id: string
  target_node_id: string
  link_type: 'structural_to_context' | 'context_to_context'
}

interface Archive {
  meta: { format_version: string; source: string; extracted_at: string }
  project: { original_id: string; name: string }
  document: {
    original_id: string
    name: string
    document_type: string
    description: string | null
    authors: string[]
    status: string
    root_node_original_id: string | null
  }
  layer_stack: { name: string; document_type: string; layers: unknown }
  nodes: ArchiveNode[]
  node_versions: ArchiveNodeVersion[]
  context_links: ArchiveContextLink[]
}

function parseArgs(): { reset: boolean } {
  const args = process.argv.slice(2)
  return { reset: args.includes('--reset') }
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
    process.exit(1)
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

async function ensureTestUser(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<{ user_id: string; created: boolean }> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const existing = (list?.users ?? []).find((u) => u.email === email)
  if (existing) return { user_id: existing.id, created: false }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: email.split('@')[0] },
  })
  if (error || !data?.user) {
    console.error('error: failed to create test user:', error?.message)
    process.exit(1)
  }
  // Brief wait for the H-03 trigger to create the organisation + membership.
  await new Promise((r) => setTimeout(r, 500))
  return { user_id: data.user.id, created: true }
}

async function getUserOrg(admin: SupabaseClient, user_id: string): Promise<string> {
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user_id)
    .single()
  if (!data) {
    console.error('error: user has no organisation_members row — H-03 trigger may have failed')
    process.exit(1)
  }
  return data.organisation_id
}

async function deletePriorProject(
  admin: SupabaseClient,
  organisation_id: string,
  project_name: string,
): Promise<number> {
  const { data: priors } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', organisation_id)
    .eq('name', project_name)
  const ids = (priors ?? []).map((p) => p.id)
  if (ids.length === 0) return 0
  const { error } = await admin.from('projects').delete().in('id', ids)
  if (error) {
    console.error('error: failed to delete prior project(s):', error.message)
    process.exit(1)
  }
  return ids.length
}

async function main() {
  const { reset } = parseArgs()
  const admin = adminClient()
  const archive: Archive = JSON.parse(readFileSync(ARCHIVE_PATH, 'utf-8'))

  console.log(`=== Shadow Protocol seeder ===`)
  console.log(`archive: ${archive.meta.source}`)
  console.log(`archive format: ${archive.meta.format_version}`)
  console.log(`extracted at: ${archive.meta.extracted_at}\n`)

  // Step 1: ensure test user.
  const { user_id, created } = await ensureTestUser(admin, TEST_EMAIL, TEST_PASSWORD)
  console.log(`user ${TEST_EMAIL}: ${created ? 'created' : 'already existed'} (id ${user_id.slice(0, 8)}…)`)

  // Step 2: get user's organisation.
  const organisation_id = await getUserOrg(admin, user_id)
  console.log(`organisation: ${organisation_id.slice(0, 8)}…`)

  // Step 3: handle existing project.
  if (reset) {
    const deleted = await deletePriorProject(admin, organisation_id, archive.project.name)
    console.log(`prior projects deleted: ${deleted}`)
  } else {
    const { data: priors } = await admin
      .from('projects')
      .select('id')
      .eq('organisation_id', organisation_id)
      .eq('name', archive.project.name)
    if ((priors ?? []).length > 0) {
      console.error(`\nerror: project "${archive.project.name}" already exists for this user.`)
      console.error('       re-run with --reset to delete and recreate.\n')
      process.exit(1)
    }
  }

  // Step 4: create project.
  const { data: project, error: projectError } = await admin
    .from('projects')
    .insert({ organisation_id, name: archive.project.name })
    .select('id')
    .single()
  if (projectError || !project) {
    console.error('error: failed to create project:', projectError?.message)
    process.exit(1)
  }
  console.log(`project: ${project.id.slice(0, 8)}…`)

  // Step 5: create document via RPC (auto-creates project_profile + layer_stack + root_node).
  const { data: rpc, error: rpcError } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project.id,
    p_organisation_id: organisation_id,
    p_name: archive.document.name,
    p_description: archive.document.description,
    p_document_type: archive.document.document_type,
    p_authors: archive.document.authors,
  })
  if (rpcError || !rpc) {
    console.error('error: create_document_with_layer_stack failed:', rpcError?.message)
    process.exit(1)
  }
  const setup = rpc as { document: { id: string; name: string }; root_node: { id: string }; layer_stack: { id: string } }
  const document_id = setup.document.id
  const auto_root_node_id = setup.root_node.id
  const layer_stack_id = setup.layer_stack.id
  console.log(`document: ${document_id.slice(0, 8)}… ("${setup.document.name}")`)
  console.log(`auto-created root node: ${auto_root_node_id.slice(0, 8)}… (will be replaced)`)

  // Step 6: replace layer_stack.layers with archive layers (in case defaults differ).
  const { error: layerError } = await admin
    .from('layer_stacks')
    .update({ layers: archive.layer_stack.layers, name: archive.layer_stack.name })
    .eq('id', layer_stack_id)
  if (layerError) {
    console.error('error: failed to update layer_stack:', layerError.message)
    process.exit(1)
  }
  console.log(`layer_stack: updated to "${archive.layer_stack.name}"`)

  // Step 7: identify archive root and build the old→new UUID remap.
  // The archive's root node is the structural node with parent_id === null and depth 0.
  const archiveRoot = archive.nodes.find((n) => n.parent_id === null && n.node_category === 'structural' && n.depth === 0)
  if (!archiveRoot) {
    console.error('error: archive has no root structural node (parent_id IS NULL, depth=0)')
    process.exit(1)
  }
  console.log(`archive root: ${archiveRoot.id.slice(0, 8)}… ("${archiveRoot.name}", ${archiveRoot.node_type})`)

  // Remap: archive root → auto-created root (so documents.root_node_id stays valid).
  // All other nodes get fresh UUIDs at insert time (we leave id undefined and let DB generate).
  const oldToNew = new Map<string, string>()
  oldToNew.set(archiveRoot.id, auto_root_node_id)

  // Update the auto-created root with the archive root's content + properties.
  const { error: rootUpdateError } = await admin
    .from('nodes')
    .update({
      node_type: archiveRoot.node_type,
      order: archiveRoot.order,
      depth: archiveRoot.depth,
      layer_index: archiveRoot.layer_index,
      version: archiveRoot.version,
      name: archiveRoot.name,
      short_description: archiveRoot.short_description,
      tags: archiveRoot.tags,
      summary: archiveRoot.summary,
      prose: archiveRoot.prose,
      notes: archiveRoot.notes,
      metadata: archiveRoot.metadata,
      status: archiveRoot.status,
      agent_instruction: archiveRoot.agent_instruction,
      word_count_target: archiveRoot.word_count_target,
      word_count_actual: archiveRoot.word_count_actual,
      mobile_notes: archiveRoot.mobile_notes,
      export_include: archiveRoot.export_include,
      export_heading_override: archiveRoot.export_heading_override,
      export_page_break_before: archiveRoot.export_page_break_before,
      external_ref: archiveRoot.external_ref,
      content_revision: archiveRoot.content_revision,
    })
    .eq('id', auto_root_node_id)
  if (rootUpdateError) {
    console.error('error: failed to update root node with archive content:', rootUpdateError.message)
    process.exit(1)
  }

  // Step 8: insert all non-root nodes in topological order (parents before children).
  // Structural nodes first (sorted by depth then order so parents always exist).
  // Context nodes have no parent_id; insert them last with no dependency on order.
  const structuralNonRoot = archive.nodes
    .filter((n) => n.node_category === 'structural' && n.id !== archiveRoot.id)
    .sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : a.order - b.order))
  const contextNodes = archive.nodes.filter((n) => n.node_category === 'context')

  for (const n of structuralNonRoot) {
    const newParentId = n.parent_id ? oldToNew.get(n.parent_id) : null
    if (n.parent_id && !newParentId) {
      console.error(`error: parent ${n.parent_id.slice(0, 8)}… not yet inserted for node ${n.id.slice(0, 8)}… (${n.name ?? n.node_type})`)
      process.exit(1)
    }
    const insert = {
      organisation_id,
      project_id: project.id,
      document_id,
      parent_id: newParentId,
      node_category: n.node_category,
      node_type: n.node_type,
      order: n.order,
      depth: n.depth,
      layer_index: n.layer_index,
      scope: n.scope,
      version: n.version,
      name: n.name,
      short_description: n.short_description,
      tags: n.tags,
      summary: n.summary,
      prose: n.prose,
      notes: n.notes,
      metadata: n.metadata,
      status: n.status,
      agent_instruction: n.agent_instruction,
      word_count_target: n.word_count_target,
      word_count_actual: n.word_count_actual,
      mobile_notes: n.mobile_notes,
      export_include: n.export_include,
      export_heading_override: n.export_heading_override,
      export_page_break_before: n.export_page_break_before,
      external_ref: n.external_ref,
      content_revision: n.content_revision,
    }
    const { data: row, error: insertError } = await admin
      .from('nodes')
      .insert(insert)
      .select('id')
      .single()
    if (insertError || !row) {
      console.error(`error: insert failed for ${n.id.slice(0, 8)}… (${n.name ?? n.node_type}):`, insertError?.message)
      process.exit(1)
    }
    oldToNew.set(n.id, row.id)
  }
  console.log(`structural nodes inserted: ${structuralNonRoot.length} (+ 1 root = ${structuralNonRoot.length + 1})`)

  // Context nodes — no parent_id, no document_id (they're project-scoped per nodes_scope_check).
  for (const n of contextNodes) {
    const insert = {
      organisation_id,
      project_id: project.id,
      document_id: n.scope === 'document' ? document_id : null,
      parent_id: null,
      node_category: n.node_category,
      node_type: n.node_type,
      order: n.order,
      depth: n.depth,
      layer_index: n.layer_index,
      scope: n.scope,
      version: n.version,
      name: n.name,
      short_description: n.short_description,
      tags: n.tags,
      summary: n.summary,
      prose: n.prose,
      notes: n.notes,
      metadata: n.metadata,
      status: n.status,
      agent_instruction: n.agent_instruction,
      word_count_target: n.word_count_target,
      word_count_actual: n.word_count_actual,
      mobile_notes: n.mobile_notes,
      export_include: n.export_include,
      export_heading_override: n.export_heading_override,
      export_page_break_before: n.export_page_break_before,
      external_ref: n.external_ref,
      content_revision: n.content_revision,
    }
    const { data: row, error: insertError } = await admin
      .from('nodes')
      .insert(insert)
      .select('id')
      .single()
    if (insertError || !row) {
      console.error(`error: context node insert failed for ${n.id.slice(0, 8)}… (${n.name}):`, insertError?.message)
      process.exit(1)
    }
    oldToNew.set(n.id, row.id)
  }
  console.log(`context nodes inserted: ${contextNodes.length}`)

  // Step 9: insert node_versions with remapped node_id.
  let versionCount = 0
  for (const v of archive.node_versions) {
    const newNodeId = oldToNew.get(v.node_id)
    if (!newNodeId) {
      console.warn(`  warning: skipping node_version for unknown node ${v.node_id.slice(0, 8)}…`)
      continue
    }
    const insert = {
      node_id: newNodeId,
      organisation_id,
      version: v.version,
      summary: v.summary,
      prose: v.prose,
      notes: v.notes,
      metadata: v.metadata,
      changed_by: v.changed_by,
      change_reason: v.change_reason,
      content_revision: v.content_revision,
    }
    const { error: insertError } = await admin.from('node_versions').insert(insert)
    if (insertError) {
      console.error(`error: node_version insert failed:`, insertError.message)
      process.exit(1)
    }
    versionCount++
  }
  console.log(`node_versions inserted: ${versionCount}`)

  // Step 10: insert context_links with remapped source/target.
  let linkCount = 0
  for (const l of archive.context_links) {
    const newSourceId = oldToNew.get(l.source_node_id)
    const newTargetId = oldToNew.get(l.target_node_id)
    if (!newSourceId || !newTargetId) {
      console.warn(`  warning: skipping context_link with unknown source/target`)
      continue
    }
    const insert = {
      organisation_id,
      source_node_id: newSourceId,
      target_node_id: newTargetId,
      link_type: l.link_type,
    }
    const { error: insertError } = await admin.from('node_context_links').insert(insert)
    if (insertError) {
      console.error(`error: context_link insert failed:`, insertError.message)
      process.exit(1)
    }
    linkCount++
  }
  console.log(`context_links inserted: ${linkCount}`)

  // Step 11: print credentials + summary.
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
  console.log('\n=== seed complete ===')
  console.log(`\nlog in at: ${appUrl}/login`)
  console.log(`  email:    ${TEST_EMAIL}`)
  console.log(`  password: ${TEST_PASSWORD}`)
  console.log(`\nproject: "${archive.project.name}"`)
  console.log(`document: "${archive.document.name}"`)
  console.log(`document id: ${document_id}`)
  console.log(`\nbreakdown:`)
  console.log(`  structural nodes:  ${structuralNonRoot.length + 1}`)
  console.log(`  context nodes:     ${contextNodes.length}`)
  console.log(`  node versions:     ${versionCount}`)
  console.log(`  context links:     ${linkCount}`)
}

main().catch((err) => {
  console.error('\nseed failed with error:')
  console.error(err)
  process.exit(1)
})
