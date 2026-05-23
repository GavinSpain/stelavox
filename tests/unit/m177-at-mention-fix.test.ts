/**
 * M-177 — @-mention path fix + sentinel-UUID guard.
 *
 * Methodology: feedback_testing_methodology.md (four layers).
 *
 * Layer 1 — pure-function tests on isPlaceholderUuid (sentinel
 *           recognition over: all-zeros, all-fs, single-digit repeats,
 *           valid UUIDs, non-UUID strings, null).
 * Layer 2 — tool contract:
 *   find_node_by_name accepts `@name` and strips the prefix correctly
 *   get_node rejects all sentinel UUIDs with placeholder_uuid_rejected
 *   get_node still works for valid UUIDs
 * Layer 3 — invariant: any get_node call with a sentinel UUID returns
 *           the teaching error, not generic node_not_found.
 */

import { describe, expect, it } from 'vitest'
import { execFindNodeByName, execGetNode, isPlaceholderUuid } from '@/lib/director/tools/read'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''

// ---------------------------------------------------------------------------
// Layer 1 — pure-function tests
// ---------------------------------------------------------------------------

describe('M-177 isPlaceholderUuid — layer 1', () => {
  it('all-zeros UUID is a placeholder', () => {
    expect(isPlaceholderUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('all-fs UUID is a placeholder', () => {
    expect(isPlaceholderUuid('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true)
  })

  it('all-fs UPPERCASE UUID is also a placeholder (case-insensitive)', () => {
    expect(isPlaceholderUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF')).toBe(true)
  })

  it('repeated-digit placeholders are detected (1s, 2s, 9s, as)', () => {
    expect(isPlaceholderUuid('11111111-1111-1111-1111-111111111111')).toBe(true)
    expect(isPlaceholderUuid('22222222-2222-2222-2222-222222222222')).toBe(true)
    expect(isPlaceholderUuid('99999999-9999-9999-9999-999999999999')).toBe(true)
    expect(isPlaceholderUuid('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(true)
  })

  it('a real UUID is NOT a placeholder', () => {
    expect(isPlaceholderUuid('6d4d631e-06b0-4be6-87d2-829a0f62d0b0')).toBe(false)
    expect(isPlaceholderUuid('94822bb9-339a-4af4-a366-aa319fae1d25')).toBe(false)
  })

  it('non-string inputs are not placeholders', () => {
    expect(isPlaceholderUuid(null)).toBe(false)
    expect(isPlaceholderUuid(undefined)).toBe(false)
    expect(isPlaceholderUuid(0)).toBe(false)
    expect(isPlaceholderUuid({})).toBe(false)
  })

  it('arbitrary strings are not placeholders', () => {
    expect(isPlaceholderUuid('hello world')).toBe(false)
    expect(isPlaceholderUuid('')).toBe(false)
    expect(isPlaceholderUuid('not-a-uuid')).toBe(false)
  })

  it('UUID with mixed but symmetric digits is NOT a placeholder', () => {
    // Real UUIDs frequently have repeated chars within them; only ALL
    // hex chars being the same flags as placeholder.
    expect(isPlaceholderUuid('aabbccdd-aabb-ccdd-aabb-aabbccddeeff')).toBe(false)
  })

  it('UUID with leading/trailing whitespace is normalised', () => {
    expect(isPlaceholderUuid('  ffffffff-ffff-ffff-ffff-ffffffffffff  ')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Layer 2 — tool contract
// ---------------------------------------------------------------------------

describe.skipIf(!hasServiceKey)('M-177 tool behaviour — layer 2', () => {
  const ORG_ID = '94822bb9-339a-4af4-a366-aa319fae1d25'
  const DOC_ID = '637acf44-38ab-42ad-b179-1d57844014b5'
  const session = {
    user_id: '5259319f-adde-4f29-9c6d-36b9dcea09c7',
    organisation_id: ORG_ID,
    document_id: DOC_ID,
    conversation_id: '00000000-0000-0000-0000-000000000000',
  } as never

  it('find_node_by_name strips a leading @ from the query', async () => {
    const r = await execFindNodeByName({ query: '@the ghost burns dark' }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as { matches: Array<{ name: string }>; query: string }
    // The stored query in the return is the @-stripped form.
    expect(d.query).toBe('the ghost burns dark')
    expect(d.matches.length).toBeGreaterThan(0)
    expect(d.matches[0].name?.toLowerCase()).toContain('ghost burns dark')
  })

  it('find_node_by_name with @-only (just `@`) returns invalid_input', async () => {
    const r = await execFindNodeByName({ query: '@' }, session)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_input')
  })

  it('find_node_by_name without @ still works (regression)', async () => {
    const r = await execFindNodeByName({ query: 'the ghost burns dark' }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = r.data as { matches: Array<{ name: string }> }
    expect(d.matches.length).toBeGreaterThan(0)
  })

  it('get_node rejects all-zeros sentinel UUID with placeholder_uuid_rejected', async () => {
    const r = await execGetNode(
      { node_id: '00000000-0000-0000-0000-000000000000' },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('placeholder_uuid_rejected')
      expect(r.reason).toContain('find_node_by_name')
    }
  })

  it('get_node rejects all-fs sentinel UUID', async () => {
    const r = await execGetNode(
      { node_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('placeholder_uuid_rejected')
  })

  it('get_node still returns node_not_found for plausible-but-absent UUIDs', async () => {
    const r = await execGetNode(
      { node_id: '12345678-1234-1234-1234-123456789abc' },
      session,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('node_not_found')
  })

  it('get_node still works for a valid existing node', async () => {
    // Look up a real node by name to get a valid id, then call get_node.
    const find = await execFindNodeByName({ query: 'Salvage' }, session)
    expect(find.ok).toBe(true)
    if (!find.ok) return
    const d = find.data as { matches: Array<{ id: string; node_type: string }> }
    const chapter = d.matches.find((m) => m.node_type === 'chapter')
    if (!chapter) return
    const r = await execGetNode({ node_id: chapter.id }, session)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const node = r.data as { name: string }
    expect(node.name).toBe('Salvage')
  })
})
