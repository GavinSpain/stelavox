'use client'

// Spec: stelavox_component_specification_v2_10.md §17.2 (BriefViewer)
//       Director Architecture v2.0 §6.3 (BriefStatePayload shape)
//
// Read-only project-header panel showing the current Brief state.
// Subscribes to realtime updates on the briefs + brief_stages tables for
// this document. Empty Brief shows a placeholder; populated Brief shows
// goal text + stage list + preferences + recent amendments.
//
// Inviolable discipline: Inter typography only (structural panel). No
// verdigris use in this component (StageCard's Approve button is the
// only verdigris affordance, and that only fires on `proposed` status).

import { useEffect, useState } from 'react'

import type { BriefStatePayload } from '@/lib/brief/types'
import { createClient } from '@/lib/supabase/client'
import { StageCard } from './StageCard'

interface BriefViewerProps {
  briefId: string
  initialState?: BriefStatePayload | null
}

export function BriefViewer({ briefId, initialState }: BriefViewerProps) {
  const [state, setState] = useState<BriefStatePayload | null>(initialState ?? null)
  const [loading, setLoading] = useState(!initialState)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial state if not provided.
  useEffect(() => {
    if (initialState) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/brief/${briefId}`)
        if (cancelled) return
        if (!res.ok) {
          setError(`Failed to load Brief (${res.status})`)
        } else {
          const payload = (await res.json()) as BriefStatePayload
          if (!cancelled) setState(payload)
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [briefId, initialState])

  // Realtime subscriptions on briefs + brief_stages.
  useEffect(() => {
    const supabase = createClient()
    const refetch = async () => {
      const res = await fetch(`/api/brief/${briefId}`)
      if (res.ok) setState((await res.json()) as BriefStatePayload)
    }
    const channel = supabase
      .channel(`brief:${briefId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'briefs', filter: `id=eq.${briefId}` },
        () => void refetch(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'brief_stages',
          filter: `brief_id=eq.${briefId}`,
        },
        () => void refetch(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [briefId])

  if (loading) {
    return (
      <section
        data-testid="brief-viewer"
        data-state="loading"
        style={panelStyle}
        aria-busy="true"
      >
        <Header />
        <div style={mutedStyle}>Loading Brief…</div>
      </section>
    )
  }

  if (error) {
    return (
      <section data-testid="brief-viewer" data-state="error" style={panelStyle}>
        <Header />
        <div style={{ ...mutedStyle, color: 'var(--color-text-secondary)' }}>{error}</div>
      </section>
    )
  }

  if (!state || state.goal_text === null) {
    return (
      <section data-testid="brief-viewer" data-state="empty" style={panelStyle}>
        <Header />
        <div style={mutedStyle}>
          No project goal set yet. The Director will propose one when you describe what you
          want to work on.
        </div>
      </section>
    )
  }

  return (
    <section data-testid="brief-viewer" data-state="populated" style={panelStyle}>
      <Header />
      <div
        style={{
          fontWeight: 400,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          lineHeight: 1.5,
          marginBottom: 12,
        }}
      >
        {state.goal_text}
      </div>

      {state.stages.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <SectionLabel>Stages</SectionLabel>
          <ol
            style={{
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {state.stages.map((s) => (
              <StageCard
                key={s.order}
                order={s.order}
                title={s.title}
                description={s.description}
                trigger_type={s.trigger_type}
                status={s.status}
                is_current={state.current_stage?.order === s.order}
              />
            ))}
          </ol>
        </div>
      ) : null}

      {hasAnyPreference(state.preferences) ? (
        <div style={{ marginBottom: 12 }}>
          <SectionLabel>Preferences</SectionLabel>
          <PreferencesView preferences={state.preferences} />
        </div>
      ) : null}

      {state.recent_amendments.length > 0 ? (
        <div>
          <SectionLabel>Recent amendments</SectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {state.recent_amendments.map((a, i) => (
              <li
                key={i}
                style={{
                  fontWeight: 300,
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.4,
                  padding: '2px 0',
                }}
              >
                <span>{a.amendment_type}</span>
                {a.reason ? <span> — {a.reason}</span> : null}
                <span style={{ marginLeft: 6 }}>·</span>
                <span style={{ marginLeft: 6 }}>{formatRelative(a.approved_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function Header() {
  return (
    <div
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 500,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'var(--color-text-muted)',
        marginBottom: 8,
      }}
    >
      Project Brief
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 500,
        fontSize: 12,
        color: 'var(--color-text-secondary)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function PreferencesView({ preferences }: { preferences: Record<string, unknown> }) {
  const voice = typeof preferences.voice === 'string' ? preferences.voice : null
  const constraints = Array.isArray(preferences.constraints)
    ? (preferences.constraints as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  const decisions = Array.isArray(preferences.decisions)
    ? (preferences.decisions as unknown[]).filter((s): s is string => typeof s === 'string')
    : []

  return (
    <div style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
      {voice ? (
        <PreferenceRow label="Voice">{voice}</PreferenceRow>
      ) : null}
      {constraints.length > 0 ? (
        <PreferenceRow label="Constraints">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {constraints.map((c, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{c}</li>
            ))}
          </ul>
        </PreferenceRow>
      ) : null}
      {decisions.length > 0 ? (
        <PreferenceRow label="Decisions">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {decisions.map((d, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{d}</li>
            ))}
          </ul>
        </PreferenceRow>
      ) : null}
    </div>
  )
}

function PreferenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, alignItems: 'baseline' }}>
      <span
        style={{
          minWidth: 90,
          fontSize: 12,
          fontWeight: 400,
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>
        {children}
      </span>
    </div>
  )
}

function hasAnyPreference(p: Record<string, unknown>): boolean {
  return Object.keys(p).length > 0
}

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime()
    const ageMs = Date.now() - t
    const min = Math.floor(ageMs / 60_000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const d = Math.floor(hr / 24)
    return `${d}d ago`
  } catch {
    return iso
  }
}

const panelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  padding: '12px 14px',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 8,
}

const mutedStyle: React.CSSProperties = {
  fontWeight: 300,
  fontSize: 13,
  color: 'var(--color-text-muted)',
  lineHeight: 1.5,
}
