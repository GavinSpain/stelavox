/**
 * Phase 8.1 — command palette registry tests.
 *
 * Pure-data tests over commands.ts: registry shape, context-aware
 * availability filtering, navigation-path resolution, and grouping
 * order.
 */

import { describe, expect, it } from 'vitest'
import {
  COMMANDS,
  GROUP_TITLES,
  availableCommands,
  groupCommands,
  resolveNavigatePath,
  type CommandContext,
} from '@/lib/commands/commands'

const emptyCtx: CommandContext = {
  projectId: null,
  documentId: null,
  mode: null,
  onDocumentPage: false,
}

const docCtxEdit: CommandContext = {
  projectId: 'proj-1',
  documentId: 'doc-1',
  mode: 'edit',
  onDocumentPage: true,
}

const docCtxDirector: CommandContext = {
  projectId: 'proj-1',
  documentId: 'doc-1',
  mode: 'director',
  onDocumentPage: true,
}

describe('COMMANDS registry', () => {
  it('every entry has a unique id', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a non-empty label', () => {
    for (const c of COMMANDS) {
      expect(c.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('every emit action has a non-empty event name', () => {
    for (const c of COMMANDS) {
      if (c.action.kind === 'emit') {
        expect(c.action.event.length).toBeGreaterThan(0)
        expect(c.action.event.startsWith('stelavox:command:')).toBe(true)
      }
    }
  })

  it('every group used in the registry has a title in GROUP_TITLES', () => {
    for (const c of COMMANDS) {
      expect(GROUP_TITLES[c.group]).toBeTruthy()
    }
  })
})

describe('availableCommands', () => {
  it('on an idle context (no document open) shows only commands without a gate', () => {
    const ids = availableCommands(emptyCtx).map((c) => c.id)
    // Always-available commands:
    expect(ids).toContain('go-dashboard')
    expect(ids).toContain('go-settings')
    expect(ids).toContain('go-api-keys')
    expect(ids).toContain('go-usage')
    expect(ids).toContain('toggle-sentence-focus')
    expect(ids).toContain('toggle-typewriter')
    expect(ids).toContain('show-shortcuts')
    expect(ids).toContain('sign-out')
    // Document-gated commands NOT available:
    expect(ids).not.toContain('go-current-project')
    expect(ids).not.toContain('go-scheduler')
    expect(ids).not.toContain('switch-edit')
    expect(ids).not.toContain('switch-director')
    expect(ids).not.toContain('enter-focus')
    expect(ids).not.toContain('export-document')
  })

  it('on a document page in Edit mode, exposes the document-gated commands and the Director switch', () => {
    const ids = availableCommands(docCtxEdit).map((c) => c.id)
    expect(ids).toContain('go-current-project')
    expect(ids).toContain('go-scheduler')
    expect(ids).toContain('switch-director') // not currently in director
    expect(ids).not.toContain('switch-edit')  // already in edit
    expect(ids).toContain('enter-focus')
    expect(ids).toContain('export-document')
  })

  it('on a document page in Director mode, the Edit switch is available and the Director switch is not', () => {
    const ids = availableCommands(docCtxDirector).map((c) => c.id)
    expect(ids).toContain('switch-edit')
    expect(ids).not.toContain('switch-director')
  })

  it('hides go-current-project when projectId is absent even if onDocumentPage is true', () => {
    const ctx: CommandContext = {
      projectId: null, documentId: null, mode: null, onDocumentPage: true,
    }
    const ids = availableCommands(ctx).map((c) => c.id)
    expect(ids).not.toContain('go-current-project')
  })
})

describe('resolveNavigatePath', () => {
  it('returns the literal path for static-path commands', () => {
    const cmd = COMMANDS.find((c) => c.id === 'go-dashboard')!
    expect(resolveNavigatePath(cmd, emptyCtx)).toBe('/dashboard')
  })

  it('builds the current-project path from the context projectId', () => {
    const cmd = COMMANDS.find((c) => c.id === 'go-current-project')!
    expect(resolveNavigatePath(cmd, docCtxEdit)).toBe('/projects/proj-1')
  })

  it('builds the scheduler path from project + document ids', () => {
    const cmd = COMMANDS.find((c) => c.id === 'go-scheduler')!
    expect(resolveNavigatePath(cmd, docCtxEdit))
      .toBe('/projects/proj-1/documents/doc-1/scheduler')
  })

  it('returns null when an emit command is passed', () => {
    const cmd = COMMANDS.find((c) => c.id === 'toggle-sentence-focus')!
    expect(resolveNavigatePath(cmd, emptyCtx)).toBeNull()
  })

  it('returns null when a context-required path lacks its context', () => {
    const cmd = COMMANDS.find((c) => c.id === 'go-scheduler')!
    expect(resolveNavigatePath(cmd, emptyCtx)).toBeNull()
  })
})

describe('groupCommands', () => {
  it('groups in canonical order: navigate, mode, toggle, action', () => {
    const grouped = groupCommands([...COMMANDS])
    const order = grouped.map((g) => g.group)
    expect(order).toEqual(['navigate', 'mode', 'toggle', 'action'])
  })

  it('preserves in-group insertion order', () => {
    const grouped = groupCommands([...COMMANDS])
    const navIds = grouped.find((g) => g.group === 'navigate')!.commands.map((c) => c.id)
    expect(navIds.indexOf('go-dashboard')).toBeLessThan(navIds.indexOf('go-settings'))
  })

  it('omits groups that have no commands in the input', () => {
    const onlyNav = COMMANDS.filter((c) => c.group === 'navigate')
    const grouped = groupCommands([...onlyNav])
    expect(grouped.map((g) => g.group)).toEqual(['navigate'])
  })
})
