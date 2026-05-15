/**
 * V1.x-D — PlanPanel.
 *
 * Source: Component Spec §17.7 (V1.x-D extension) ·
 * wireframe_plan_panel_v1.html.
 *
 * Read-only V1 surface at /settings/plan. Shows the org's current plan
 * banner plus the full tier menu (4 Platform tiers + 2 BYOK tiers) so
 * the author understands their options before V2 lights up Stripe.
 *
 * Server-rendered: prices + allocations read from platform_config in
 * the page component; this component is a presentational shell.
 */

interface TierRow {
  slug: string
  name: string
  group: 'platform' | 'byok'
  monthly_cents: number
  yearly_cents: number
  allocation_credits: number | null
  description: string
  allocation_label: string
  current: boolean
}

interface PlanPanelProps {
  currentPlan: string
  currentPeriodStart: string | null
  daysRemaining: number | null
  byokKeyPresent: boolean
  byokKeyLastValidatedAt: string | null
  byokKeyLastFour: string | null
  trialDaysRemaining: number | null
  tiers: TierRow[]
}

export function PlanPanel({
  currentPlan,
  daysRemaining,
  byokKeyPresent,
  byokKeyLastValidatedAt,
  byokKeyLastFour,
  trialDaysRemaining,
  tiers,
}: PlanPanelProps) {
  const currentTier = tiers.find((t) => t.slug === currentPlan)

  return (
    <section data-testid="plan-panel">
      {/* Current plan banner */}
      <div
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 8,
          padding: '20px 24px',
          marginBottom: 24,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
        data-testid="plan-current-banner"
      >
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              background: 'var(--color-bg-elevated)',
              borderRadius: 3,
              color: 'var(--color-text-secondary)',
              marginRight: 10,
            }}
          >
            Current
          </span>
          <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {currentTier?.name ?? formatPlanLabel(currentPlan)}
          </span>
        </div>
        {currentTier ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {priceCopy(currentTier)}
          </div>
        ) : null}
        {trialDaysRemaining !== null ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10 }}>
            Free · {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} remaining
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10 }}>
            {currentTier?.allocation_label ?? ''}
            {daysRemaining !== null
              ? ` · resets in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
              : ''}
          </div>
        )}
        {byokKeyPresent && byokKeyLastFour ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 10 }}>
            Provider key on file · …{byokKeyLastFour}
            {byokKeyLastValidatedAt ? ` · validated ${relativeTime(byokKeyLastValidatedAt)}` : ''}
            {' · '}
            <a
              href="/settings/usage"
              style={{
                color: 'var(--color-text-secondary)',
                borderBottom: '1px dotted var(--color-text-muted)',
                textDecoration: 'none',
              }}
            >
              Usage &amp; Billing →
            </a>
          </div>
        ) : null}
      </div>

      {/* Trial-expiry note */}
      {trialDaysRemaining !== null ? (
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--color-bg-elevated)',
            border: '1px dashed var(--color-border-default)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.5,
            marginBottom: 24,
          }}
          data-testid="plan-trial-note"
        >
          Your trial expires in {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'}. To
          keep writing afterwards, switch to a paid plan or BYOK tier. Switching arrives in V2.
        </div>
      ) : null}

      {/* Platform tiers */}
      <TierGroup
        label="Platform tiers"
        tiers={tiers.filter((t) => t.group === 'platform')}
        currentPlan={currentPlan}
      />

      {/* BYOK tiers */}
      <TierGroup
        label="BYOK tiers · bring your own LLM provider key"
        tiers={tiers.filter((t) => t.group === 'byok')}
        currentPlan={currentPlan}
      />

      {/* Read-only V1 note */}
      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          background: 'var(--color-bg-elevated)',
          border: '1px dashed var(--color-border-default)',
          borderRadius: 6,
          fontSize: 12,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
        data-testid="plan-switching-note"
      >
        <div style={{ color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: 4, fontSize: 13 }}>
          Switching plans
        </div>
        Plan changes — including BYOK enablement — arrive with V2&apos;s Stripe integration. To
        change your subscription in V1, contact support.
        <div style={{ color: 'var(--color-text-muted)', marginTop: 6, fontStyle: 'italic' }}>
          No Stripe Checkout in V1; this page is informational only.
        </div>
      </div>
    </section>
  )
}

function TierGroup({
  label,
  tiers,
  currentPlan,
}: {
  label: string
  tiers: TierRow[]
  currentPlan: string
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 400,
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
          margin: '0 0 10px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {label}
      </div>
      {tiers.map((t) => (
        <TierCard key={t.slug} tier={t} isCurrent={t.slug === currentPlan} />
      ))}
    </div>
  )
}

function TierCard({ tier, isCurrent }: { tier: TierRow; isCurrent: boolean }) {
  return (
    <div
      data-testid={`tier-card-${tier.slug}`}
      data-current={isCurrent || undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'start',
        gap: 16,
        padding: '16px 18px',
        background: isCurrent ? 'var(--color-bg-hover)' : 'var(--color-bg-surface)',
        border: `1px solid ${isCurrent ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
        borderRadius: 6,
        marginBottom: 10,
        position: 'relative',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      {isCurrent ? (
        <span
          style={{
            position: 'absolute',
            top: -8,
            left: 12,
            background: 'var(--color-bg-base)',
            padding: '0 8px',
            fontSize: 9,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'var(--color-accent-hover)',
          }}
          data-testid="tier-current-marker"
        >
          ● Current plan
        </span>
      ) : null}
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          {tier.name}
          {tier.monthly_cents === 0 ? (
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                padding: '1px 6px',
                background: 'var(--color-bg-elevated)',
                color: 'var(--color-text-secondary)',
                borderRadius: 3,
                fontWeight: 400,
              }}
            >
              Free
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {tier.description}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
          {tier.allocation_label}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 120 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {tier.monthly_cents === 0 ? (
            'Free'
          ) : (
            <>
              ${(tier.monthly_cents / 100).toFixed(0)}
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                {tier.slug === 'byok_team' ? '/seat/mo' : '/mo'}
              </span>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {tier.monthly_cents === 0
            ? '30-day trial'
            : `$${(tier.yearly_cents / 100).toFixed(0)}${tier.slug === 'byok_team' ? '/seat/yr' : '/yr'} (–20%)`}
        </div>
      </div>
    </div>
  )
}

function priceCopy(tier: TierRow): string {
  if (tier.monthly_cents === 0) return 'Free · 30-day trial'
  const monthly = `$${(tier.monthly_cents / 100).toFixed(0)} / month`
  const yearly = `$${(tier.yearly_cents / 100).toFixed(0)} / year (20% discount)`
  if (tier.slug === 'byok_team') {
    return `$${(tier.monthly_cents / 100).toFixed(0)} / seat / month · $${(tier.yearly_cents / 100).toFixed(0)} / seat / year (20% discount)`
  }
  return `${monthly} · ${yearly}`
}

function formatPlanLabel(slug: string): string {
  switch (slug) {
    case 'byok_solo':
      return 'BYOK Solo'
    case 'byok_team':
      return 'BYOK Team'
    default:
      return slug.charAt(0).toUpperCase() + slug.slice(1)
  }
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

export type { PlanPanelProps, TierRow }
