// Phase 8.01.C T-9 — positional path parser.

import { describe, expect, it } from 'vitest'

import { parsePositionalPath } from '@/lib/director/parsePositionalPath'

describe('parsePositionalPath', () => {
  it('act1 → single act segment', () => {
    expect(parsePositionalPath('act1')).toEqual([{ layer: 'act', position: 1 }])
  })

  it('act1ch1sc1bt2 → 4-segment chain', () => {
    expect(parsePositionalPath('act1ch1sc1bt2')).toEqual([
      { layer: 'act', position: 1 },
      { layer: 'chapter', position: 1 },
      { layer: 'scene', position: 1 },
      { layer: 'beat', position: 2 },
    ])
  })

  it('double-digit position → ch12 parses as chapter 12', () => {
    expect(parsePositionalPath('ch12')).toEqual([{ layer: 'chapter', position: 12 }])
  })

  it('series → series segment with no position', () => {
    expect(parsePositionalPath('series')).toEqual([{ layer: 'series' }])
  })

  it('series1book2ch3 → series + book 2 + chapter 3', () => {
    expect(parsePositionalPath('series1book2ch3')).toEqual([
      { layer: 'series' },
      { layer: 'book', position: 2 },
      { layer: 'chapter', position: 3 },
    ])
  })

  it('unknown abbreviation → null', () => {
    expect(parsePositionalPath('xyz')).toBeNull()
  })

  it('trailing garbage after valid prefix → null (must consume entire input)', () => {
    expect(parsePositionalPath('act1foo')).toBeNull()
  })

  it('empty string → null', () => {
    expect(parsePositionalPath('')).toBeNull()
  })

  it('positional layer without digits → null (act with no number is invalid)', () => {
    expect(parsePositionalPath('act')).toBeNull()
  })

  it('case-insensitive (uppercase input)', () => {
    expect(parsePositionalPath('ACT1CH2')).toEqual([
      { layer: 'act', position: 1 },
      { layer: 'chapter', position: 2 },
    ])
  })
})
