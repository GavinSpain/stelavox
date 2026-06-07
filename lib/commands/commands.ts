/**
 * Phase 8.1 — Command palette registry.
 *
 * Pure data + helpers for the commands the palette can run. Each
 * command is one of two shapes:
 *
 *   • action='navigate' — palette closes and the user is routed to
 *     `path`. Handled by the palette via Next.js router.
 *   • action='emit' — palette closes and a window CustomEvent is
 *     dispatched with the given name + optional detail payload.
 *     Other components (mode tab bar, prose settings, etc.) listen.
 *
 * The `emit` shape keeps the palette decoupled from the components
 * it actuates — adding a new toggle to the palette is data, not a
 * code import. The downside is one indirection: each emitting
 * command lands at a window event that some component must already
 * be listening for. Worth that cost for the loose coupling.
 *
 * Context-aware commands (e.g., "Go to current document") depend on
 * route state. The palette derives a small CommandContext from the
 * Sidebar project state + Next router, and `availableCommands(ctx)`
 * filters the registry to what's runnable right now.
 */

export type CommandAction =
  | { kind: 'navigate'; path: string }
  | { kind: 'emit'; event: string; detail?: Record<string, unknown> }

/** Scope under which a command appears. Drives the group heading in
 *  the palette and (with context) decides availability. */
export type CommandGroup =
  | 'navigate'
  | 'mode'
  | 'toggle'
  | 'action'

export interface CommandDescriptor {
  id: string
  label: string
  /** Keywords for fuzzy match — cmdk concatenates `label` + `keywords`. */
  keywords?: string[]
  group: CommandGroup
  /** Pre-rendered glyph (no icon dependency). Optional. */
  glyph?: string
  /** Shortcut to display on the right of the item (decorative; the real
   *  handler is the per-component keydown listener — same convention as
   *  KeyboardShortcutsHelp). */
  shortcut?: string
  action: CommandAction
  /** Optional gate: command is hidden when this returns false.
   *  Receives the context the palette assembles. */
  availableWhen?: (ctx: CommandContext) => boolean
}

export const GROUP_TITLES: Record<CommandGroup, string> = {
  navigate: 'Navigate',
  mode:     'Mode',
  toggle:   'Toggle',
  action:   'Action',
}

/** Context the palette assembles from the current route + sidebar
 *  state. Each field is optional — palette opens on any route. */
export interface CommandContext {
  /** Document the user is currently looking at (if any). */
  projectId: string | null
  documentId: string | null
  /** Current ModeContext value (edit / director). */
  mode: 'edit' | 'director' | null
  /** Is the user on a route that's INSIDE a document page? */
  onDocumentPage: boolean
}

/**
 * Window event names dispatched by `kind: 'emit'` commands. Other
 * components subscribe — single-source-of-truth for the wire names so
 * no caller string-types the event by hand.
 */
export const COMMAND_EVENT = {
  toggleSentenceFocus: 'stelavox:command:toggle-sentence-focus',
  toggleTypewriter:    'stelavox:command:toggle-typewriter',
  enterFocusMode:      'stelavox:command:enter-focus-mode',
  switchModeEdit:      'stelavox:command:switch-mode-edit',
  switchModeDirector:  'stelavox:command:switch-mode-director',
  showShortcuts:       'stelavox:command:show-shortcuts',
  signOut:             'stelavox:command:sign-out',
  exportDocument:      'stelavox:command:export-document',
} as const

/** Canonical command list. Order within each group is preserved when
 *  the palette renders. */
export const COMMANDS: ReadonlyArray<CommandDescriptor> = [
  // ─── Navigate ──────────────────────────────────────────────────────
  {
    id: 'go-dashboard',
    label: 'Go to dashboard',
    keywords: ['home', 'projects'],
    group: 'navigate',
    glyph: '🏠',
    action: { kind: 'navigate', path: '/dashboard' },
  },
  {
    id: 'go-current-project',
    label: 'Go to current project',
    keywords: ['project'],
    group: 'navigate',
    glyph: '📁',
    action: { kind: 'navigate', path: '' /* derived in selector */ },
    availableWhen: (ctx) => Boolean(ctx.projectId),
  },
  {
    id: 'go-scheduler',
    label: 'Go to scheduler',
    keywords: ['queue', 'jobs'],
    group: 'navigate',
    glyph: '⏱',
    action: { kind: 'navigate', path: '' /* derived */ },
    availableWhen: (ctx) => ctx.onDocumentPage,
  },
  {
    id: 'go-settings',
    label: 'Go to settings',
    keywords: ['preferences'],
    group: 'navigate',
    glyph: '⚙',
    action: { kind: 'navigate', path: '/settings' },
  },
  {
    id: 'go-api-keys',
    label: 'Go to API keys',
    keywords: ['byok', 'anthropic', 'settings'],
    group: 'navigate',
    glyph: '🔑',
    action: { kind: 'navigate', path: '/settings/api-keys' },
  },
  {
    id: 'go-usage',
    label: 'Go to usage',
    keywords: ['cost', 'plan', 'tokens', 'meter'],
    group: 'navigate',
    glyph: '📊',
    action: { kind: 'navigate', path: '/settings/usage' },
  },

  // ─── Mode ──────────────────────────────────────────────────────────
  {
    id: 'switch-edit',
    label: 'Switch to Edit mode',
    keywords: ['write', 'editor'],
    group: 'mode',
    glyph: '✎',
    action: { kind: 'emit', event: COMMAND_EVENT.switchModeEdit },
    availableWhen: (ctx) => ctx.onDocumentPage && ctx.mode !== 'edit',
  },
  {
    id: 'switch-director',
    label: 'Switch to Director mode',
    keywords: ['agent', 'workflow'],
    group: 'mode',
    glyph: '◆',
    action: { kind: 'emit', event: COMMAND_EVENT.switchModeDirector },
    availableWhen: (ctx) => ctx.onDocumentPage && ctx.mode !== 'director',
  },
  {
    id: 'enter-focus',
    label: 'Enter Focus Mode',
    keywords: ['fullscreen', 'distraction-free'],
    group: 'mode',
    glyph: '⊞',
    shortcut: '⌘↵',
    action: { kind: 'emit', event: COMMAND_EVENT.enterFocusMode },
    availableWhen: (ctx) => ctx.onDocumentPage,
  },

  // ─── Toggle ────────────────────────────────────────────────────────
  {
    id: 'toggle-sentence-focus',
    label: 'Toggle Sentence Focus',
    keywords: ['dim', 'reading', 'cursor'],
    group: 'toggle',
    glyph: '◐',
    action: { kind: 'emit', event: COMMAND_EVENT.toggleSentenceFocus },
  },
  {
    id: 'toggle-typewriter',
    label: 'Toggle Typewriter',
    keywords: ['scroll', 'centre'],
    group: 'toggle',
    glyph: '⌶',
    action: { kind: 'emit', event: COMMAND_EVENT.toggleTypewriter },
  },

  // ─── Action ────────────────────────────────────────────────────────
  {
    id: 'show-shortcuts',
    label: 'Show keyboard shortcuts',
    keywords: ['help', 'keys'],
    group: 'action',
    glyph: '?',
    shortcut: '?',
    action: { kind: 'emit', event: COMMAND_EVENT.showShortcuts },
  },
  {
    id: 'export-document',
    label: 'Export current document',
    keywords: ['download', 'docx', 'epub', 'json'],
    group: 'action',
    glyph: '📄',
    shortcut: '⌘⇧E',
    action: { kind: 'emit', event: COMMAND_EVENT.exportDocument },
    availableWhen: (ctx) => ctx.onDocumentPage,
  },
  {
    id: 'sign-out',
    label: 'Sign out',
    keywords: ['logout', 'leave'],
    group: 'action',
    glyph: '⎋',
    action: { kind: 'emit', event: COMMAND_EVENT.signOut },
  },
]

/** Filter the registry to commands runnable in the given context.
 *  Exported for unit testing — palette renders this output. */
export function availableCommands(
  ctx: CommandContext,
): CommandDescriptor[] {
  return COMMANDS.filter((c) =>
    c.availableWhen ? c.availableWhen(ctx) : true,
  )
}

/** Build a navigate path for context-aware commands whose path was
 *  declared as empty. Exported for unit testing. */
export function resolveNavigatePath(
  command: CommandDescriptor,
  ctx: CommandContext,
): string | null {
  if (command.action.kind !== 'navigate') return null
  if (command.action.path) return command.action.path
  if (command.id === 'go-current-project' && ctx.projectId) {
    return `/projects/${ctx.projectId}`
  }
  if (command.id === 'go-scheduler' && ctx.projectId && ctx.documentId) {
    return `/projects/${ctx.projectId}/documents/${ctx.documentId}/scheduler`
  }
  return null
}

/** Group a list of commands by their group, preserving canonical
 *  group order. Exported for unit testing. */
export function groupCommands(
  commands: CommandDescriptor[],
): Array<{ group: CommandGroup; commands: CommandDescriptor[] }> {
  const order: CommandGroup[] = ['navigate', 'mode', 'toggle', 'action']
  const buckets = new Map<CommandGroup, CommandDescriptor[]>()
  for (const c of commands) {
    const list = buckets.get(c.group) ?? []
    list.push(c)
    buckets.set(c.group, list)
  }
  return order
    .filter((g) => buckets.has(g))
    .map((group) => ({ group, commands: buckets.get(group)! }))
}
