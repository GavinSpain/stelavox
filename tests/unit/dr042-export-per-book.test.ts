/**
 * DR-042 — per-book export + Markdown manuscript.
 *
 * Pins: (1) the subtree-scoped walk emits only a Book's subtree;
 * (2) the whole-document walk emits all books; (3) the Markdown renderer
 * emits headings + final prose, no history/ids; (4) extractProseParagraphs
 * is correct (pure).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { walkDocument } from '@/lib/export/tree-walker'
import { renderMarkdown, extractProseParagraphs } from '@/lib/export/markdown'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

function proseDoc(text: string) {
  return JSON.stringify({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ] })
}

interface Fix {
  organisationId: string
  documentId: string
  ownerUserId: string
  book1Id: string
  book2Id: string
}
let fix: Fix | null = null

describe('extractProseParagraphs (pure)', () => {
  it('pulls paragraph text and drops empty paragraphs', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First.' }] },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] },
    ] }
    expect(extractProseParagraphs(doc)).toEqual(['First.', 'Second.'])
  })
  it('returns [] for empty / null', () => {
    expect(extractProseParagraphs(null)).toEqual([])
    expect(extractProseParagraphs({ type: 'doc', content: [] })).toEqual([])
  })
  it('parses a JSON string body', () => {
    expect(extractProseParagraphs(proseDoc('Hello world.'))).toEqual(['Hello world.'])
  })
})

describe.skipIf(!hasServiceKey)('DR-042 per-book walk + Markdown', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    const { data: u1 } = await svc.auth.admin.createUser({
      email: `dr042-${Date.now()}@stelavox.test`, password: 'TestDR042!', email_confirm: true,
    })
    const ownerUserId = u1.user!.id

    let r = await svc.from('organisations').insert({
      id: orgId, name: 'DR042 test', slug: `dr042-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({ organisation_id: orgId, user_id: ownerUserId, role: 'owner' })
    if (r.error) throw new Error(`member: ${r.error.message}`)
    r = await svc.from('projects').insert({ id: projectId, organisation_id: orgId, name: 'DR042 Project' })
    if (r.error) throw new Error(`project: ${r.error.message}`)

    // Series document — create_document_with_layer_stack gives the Series root.
    const { data: docResult, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
      p_project_id: projectId, p_organisation_id: orgId,
      p_name: 'The Tidewright Cycle', p_description: '',
      p_document_type: 'series', p_authors: [],
    })
    if (docErr) throw new Error(`doc: ${docErr.message}`)
    const docId = (docResult as { document: { id: string } }).document.id
    const rootId = (docResult as { root_node: { id: string } }).root_node.id

    // Two books, each Book → Act → Chapter → Scene(prose).
    function bookSubtree(bookId: string, order: number, bookName: string, prose: string) {
      const actId = crypto.randomUUID(), chId = crypto.randomUUID(), scId = crypto.randomUUID()
      const base = { organisation_id: orgId, project_id: projectId, document_id: docId, node_category: 'structural', status: 'draft' }
      return [
        { ...base, id: bookId, node_type: 'book', parent_id: rootId, order, depth: 1, layer_index: 1, name: bookName },
        { ...base, id: actId, node_type: 'act', parent_id: bookId, order: 1, depth: 2, layer_index: 2, name: 'Act 1' },
        { ...base, id: chId, node_type: 'chapter', parent_id: actId, order: 1, depth: 3, layer_index: 3, name: 'Chapter 1' },
        { ...base, id: scId, node_type: 'scene', parent_id: chId, order: 1, depth: 4, layer_index: 4, name: 'Scene 1', prose: proseDoc(prose) },
      ]
    }
    const book1Id = crypto.randomUUID(), book2Id = crypto.randomUUID()
    r = await svc.from('nodes').insert([
      ...bookSubtree(book1Id, 1, 'Saltbound', 'Book one prose alpha.'),
      ...bookSubtree(book2Id, 2, 'The Drowned Court', 'Book two prose beta.'),
    ])
    if (r.error) throw new Error(`nodes: ${r.error.message}`)

    fix = { organisationId: orgId, documentId: docId, ownerUserId, book1Id, book2Id }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  async function noop(_n: string | null): Promise<void> {}

  it('whole-document walk includes both books', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const text = walked.blocks.map(b => b.text ?? '').join(' ')
    expect(text).toContain('Book one prose alpha.')
    expect(text).toContain('Book two prose beta.')
  })

  it('subtree walk (rootNodeId=book1) includes ONLY book 1', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId, { rootNodeId: fix.book1Id })
    const text = walked.blocks.map(b => b.text ?? '').join(' ')
    expect(text).toContain('Book one prose alpha.')
    expect(text).not.toContain('Book two prose beta.')
  })

  it('Markdown renderer emits the title + final prose, scoped to a book', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId, { rootNodeId: fix.book1Id })
    const md = await renderMarkdown(walked, {}, noop, 'The Tidewright Cycle', fix.book1Id)
    expect(md).toMatch(/^# The Tidewright Cycle/)
    expect(md).toContain('## Saltbound')        // book heading
    expect(md).toContain('Book one prose alpha.')
    expect(md).not.toContain('Book two prose beta.')
    // No history / internal ids leak into the manuscript.
    expect(md).not.toMatch(/node_version|organisation_id|"id":/)
  })

  it('Markdown whole-document includes both books', async () => {
    if (!fix) throw new Error('no fixture')
    const walked = await walkDocument(svc, fix.documentId)
    const md = await renderMarkdown(walked, {}, noop, 'The Tidewright Cycle', null)
    expect(md).toContain('## Saltbound')
    expect(md).toContain('## The Drowned Court')
    expect(md).toContain('Book one prose alpha.')
    expect(md).toContain('Book two prose beta.')
  })
})
