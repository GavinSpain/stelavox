/**
 * Phase 8.4 — Keyboard shortcuts registry.
 *
 * Source of truth for every keyboard shortcut surfaced to the author.
 * The KeyboardShortcutsHelp overlay (the `?`-triggered help dialog)
 * renders directly from this data; components keep their actual
 * keydown handlers where they make sense (focus mode in FocusMode,
 * formatting in ProseEditor, etc.). Adding a new shortcut means:
 *
 *   1. Implement the handler in the owning component
 *   2. Add an entry here so it appears in the help overlay
 *
 * The two are coupled by convention, not by code — the registry is
 * pure data and never invoked at runtime to dispatch events. This
 * keeps the existing per-component handlers unchanged while still
 * giving the user a single, accurate list.
 *
 * Mod-key convention: `⌘` is used in the keyDisplay strings as the
 * cross-platform "command/control" glyph. `keyDisplayForPlatform`
 * replaces it with `Ctrl` on non-Mac platforms at render time.
 */

export type ShortcutScope =
  | 'global'      // works anywhere outside text inputs
  | 'document'    // works on a document page
  | 'editor'      // inside the prose / summary / notes editor
  | 'focus'       // inside Focus Mode
  | 'modal'       // when a modal/menu is open

export interface ShortcutEntry {
  /** Stable id — also used as the test-id when the entry surfaces in the UI. */
  id: string
  /** Cross-platform display string (`⌘` → `Ctrl` on Windows/Linux). */
  keyDisplay: string
  /** User-facing label, kept short. */
  label: string
  /** Where the shortcut is active. */
  scope: ShortcutScope
}

export const SCOPE_TITLES: Record<ShortcutScope, string> = {
  global:   'Anywhere',
  document: 'On a document',
  editor:   'In the editor',
  focus:    'In Focus Mode',
  modal:    'In a dialog or menu',
}

/** The canonical list. New shortcuts go here in order of scope. */
export const SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  // ─── Global ────────────────────────────────────────────────────────
  { id: 'help',     keyDisplay: '?',  label: 'Show keyboard shortcuts',  scope: 'global' },
  { id: 'palette',  keyDisplay: '⌘K', label: 'Open command palette',     scope: 'global' },

  // ─── Document ──────────────────────────────────────────────────────
  { id: 'export',     keyDisplay: '⌘⇧E', label: 'Export this document',    scope: 'document' },
  { id: 'enter-focus', keyDisplay: '⌘↵',  label: 'Enter Focus Mode on this leaf', scope: 'document' },

  // ─── Editor ────────────────────────────────────────────────────────
  { id: 'bold',   keyDisplay: '⌘B', label: 'Bold the selection',                  scope: 'editor' },
  { id: 'italic', keyDisplay: '⌘I', label: 'Italicise the selection',             scope: 'editor' },
  { id: 'link',   keyDisplay: '⌘K', label: 'Add a link to the selection',         scope: 'editor' },
  { id: 'undo',   keyDisplay: '⌘Z', label: 'Undo the last change',                scope: 'editor' },
  { id: 'redo',   keyDisplay: '⌘⇧Z', label: 'Redo the next change',               scope: 'editor' },

  // ─── Focus Mode ────────────────────────────────────────────────────
  { id: 'exit-focus',  keyDisplay: 'Esc', label: 'Exit Focus Mode',         scope: 'focus' },
  { id: 'exit-focus-mod', keyDisplay: '⌘↵', label: 'Exit Focus Mode',       scope: 'focus' },
  { id: 'prev-beat',   keyDisplay: '⌘←',  label: 'Previous beat',           scope: 'focus' },
  { id: 'next-beat',   keyDisplay: '⌘→',  label: 'Next beat',               scope: 'focus' },

  // ─── Modal / Menu ──────────────────────────────────────────────────
  { id: 'close-modal', keyDisplay: 'Esc', label: 'Close this dialog or menu', scope: 'modal' },
]

/** Group the registry by scope, preserving in-scope insertion order. */
export function shortcutsByScope(): Array<{ scope: ShortcutScope; entries: ShortcutEntry[] }> {
  const buckets = new Map<ShortcutScope, ShortcutEntry[]>()
  for (const entry of SHORTCUTS) {
    const list = buckets.get(entry.scope) ?? []
    list.push(entry)
    buckets.set(entry.scope, list)
  }
  // Preserve the canonical scope order: global → document → editor → focus → modal
  const order: ShortcutScope[] = ['global', 'document', 'editor', 'focus', 'modal']
  return order
    .filter((s) => buckets.has(s))
    .map((scope) => ({ scope, entries: buckets.get(scope)! }))
}

/** Replace `⌘` with `Ctrl` on non-Mac platforms. Reads navigator.platform
 *  at render time; SSR-safe (default to Mac glyphs on the server and let
 *  the client correct on hydration — the help dialog isn't visible
 *  during SSR anyway). */
export function keyDisplayForPlatform(keyDisplay: string): string {
  if (typeof navigator === 'undefined') return keyDisplay
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
  if (isMac) return keyDisplay
  return keyDisplay.replace(/⌘/g, 'Ctrl').replace(/↵/g, 'Enter')
}

/** Detect whether the event target is inside a text-entry surface.
 *  Used by the global keyboard handler to skip shortcuts when the
 *  user is typing into an input / textarea / contenteditable (Tiptap
 *  uses contenteditable underneath). Exported for unit testing.
 *
 *  Duck-typed against `.closest()` rather than `instanceof Element`
 *  so the helper is portable to Vitest's node environment (no DOM
 *  globals) for unit tests. */
export function isTargetInTextInput(target: EventTarget | null): boolean {
  if (!target) return false
  // Need .closest() to walk the ancestor chain. Anything without it
  // can't be an Element we care about.
  const maybe = target as { closest?: (selector: string) => Element | null }
  if (typeof maybe.closest !== 'function') return false
  if (maybe.closest('input, textarea')) return true
  if (maybe.closest('[contenteditable=""], [contenteditable="true"]')) return true
  return false
}
