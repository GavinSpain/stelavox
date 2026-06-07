'use client'

/**
 * Phase 8.4 — top-level keyboard provider.
 *
 * Mounts once at the AppShell level. Listens for two global shortcuts:
 *
 *   ?    — opens the KeyboardShortcutsHelp overlay
 *   ⌘K   — dispatches a window CustomEvent so the (future) command
 *          palette can open. Phase 8.1 wires the palette to listen
 *          for the same event.
 *
 * Both shortcuts only fire when the keypress did NOT originate from
 * inside a text input (input / textarea / contenteditable). That
 * means Tiptap's native ⌘K-for-Link inside the prose editor stays
 * working, and typing "?" into the Director input or prose just
 * inserts the character.
 *
 * The SearchChip button in the Header dispatches the same
 * `stelavox:command-palette:open` event on click — so click and ⌘K
 * go through the same hook.
 */

import { useEffect, useState } from 'react'

import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp'
import { isTargetInTextInput } from '@/lib/keyboard/shortcuts'

/** Window event name dispatched when ⌘K is pressed (outside text
 *  inputs) or when SearchChip is clicked. Phase 8.1's command palette
 *  listens for this to open. */
export const COMMAND_PALETTE_OPEN_EVENT = 'stelavox:command-palette:open'

export function KeyboardShortcutsProvider() {
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Skip if focus is inside a text-entry surface — `?` should type
      // a literal `?`, and ⌘K should reach the editor's Link handler.
      if (isTargetInTextInput(e.target)) return

      // ? — open help
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      // ⌘K / Ctrl+K — dispatch the command-palette open event. The
      // palette itself is Phase 8.1; until it ships, this event has
      // no listener and the shortcut is effectively a no-op outside
      // editors. We still preventDefault so the browser's native
      // "open search bar" behaviour doesn't leak through.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT))
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <KeyboardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
  )
}
