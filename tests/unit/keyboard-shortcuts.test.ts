/**
 * Phase 8.4 — registry shape + focus-target helper unit tests.
 */

import { describe, expect, it } from 'vitest'
import {
  SCOPE_TITLES,
  SHORTCUTS,
  isTargetInTextInput,
  keyDisplayForPlatform,
  shortcutsByScope,
  type ShortcutScope,
} from '@/lib/keyboard/shortcuts'

describe('SHORTCUTS registry', () => {
  it('every entry has a unique id', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every entry has a non-empty label + keyDisplay', () => {
    for (const entry of SHORTCUTS) {
      expect(entry.label.trim().length).toBeGreaterThan(0)
      expect(entry.keyDisplay.trim().length).toBeGreaterThan(0)
    }
  })

  it('every entry uses a known scope', () => {
    const known: ShortcutScope[] = ['global', 'document', 'editor', 'focus', 'modal']
    for (const entry of SHORTCUTS) {
      expect(known).toContain(entry.scope)
    }
  })

  it('SCOPE_TITLES has a title for every scope used in the registry', () => {
    for (const entry of SHORTCUTS) {
      expect(SCOPE_TITLES[entry.scope]).toBeTruthy()
    }
  })

  it('contains the two new 8.4 shortcuts (help + palette)', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(ids).toContain('help')
    expect(ids).toContain('palette')
  })

  it('contains the already-shipped shortcuts (export + focus mode entry)', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(ids).toContain('export')
    expect(ids).toContain('enter-focus')
  })
})

describe('shortcutsByScope', () => {
  it('groups entries preserving canonical scope order', () => {
    const groups = shortcutsByScope()
    const order = groups.map((g) => g.scope)
    // Within the registry we have entries for every scope, so all five
    // should be present and in canonical order.
    expect(order).toEqual(['global', 'document', 'editor', 'focus', 'modal'])
  })

  it('preserves in-scope insertion order', () => {
    const groups = shortcutsByScope()
    const global = groups.find((g) => g.scope === 'global')!
    const ids = global.entries.map((e) => e.id)
    // help registered before palette in the registry
    expect(ids.indexOf('help')).toBeLessThan(ids.indexOf('palette'))
  })

  it('does not list scopes that have no entries', () => {
    // The current registry covers all five — verify no extras would
    // surface if a scope were emptied. This guards against an
    // accidental empty-scope rendering in the help overlay.
    const groups = shortcutsByScope()
    for (const g of groups) {
      expect(g.entries.length).toBeGreaterThan(0)
    }
  })
})

describe('keyDisplayForPlatform', () => {
  it('returns the input unchanged when navigator is absent (SSR)', () => {
    const originalNav = (globalThis as { navigator?: unknown }).navigator
    delete (globalThis as { navigator?: unknown }).navigator
    try {
      expect(keyDisplayForPlatform('⌘K')).toBe('⌘K')
      expect(keyDisplayForPlatform('⌘↵')).toBe('⌘↵')
    } finally {
      ;(globalThis as { navigator?: unknown }).navigator = originalNav
    }
  })

  it('replaces ⌘ with Ctrl on non-Mac platforms', () => {
    const originalNav = (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: { platform: string; userAgent: string } }).navigator = {
      platform: 'Win32', userAgent: 'Mozilla/5.0 Windows',
    }
    try {
      expect(keyDisplayForPlatform('⌘K')).toBe('CtrlK')
      expect(keyDisplayForPlatform('⌘↵')).toBe('CtrlEnter')
      expect(keyDisplayForPlatform('⌘⇧E')).toBe('Ctrl⇧E')
    } finally {
      ;(globalThis as { navigator?: unknown }).navigator = originalNav
    }
  })

  it('leaves ⌘ in place on Mac platforms', () => {
    const originalNav = (globalThis as { navigator?: unknown }).navigator
    ;(globalThis as { navigator?: { platform: string; userAgent: string } }).navigator = {
      platform: 'MacIntel', userAgent: 'Mozilla/5.0 Macintosh',
    }
    try {
      expect(keyDisplayForPlatform('⌘K')).toBe('⌘K')
      expect(keyDisplayForPlatform('⌘↵')).toBe('⌘↵')
    } finally {
      ;(globalThis as { navigator?: unknown }).navigator = originalNav
    }
  })
})

describe('isTargetInTextInput', () => {
  function el(html: string): Element {
    // Minimal DOM-like Element stub. We can't use real document.createElement
    // under Vitest's node env without jsdom, so we mock just what
    // .closest()  needs: the selector and the cached tagName / contenteditable.
    return makeStub(html)
  }
  function makeStub(html: string): Element {
    // tag with optional contenteditable attribute, e.g.:
    //   'input', 'textarea', 'div[contenteditable="true"]', 'p[ce-parent]'
    const tagMatch = html.match(/^[a-z]+/i)
    const tag = (tagMatch?.[0] ?? 'div').toUpperCase()
    const isCe = /contenteditable=("true"|"")/.test(html)
    const isCeParent = /\bce-parent\b/.test(html)
    const stub = {
      tagName: tag,
      closest(selector: string): Element | null {
        if (selector.includes('input') && tag === 'INPUT') return stub
        if (selector.includes('textarea') && tag === 'TEXTAREA') return stub
        if (selector.includes('contenteditable') && isCe) return stub
        if (selector.includes('contenteditable') && isCeParent) {
          // The parent is contenteditable — return a parent stub.
          return makeStub('div[contenteditable="true"]')
        }
        return null
      },
    } as unknown as Element
    return stub
  }

  it('returns false for null target', () => {
    expect(isTargetInTextInput(null)).toBe(false)
  })

  it('returns false for non-Element targets', () => {
    expect(isTargetInTextInput({} as EventTarget)).toBe(false)
  })

  it('returns true for an input element', () => {
    expect(isTargetInTextInput(el('input'))).toBe(true)
  })

  it('returns true for a textarea element', () => {
    expect(isTargetInTextInput(el('textarea'))).toBe(true)
  })

  it('returns true for a contenteditable div', () => {
    expect(isTargetInTextInput(el('div[contenteditable="true"]'))).toBe(true)
  })

  it('returns true for a descendant of a contenteditable container', () => {
    // The Tiptap editor reports keydowns from inner <p>/<span> elements.
    // The closest() call walks up to find the contenteditable parent.
    expect(isTargetInTextInput(el('p ce-parent'))).toBe(true)
  })

  it('returns false for a plain div / button / span', () => {
    expect(isTargetInTextInput(el('div'))).toBe(false)
    expect(isTargetInTextInput(el('button'))).toBe(false)
    expect(isTargetInTextInput(el('span'))).toBe(false)
  })
})
