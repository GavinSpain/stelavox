/**
 * Phase 7.B unit tests — JSON export renderer.
 *
 * Exercises the renderer against a seeded test document. Validates
 * the backup-format v1.0 shape, the inclusion of full version history,
 * and the deliberate exclusions per D9.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { renderJson } from '@/lib/export/json'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

interface Fixture {
  organisationId: string
  projectId: string
  documentId: string
  ownerUserId: string
  rootNodeId: string
  chapter1Id: string
}

let fix: Fixture | null = null
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('Phase 7.B renderJson', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()

    const { data: u1 } = await svc.auth.admin.createUser({
      email: `phase7b-${Date.now()}@stelavox.test`,
      password: 'TestPhase7B!',
      email_confirm: true,
    })
    const ownerUserId = u1.user!.id

    let r = await svc.from('organisations').insert({
      id: orgId, name: 'P7B test', slug: `phase7b-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({
      organisation_id: orgId, user_id: ownerUserId, role: 'owner',
    })
    if (r.error) throw new Error(`member: ${r.error.message}`)
    r = await svc.from('projects').insert({
      id: projectId, organisation_id: orgId, name: 'P7B Project',
    })
    if (r.error) throw new Error(`project: ${r.error.message}`)

    const { data: docResult, error: docErr } = await svc.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: projectId, p_organisation_id: orgId,
        p_name: 'P7B Doc', p_description: '',
        p_document_type: 'novel', p_authors: [],
      },
    )
    if (docErr) throw new Error(`doc: ${docErr.message}`)
    const docId = (docResult as { document: { id: string } }).document.id
    const rootId = (docResult as { root_node: { id: string } }).root_node.id

    // Add an Act + Chapter under the root
    const actId = crypto.randomUUID()
    const chapterId = crypto.randomUUID()
    r = await svc.from('nodes').insert([
      {
        id: actId, organisation_id: orgId, project_id: projectId,
        document_id: docId, node_category: 'structural', node_type: 'act',
        parent_id: rootId, order: 1, depth: 1, layer_index: 1, name: 'Act 1',
        summary: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The Departure' }] },
        ]}),
      },
      {
        id: chapterId, organisation_id: orgId, project_id: projectId,
        document_id: docId, node_category: 'structural', node_type: 'chapter',
        parent_id: actId, order: 1, depth: 2, layer_index: 2,
        name: 'Chapter 1: The Letter',
        prose: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A mysterious letter arrived at dawn.' }] },
        ]}),
      },
    ])
    if (r.error) throw new Error(`structural nodes: ${r.error.message}`)

    // Insert a couple of node_versions to exercise version-history inclusion
    r = await svc.from('node_versions').insert([
      {
        node_id: chapterId, organisation_id: orgId, version: 1,
        summary: null,
        prose: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        notes: null, metadata: {},
        changed_by: ownerUserId, change_reason: 'autosave',
      },
      {
        node_id: chapterId, organisation_id: orgId, version: 2,
        summary: null,
        prose: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A mysterious letter arrived at dawn.' }] },
        ]}),
        notes: null, metadata: {},
        changed_by: ownerUserId, change_reason: 'autosave',
      },
    ])
    if (r.error) throw new Error(`node_versions: ${r.error.message}`)

    fix = {
      organisationId: orgId, projectId, documentId: docId,
      ownerUserId, rootNodeId: rootId, chapter1Id: chapterId,
    }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  async function noopProgress(_name: string | null): Promise<void> {}

  it('produces parseable JSON with backup-format v1.0 marker', async () => {
    if (!fix) throw new Error('no fixture')
    const out = await renderJson(svc, fix.documentId, noopProgress)
    expect(typeof out).toBe('string')
    const parsed = JSON.parse(out) as Record<string, unknown>
    expect(parsed.stelavox_backup).toBeDefined()
    const backup = parsed.stelavox_backup as Record<string, unknown>
    expect(backup.version).toBe('1.0')
    expect(backup.document_id).toBe(fix.documentId)
    expect(typeof backup.created_at).toBe('string')
  })

  it('includes top-level expected keys', async () => {
    if (!fix) throw new Error('no fixture')
    const out = await renderJson(svc, fix.documentId, noopProgress)
    const parsed = JSON.parse(out) as Record<string, unknown>
    const keys = Object.keys(parsed).sort()
    expect(keys).toEqual([
      'context_links',
      'context_nodes_referenced',
      'document',
      'layer_stack',
      'node_author_locks',
      'node_comments',
      'node_versions',
      'nodes',
      'stelavox_backup',
    ])
  })

  it('includes all structural nodes for the document', async () => {
    if (!fix) throw new Error('no fixture')
    const out = await renderJson(svc, fix.documentId, noopProgress)
    const parsed = JSON.parse(out) as { nodes: { id: string }[] }
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(3)  // root + act + chapter
    expect(parsed.nodes.some(n => n.id === fix!.rootNodeId)).toBe(true)
    expect(parsed.nodes.some(n => n.id === fix!.chapter1Id)).toBe(true)
  })

  it('includes full node_versions history (D9)', async () => {
    if (!fix) throw new Error('no fixture')
    const out = await renderJson(svc, fix.documentId, noopProgress)
    const parsed = JSON.parse(out) as { node_versions: { node_id: string; version: number }[] }
    const chapterVersions = parsed.node_versions.filter(v => v.node_id === fix!.chapter1Id)
    expect(chapterVersions.length).toBe(2)
    expect(chapterVersions.map(v => v.version).sort()).toEqual([1, 2])
  })

  it('emits a progress event during the render', async () => {
    if (!fix) throw new Error('no fixture')
    const events: (string | null)[] = []
    await renderJson(svc, fix.documentId, async (name) => { events.push(name) })
    expect(events.length).toBeGreaterThan(0)
  })

  it('throws on missing document', async () => {
    await expect(
      renderJson(svc, '00000000-0000-0000-0000-000000000000', noopProgress),
    ).rejects.toThrow(/document_not_found/)
  })
})
