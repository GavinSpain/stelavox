'use client'

// Phase 8 nav refactor: mode (Edit / Director / Scheduler) is URL-driven.
//
// `mode` is derived from `usePathname()`:
//   /projects/[p]/documents/[d]            → 'edit'   (default)
//   /projects/[p]/documents/[d]/director   → 'director'
//   /projects/[p]/documents/[d]/scheduler  → 'scheduler'
//
// `setMode(m)` is a navigation call. It pushes the appropriate URL
// using the projectId + documentId derived from the current pathname.
//
// `enabled` is true iff the pathname is inside a document route. The
// document layout still calls `setEnabled(true)` for backwards-compat
// with consumers that watch the flag, but internally `enabled` is also
// derived from pathname.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'

export type AppMode = 'edit' | 'director' | 'scheduler'

interface ModeContextValue {
  mode: AppMode
  setMode: (m: AppMode) => void
  enabled: boolean
  setEnabled: (e: boolean) => void
}

const ModeContext = createContext<ModeContextValue>({
  mode: 'edit',
  setMode: () => {},
  enabled: false,
  setEnabled: () => {},
})

export function useMode() {
  return useContext(ModeContext)
}

const DOCUMENT_ROUTE_RX =
  /^\/projects\/([^/]+)\/documents\/([^/]+)(?:\/(director|scheduler))?(?:\/|$)/

/** Returns `{ projectId, documentId, mode }` if the path is a document
 *  route, otherwise `null`. */
function parseDocumentRoute(pathname: string | null):
  | { projectId: string; documentId: string; mode: AppMode }
  | null {
  if (!pathname) return null
  const m = pathname.match(DOCUMENT_ROUTE_RX)
  if (!m) return null
  const subroute = m[3]
  const mode: AppMode =
    subroute === 'director' ? 'director' : subroute === 'scheduler' ? 'scheduler' : 'edit'
  return { projectId: m[1]!, documentId: m[2]!, mode }
}

export function ModeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  // `enabledOverride` lets the document layout explicitly enable the
  // mode bar even before the pathname-derive completes (avoids a
  // first-paint flash). The derived value still wins for changes.
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null)

  const parsed = useMemo(() => parseDocumentRoute(pathname), [pathname])
  const enabled = enabledOverride ?? parsed !== null
  const mode: AppMode = parsed?.mode ?? 'edit'

  const setMode = useCallback(
    (next: AppMode) => {
      if (!parsed) return
      const { projectId, documentId } = parsed
      const base = `/projects/${projectId}/documents/${documentId}`
      const url =
        next === 'edit' ? base : next === 'director' ? `${base}/director` : `${base}/scheduler`
      router.push(url)
    },
    [parsed, router],
  )

  // ⌘. (and Ctrl+. on non-mac) toggles Edit ↔ Director when enabled.
  // Scheduler is reachable via its tab; the keyboard shortcut keeps the
  // historical Edit ↔ Director binding because that's the most common
  // pair of toggles during writing work.
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === '.') {
        e.preventDefault()
        setMode(mode === 'edit' ? 'director' : 'edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, mode, setMode])

  // Phase 8.1 — command palette emit events for mode switching.
  useEffect(() => {
    if (!enabled) return
    function onSwitchEdit() { setMode('edit') }
    function onSwitchDirector() { setMode('director') }
    window.addEventListener('stelavox:command:switch-mode-edit', onSwitchEdit)
    window.addEventListener('stelavox:command:switch-mode-director', onSwitchDirector)
    return () => {
      window.removeEventListener('stelavox:command:switch-mode-edit', onSwitchEdit)
      window.removeEventListener('stelavox:command:switch-mode-director', onSwitchDirector)
    }
  }, [enabled, setMode])

  return (
    <ModeContext.Provider
      value={{
        mode,
        setMode,
        enabled,
        setEnabled: setEnabledOverride,
      }}
    >
      {children}
    </ModeContext.Provider>
  )
}
