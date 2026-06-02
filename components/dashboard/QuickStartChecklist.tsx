'use client'

// Phase 8.01.D T-7 — Quick Start checklist.
//
// Spec: Component Spec v2.21 §18.6.
// Per OQ-2 lock: completion is server-derived; localStorage holds only
// the "user dismissed the condensed Setup-complete banner" UI state.
//
// Inviolable #2: checked-box verdigris falls under use #5 (approved
// status family — passive completion indicator). No new use category.

import { useEffect, useState } from 'react'
import {
  countCompleted,
  allComplete,
  type QuickStartCompletion,
} from '@/lib/dashboard/quickStartCompletion'

export type { QuickStartCompletion }

interface QuickStartChecklistProps {
  completion: QuickStartCompletion
}

interface Item {
  id: keyof QuickStartCompletion
  label: string
  meta?: string
}

const ITEMS: Item[] = [
  { id: 'signedIn',          label: 'Sign in' },
  { id: 'hasProject',        label: 'Create your first project', meta: 'Novel or Series' },
  { id: 'hasBeatWithProse',  label: 'Add a beat and write',       meta: '~2 minutes' },
  { id: 'hasTriedDirector',  label: 'Try the Director',           meta: 'Ask for a scene' },
  { id: 'hasCompletedExport',label: 'Export your first chapter',  meta: 'DOCX or EPUB' },
]

const DISMISSED_KEY = 'stelavox_qs_dismissed_v1'

export function QuickStartChecklist({ completion }: QuickStartChecklistProps) {
  const done = countCompleted(completion)
  const complete = allComplete(completion)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(DISMISSED_KEY) === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDismissed(true)
    }
  }, [])

  if (dismissed) return null

  if (complete) {
    return (
      <div
        data-testid="quick-start-complete"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12,
          color: 'var(--color-text-secondary)',
        }}
      >
        <span style={{ color: 'var(--color-accent)' }}>✓</span>
        <span style={{ flex: 1 }}>Setup complete</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            window.localStorage.setItem(DISMISSED_KEY, 'true')
            setDismissed(true)
          }}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div data-testid="quick-start-checklist" data-completed={done}>
      {ITEMS.map((item) => {
        const isDone = completion[item.id]
        return (
          <div
            key={item.id}
            data-testid={`qs-item-${item.id}`}
            data-done={isDone ? 'true' : 'false'}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 10px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              color: 'var(--color-text-primary)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 14,
                height: 14,
                border: '1px solid var(--color-border-strong)',
                borderRadius: 3,
                flexShrink: 0,
                marginTop: 1,
                background: isDone ? 'var(--color-accent)' : 'transparent',
                borderColor: isDone ? 'var(--color-accent)' : 'var(--color-border-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-bg-base)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {isDone ? '✓' : ''}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  color: isDone ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
                  textDecoration: isDone ? 'line-through' : undefined,
                }}
              >
                {item.label}
              </div>
              {item.meta && (
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-text-muted)',
                    marginTop: 2,
                  }}
                >
                  {item.meta}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
