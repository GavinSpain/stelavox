/**
 * Shadow Protocol corpus extractor.
 *
 * Reads from a Postgres database that has the May-13 Shadow Protocol
 * pre-V1.x-A.1 schema restored into it (scratch_may13) and writes a
 * self-contained JSON archive at:
 *
 *   fixtures/shadow-protocol/shadow_protocol_corpus_v1.json
 *
 * The archive is schema-agnostic and durable: it preserves the novel
 * content (109 nodes + 47 versions + 14 context links + layer stack),
 * stripped of fields that have changed shape in current schema
 * (nodes.locked / lock_reason / etc. dropped per Phase 6; status remapped
 * per Phase 6 D7).
 *
 * Usage:
 *   npm run script scripts/extract-shadow-protocol.ts
 *
 * Connection defaults to the local Supabase Postgres instance on port
 * 54332 with the scratch_may13 database. Override via env vars:
 *   SCRATCH_DB_HOST (default 127.0.0.1)
 *   SCRATCH_DB_PORT (default 54332)
 *   SCRATCH_DB_USER (default postgres)
 *   SCRATCH_DB_PASSWORD (default postgres)
 *   SCRATCH_DB_NAME (default scratch_may13)
 *   SHADOW_DOC_NAME (default 'Shadow Protocol')
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { Client } from 'pg'

const SCRATCH = {
  host: process.env.SCRATCH_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.SCRATCH_DB_PORT ?? 54332),
  user: process.env.SCRATCH_DB_USER ?? 'postgres',
  password: process.env.SCRATCH_DB_PASSWORD ?? 'postgres',
  database: process.env.SCRATCH_DB_NAME ?? 'scratch_may13',
}
const DOC_NAME = process.env.SHADOW_DOC_NAME ?? 'Shadow Protocol'
const OUTPUT_PATH = join(
  process.cwd(),
  'fixtures',
  'shadow-protocol',
  'shadow_protocol_corpus_v1.json',
)

interface ArchiveNode {
  id: string                           // original UUID — preserved for inter-row references
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
  summary: unknown | null              // Tiptap JSON doc
  prose: unknown | null
  notes: unknown | null
  metadata: Record<string, unknown>
  status: 'draft' | 'approved'         // remapped from old 4-state per Phase 6 D7
  status_original: string              // record what it was for forensics
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
  node_id: string                      // original UUID; remapped at seed time
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
  meta: {
    format_version: '1.0'
    source: string
    source_schema_era: string
    extracted_at: string
    description: string
  }
  project: {
    original_id: string
    name: string
  }
  document: {
    original_id: string
    name: string
    document_type: string
    description: string | null
    authors: string[]
    status: string
    root_node_original_id: string | null
  }
  layer_stack: {
    name: string
    document_type: string
    layers: unknown
  }
  nodes: ArchiveNode[]
  node_versions: ArchiveNodeVersion[]
  context_links: ArchiveContextLink[]
}

function remapStatus(old: string): { status: 'draft' | 'approved'; original: string } {
  // Phase 6 D7: enum reduces 4→2. 'in_review' + 'locked' both collapse to 'draft'.
  if (old === 'approved') return { status: 'approved', original: old }
  return { status: 'draft', original: old }
}

async function main() {
  const client = new Client(SCRATCH)
  await client.connect()

  console.log(`=== Shadow Protocol extractor ===`)
  console.log(`source: ${SCRATCH.host}:${SCRATCH.port}/${SCRATCH.database}`)
  console.log(`document: "${DOC_NAME}"\n`)

  // Step 1: locate the document.
  const docRow = await client.query<{
    id: string
    project_id: string
    organisation_id: string
    name: string
    document_type: string
    description: string | null
    authors: string[] | null
    status: string
    layer_stack_id: string | null
    root_node_id: string | null
  }>(
    `SELECT id, project_id, organisation_id, name, document_type, description, authors, status, layer_stack_id, root_node_id
     FROM public.documents WHERE name = $1`,
    [DOC_NAME],
  )
  if (docRow.rows.length === 0) {
    console.error(`error: no document named "${DOC_NAME}" found in ${SCRATCH.database}`)
    process.exit(1)
  }
  const doc = docRow.rows[0]
  console.log(`document.id: ${doc.id}`)
  console.log(`project.id:  ${doc.project_id}`)

  // Step 2: project.
  const projectRow = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.projects WHERE id = $1`,
    [doc.project_id],
  )
  if (projectRow.rows.length === 0) {
    console.error(`error: project ${doc.project_id} not found`)
    process.exit(1)
  }
  const project = projectRow.rows[0]
  console.log(`project.name: "${project.name}"`)

  // Step 3: layer_stack.
  const layerRow = await client.query<{ name: string; document_type: string; layers: unknown }>(
    `SELECT name, document_type, layers FROM public.layer_stacks WHERE id = $1`,
    [doc.layer_stack_id],
  )
  if (layerRow.rows.length === 0) {
    console.error(`error: layer_stack ${doc.layer_stack_id} not found`)
    process.exit(1)
  }
  const layerStack = layerRow.rows[0]
  const layersArr = Array.isArray(layerStack.layers) ? layerStack.layers : []
  console.log(`layer_stack: "${layerStack.name}" (${layersArr.length} layers)`)

  // Step 4: all nodes for this project (structural + context).
  const nodeRows = await client.query<{
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
    tags: string[] | null
    summary: unknown | null
    prose: unknown | null
    notes: unknown | null
    metadata: Record<string, unknown> | null
    status: string
    agent_instruction: string | null
    word_count_target: number | null
    word_count_actual: number | null
    mobile_notes: unknown
    export_include: boolean
    export_heading_override: string | null
    export_page_break_before: boolean
    external_ref: string | null
    content_revision: number
  }>(
    `SELECT id, parent_id, node_category, node_type, "order", depth, layer_index, scope, version,
            name, short_description, tags, summary, prose, notes, metadata, status,
            agent_instruction, word_count_target, word_count_actual, mobile_notes,
            export_include, export_heading_override, export_page_break_before, external_ref, content_revision
     FROM public.nodes WHERE project_id = $1
     ORDER BY depth, "order"`,
    [project.id],
  )
  console.log(`nodes: ${nodeRows.rows.length}`)

  const nodes: ArchiveNode[] = nodeRows.rows.map((r) => {
    const remap = remapStatus(r.status)
    return {
      id: r.id,
      parent_id: r.parent_id,
      node_category: r.node_category,
      node_type: r.node_type,
      order: r.order,
      depth: r.depth,
      layer_index: r.layer_index,
      scope: r.scope,
      version: r.version,
      name: r.name,
      short_description: r.short_description,
      tags: r.tags ?? [],
      summary: r.summary,
      prose: r.prose,
      notes: r.notes,
      metadata: r.metadata ?? {},
      status: remap.status,
      status_original: remap.original,
      agent_instruction: r.agent_instruction,
      word_count_target: r.word_count_target,
      word_count_actual: r.word_count_actual,
      mobile_notes: r.mobile_notes,
      export_include: r.export_include,
      export_heading_override: r.export_heading_override,
      export_page_break_before: r.export_page_break_before,
      external_ref: r.external_ref,
      content_revision: r.content_revision,
    }
  })

  // Step 5: node_versions for all the nodes in this project.
  const nodeIds = nodes.map((n) => n.id)
  const versionRows = await client.query<{
    id: string
    node_id: string
    version: number
    summary: unknown | null
    prose: unknown | null
    notes: unknown | null
    metadata: Record<string, unknown> | null
    changed_by: string
    change_reason: string | null
    content_revision: number | null
    created_at: Date
  }>(
    `SELECT id, node_id, version, summary, prose, notes, metadata, changed_by, change_reason, content_revision, created_at
     FROM public.node_versions WHERE node_id = ANY($1::uuid[])
     ORDER BY node_id, version`,
    [nodeIds],
  )
  const versions: ArchiveNodeVersion[] = versionRows.rows.map((v) => ({
    id: v.id,
    node_id: v.node_id,
    version: v.version,
    summary: v.summary,
    prose: v.prose,
    notes: v.notes,
    metadata: v.metadata ?? {},
    changed_by: v.changed_by,
    change_reason: v.change_reason,
    content_revision: v.content_revision,
    created_at: v.created_at.toISOString(),
  }))
  console.log(`node_versions: ${versions.length}`)

  // Step 6: context links (filter to those whose source AND target are in our node set).
  const linkRows = await client.query<{
    id: string
    source_node_id: string
    target_node_id: string
    link_type: 'structural_to_context' | 'context_to_context'
  }>(
    `SELECT id, source_node_id, target_node_id, link_type
     FROM public.node_context_links
     WHERE source_node_id = ANY($1::uuid[]) AND target_node_id = ANY($1::uuid[])`,
    [nodeIds],
  )
  const links: ArchiveContextLink[] = linkRows.rows.map((l) => ({
    id: l.id,
    source_node_id: l.source_node_id,
    target_node_id: l.target_node_id,
    link_type: l.link_type,
  }))
  console.log(`context_links: ${links.length}`)

  // Step 7: write archive.
  const archive: Archive = {
    meta: {
      format_version: '1.0',
      source: 'snapshots/stelavox_local_2026-05-13_pre_v1x_a1_rework.dump',
      source_schema_era: 'pre-V1.x-A.1 (May 13, 2026)',
      extracted_at: new Date().toISOString(),
      description:
        'Shadow Protocol — half-written novel + context nodes; the canonical agent-testing corpus from Phase 5d / V1.x-LB / Round-3 launch-standard testing. Preserved as schema-agnostic JSON ahead of Phase 7 close-out.',
    },
    project: {
      original_id: project.id,
      name: project.name,
    },
    document: {
      original_id: doc.id,
      name: doc.name,
      document_type: doc.document_type,
      description: doc.description,
      authors: doc.authors ?? [],
      status: doc.status,
      root_node_original_id: doc.root_node_id,
    },
    layer_stack: {
      name: layerStack.name,
      document_type: layerStack.document_type,
      layers: layerStack.layers,
    },
    nodes,
    node_versions: versions,
    context_links: links,
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(archive, null, 2))

  console.log(`\n=== archive written ===`)
  console.log(`path: ${OUTPUT_PATH}`)
  console.log(`size: ${(JSON.stringify(archive).length / 1024).toFixed(1)} KB`)

  // Step 8: breakdown summary.
  const structural = nodes.filter((n) => n.node_category === 'structural').length
  const context = nodes.filter((n) => n.node_category === 'context').length
  const withProse = nodes.filter((n) => n.prose != null).length
  console.log(`\nbreakdown:`)
  console.log(`  structural nodes:    ${structural}`)
  console.log(`  context nodes:       ${context}`)
  console.log(`  nodes with prose:    ${withProse}`)
  console.log(`  node versions:       ${versions.length}`)
  console.log(`  context links:       ${links.length}`)
  console.log(`  layer stack layers:  ${layersArr.length}`)

  await client.end()
}

main().catch((err) => {
  console.error('\nextraction failed:')
  console.error(err)
  process.exit(1)
})
