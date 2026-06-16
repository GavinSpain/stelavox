'use client'

/**
 * AdminModels — Model Governance console (P1).
 *
 * Three parts:
 *   1. Metering integrity banner — the bulletproof-credits backstop. All
 *      counters must read zero; any non-zero is a credit-leakage alarm.
 *   2. Models registry — add a model (id + display + $ rates), re-price
 *      (append effective-dated), activate/deprecate. A model is "assignable"
 *      only when active AND priced; unassignable models can't be selected
 *      below (and the DB rejects them anyway).
 *   3. Assignments — the Director + every agent tool (operation x layer),
 *      each a dropdown constrained to assignable models, with the model's
 *      $ rate shown. This is how you tune cost/quality per function.
 *
 * Inter only; no verdigris. Status uses --color-success / --color-error /
 * --color-status-review.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Pricing {
  input_dollars_per_million: number
  output_dollars_per_million: number
  cache_write_dollars_per_million: number | null
  cache_read_dollars_per_million: number | null
  effective_from: string
}
interface ModelRow {
  model_id: string
  display_name: string
  provider: string
  status: 'active' | 'deprecated' | 'hidden'
  note: string | null
  pricing: Pricing | null
  assignable: boolean
}
interface Assignments {
  agent_profiles: Array<{ id: string; name: string; operation_type: string; node_type: string | null; model_id: string }>
  director: { version_number: number; model_id: string } | null
}
interface Metering {
  unmetered_completed_jobs: number
  unpriced_agent_profiles: number
  unpriced_director_config: number
}
interface Payload {
  models: ModelRow[]
  assignments: Assignments
  metering_integrity: Metering
}

export function AdminModels() {
  const [data, setData] = useState<Payload | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/models', { cache: 'no-store' })
    setData((await res.json()) as Payload)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const post = useCallback(
    async (bodyObj: Record<string, unknown>) => {
      setBusy(true)
      setMsg(null)
      try {
        const res = await fetch('/api/admin/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyObj),
        })
        const body = (await res.json()) as { ok?: boolean; error?: string }
        if (!res.ok || !body.ok) {
          setMsg(`Error: ${body.error ?? 'failed'}`)
        } else {
          setMsg('Saved.')
          await refresh()
        }
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const assignable = useMemo(() => (data?.models ?? []).filter((m) => m.assignable), [data])
  const rateOf = useCallback(
    (modelId: string) => {
      const m = data?.models.find((x) => x.model_id === modelId)
      return m?.pricing ? `$${m.pricing.input_dollars_per_million}/$${m.pricing.output_dollars_per_million}` : '—'
    },
    [data],
  )

  if (!data) {
    return <div style={{ ...wrap, color: 'var(--color-text-secondary)' }}>Loading…</div>
  }

  const mi = data.metering_integrity
  const leak = mi.unmetered_completed_jobs + mi.unpriced_agent_profiles + mi.unpriced_director_config

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Model governance</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, margin: '8px 0 22px' }}>
        Register models, set their rates, and assign a model to every tool and the Director. A model
        can only be assigned when it is active AND priced — so usage can never go unmetered.
      </p>

      {/* 1. Metering integrity */}
      <section
        style={{
          ...card,
          borderColor: leak === 0 ? 'var(--color-success, #4caf50)' : 'var(--color-error)',
          background: leak === 0 ? 'rgba(56,142,60,0.10)' : 'rgba(176,60,60,0.12)',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {leak === 0 ? '✓ Metering integrity: bulletproof' : '⚠ Metering integrity FAILURE — credit leakage'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 6, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span>Unmetered completed jobs: <b style={{ color: leak === 0 ? 'inherit' : 'var(--color-error)' }}>{mi.unmetered_completed_jobs}</b></span>
          <span>Unpriced tool assignments: <b style={{ color: mi.unpriced_agent_profiles ? 'var(--color-error)' : 'inherit' }}>{mi.unpriced_agent_profiles}</b></span>
          <span>Unpriced Director: <b style={{ color: mi.unpriced_director_config ? 'var(--color-error)' : 'inherit' }}>{mi.unpriced_director_config}</b></span>
        </div>
      </section>

      {msg && (
        <div style={{ ...card, fontSize: 13, borderColor: msg.startsWith('Error') ? 'var(--color-error)' : 'var(--color-border-default)' }}>
          {msg}
        </div>
      )}

      {/* 2. Registry */}
      <h2 style={h2}>Models</h2>
      <table style={table}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Model</th><th style={th}>ID</th><th style={th}>$ in / out (per Mtok)</th>
            <th style={th}>Status</th><th style={th}>Assignable</th><th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.models.map((m) => (
            <ModelRowView key={m.model_id} m={m} busy={busy} onAction={post} />
          ))}
        </tbody>
      </table>

      <AddModelForm busy={busy} onAdd={post} />

      {/* 3. Assignments */}
      <h2 style={h2}>Assignments</h2>
      <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Only active, priced models are selectable. Saving an unpriced model is rejected by the database.
      </p>

      <div style={{ ...card, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Director</div>
        <ModelSelect
          value={data.assignments.director?.model_id ?? ''}
          models={assignable}
          busy={busy}
          onChange={(model_id) => post({ action: 'set_director_model', model_id })}
        />
        <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginLeft: 10 }}>
          {data.assignments.director ? `v${data.assignments.director.version_number} · ${rateOf(data.assignments.director.model_id)}` : '—'}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, margin: '18px 0 8px' }}>Agent tools (operation × layer)</div>
      <table style={table}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Operation</th><th style={th}>Layer</th><th style={th}>Model</th><th style={th}>$ in/out</th>
          </tr>
        </thead>
        <tbody>
          {data.assignments.agent_profiles.map((p) => (
            <tr key={p.id} style={trBody}>
              <td style={td}>{p.operation_type}</td>
              <td style={{ ...td, color: 'var(--color-text-secondary)' }}>{p.node_type ?? '—'}</td>
              <td style={td}>
                <ModelSelect
                  value={p.model_id}
                  models={assignable}
                  busy={busy}
                  onChange={(model_id) => post({ action: 'set_profile_model', profile_id: p.id, model_id })}
                />
              </td>
              <td style={{ ...td, fontSize: 11.5, color: 'var(--color-text-muted)' }}>{rateOf(p.model_id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ModelSelect({
  value, models, busy, onChange,
}: { value: string; models: ModelRow[]; busy: boolean; onChange: (modelId: string) => void }) {
  // Include the current value even if now unassignable, so a stale row renders.
  const has = models.some((m) => m.model_id === value)
  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => e.target.value !== value && onChange(e.target.value)}
      style={select}
    >
      {!has && value && <option value={value}>{value} (unassignable)</option>}
      {models.map((m) => (
        <option key={m.model_id} value={m.model_id}>{m.display_name}</option>
      ))}
    </select>
  )
}

function ModelRowView({
  m, busy, onAction,
}: { m: ModelRow; busy: boolean; onAction: (b: Record<string, unknown>) => void }) {
  const [reprice, setReprice] = useState(false)
  const [inp, setInp] = useState('')
  const [out, setOut] = useState('')
  return (
    <>
      <tr style={trBody}>
        <td style={td}>{m.display_name}</td>
        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{m.model_id}</td>
        <td style={td}>{m.pricing ? `$${m.pricing.input_dollars_per_million} / $${m.pricing.output_dollars_per_million}` : <span style={{ color: 'var(--color-error)' }}>unpriced</span>}</td>
        <td style={td}><StatusPill status={m.status} /></td>
        <td style={td}>{m.assignable ? '✓' : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
        <td style={td}>
          <button type="button" style={btn} disabled={busy} onClick={() => setReprice((v) => !v)}>Re-price</button>
          {m.status === 'active' ? (
            <button type="button" style={btn} disabled={busy} onClick={() => onAction({ action: 'set_status', model_id: m.model_id, status: 'deprecated' })}>Deprecate</button>
          ) : (
            <button type="button" style={btn} disabled={busy} onClick={() => onAction({ action: 'set_status', model_id: m.model_id, status: 'active' })}>Activate</button>
          )}
        </td>
      </tr>
      {reprice && (
        <tr style={trBody}>
          <td style={td} colSpan={6}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>New rate ($/Mtok), effective today:</span>
              <input style={input} placeholder="input $" value={inp} onChange={(e) => setInp(e.target.value)} />
              <input style={input} placeholder="output $" value={out} onChange={(e) => setOut(e.target.value)} />
              <button
                type="button"
                style={btnPrimary}
                disabled={busy || !inp || !out}
                onClick={() => {
                  onAction({ action: 'add_pricing', model_id: m.model_id, input_dollars_per_million: Number(inp), output_dollars_per_million: Number(out) })
                  setReprice(false); setInp(''); setOut('')
                }}
              >Save rate</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddModelForm({ busy, onAdd }: { busy: boolean; onAdd: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ model_id: '', display_name: '', input: '', output: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const valid = f.model_id && f.display_name && f.input && f.output
  return (
    <div style={{ ...card, padding: 14, marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add a model</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...input, width: 220 }} placeholder="model id (e.g. claude-opus-4-8)" value={f.model_id} onChange={set('model_id')} />
        <input style={{ ...input, width: 180 }} placeholder="display name" value={f.display_name} onChange={set('display_name')} />
        <input style={input} placeholder="input $/Mtok" value={f.input} onChange={set('input')} />
        <input style={input} placeholder="output $/Mtok" value={f.output} onChange={set('output')} />
        <button
          type="button"
          style={btnPrimary}
          disabled={busy || !valid}
          onClick={() => {
            onAdd({ action: 'add_model', model_id: f.model_id.trim(), display_name: f.display_name.trim(), input_dollars_per_million: Number(f.input), output_dollars_per_million: Number(f.output) })
            setF({ model_id: '', display_name: '', input: '', output: '' })
          }}
        >Add model</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
        Credits derive automatically (1M credits = $1). The model becomes assignable immediately.
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'active' ? 'var(--color-success, #4caf50)' : status === 'deprecated' ? 'var(--color-text-muted)' : 'var(--color-status-review)'
  return <span style={{ fontSize: 11, color, fontWeight: 500 }}>{status}</span>
}

// ---- styles ----
const wrap: React.CSSProperties = { padding: 24, maxWidth: 1100, margin: '0 auto', fontFamily: 'var(--font-inter), Inter, sans-serif', color: 'var(--color-text-primary)' }
const card: React.CSSProperties = { border: '1px solid var(--color-border-default)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: '24px 0 12px' }
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 8 }
const trHead: React.CSSProperties = { borderBottom: '1px solid var(--color-border-default)' }
const trBody: React.CSSProperties = { borderBottom: '1px solid var(--color-border-subtle)' }
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 500, color: 'var(--color-text-secondary)' }
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'middle' }
const select: React.CSSProperties = { padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', fontSize: 12.5 }
const input: React.CSSProperties = { padding: '6px 9px', borderRadius: 5, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)', fontSize: 12.5, width: 110 }
const btn: React.CSSProperties = { padding: '4px 9px', marginRight: 6, borderRadius: 4, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', fontSize: 11.5, cursor: 'pointer' }
const btnPrimary: React.CSSProperties = { padding: '6px 12px', borderRadius: 5, border: '1px solid var(--color-border-strong)', background: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', fontSize: 12.5, cursor: 'pointer', fontWeight: 500 }
