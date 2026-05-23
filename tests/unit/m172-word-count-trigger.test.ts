/**
 * M-172 — word_count_actual trigger + tiptap_word_count() SQL function.
 *
 * Layer-1/2/3 tests against the four-layer methodology (feedback memory
 * 2026-05-18). The layer-4 big-picture pass is in the migration's
 * commit message + Tier-A amendment (TA hazard candidate H-26).
 *
 * Layer 1 — pure-function unit tests on tiptap_word_count() over:
 *           NULL, empty doc, single word, plain string scalar, unicode
 *           whitespace, large doc.
 *
 * Layer 2 — N/A (this is a SQL function + trigger, not a Director tool).
 *
 * Layer 3 — invariant tests asserting word_count_actual = countWords(prose)
 *           after every write path: INSERT, UPDATE prose, UPDATE other
 *           field (no recompute), prose → NULL, prose → empty doc.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

interface Fixture {
  orgId: string
  projectId: string
  documentId: string
  layerStackId: string
  rootNodeId: string
  chapterId: string
  ownerUserId: string
}

let fix: Fixture | null = null

function tiptapDoc(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function multiParaTiptap(paragraphs: string[]) {
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  }
}

async function callTiptapWordCount(doc: unknown): Promise<number> {
  const { data, error } = await svc.rpc('tiptap_word_count', { doc })
  if (error) throw new Error(error.message)
  return data as number
}

describe.skipIf(!hasServiceKey)('M-172 tiptap_word_count() — layer 1 pure-function tests', () => {
  beforeAll(async () => {
    // Expose the function via temporary RPC-style wrapper. The function
    // is callable directly because PostgREST exposes any non-trigger
    // SQL function — but Supabase's rpc() helper expects the function
    // to be marked as such. Confirm shape works.
    const { error } = await svc.rpc('tiptap_word_count', { doc: null })
    if (error) {
      throw new Error(`tiptap_word_count not exposed via RPC: ${error.message}. Layer-1 tests need the function to be callable.`)
    }
  })

  it('returns 0 for null input', async () => {
    const n = await callTiptapWordCount(null)
    expect(n).toBe(0)
  })

  it('returns 0 for empty Tiptap doc', async () => {
    const n = await callTiptapWordCount({ type: 'doc', content: [] })
    expect(n).toBe(0)
  })

  it('returns 0 for {}', async () => {
    const n = await callTiptapWordCount({})
    expect(n).toBe(0)
  })

  it('returns 0 for whitespace-only text', async () => {
    const n = await callTiptapWordCount(tiptapDoc('   \n\t  '))
    expect(n).toBe(0)
  })

  it('counts a single word', async () => {
    const n = await callTiptapWordCount(tiptapDoc('hello'))
    expect(n).toBe(1)
  })

  it('counts two words separated by space', async () => {
    const n = await callTiptapWordCount(tiptapDoc('hello world'))
    expect(n).toBe(2)
  })

  it('counts across multiple paragraphs', async () => {
    const n = await callTiptapWordCount(
      multiParaTiptap(['the quick brown fox', 'jumped over the lazy dog']),
    )
    expect(n).toBe(9)
  })

  it('handles unicode em-dash + non-ASCII whitespace', async () => {
    const n = await callTiptapWordCount(tiptapDoc('one—two three'))
    // em-dash with no surrounding space → "one—two" treated as one token;
    //   (non-breaking space) — Postgres \s+ in regexp_split_to_array
    // matches Unicode whitespace classes in default UTF-8 locale.
    expect(n).toBeGreaterThanOrEqual(2)
    expect(n).toBeLessThanOrEqual(3)
  })

  it('counts a plain JSONB string scalar (legacy / fixture path)', async () => {
    const n = await callTiptapWordCount('a b c d e')
    expect(n).toBe(5)
  })

  it('counts a large doc (~500 words) correctly', async () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    const n = await callTiptapWordCount(tiptapDoc(words))
    expect(n).toBe(500)
  })

  it('counts nested content (paragraph > content > marks)', async () => {
    // Tiptap with text marks (bold/italic) keeps text in a flat array
    // under content; this exercises the recursive walk.
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    }
    const n = await callTiptapWordCount(doc)
    expect(n).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Layer 3 — invariant tests via trigger on real nodes table
// ---------------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('M-172 trigger — layer 3 invariant tests', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    const chapterId = crypto.randomUUID()

    // Create a real auth user for created_by FKs.
    const { data: user, error: userErr } = await svc.auth.admin.createUser({
      email: `m172-${Date.now()}@test.local`,
      password: 'Test1234!Test1234!',
      email_confirm: true,
    })
    if (userErr || !user.user) throw new Error('user create failed: ' + (userErr?.message ?? 'no user'))

    let r = await svc.from('organisations').insert({
      id: orgId,
      name: 'M-172 Test Org',
      slug: `m172-${Date.now()}`,
      plan: 'trial',
      token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org insert: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({ organisation_id: orgId, user_id: user.user.id, role: 'owner' })
    if (r.error) throw new Error(`member insert: ${r.error.message}`)
    r = await svc.from('projects').insert({ id: projectId, organisation_id: orgId, name: 'M-172 Test Project' })
    if (r.error) throw new Error(`project insert: ${r.error.message}`)

    // Use the existing RPC so we get a fully-formed document + layer stack + root.
    const { data: docResult, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
      p_project_id: projectId,
      p_organisation_id: orgId,
      p_name: 'M-172 Test Document',
      p_description: 'test fixture',
      p_document_type: 'novel',
      p_authors: ['M-172 test'],
    })
    if (docErr) throw new Error('create_document_with_layer_stack: ' + docErr.message)
    const result = docResult as { document_id: string; layer_stack_id: string; root_node_id: string }

    // Create a chapter under the root to use as the target node.
    const chap = await svc.from('nodes').insert({
      id: chapterId,
      organisation_id: orgId,
      document_id: result.document_id,
      project_id: projectId,
      node_type: 'chapter',
      node_category: 'structural',
      parent_id: result.root_node_id,
      order: 1,
      depth: 2,
      layer_index: 2,
      name: 'M-172 Test Chapter',
      created_by: user.user.id,
      last_modified_by: user.user.id,
      scope: null,
    })
    if (chap.error) throw new Error(`chapter insert: ${chap.error.message}`)

    fix = {
      orgId,
      projectId,
      documentId: result.document_id,
      layerStackId: result.layer_stack_id,
      rootNodeId: result.root_node_id,
      chapterId,
      ownerUserId: user.user.id,
    }
  })

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.orgId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  async function getCount(nodeId: string): Promise<number | null> {
    const { data, error } = await svc.from('nodes').select('word_count_actual').eq('id', nodeId).single()
    if (error) throw new Error(`getCount(${nodeId}): ${error.message}`)
    return data?.word_count_actual ?? null
  }

  let nextOrder = 100
  async function insertBeat(name: string, prose: unknown | null): Promise<string> {
    if (!fix) throw new Error('fixture not initialised')
    const id = crypto.randomUUID()
    const row: Record<string, unknown> = {
      id,
      organisation_id: fix.orgId,
      document_id: fix.documentId,
      project_id: fix.projectId,
      node_type: 'beat',
      node_category: 'structural',
      parent_id: fix.chapterId,
      order: nextOrder++,
      depth: 4,
      layer_index: 4,
      name,
      created_by: fix.ownerUserId,
      last_modified_by: fix.ownerUserId,
      scope: null,
    }
    if (prose !== null) row.prose = prose
    const { error } = await svc.from('nodes').insert(row)
    if (error) throw new Error(`insertBeat(${name}): ${error.message}`)
    return id
  }

  it('INSERT with prose: word_count_actual is computed', async () => {
    const id = await insertBeat('beat-insert', tiptapDoc('one two three four five'))
    expect(await getCount(id)).toBe(5)
  })

  it('INSERT with no prose: word_count_actual = 0', async () => {
    const id = await insertBeat('beat-no-prose', null)
    expect(await getCount(id)).toBe(0)
  })

  it('UPDATE prose: word_count_actual recomputed', async () => {
    const id = await insertBeat('beat-update', tiptapDoc('one two three'))
    expect(await getCount(id)).toBe(3)

    const u1 = await svc.from('nodes').update({ prose: tiptapDoc('a b c d e f g h') }).eq('id', id)
    if (u1.error) throw new Error('update 1: ' + u1.error.message)
    expect(await getCount(id)).toBe(8)

    const u2 = await svc.from('nodes').update({ prose: tiptapDoc('shorter') }).eq('id', id)
    if (u2.error) throw new Error('update 2: ' + u2.error.message)
    expect(await getCount(id)).toBe(1)
  })

  it('UPDATE non-prose field: word_count_actual NOT recomputed', async () => {
    const id = await insertBeat('beat-name-only', tiptapDoc('one two three'))
    expect(await getCount(id)).toBe(3)

    // Rename — word_count_actual should remain 3 (not recomputed; saves work).
    const u1 = await svc.from('nodes').update({ name: 'renamed' }).eq('id', id)
    if (u1.error) throw new Error('rename: ' + u1.error.message)
    expect(await getCount(id)).toBe(3)

    // Status change — same.
    const u2 = await svc.from('nodes').update({ status: 'approved' }).eq('id', id)
    if (u2.error) throw new Error('status: ' + u2.error.message)
    expect(await getCount(id)).toBe(3)
  })

  it('UPDATE prose → NULL: word_count_actual goes to 0', async () => {
    const id = await insertBeat('beat-clear', tiptapDoc('one two three four'))
    expect(await getCount(id)).toBe(4)

    const u = await svc.from('nodes').update({ prose: null }).eq('id', id)
    if (u.error) throw new Error('clear: ' + u.error.message)
    expect(await getCount(id)).toBe(0)
  })

  it('UPDATE prose → empty doc: word_count_actual goes to 0', async () => {
    const id = await insertBeat('beat-empty', tiptapDoc('one two three four five'))
    expect(await getCount(id)).toBe(5)

    const u = await svc.from('nodes').update({ prose: { type: 'doc', content: [] } }).eq('id', id)
    if (u.error) throw new Error('empty: ' + u.error.message)
    expect(await getCount(id)).toBe(0)
  })

  it('backfill correctness: every node with prose has non-NULL word_count_actual', async () => {
    const { data } = await svc
      .from('nodes')
      .select('id, prose, word_count_actual')
      .not('prose', 'is', null)
      .limit(50)
    expect(data).toBeTruthy()
    for (const row of data ?? []) {
      expect(row.word_count_actual).not.toBeNull()
      // Loose sanity: prose chars > 0 implies word_count_actual > 0.
      const proseChars = JSON.stringify(row.prose ?? '').length
      if (proseChars > 50) {
        expect(row.word_count_actual).toBeGreaterThan(0)
      }
    }
  })
})
