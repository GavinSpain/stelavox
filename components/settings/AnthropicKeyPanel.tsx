'use client'

/**
 * V1.x-B.1.2 — AnthropicKeyPanel.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.5.
 *
 * Single input + Save (verdigris use #7 — affirmative-action triggers
 * family) + Delete (destructive token, NOT verdigris) + status indicator.
 *
 * Status indicator states:
 *   - green dot + "Key set, validated <relative time>" when present
 *   - muted "No BYOK key set — using platform key" when absent
 *   - red dot + "Validation failed: <reason>" after failed save attempt
 *
 * H-09 invariant honoured at the UI layer:
 *   - Input field type=password (the value never appears in plain text on
 *     the user's screen after typing)
 *   - On successful save the input clears (no need to keep displaying)
 *   - The key is never echoed back from the server (status payload only
 *     carries last_four)
 *
 * Inviolable #2: Save button is verdigris use #7 (affirmative-action
 * triggers family — within the existing nine; no broadening). Delete is
 * destructive-token, NOT verdigris.
 */

import { useCallback, useEffect, useState } from 'react'
import type { UserKeyStatus } from '@/lib/byok'

const STATUS_INDICATOR_GREEN = 'rgb(110, 175, 110)'
const STATUS_INDICATOR_MUTED = 'var(--color-text-muted)'
// Failed-validation persistent indicator deferred to V1.x-D; B.1.2
// surfaces validation failure inline as the saveError below the input.

export function AnthropicKeyPanel() {
  const [status, setStatus] = useState<UserKeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/user/anthropic-key', { cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as UserKeyStatus
        setStatus(body)
      }
    } catch {
      // Network error — keep last known
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  async function save() {
    if (keyInput.trim().length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/user/anthropic-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim() }),
      })
      if (res.status === 422) {
        const body = (await res.json()) as { reason?: string }
        setSaveError(body.reason ?? 'Key rejected by Anthropic.')
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setSaveError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      // Success — clear input + refresh status.
      setKeyInput('')
      await refresh()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteKey() {
    setDeleting(true)
    try {
      const res = await fetch('/api/user/anthropic-key', { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        setSaveError(body?.message ?? `Delete failed (${res.status})`)
        return
      }
      setConfirmingDelete(false)
      await refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section
      data-testid="anthropic-key-panel"
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '20px 24px',
        maxWidth: 540,
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: '0 0 4px', color: 'var(--color-text-primary)' }}>
        Anthropic API key (BYOK)
      </h2>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
        Use your own Anthropic API key for Director conversations. Your key is encrypted at rest with Supabase Vault, dispatched only through an isolated Edge Function, and never logged.
      </p>

      <StatusIndicator status={status} loading={loading} />

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input
          data-testid="anthropic-key-input"
          type="password"
          placeholder="sk-ant-..."
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value)
            if (saveError) setSaveError(null)
          }}
          disabled={saving}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-primary)',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        />
        <button
          type="button"
          data-testid="anthropic-key-save"
          disabled={saving || keyInput.trim().length === 0}
          onClick={() => void save()}
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-bg-base)',
            border: 'none',
            padding: '8px 18px',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 500,
            cursor: saving || keyInput.trim().length === 0 ? 'not-allowed' : 'pointer',
            opacity: saving || keyInput.trim().length === 0 ? 0.6 : 1,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          {saving ? 'Validating…' : 'Save'}
        </button>
      </div>

      {saveError ? (
        <div
          role="alert"
          data-testid="anthropic-key-error"
          style={{
            marginTop: 10,
            padding: '8px 12px',
            background: 'rgba(184,48,48,0.08)',
            border: '1px solid rgba(184,48,48,0.25)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--color-text-primary)',
          }}
        >
          {saveError}
        </div>
      ) : null}

      {status?.present ? (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-border-subtle)' }}>
          {confirmingDelete ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', flex: 1 }}>
                Delete the key on file? Director conversations will revert to the platform key.
              </span>
              <button
                type="button"
                data-testid="anthropic-key-delete-confirm"
                disabled={deleting}
                onClick={() => void deleteKey()}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(184,48,48,0.6)',
                  color: 'rgba(184,48,48,0.95)',
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                }}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="anthropic-key-delete-trigger"
              onClick={() => setConfirmingDelete(true)}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border-strong)',
                color: 'var(--color-text-secondary)',
                padding: '6px 14px',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'var(--font-inter), Inter, sans-serif',
              }}
            >
              Delete key
            </button>
          )}
        </div>
      ) : null}
    </section>
  )
}

function StatusIndicator({ status, loading }: { status: UserKeyStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
    )
  }
  if (!status || !status.present) {
    return (
      <div data-testid="anthropic-key-status" data-state="absent" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: STATUS_INDICATOR_MUTED }} />
        No BYOK key set — using platform key
      </div>
    )
  }
  return (
    <div data-testid="anthropic-key-status" data-state="present" data-last-four={status.last_four} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-primary)' }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: STATUS_INDICATOR_GREEN }} />
      Key set (ending …{status.last_four}) · validated {relativeTime(status.last_validated_at)}
    </div>
  )
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
