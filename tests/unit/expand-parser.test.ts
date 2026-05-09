/**
 * Unit tests for the expand-operation JSON parser.
 *
 * Source: cloud production failures observed 2026-05-08 against
 * stelavox-dev document 9503c6ea (Mars series). Two distinct failure modes:
 *
 *   1. word_count_target rejection — the schema capped at 100,000 but the
 *      `expand_series_into_books` prompt asks for 70,000–120,000 with
 *      150,000+ for high-fantasy. Resolved by raising cap to 250,000.
 *
 *   2. "no JSON array found in output" — the model returned an object
 *      wrapping the array (e.g., `{"books": [...]}`) instead of a
 *      top-level array. Resolved by adding a fallback path that extracts
 *      the first array-valued property of a wrapping object.
 */

import { describe, expect, it } from 'vitest'

import { runExpand } from '@/lib/agent/operations/expand'

const validBookItem = (position: number, name: string, words = 90_000) => ({
  name,
  short_description: `Book ${position}: ${name}`,
  summary: `A complete arc for book ${position}, contributing to the series transformation. Lorem ipsum.`,
  word_count_target: words,
  position,
})

describe('expand parser — word_count_target schema cap', () => {
  it('accepts word_count_target up to 250,000 (high-fantasy series book)', async () => {
    const arr = [
      { ...validBookItem(0, 'Book One', 200_000) },
      { ...validBookItem(1, 'Book Two', 250_000) },
    ]
    const result = await runExpand(JSON.stringify(arr))
    expect(result.result_child_nodes).toHaveLength(2)
  })

  it('accepts word_count_target = 120,000 (typical series book — was previously rejected at 100,000 cap)', async () => {
    const arr = [
      { ...validBookItem(0, 'Book One', 120_000) },
      { ...validBookItem(1, 'Book Two', 110_000) },
      { ...validBookItem(2, 'Book Three', 130_000) },
    ]
    const result = await runExpand(JSON.stringify(arr))
    expect(result.result_child_nodes).toHaveLength(3)
  })

  it('rejects word_count_target above 250,000 (sanity bound)', async () => {
    const arr = [{ ...validBookItem(0, 'Book One', 300_000) }]
    await expect(runExpand(JSON.stringify(arr))).rejects.toThrow(/output_schema_invalid/)
  })

  it('rejects word_count_target below 1 (sanity bound)', async () => {
    const arr = [{ ...validBookItem(0, 'Book One', 0) }]
    await expect(runExpand(JSON.stringify(arr))).rejects.toThrow(/output_schema_invalid/)
  })
})

describe('expand parser — JSON array extraction', () => {
  it('parses a bare top-level JSON array', async () => {
    const arr = [validBookItem(0, 'A'), validBookItem(1, 'B')]
    const result = await runExpand(JSON.stringify(arr))
    expect(result.result_child_nodes).toHaveLength(2)
  })

  it('strips opening + closing markdown fences with json language tag', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = '```json\n' + JSON.stringify(arr) + '\n```'
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })

  it('strips bare ``` fences (no json language tag)', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = '```\n' + JSON.stringify(arr) + '\n```'
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })

  it('extracts array embedded in commentary text', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = `Here is the array you requested:\n\n${JSON.stringify(arr)}\n\nLet me know if you need adjustments.`
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })
})

describe('expand parser — object-wrapped array fallback (Bug 2 resolution)', () => {
  it('extracts array from a wrapping object with `books` property', async () => {
    const arr = [validBookItem(0, 'A'), validBookItem(1, 'B')]
    const wrapped = JSON.stringify({ books: arr })
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(2)
  })

  it('extracts array from a wrapping object with `result` property', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = JSON.stringify({ result: arr })
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })

  it('extracts array from a wrapping object with arbitrary property name', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = JSON.stringify({ proposed_chapters: arr })
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })

  it('handles object wrapper inside markdown fences', async () => {
    const arr = [validBookItem(0, 'A')]
    const wrapped = '```json\n' + JSON.stringify({ items: arr }) + '\n```'
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })

  it('rejects wrapping object that has no array-valued property', async () => {
    const wrapped = JSON.stringify({ status: 'ok', message: 'no books for you' })
    await expect(runExpand(wrapped)).rejects.toThrow(/no JSON array found in output/)
  })

  it('rejects empty/non-JSON content', async () => {
    await expect(runExpand('')).rejects.toThrow(/no JSON array found in output/)
    await expect(runExpand('   ')).rejects.toThrow(/no JSON array found in output/)
    await expect(runExpand('not json at all')).rejects.toThrow(/no JSON array found in output/)
  })

  it('rejects unterminated array', async () => {
    await expect(runExpand('[{"name": "incomplete"')).rejects.toThrow(/unterminated JSON array/)
  })

  it('rejects unterminated object', async () => {
    await expect(runExpand('{"books": [{"name": "incomplete"')).rejects.toThrow(/unterminated JSON object/)
  })

  it('prefers a top-level array even when an object appears later', async () => {
    // The model returned a leading array followed by trailing commentary
    // that includes a trailing JSON-shaped object.
    const arr = [validBookItem(0, 'A')]
    const wrapped = `${JSON.stringify(arr)}\n\nNote: { "context": "this should not be parsed" }`
    const result = await runExpand(wrapped)
    expect(result.result_child_nodes).toHaveLength(1)
  })
})

describe('expand parser — schema validation pass-through', () => {
  it('rejects when position values are not contiguous', async () => {
    const arr = [validBookItem(0, 'A'), validBookItem(2, 'C')]
    await expect(runExpand(JSON.stringify(arr))).rejects.toThrow(/positions/)
  })

  it('rejects when summary is empty (z.string().min(1))', async () => {
    const item = { ...validBookItem(0, 'A'), summary: '' }
    await expect(runExpand(JSON.stringify([item]))).rejects.toThrow(/output_schema_invalid/)
  })

  it('rejects when array has zero items', async () => {
    await expect(runExpand('[]')).rejects.toThrow(/output_schema_invalid/)
  })

  it('rejects when array exceeds 20 items', async () => {
    const arr = Array.from({ length: 25 }, (_, i) => validBookItem(i, `B${i}`))
    await expect(runExpand(JSON.stringify(arr))).rejects.toThrow(/output_schema_invalid/)
  })
})
