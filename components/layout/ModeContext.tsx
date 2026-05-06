'use client'

// Spec: stelavox_component_specification_v2_7.md §2.5 (ModeTabBar) +
//       §7.1 (DirectorPanel — G-12 mode swap)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1
//
// Edit-vs-Director mode state, lifted to AppShell so the ModeTabBar in
// the global Header can write it and the DocumentClient can read it
// (deciding which panel to push into the right slot). Focus Mode is a
// transient overlay, not a stored mode value, so it is NOT part of
// this state.
//
// Mode is enabled only on document routes. Non-document pages (dash,
// project list) call setEnabled(false) implicitly by not mounting any
// document client; the default `enabled: false` keeps the tab bar
// disabled until a document client mounts and flips it true.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type AppMode = 'edit' | 'director'

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

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode>('edit')
  const [enabled, setEnabled] = useState(false)

  // ⌘. (and Ctrl+. on non-mac) toggles Edit ↔ Director when enabled.
  // The shortcut is a no-op on non-document routes.
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === '.') {
        e.preventDefault()
        setMode((m) => (m === 'edit' ? 'director' : 'edit'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  // When the document client unmounts (route change away from a
  // document), reset to Edit so the next document opens in Edit by
  // default.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!enabled) setMode('edit')
  }, [enabled])

  return (
    <ModeContext.Provider
      value={{
        mode,
        setMode,
        enabled,
        setEnabled,
      }}
    >
      {children}
    </ModeContext.Provider>
  )
}
