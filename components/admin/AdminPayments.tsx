'use client'

/**
 * AdminPayments — /admin/payments dashboard.
 *
 * 5 tabs (Configuration · Price IDs · Health · Events · Failures).
 * URL state via ?tab=. Read-only in C.4 — C.5 will add Server Actions
 * for in-form writes with audit_log + cache invalidation.
 *
 * Inter only; no verdigris. Sibling to /admin (V1.x-E AdminDashboard).
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'

import type {
  AdminPaymentsData,
  FailureRow,
  PriceIdEntry,
  SubscriptionEventRow,
} from '@/lib/admin/payments/data'

interface Props {
  data: AdminPaymentsData
  initialTab: string
}

const TABS = [
  { key: 'configuration', label: 'Configuration' },
  { key: 'price-ids', label: 'Price IDs' },
  { key: 'health', label: 'Subscription health' },
  { key: 'events', label: 'Events' },
  { key: 'failures', label: 'Failures' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function AdminPayments({ data, initialTab }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<TabKey>(
    (TABS.find((t) => t.key === initialTab)?.key ?? 'configuration') as TabKey,
  )

  function selectTab(next: TabKey) {
    setTab(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', next)
    router.replace(`/admin/payments?${params.toString()}`)
  }

  const totalPriceIds = data.priceIds.length
  const setPriceIds = data.priceIds.filter((p) => p.priceId).length
  const failureCount = data.failures.filter((f) => f.severity === 'critical').length

  return (
    <div
      style={{
        padding: '32px 48px',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        color: 'var(--color-text-primary)',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <Header mode={data.config.stripeMode} />
      <Tabs
        tab={tab}
        onChange={selectTab}
        priceIdCounts={{ set: setPriceIds, total: totalPriceIds }}
        activeCount={data.health.countByStatus['active'] ?? 0}
        eventCount={data.events.length}
        failureCount={failureCount}
      />
      <div style={{ marginTop: 24 }}>
        {tab === 'configuration' && <ConfigurationTab data={data} />}
        {tab === 'price-ids' && <PriceIdsTab priceIds={data.priceIds} />}
        {tab === 'health' && <HealthTab health={data.health} />}
        {tab === 'events' && <EventsTab events={data.events} />}
        {tab === 'failures' && <FailuresTab failures={data.failures} />}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Header
// ----------------------------------------------------------------------

function Header({ mode }: { mode: string }) {
  const modeColor = mode === 'live' ? 'var(--color-status-review)' : 'var(--color-info)'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 28,
        paddingBottom: 16,
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 500,
            margin: '0 0 6px',
            letterSpacing: '-0.01em',
          }}
        >
          Payments
        </h1>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Stripe configuration · observation · failure surfaces · service-role auth · PLATFORM_ADMIN_EMAILS gated
        </div>
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        <span>Mode:</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: modeColor,
            fontWeight: 500,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
          data-testid="admin-payments-mode"
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: modeColor }} />
          {mode}
        </span>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Tabs
// ----------------------------------------------------------------------

function Tabs({
  tab,
  onChange,
  priceIdCounts,
  activeCount,
  eventCount,
  failureCount,
}: {
  tab: TabKey
  onChange: (next: TabKey) => void
  priceIdCounts: { set: number; total: number }
  activeCount: number
  eventCount: number
  failureCount: number
}) {
  function count(key: TabKey): string {
    switch (key) {
      case 'price-ids':
        return `${priceIdCounts.set} / ${priceIdCounts.total} set`
      case 'health':
        return `${activeCount} active`
      case 'events':
        return `${eventCount}`
      case 'failures':
        return failureCount === 0 ? '' : `${failureCount} critical`
      default:
        return ''
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--color-border-subtle)',
        marginTop: 4,
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === tab
        const isAlert = t.key === 'failures' && failureCount > 0
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            data-testid={`admin-payments-tab-${t.key}`}
            data-active={isActive || undefined}
            style={{
              background: 'transparent',
              border: 0,
              padding: '12px 18px',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'inherit',
              color: isActive
                ? 'var(--color-text-primary)'
                : isAlert
                  ? 'var(--color-error)'
                  : 'var(--color-text-secondary)',
              borderBottom: isActive
                ? '2px solid var(--color-text-primary)'
                : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
            {count(t.key) ? (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 400,
                  marginLeft: 6,
                  color: isAlert ? 'var(--color-error)' : 'var(--color-text-muted)',
                }}
              >
                {count(t.key)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

// ----------------------------------------------------------------------
// Tab 1 — Configuration
// ----------------------------------------------------------------------

function ConfigurationTab({ data }: { data: AdminPaymentsData }) {
  const cfg = data.config
  return (
    <div data-testid="admin-payments-configuration">
      <Group label="Stripe core" description="Mode + API version + webhook secrets · 4 keys">
        <ConfigRow
          configKey="stripe.mode"
          description="Active Stripe mode. Swap to live via this key (no deploy)."
          value={cfg.stripeMode}
        />
        <ConfigRow
          configKey="stripe.api_version"
          description="Stripe SDK API version pinned in lib/stripe/client.ts. Roll forward via this key — drift-guard test forbids re-introducing a literal."
          value={cfg.stripeApiVersion}
          highlight
        />
        <ConfigRow
          configKey="stripe.webhook_secret_test"
          description="whsec_* for test mode signature verification."
          value={
            cfg.webhookSecretTestSet
              ? `whsec_••• ${cfg.webhookSecretTestLastFour}`
              : 'Not set'
          }
          dim={!cfg.webhookSecretTestSet}
        />
        <ConfigRow
          configKey="stripe.webhook_secret_live"
          description="whsec_* for live mode."
          value={
            cfg.webhookSecretLiveSet
              ? `whsec_••• ${cfg.webhookSecretLiveLastFour}`
              : 'Not set'
          }
          dim={!cfg.webhookSecretLiveSet}
        />
        <ConfigRow
          configKey="STRIPE_SECRET_KEY_TEST (env)"
          description="Env var. Auth credential — never in DB."
          value={
            cfg.stripeSecretKeyTestSet
              ? `sk_test_••• ${cfg.stripeSecretKeyTestLastFour}`
              : 'Not set'
          }
          dim={!cfg.stripeSecretKeyTestSet}
        />
        <ConfigRow
          configKey="STRIPE_SECRET_KEY_LIVE (env)"
          description="Env var for live mode."
          value={
            cfg.stripeSecretKeyLiveSet
              ? `sk_live_••• ${cfg.stripeSecretKeyLiveLastFour}`
              : 'Not set'
          }
          dim={!cfg.stripeSecretKeyLiveSet}
        />
      </Group>

      <Group
        label="Checkout behaviour"
        description="Stripe Checkout Session options · 3 keys · M-223"
      >
        <ConfigRow
          configKey="stripe.checkout.automatic_tax_enabled"
          description="Stripe Tax — auto-collects sales tax / VAT based on customer location."
          value={cfg.checkoutAutomaticTaxEnabled ? 'true (collect tax)' : 'false (off)'}
        />
        <ConfigRow
          configKey="stripe.checkout.allow_promotion_codes"
          description="Lets users enter promo codes at Checkout."
          value={cfg.checkoutAllowPromotionCodes ? 'true (allow)' : 'false (off)'}
        />
        <ConfigRow
          configKey="stripe.checkout.billing_address_collection"
          description="Billing address collection mode at Checkout."
          value={cfg.checkoutBillingAddressCollection}
        />
        <ConfigRow
          configKey="Currency"
          description="Inherited from each Stripe Price's own currency. V1 = USD only. Multi-currency = V2 (Price ID matrix × N currencies)."
          value="USD"
          dim
        />
      </Group>

      <Group
        label="Trial + payment failure"
        description="Trial duration + past-due grace window · 2 keys"
      >
        <ConfigRow
          configKey="billing.trial_duration_days"
          description="New-org trial duration. Stamps trial_expires_at at signup. Existing trials NOT retroactively changed (D2.a)."
          value={`${cfg.trialDurationDays} days`}
        />
        <ConfigRow
          configKey="billing.payment_failure_grace_days"
          description="C.2: app access preserved for N days after past_due; LLM access cuts immediately. Used by the past-due banner copy."
          value={`${cfg.paymentFailureGraceDays} days`}
          highlight
        />
      </Group>

      <Group
        label="Plan allocations"
        description="Credit allocation per plan · 4 keys · read-only here (edit on /admin)"
      >
        <ConfigRow
          configKey="plan.trial_token_allocation_credits"
          description="Allocation for new-org trial. Auto-stamped by handle_new_user."
          value={cfg.planAllocations.trial.toLocaleString()}
          dim
        />
        <ConfigRow
          configKey="plan.writer_token_allocation_credits"
          value={cfg.planAllocations.writer.toLocaleString()}
          dim
        />
        <ConfigRow
          configKey="plan.author_token_allocation_credits"
          value={cfg.planAllocations.author.toLocaleString()}
          dim
        />
        <ConfigRow
          configKey="plan.pro_token_allocation_credits"
          value={cfg.planAllocations.pro.toLocaleString()}
          dim
        />
      </Group>
    </div>
  )
}

function Group({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span>{label}</span>
        {description ? (
          <span
            style={{
              fontSize: 10.5,
              color: 'var(--color-text-muted)',
              fontWeight: 400,
              letterSpacing: 0,
              textTransform: 'none',
            }}
          >
            {description}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

const EDITABLE_CONFIG_KEYS = new Set([
  'stripe.mode',
  'stripe.api_version',
  'stripe.webhook_secret_test',
  'stripe.webhook_secret_live',
  'stripe.checkout.automatic_tax_enabled',
  'stripe.checkout.allow_promotion_codes',
  'stripe.checkout.billing_address_collection',
  'billing.trial_duration_days',
  'billing.payment_failure_grace_days',
])

interface InlineEditorProps {
  configKey: string
  initialValue: string
}

function InlineConfigEditor({ configKey, initialValue }: InlineEditorProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(initialValue)
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const isSecret = configKey.startsWith('stripe.webhook_secret_')
  const isBool = configKey.startsWith('stripe.checkout.') && configKey.endsWith('_enabled')
    || configKey === 'stripe.checkout.allow_promotion_codes'
  const isMode = configKey === 'stripe.mode'
  const isBillingAddress = configKey === 'stripe.checkout.billing_address_collection'
  const isNumber =
    configKey === 'billing.trial_duration_days' ||
    configKey === 'billing.payment_failure_grace_days'

  const dirty = draft !== initialValue || (isSecret && confirm !== '')

  async function onSave() {
    setError(null)
    setSaving(true)
    try {
      const body: { key: string; value: string; valueConfirm?: string } = {
        key: configKey,
        value: draft,
      }
      if (isSecret) body.valueConfirm = confirm
      const res = await fetch('/api/admin/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'save failed')
        return
      }
      setSavedAt(Date.now())
      setConfirm('')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {isBool ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={inputStyle}
          disabled={saving}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : isMode ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={inputStyle}
          disabled={saving}
        >
          <option value="test">test</option>
          <option value="live">live</option>
        </select>
      ) : isBillingAddress ? (
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={inputStyle}
          disabled={saving}
        >
          <option value="auto">auto</option>
          <option value="required">required</option>
        </select>
      ) : (
        <input
          type={isSecret ? 'password' : isNumber ? 'number' : 'text'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isSecret ? 'whsec_…' : ''}
          style={inputStyle}
          disabled={saving}
        />
      )}
      {isSecret ? (
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm whsec_… (D1.a)"
          style={inputStyle}
          disabled={saving}
        />
      ) : null}
      {error ? (
        <div style={{ fontSize: 10.5, color: 'var(--color-error)' }}>{error}</div>
      ) : null}
      {savedAt && Date.now() - savedAt < 4000 ? (
        <div style={{ fontSize: 10.5, color: 'var(--color-success, #3a8a5a)' }}>
          Saved
        </div>
      ) : null}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '5px 9px',
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 4,
  fontFamily:
    'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
  fontSize: 12,
  color: 'var(--color-text-primary)',
  fontWeight: 400,
}

function SaveControl({ editable }: { editable: boolean }) {
  if (!editable) {
    return (
      <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
        Read-only
      </span>
    )
  }
  return (
    <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
      Edit + save
    </span>
  )
}

function ConfigRow({
  configKey,
  description,
  value,
  highlight,
  dim,
}: {
  configKey: string
  description?: string
  value: string
  highlight?: boolean
  dim?: boolean
}) {
  const editable = EDITABLE_CONFIG_KEYS.has(configKey)
  // Best-effort: derive a "stored value" string for the editor input.
  // For booleans we display "true (collect tax)" etc. so strip the parens
  // suffix before editing.
  const editorValue = (() => {
    if (configKey.endsWith('_enabled')) {
      return value.startsWith('true') ? 'true' : 'false'
    }
    if (configKey === 'stripe.checkout.allow_promotion_codes') {
      return value.startsWith('true') ? 'true' : 'false'
    }
    if (
      configKey === 'billing.trial_duration_days' ||
      configKey === 'billing.payment_failure_grace_days'
    ) {
      // Display value is "N days" — strip the suffix for the editor.
      return String(parseInt(value, 10))
    }
    return value
  })()

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr 220px',
        gap: 18,
        alignItems: 'start',
        padding: '12px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
      data-testid={`config-row-${configKey}`}
    >
      <div>
        <div
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
            fontSize: 11,
            color: highlight
              ? 'var(--color-status-review)'
              : 'var(--color-text-primary)',
            wordBreak: 'break-all',
          }}
        >
          {configKey}
        </div>
        {description ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              marginTop: 4,
              lineHeight: 1.45,
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
      {editable ? (
        <InlineConfigEditor configKey={configKey} initialValue={editorValue} />
      ) : (
        <div
          style={{
            padding: '4px 10px',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 4,
            fontFamily:
              'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
            fontSize: 12,
            color: dim ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          }}
        >
          {value}
        </div>
      )}
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--color-text-muted)',
          textAlign: 'right',
          paddingTop: 6,
        }}
      >
        <SaveControl editable={editable} />
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------
// Tab 2 — Price IDs
// ----------------------------------------------------------------------

function PriceIdsTab({ priceIds }: { priceIds: PriceIdEntry[] }) {
  return (
    <div data-testid="admin-payments-price-ids">
      <PriceIdGrid mode="test" priceIds={priceIds.filter((p) => p.mode === 'test')} />
      <PriceIdGrid mode="live" priceIds={priceIds.filter((p) => p.mode === 'live')} />
    </div>
  )
}

function PriceIdGrid({
  mode,
  priceIds,
}: {
  mode: 'test' | 'live'
  priceIds: PriceIdEntry[]
}) {
  const setCount = priceIds.filter((p) => p.priceId).length
  const byPlan: Record<string, PriceIdEntry[]> = {}
  for (const p of priceIds) {
    byPlan[p.plan] = byPlan[p.plan] ?? []
    byPlan[p.plan].push(p)
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 12,
          color: 'var(--color-text-muted)',
          marginBottom: 12,
        }}
      >
        <strong style={{ color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>{mode} mode</strong>{' '}
        · {setCount} / {priceIds.length} set
        {mode === 'live' && setCount === 0 ? (
          <span style={{ color: 'var(--color-status-review)', marginLeft: 10 }}>
            — required before launch
          </span>
        ) : null}
      </div>
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 6,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 1fr',
            gap: '10px 14px',
            alignItems: 'center',
          }}
        >
          <div style={priceHeadStyle()}>Plan</div>
          <div style={priceHeadStyle()}>Monthly</div>
          <div style={priceHeadStyle()}>Yearly</div>
          {['writer', 'author', 'pro', 'byok_solo'].map((plan) => (
            <PriceIdRow key={plan} plan={plan} entries={byPlan[plan] ?? []} />
          ))}
        </div>
      </div>
    </div>
  )
}

function priceHeadStyle(): React.CSSProperties {
  return {
    fontSize: 9.5,
    fontWeight: 500,
    letterSpacing: '0.25em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    paddingBottom: 8,
    borderBottom: '1px solid var(--color-border-subtle)',
  }
}

function PriceIdRow({ plan, entries }: { plan: string; entries: PriceIdEntry[] }) {
  const monthly = entries.find((e) => e.cadence === 'monthly')
  const yearly = entries.find((e) => e.cadence === 'yearly')
  return (
    <>
      <div style={{ fontSize: 12, padding: '4px 0', textTransform: 'capitalize' }}>
        {plan.replace('_', ' ')}
      </div>
      <PriceIdCell entry={monthly} />
      <PriceIdCell entry={yearly} />
    </>
  )
}

function PriceIdCell({ entry }: { entry: PriceIdEntry | undefined }) {
  const router = useRouter()
  const [draft, setDraft] = useState(entry?.priceId ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  if (!entry) {
    return <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>—</div>
  }
  const dirty = draft !== (entry.priceId ?? '')

  async function onBlur() {
    if (!dirty || !entry) return
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/payments/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: `stripe.${entry.mode}.price_id.${entry.plan}_${entry.cadence}`,
          value: draft,
        }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error ?? 'save failed')
        return
      }
      setSavedAt(Date.now())
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        disabled={saving}
        placeholder="Not set"
        data-testid={`price-id-input-${entry.mode}-${entry.plan}-${entry.cadence}`}
        style={{
          padding: '5px 9px',
          background: 'var(--color-bg-elevated)',
          border: `1px solid ${
            draft ? 'var(--color-border-subtle)' : 'var(--color-border-default)'
          }`,
          borderRadius: 4,
          fontFamily:
            'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
          fontSize: 11,
          color: draft ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
          width: '100%',
        }}
      />
      {error ? (
        <div style={{ fontSize: 10, color: 'var(--color-error)' }}>{error}</div>
      ) : null}
      {savedAt && Date.now() - savedAt < 4000 ? (
        <div style={{ fontSize: 10, color: 'var(--color-success, #3a8a5a)' }}>Saved</div>
      ) : null}
    </div>
  )
}

// ----------------------------------------------------------------------
// Tab 3 — Health
// ----------------------------------------------------------------------

function HealthTab({
  health,
}: {
  health: AdminPaymentsData['health']
}) {
  const status = health.countByStatus
  return (
    <div data-testid="admin-payments-health">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <HealthCard label="Active" value={status['active'] ?? 0} />
        <HealthCard label="Trialing" value={status['trialling'] ?? 0} />
        <HealthCard
          label="Past due"
          value={status['past_due'] ?? 0}
          alert={(status['past_due'] ?? 0) > 0}
        />
        <HealthCard label="Cancelled" value={status['cancelled'] ?? 0} />
      </div>

      <SubBlock title="Past-due orgs · needs attention">
        {health.pastDueOrgs.length === 0 ? (
          <div style={placeholderStyle}>No past-due organisations.</div>
        ) : (
          health.pastDueOrgs.map((org) => (
            <div key={org.organisationId} style={subRowStyle}>
              <div>
                <div style={{ fontSize: 12 }}>{org.name}</div>
                <div
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {org.organisationId}
                </div>
              </div>
              <div>
                <span style={planPillStyle}>{org.plan ?? '—'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-status-review)' }}>
                ● {relTime(org.lastFailureAt)}
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-text-muted)' }}>
                {/* C.5 adds Stripe deep-link */}
              </div>
            </div>
          ))
        )}
      </SubBlock>

      <SubBlock title="Trials expiring this week">
        {health.trialsExpiringSoon.length === 0 ? (
          <div style={placeholderStyle}>No trials expiring in the next 7 days.</div>
        ) : (
          health.trialsExpiringSoon.map((org) => (
            <div key={org.organisationId} style={subRowStyle}>
              <div>
                <div style={{ fontSize: 12 }}>{org.name}</div>
                <div
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {org.organisationId}
                </div>
              </div>
              <div>
                <span style={planPillStyle}>Trial</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-info)' }}>● {org.expiresAt.slice(0, 10)}</div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-text-muted)' }}>
                {org.daysLeft} {org.daysLeft === 1 ? 'day' : 'days'} left
              </div>
            </div>
          ))
        )}
      </SubBlock>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginTop: 18,
        }}
      >
        <SmallCard
          label="Webhook ingestion lag"
          value={
            health.webhookIngestionLagSeconds === null
              ? '—'
              : `${health.webhookIngestionLagSeconds}s`
          }
          subtext={
            health.webhookIngestionLagSeconds === null
              ? 'No events yet'
              : health.webhookIngestionLagSeconds < 60
                ? 'Healthy · < 60s'
                : 'Slow · investigate'
          }
        />
        <SmallCard
          label="MRR · estimated (D3.a)"
          value={`$${(health.estimatedMrrCents / 100).toLocaleString()}`}
          subtext="Σ active subs × plan price. Stripe Dashboard for canonical."
        />
      </div>
    </div>
  )
}

function HealthCard({
  label,
  value,
  alert,
}: {
  label: string
  value: number
  alert?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        padding: '14px 16px',
      }}
      data-testid={`health-card-${label.toLowerCase().replace(' ', '-')}`}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {alert ? (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--color-status-review)',
            }}
          />
        ) : null}
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          color: alert ? 'var(--color-status-review)' : 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function SmallCard({
  label,
  value,
  subtext,
}: {
  label: string
  value: string
  subtext: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-primary)' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
        {subtext}
      </div>
    </div>
  )
}

function SubBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 18,
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-elevated)',
          padding: '10px 14px',
          fontSize: 10,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

const subRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 110px 160px 110px',
  gap: 12,
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border-subtle)',
}

const planPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  padding: '2px 8px',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  borderRadius: 3,
  background: 'var(--color-bg-elevated)',
  color: 'var(--color-text-secondary)',
  fontWeight: 500,
}

const placeholderStyle: React.CSSProperties = {
  padding: '20px 14px',
  fontSize: 11.5,
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
  textAlign: 'center',
}

// ----------------------------------------------------------------------
// Tab 4 — Events
// ----------------------------------------------------------------------

function EventsTab({ events }: { events: SubscriptionEventRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const mode = useMemo(() => {
    // Derive from first event's metadata; falls back to "test".
    return 'test'
  }, [])

  return (
    <div data-testid="admin-payments-events">
      <div
        style={{
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div style={{ ...evtRowStyle, ...evtHeadStyle }}>
          <div>Time</div>
          <div>Event type</div>
          <div>Organisation</div>
          <div>Metadata preview</div>
          <div style={{ textAlign: 'right' }}>Stripe</div>
        </div>
        {events.length === 0 ? (
          <div style={placeholderStyle}>No events recorded yet.</div>
        ) : (
          events.map((evt) => (
            <div key={evt.id}>
              <button
                type="button"
                onClick={() => setExpanded(expanded === evt.id ? null : evt.id)}
                style={{ ...evtRowStyle, background: 'transparent', border: 0, width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
                data-testid="admin-payments-event-row"
              >
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {relTime(evt.createdAt)}
                </div>
                <div
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                    fontSize: 10.5,
                  }}
                >
                  {evt.eventType}
                </div>
                <div style={{ fontSize: 12 }}>
                  {evt.organisationName ?? '—'}
                  <div
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                      fontSize: 10,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {evt.organisationId}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: 'var(--color-text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {previewMetadata(evt.metadata)}
                </div>
                <div style={{ textAlign: 'right' }}>
                  {evt.stripeEventId ? (
                    <a
                      href={`https://dashboard.stripe.com/${mode}/events/${evt.stripeEventId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{
                        fontSize: 10.5,
                        color: 'var(--color-text-secondary)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {evt.stripeEventId.slice(0, 8)} ↗
                    </a>
                  ) : null}
                </div>
              </button>
              {expanded === evt.id ? (
                <div
                  style={{
                    background: 'var(--color-bg-elevated)',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                  data-testid="admin-payments-event-expand"
                >
                  <pre
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                      fontSize: 10.5,
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.55,
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(evt.metadata, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const evtRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '100px 220px 1fr 200px 100px',
  gap: 12,
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border-subtle)',
  fontSize: 11.5,
}

const evtHeadStyle: React.CSSProperties = {
  background: 'var(--color-bg-elevated)',
  fontSize: 9.5,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
}

function previewMetadata(metadata: Record<string, unknown>): string {
  const keys = ['mapped_plan', 'cadence', 'status', 'amount', 'reason', 'invoice_id', 'subscription_id']
  const pairs: string[] = []
  for (const key of keys) {
    const value = metadata[key]
    if (value !== undefined && value !== null) {
      pairs.push(`${key}: ${value}`)
      if (pairs.length >= 3) break
    }
  }
  return pairs.join(' · ') || JSON.stringify(metadata).slice(0, 80)
}

// ----------------------------------------------------------------------
// Tab 5 — Failures
// ----------------------------------------------------------------------

function FailuresTab({ failures }: { failures: FailureRow[] }) {
  const disputes = failures.filter((f) => f.eventType === 'stripe_dispute_created')
  const refunds = failures.filter((f) => f.eventType === 'stripe_charge_refunded')
  const paymentAction = failures.filter(
    (f) => f.eventType === 'stripe_payment_action_required',
  )
  return (
    <div data-testid="admin-payments-failures">
      <FailuresSection
        title="Disputes"
        items={disputes}
        critical
        emptyText="No open disputes."
      />
      <FailuresSection
        title="Refunds"
        items={refunds}
        emptyText="No recent refunds."
      />
      <FailuresSection
        title="Payment action required (3D Secure)"
        items={paymentAction}
        emptyText="No outstanding payment actions."
      />
    </div>
  )
}

function FailuresSection({
  title,
  items,
  critical,
  emptyText,
}: {
  title: string
  items: FailureRow[]
  critical?: boolean
  emptyText: string
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          marginBottom: 12,
        }}
      >
        <strong style={{ color: 'var(--color-text-primary)' }}>{title}</strong> ·{' '}
        {items.length === 0 ? 'none' : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      </div>
      {items.length === 0 ? (
        <div style={{ ...placeholderStyle, border: '1px dashed var(--color-border-default)', borderRadius: 6 }}>
          {emptyText}
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderLeft: `3px solid ${
                critical ? 'var(--color-error)' : 'var(--color-status-review)'
              }`,
              borderRadius: 4,
              padding: '14px 16px',
              marginBottom: 12,
            }}
            data-testid="failure-row"
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500 }}>
                {prettyEventLabel(item.eventType)} ·{' '}
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                  {item.severity}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                {relTime(item.createdAt)} · {item.organisationName ?? item.organisationId ?? '—'}
              </div>
            </div>
            <pre
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace',
                fontSize: 10.5,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.55,
                margin: '6px 0 0',
              }}
            >
              {JSON.stringify(item.metadata, null, 2)}
            </pre>
          </div>
        ))
      )}
    </div>
  )
}

function prettyEventLabel(type: string): string {
  return type.replace('stripe_', '').replace(/_/g, ' ')
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
