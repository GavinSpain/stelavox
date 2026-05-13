'use client'

// Spec: stelavox_director_architecture_v2_1_0.md §6.1 + Component Spec v2.10 §17.2 (revised)
//
// Read-only project-header panel showing the current Project Profile.
// Subscribes to realtime updates on project_profiles + profile_amendments
// for this document.
//
// Inviolable discipline: Inter typography only (structural panel). No
// verdigris use.

import { useEffect, useState } from 'react'

import type { ProjectProfilePayload } from '@/lib/profile/types'
import { createClient } from '@/lib/supabase/client'

interface ProjectProfileViewerProps {
  profileId: string
  initialState?: ProjectProfilePayload | null
}

export function ProjectProfileViewer({ profileId, initialState }: ProjectProfileViewerProps) {
  const [state, setState] = useState<ProjectProfilePayload | null>(initialState ?? null)
  const [loading, setLoading] = useState(!initialState)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialState) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/profile/${profileId}`)
        if (cancelled) return
        if (!res.ok) {
          setError(`Failed to load Project Profile (${res.status})`)
        } else {
          const payload = (await res.json()) as ProjectProfilePayload
          if (!cancelled) setState(payload)
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [profileId, initialState])

  useEffect(() => {
    const supabase = createClient()
    const refetch = async () => {
      const res = await fetch(`/api/profile/${profileId}`)
      if (res.ok) setState((await res.json()) as ProjectProfilePayload)
    }
    const channel = supabase
      .channel(`profile:${profileId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_profiles', filter: `id=eq.${profileId}` }, () => void refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_amendments', filter: `profile_id=eq.${profileId}` }, () => void refetch())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [profileId])

  if (loading) {
    return (
      <section data-testid="project-profile-viewer" data-state="loading" style={panelStyle} aria-busy="true">
        <Header />
        <div style={mutedStyle}>Loading Project Profile…</div>
      </section>
    )
  }
  if (error) {
    return (
      <section data-testid="project-profile-viewer" data-state="error" style={panelStyle}>
        <Header />
        <div style={{ ...mutedStyle, color: 'var(--color-text-secondary)' }}>{error}</div>
      </section>
    )
  }
  if (!state) {
    return (
      <section data-testid="project-profile-viewer" data-state="empty" style={panelStyle}>
        <Header />
        <div style={mutedStyle}>No Project Profile yet.</div>
      </section>
    )
  }

  const voice = typeof state.preferences.voice === 'string' ? state.preferences.voice : null
  const constraints = Array.isArray(state.preferences.constraints)
    ? (state.preferences.constraints as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  const decisions = Array.isArray(state.preferences.decisions)
    ? (state.preferences.decisions as unknown[]).filter((s): s is string => typeof s === 'string')
    : []

  const empty = !state.goal_text && !voice && constraints.length === 0 && decisions.length === 0

  return (
    <section data-testid="project-profile-viewer" data-state={empty ? 'unpopulated' : 'populated'} style={panelStyle}>
      <Header />

      {empty ? (
        <div style={mutedStyle}>
          No project preferences set yet. As you work with the Director, it will propose adding voice
          rules, constraints, named decisions, and named entities here.
        </div>
      ) : (
        <>
          {state.goal_text ? (
            <div style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 12 }}>
              {state.goal_text}
            </div>
          ) : null}

          {voice || constraints.length > 0 || decisions.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>Preferences</SectionLabel>
              {voice ? <Row label="Voice">{voice}</Row> : null}
              {constraints.length > 0 ? (
                <Row label="Constraints">
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {constraints.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </Row>
              ) : null}
              {decisions.length > 0 ? (
                <Row label="Decisions">
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </Row>
              ) : null}
            </div>
          ) : null}

          {state.recent_amendments.length > 0 ? (
            <div>
              <SectionLabel>Recent amendments</SectionLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {state.recent_amendments.map((a, i) => (
                  <li key={i} style={{ fontWeight: 300, fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4, padding: '2px 0' }}>
                    <span>{a.amendment_type}</span>
                    {a.reason ? <span> — {a.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function Header() {
  return (
    <div style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)', marginBottom: 8 }}>
      Project Profile
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontWeight: 500, fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, alignItems: 'baseline' }}>
      <span style={{ minWidth: 90, fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>{children}</span>
    </div>
  )
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
