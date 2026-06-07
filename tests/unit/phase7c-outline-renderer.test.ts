/**
 * Phase 7.C unit tests — Outline (Markdown) renderer.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { renderOutline } from '@/lib/export/outline'
import { walkDocument } from '@/lib/export/tree-walker'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

interface Fixture {
  organisationId: string
  projectId: string
  documentId: string
  ownerUserId: string
  rootNodeId: string
  actId: string
  chapterId: string
  sceneId: string
}

let fix: Fixture | null = null
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('Phase 7.C renderOutline', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()

    const { data: u1 } = await svc.auth.admin.createUser({
      email: `phase7c-${Date.now()}@stelavox.test`,
      password: 'TestPhase7C!',
      email_confirm: true,
    })
    const ownerUserId = u1.user!.id

    let r = await svc.from('organisations').insert({
      id: orgId, name: 'P7C test', slug: `phase7c-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({
      organisation_id: orgId, user_id: ownerUserId, role: 'owner',
    })
    if (r.error) throw new Error(`member: ${r.error.message}`)
    r = await svc.from('projects').insert({
      id: projectId, organisation_id: orgId, name: 'P7C Project',
    })
    if (r.error) throw new Error(`project: ${r.error.message}`)

    const { data: docResult, error: docErr } = await svc.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: projectId, p_organisation_id: orgId,
        p_name: 'The Mars Series — Book 1', p_description: '',
        p_document_type: 'novel', p_authors: [],
      },
    )
    if (docErr) throw new Error(`doc: ${docErr.message}`)
    const docId = (docResult as { document: { id: string } }).document.id
    const rootId = (docResult as { root_node: { id: string } }).root_node.id

    const actId = crypto.randomUUID()
    const chapterId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    r = await svc.from('nodes').insert([
      {
        id: actId, organisation_id: orgId, project_id: projectId,
        document_id: docId, node_category: 'structural', node_type: 'act',
        parent_id: rootId, order: 1, depth: 1, layer_index: 1,
        name: 'Act 1: The Departure',
        summary: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The crew leaves Earth.' }] },
        ]}),
        status: 'draft', word_count_target: 30000,
      },
      {
        id: chapterId, organisation_id: orgId, project_id: projectId,
        document_id: docId, node_category: 'structural', node_type: 'chapter',
        parent_id: actId, order: 1, depth: 2, layer_index: 2,
        name: 'Chapter 1: The Letter',
        summary: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A mysterious letter arrives.' }] },
        ]}),
        status: 'approved', word_count_target: 4000,
      },
      {
        id: sceneId, organisation_id: orgId, project_id: projectId,
        document_id: docId, node_category: 'structural', node_type: 'scene',
        parent_id: chapterId, order: 1, depth: 3, layer_index: 3,
        name: 'At the door',
        summary: JSON.stringify({ type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'The postman knocks.' }] },
        ]}),
        status: 'draft', word_count_target: 800,
      },
    ])
    if (r.error) throw new Error(`structural nodes: ${r.error.message}`)

    fix = {
      organisationId: orgId, projectId, documentId: docId,
      ownerUserId, rootNodeId: rootId, actId, chapterId, sceneId,
    }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  async function noopProgress(_name: string | null): Promise<void> {}

  it('renders document title as H1', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(walked.blocks, walked, {}, noopProgress)
    expect(out).toMatch(/^# The Mars Series — Book 1/)
  })

  it('renders Act / Chapter / Scene with bracketed layer labels', async () => {
    // 2026-06-07 — the renderer prefixes each structural line with the
    // canonical bracketed-monospace layer label (`[Act 1]`, `[Ch 1]`,
    // `[Sc 1]`) instead of the old `##` / `###` / `####` headings.
    // Document title stays `# Name`.
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(walked.blocks, walked, {}, noopProgress)
    expect(out).toMatch(/^\[Act 1\] Act 1: The Departure/m)
    expect(out).toMatch(/^\[Ch 1\] Chapter 1: The Letter/m)
    expect(out).toMatch(/^\[Sc 1\] At the door/m)
    // And no Markdown headings should creep into structural lines.
    expect(out).not.toMatch(/^## Act/m)
    expect(out).not.toMatch(/^### Chapter/m)
  })

  it('renders summary as blockquote', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(walked.blocks, walked, {}, noopProgress)
    expect(out).toContain('> The crew leaves Earth.')
    expect(out).toContain('> A mysterious letter arrives.')
    expect(out).toContain('> The postman knocks.')
  })

  it('honours max_depth — only Acts when max_depth=1', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(walked.blocks, walked, { max_depth: 1 }, noopProgress)
    expect(out).toMatch(/^\[Act 1\] Act 1/m)
    expect(out).not.toMatch(/^\[Ch /m)
    expect(out).not.toMatch(/^\[Sc /m)
  })

  it('honours include_word_count_target toggle', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(
      walked.blocks, walked, { include_word_count_target: true }, noopProgress,
    )
    expect(out).toContain('[target: 4,000 words]')
    expect(out).toContain('[target: 800 words]')
  })

  it('honours include_status toggle', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const out = await renderOutline(
      walked.blocks, walked, { include_status: true }, noopProgress,
    )
    expect(out).toContain('[✓] Chapter 1: The Letter')   // approved
    expect(out).toContain('[ ] Act 1: The Departure')    // draft
  })

  it('emits per-chapter progress events', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const events: (string | null)[] = []
    await renderOutline(
      walked.blocks, walked, {},
      async name => { events.push(name) },
    )
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events.some(e => e?.includes('Chapter') || e?.includes('Letter'))).toBe(true)
  })
})
