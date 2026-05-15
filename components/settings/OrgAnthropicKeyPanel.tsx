'use client'

/**
 * V1.x-C.4 — OrgAnthropicKeyPanel.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §4 + Component Spec
 * v2.13 §5.* (new section for the org variant).
 *
 * Mirrors components/settings/AnthropicKeyPanel (V1.x-B.1.2 per-user
 * variant) but operates against /api/org/anthropic-key. Differences:
 *
 *   - Takes `orgId` as a prop (the calling page resolves the user's
 *     primary org and passes it through).
 *   - On 403 from the RPC ("insufficient_role" / "not_a_member"), the
 *     UI surfaces the read-only state without the input row (members
 *     who aren't admins can see status but can't save/delete).
 *   - On 422 plan-not-byok-eligible, the inline error reads "Your
 *     organisation's plan does not support BYOK. Switch to BYOK Solo
 *     or BYOK Team in the plan settings."
 *
 * H-09 invariant preserved (password input; no echo from server).
 * Inviolable #2: Save button is verdigris use #7 (affirmative-action
 * triggers family — within existing nine; no broadening). Delete is
 * destructive-token, NOT verdigris.
 */

import { useCallback, useEffect, useState } from 'react'

const STATUS_INDICATOR_GREEN = 'rgb(110, 175, 110)'
const STATUS_INDICATOR_MUTED = 'var(--color-text-muted)'

interface OrgKeyStatusPresent {
  present: true
  byok_enabled: boolean
  plan: string
  last_four: string
  last_validated_at: string
}
interface OrgKeyStatusAbsent {
  present: false
  byok_enabled: boolean
  plan: string
  last_four: null
  last_validated_at: null
}
type OrgKeyStatus = OrgKeyStatusPresent | OrgKeyStatusAbsent

const NOT_ADMIN_HTTP_STATUS = 403

export function OrgAnthropicKeyPanel({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<OrgKeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(true)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/org/anthropic-key?org_id=${encodeURIComponent(orgId)}`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const body = (await res.json()) as OrgKeyStatus
        setStatus(body)
      } else if (res.status === NOT_ADMIN_HTTP_STATUS) {
        // Member-but-not-admin: read still works through the
        // get_org_anthropic_key_status RPC (any-member read). Fall
        // through to a friendly notice.
        setIsAdmin(false)
      }
    } catch {
      // Network — keep last known.
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  async function save() {
    if (keyInput.trim().length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/org/anthropic-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: keyInput.trim(), org_id: orgId }),
      })
      if (res.status === 422) {
        const body = (await res.json()) as { reason?: string; error?: string }
        const code = body.error ?? ''
        if (code === 'plan_not_byok_eligible') {
          setSaveError(
            "Your organisation's plan does not support BYOK. Switch to BYOK Solo or BYOK Team in plan settings.",
          )
        } else {
          setSaveError(body.reason ?? 'Key rejected by Anthropic.')
        }
        return
      }
      if (res.status === NOT_ADMIN_HTTP_STATUS) {
        setIsAdmin(false)
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null
        setSaveError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
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
      const res = await fetch(
        `/api/org/anthropic-key?org_id=${encodeURIComponent(orgId)}`,
        { method: 'DELETE' },
      )
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
      data-testid="org-anthropic-key-panel"
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '20px 24px',
        maxWidth: 540,
      }}
    >
      <h2
        style={{
          fontSize: 16,
          fontWeight: 500,
          margin: '0 0 4px',
          color: 'var(--color-text-primary)',
        }}
      >
        Organisation BYOK Anthropic key
      </h2>
      <p
        style={{
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          margin: '0 0 16px',
          lineHeight: 1.5,
        }}
      >
        Use your organisation&apos;s own Anthropic API key for all LLM operations. The key
        is encrypted at rest with Supabase Vault, dispatched only through an isolated Edge
        Function, and never logged. Available on BYOK Solo and BYOK Team plans only.
      </p>

      <StatusIndicator status={status} loading={loading} />

      {isAdmin ? (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <input
              data-testid="org-anthropic-key-input"
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
              }}
            />
            <button
              type="button"
              data-testid="org-anthropic-key-save"
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
                cursor:
                  saving || keyInput.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity: saving || keyInput.trim().length === 0 ? 0.6 : 1,
              }}
            >
              {saving ? 'Validating…' : 'Save'}
            </button>
          </div>

          {saveError ? (
            <div
              role="alert"
              data-testid="org-anthropic-key-error"
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
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: '1px solid var(--color-border-subtle)',
              }}
            >
              {confirmingDelete ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      flex: 1,
                    }}
                  >
                    Delete the key on file? All LLM operations will fail until a new key
                    is uploaded.
                  </span>
                  <button
                    type="button"
                    data-testid="org-anthropic-key-delete-confirm"
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
                    }}
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="org-anthropic-key-delete-trigger"
                  onClick={() => setConfirmingDelete(true)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border-strong)',
                    color: 'var(--color-text-secondary)',
                    padding: '6px 14px',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Delete key
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            marginTop: 16,
            padding: '12px 14px',
            background: 'var(--color-bg-surface)',
            border: '1px dashed var(--color-border-subtle)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
          data-testid="org-anthropic-key-not-admin"
        >
          Only organisation owners or admins can save or delete the BYOK key.
        </div>
      )}
    </section>
  )
}

function StatusIndicator({
  status,
  loading,
}: {
  status: OrgKeyStatus | null
  loading: boolean
}) {
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading…</div>
  }
  if (!status || !status.present) {
    return (
      <div
        data-testid="org-anthropic-key-status"
        data-state="absent"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: 999,
            background: STATUS_INDICATOR_MUTED,
          }}
        />
        No BYOK key set — using platform key
      </div>
    )
  }
  return (
    <div
      data-testid="org-anthropic-key-status"
      data-state="present"
      data-last-four={status.last_four}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--color-text-primary)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 999,
          background: STATUS_INDICATOR_GREEN,
        }}
      />
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
