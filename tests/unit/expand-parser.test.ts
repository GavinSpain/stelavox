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

  it('rejects unterminated array with truncation guidance (SU-J12-1)', async () => {
    // The error must name the cause (model truncation) and the remediation
    // paths (lower count / raise max_tokens) — not just say "unterminated".
    await expect(runExpand('[{"name": "incomplete"')).rejects.toThrow(/model_output_truncated:array/)
    await expect(runExpand('[{"name": "incomplete"')).rejects.toThrow(/output token limit/)
  })

  it('rejects unterminated object with truncation guidance (SU-J12-1)', async () => {
    await expect(runExpand('{"books": [{"name": "incomplete"')).rejects.toThrow(/model_output_truncated:object/)
    await expect(runExpand('{"books": [{"name": "incomplete"')).rejects.toThrow(/output token limit/)
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

describe('expand parser — SU-J12-7 ordinal-prefix stripping', () => {
  // The display layer adds its own "${i+1}. " before the name. If the
  // model also emitted "1. Red Genesis" the user sees "1. 1. Red Genesis"
  // and the persisted node name carries the redundant prefix into the
  // tree. Strip canonical ordinal patterns at the operation boundary.
  const cases: Array<[string, string]> = [
    ['1. Red Genesis',     'Red Genesis'],
    ['2) Inheritance',     'Inheritance'],
    ['3 - Red Soil',       'Red Soil'],
    ['4: The Bracket',     'The Bracket'],
    ['  5. With leading whitespace', 'With leading whitespace'],
    ['10. Two-digit prefix', 'Two-digit prefix'],
  ]

  for (const [input, expected] of cases) {
    it(`strips "${input}" → "${expected}"`, async () => {
      const arr = [{ ...validBookItem(0, input) }]
      const result = await runExpand(JSON.stringify(arr))
      const items = result.result_child_nodes as Array<{ name?: string }>
      expect(items[0].name).toBe(expected)
    })
  }

  it('preserves "1984" — number with no separator is part of the name', async () => {
    const arr = [{ ...validBookItem(0, '1984') }]
    const result = await runExpand(JSON.stringify(arr))
    const items = result.result_child_nodes as Array<{ name?: string }>
    expect(items[0].name).toBe('1984')
  })

  it('preserves a name that is purely the prefix (falls back to original)', async () => {
    // "1." alone would strip to "" — fallback returns the original.
    const arr = [{ ...validBookItem(0, '1.') }]
    const result = await runExpand(JSON.stringify(arr))
    const items = result.result_child_nodes as Array<{ name?: string }>
    expect(items[0].name).toBe('1.')
  })
})

describe('expand parser — SU-J13-3 word-ordinal stripping', () => {
  // The LLM commonly emits "Chapter N: Title" / "Scene N: Title" /
  // "Beat N: Title" / "Act N: Title" / "Book N: Title" / "Part N: Title"
  // / "Section N: Title" prefixes. The display layer adds its own
  // "${i+1}. " before the name, producing visible doubles like
  // "1. Chapter 1: The Handover" in the proposal preview AND persisting
  // the redundant prefix into the tree.
  const cases: Array<[string, string]> = [
    ['Chapter 1: The Handover', 'The Handover'],
    ['Scene 2: The Ceremony',   'The Ceremony'],
    ['Beat 3 - The Quiet After', 'The Quiet After'],
    ['Act 4. The Final Inspection', 'The Final Inspection'],
    ['Book 5: Inheritance', 'Inheritance'],
    ['Part 6: The Choice',  'The Choice'],
    ['Section 7: The Archive', 'The Archive'],
    // Case-insensitive
    ['chapter 8: lower-case', 'lower-case'],
    ['CHAPTER 9: UPPER-CASE', 'UPPER-CASE'],
  ]

  for (const [input, expected] of cases) {
    it(`strips "${input}" → "${expected}"`, async () => {
      const arr = [{ ...validBookItem(0, input) }]
      const result = await runExpand(JSON.stringify(arr))
      const items = result.result_child_nodes as Array<{ name?: string }>
      expect(items[0].name).toBe(expected)
    })
  }

  it('strips both digit-prefix and word-ordinal in sequence', async () => {
    // Belt-and-braces: if the LLM somehow emitted "1. Chapter 1: Title"
    // (saw this once), both layers should strip.
    const arr = [{ ...validBookItem(0, '1. Chapter 1: The Handover') }]
    const result = await runExpand(JSON.stringify(arr))
    const items = result.result_child_nodes as Array<{ name?: string }>
    expect(items[0].name).toBe('The Handover')
  })

  it('preserves "Chapter House" (word but no digit)', async () => {
    // Frank Herbert's Chapter House — "Chapter" alone (no digit) is part
    // of the name and must not be stripped.
    const arr = [{ ...validBookItem(0, 'Chapter House') }]
    const result = await runExpand(JSON.stringify(arr))
    const items = result.result_child_nodes as Array<{ name?: string }>
    expect(items[0].name).toBe('Chapter House')
  })
})
