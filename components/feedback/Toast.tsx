'use client'

// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.5 (cross-cutting)
//       stelavox_component_specification_v2_0.md (no §-explicit toast yet
//                                                   in v2.0; future spec to fill)
//
// Phase 2 stub: minimal toast manager. Mounts a fixed bottom-right
// stack; each toast auto-dismisses after 4s and can be dismissed by
// clicking. ToastProvider wraps any subtree that needs to surface
// toasts via the useToast() hook.
//
// Used initially by the tree drag-and-drop wiring (T-5.1) to surface
// API rejection messages. Other components can adopt later.
//
// A future polish task should extract this to a system-level
// container at the AppShell level and add proper ARIA live-region
// semantics + reduce-motion handling.

import { createContext, useCallback, useContext, useState } from 'react'

interface ToastEntry {
  id: number
  message: string
  variant: 'error' | 'info'
}

interface ToastApi {
  show: (message: string, variant?: 'error' | 'info') => void
}

const ToastContext = createContext<ToastApi>({ show: () => {} })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

let toastIdSeq = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const show = useCallback((message: string, variant: 'error' | 'info' = 'info') => {
    toastIdSeq += 1
    const id = toastIdSeq
    setToasts(prev => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  function dismiss(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 100,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            data-testid="toast"
            data-variant={t.variant}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: 'auto',
              cursor: 'pointer',
              background: t.variant === 'error' ? 'var(--color-error)' : 'var(--color-bg-elevated)',
              color: t.variant === 'error' ? 'white' : 'var(--color-text-primary)',
              border: '1px solid var(--color-border-default)',
              borderRadius: '6px',
              padding: '10px 14px',
              fontSize: 'var(--text-sm)',
              maxWidth: '420px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
