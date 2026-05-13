/**
 * V1.x-A — preferencesValidator unit tests.
 *
 * H-18 mitigation: briefs.preferences JSONB is schema-less at the DB,
 * but every amendment-write path runs through the typed validator to
 * keep the shape coherent over time.
 */

import { describe, expect, it } from 'vitest'

import {
  validatePreferences,
  validateAmendmentValue,
} from '@/lib/brief/preferencesValidator'

describe('validatePreferences', () => {
  it('accepts an empty preferences object', () => {
    expect(validatePreferences({})).toEqual({})
  })

  it('accepts the V1.x-A recognised keys', () => {
    const input = {
      voice: 'dry, sardonic',
      constraints: ['no flashbacks', 'no contractions'],
      decisions: ['protagonist: Marcus Holt'],
      named_entities: { protagonist: 'Marcus Holt', city: 'Sydney' },
    }
    expect(validatePreferences(input)).toEqual(input)
  })

  it('passes through unknown top-level keys', () => {
    const input = { voice: 'dry', custom_future_key: { whatever: true } }
    const result = validatePreferences(input)
    expect((result as Record<string, unknown>).custom_future_key).toEqual({ whatever: true })
  })

  it('rejects voice as a non-string', () => {
    expect(() => validatePreferences({ voice: 123 })).toThrow()
  })

  it('rejects constraints with empty strings', () => {
    expect(() => validatePreferences({ constraints: ['', 'valid'] })).toThrow()
  })
})

describe('validateAmendmentValue', () => {
  it('accepts a valid goal_text update', () => {
    expect(() =>
      validateAmendmentValue('update_goal_text', undefined, 'New project goal text.'),
    ).not.toThrow()
  })

  it('rejects an empty goal_text', () => {
    expect(() => validateAmendmentValue('update_goal_text', undefined, '   ')).toThrow()
  })

  it('rejects oversized goal_text', () => {
    const huge = 'x'.repeat(6000)
    expect(() => validateAmendmentValue('update_goal_text', undefined, huge)).toThrow()
  })

  it('accepts a voice update at preferences.voice', () => {
    expect(() =>
      validateAmendmentValue('update_voice', 'preferences.voice', 'dry, sardonic'),
    ).not.toThrow()
  })

  it('rejects non-preferences target paths', () => {
    expect(() =>
      validateAmendmentValue('update_voice', 'stages.1.title', 'Foo'),
    ).toThrow(/invalid_target_path/)
  })

  it('accepts constraints as string array', () => {
    expect(() =>
      validateAmendmentValue('add_constraint', 'preferences.constraints', ['no flashbacks']),
    ).not.toThrow()
  })

  it('rejects constraints with non-string element', () => {
    expect(() =>
      validateAmendmentValue('add_constraint', 'preferences.constraints', ['valid', 123]),
    ).toThrow()
  })

  it('permits unknown preferences.* keys via passthrough', () => {
    // Forward-compat: unknown preferences.<key> doesn't reject.
    expect(() =>
      validateAmendmentValue('generic_preferences_set', 'preferences.future_key', { x: 1 }),
    ).not.toThrow()
  })
})
