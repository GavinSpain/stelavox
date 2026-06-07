'use client'

/**
 * Phase 8.1 — Command palette.
 *
 * Mounts once at AppShell level. Listens for the
 * `stelavox:command-palette:open` window event (dispatched by ⌘K in
 * Phase 8.4's KeyboardShortcutsProvider and by SearchChip click) and
 * opens a centered modal with a search input + grouped command list.
 *
 * Built on `cmdk` for keyboard handling (arrow keys, Enter to run,
 * fuzzy filter on type). Styling is inline-styles with CSS vars from
 * the design system — matches the rest of the cluster (KeyboardShortcutsHelp,
 * ProseSettingsMenu) rather than the shadcn-themed components/ui/command.tsx.
 *
 * Inviolable audit:
 *   #1 — overlay is chrome, never overlaps prose canvas
 *   #2 — no verdigris. Selected-item highlight uses --color-bg-selected
 *   #3 / #6 — brand-only typefaces not referenced (Inter only)
 *   #4 — chrome surface, Inter
 *   #5 — N/A (not the prose editor)
 */

import { Command } from 'cmdk'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSidebarProject } from '@/components/layout/AppShell'
import { useMode } from '@/components/layout/ModeContext'
import { COMMAND_PALETTE_OPEN_EVENT } from '@/components/help/KeyboardShortcutsProvider'
import {
  GROUP_TITLES,
  availableCommands,
  groupCommands,
  resolveNavigatePath,
  type CommandContext,
  type CommandDescriptor,
} from '@/lib/commands/commands'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const { state: sidebar } = useSidebarProject()
  const { mode } = useMode()

  // Context the registry filters against.
  const ctx: CommandContext = useMemo(() => ({
    projectId: sidebar.projectId,
    documentId: sidebar.documentId,
    mode,
    // Document page: any /projects/[id]/documents/[id] route. We
    // detect via pathname because Sidebar state propagates from
    // DocumentClient mount — both signals usually align, but
    // pathname is the route-truth.
    onDocumentPage: /\/projects\/[^/]+\/documents\/[^/]+/.test(pathname),
  }), [sidebar.projectId, sidebar.documentId, mode, pathname])

  const commands = useMemo(() => availableCommands(ctx), [ctx])
  const groups = useMemo(() => groupCommands(commands), [commands])

  // Listen for the open-event dispatched by ⌘K + SearchChip click.
  useEffect(() => {
    function onOpen() {
      setOpen(true)
      setQuery('')
    }
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpen)
  }, [])

  // Close on Escape — cmdk's Command root handles arrow keys but we
  // own the close shortcut so a single key event clears the modal
  // even before the input has focus.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Run a command — navigation routes; emit dispatches a window event
  // and the palette closes either way.
  const run = useCallback((command: CommandDescriptor) => {
    setOpen(false)
    if (command.action.kind === 'navigate') {
      const path = resolveNavigatePath(command, ctx)
      if (path) router.push(path)
      return
    }
    // emit
    const event = new CustomEvent(command.action.event, {
      detail: command.action.detail ?? null,
    })
    window.dispatchEvent(event)
  }, [ctx, router])

  if (!open) return null

  return (
    <div
      data-testid="command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        zIndex: 220,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <div
        data-testid="command-palette-card"
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '70vh',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 6,
          boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Command label="Command palette" loop shouldFilter>
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <Command.Input
              data-testid="command-palette-input"
              autoFocus
              placeholder="Type a command or search…"
              value={query}
              onValueChange={setQuery}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--color-text-primary)',
                fontSize: 14,
                fontFamily: 'inherit',
              }}
            />
          </div>

          <Command.List
            data-testid="command-palette-list"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 0',
              maxHeight: 'calc(70vh - 56px)',
            }}
          >
            <Command.Empty
              style={{
                padding: '20px 18px',
                fontSize: 12.5,
                color: 'var(--color-text-muted)',
                textAlign: 'center',
              }}
            >
              No commands match.
            </Command.Empty>

            {groups.map(({ group, commands: groupCmds }) => (
              <Command.Group
                key={group}
                heading={GROUP_TITLES[group]}
                data-testid={`command-palette-group-${group}`}
                style={{
                  padding: '6px 0',
                }}
              >
                {groupCmds.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`${c.label} ${(c.keywords ?? []).join(' ')}`}
                    onSelect={() => run(c)}
                    data-testid={`command-palette-item-${c.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 16px',
                      fontSize: 13,
                      color: 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      transition: 'background var(--duration-fast, 120ms), color var(--duration-fast, 120ms)',
                    }}
                  >
                    {c.glyph && (
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          textAlign: 'center',
                          color: 'var(--color-text-muted)',
                          fontSize: 13,
                        }}
                      >
                        {c.glyph}
                      </span>
                    )}
                    <span style={{ flex: 1 }}>{c.label}</span>
                    {c.shortcut && (
                      <kbd
                        style={{
                          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                          fontSize: 10,
                          color: 'var(--color-text-muted)',
                          background: 'var(--color-bg-surface)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 3,
                          padding: '2px 6px',
                          marginLeft: 8,
                        }}
                      >
                        {c.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>

        {/* cmdk selected-item styling — applied via global CSS rules
            embedded in this component. We can't reach the selected
            cmdk item from inline styles since cmdk sets the
            data-selected attribute on Command.Item internally. */}
        <style>{`
          [data-testid="command-palette-card"] [cmdk-group-heading] {
            padding: 6px 16px 2px;
            font-size: 9.5px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--color-text-muted);
          }
          [data-testid="command-palette-card"] [cmdk-item][data-selected="true"] {
            background: var(--color-bg-selected);
            color: var(--color-text-primary);
          }
          [data-testid="command-palette-card"] [cmdk-item][data-selected="true"] kbd {
            color: var(--color-text-secondary);
          }
        `}</style>
      </div>
    </div>
  )
}
