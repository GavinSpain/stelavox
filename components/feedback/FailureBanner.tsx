'use client'

/**
 * FailureBanner — Class D (validation) + Class E (hard system) surface.
 *
 * Source: docs/wireframes/wireframe_failure_mode_ux_v1.html §03.
 * Spec: Component Spec §17.13 (V1.x-F).
 *
 * In-page banner anchored above the affected surface (caller decides
 * placement). Two tones:
 *   - Class D — 3px --color-error left border + optional remediation
 *     block + optional action link ("Open node"). No automatic retry —
 *     validation failures need user intervention.
 *   - Class E — full --color-error border + low-saturation red gradient
 *     background + mailto: support CTA. Visually heavier; Class E is
 *     exceptional and worth pausing for.
 *
 * Dismiss persistence (D4 locked decision): caller persists via
 * localStorage `failure-banner-dismissed:<job_id>` on onDismiss; the
 * banner re-mount path then short-circuits when the key exists.
 *
 * Inviolables: Inter only; no verdigris.
 */

interface FailureBannerProps {
  classKind: 'D' | 'E'
  title: string
  message: string
  /** Class D — actionable remediation guidance shown in elevated sub-block. */
  remediation?: string
  /** Class D — action affordance text + href (e.g. "Open node"). */
  actionLabel?: string
  actionHref?: string
  /** Class E — mailto: target. */
  contactEmail?: string
  /** Class E — subject prefix; the component appends ": <job_id_or_title>". */
  contactSubjectPrefix?: string
  jobId?: string
  onDismiss?: () => void
}

const ICON: Record<FailureBannerProps['classKind'], string> = {
  D: '!',
  E: '⚠',
}

export function FailureBanner({
  classKind,
  title,
  message,
  remediation,
  actionLabel,
  actionHref,
  contactEmail,
  contactSubjectPrefix,
  jobId,
  onDismiss,
}: FailureBannerProps) {
  const isClassE = classKind === 'E'
  const containerStyle: React.CSSProperties = isClassE
    ? {
        border: '1px solid var(--color-error)',
        background:
          'linear-gradient(0deg, rgba(184,56,56,0.05) 0%, rgba(184,56,56,0.10) 100%)',
      }
    : {
        border: '1px solid var(--color-border-subtle)',
        borderLeft: '3px solid var(--color-error)',
        background: 'var(--color-bg-base)',
      }

  const mailtoHref = (() => {
    if (!isClassE || !contactEmail) return undefined
    const subject = encodeURIComponent(
      `${contactSubjectPrefix ?? 'Hard system error'}${jobId ? ` (job ${jobId})` : ''}`,
    )
    return `mailto:${contactEmail}?subject=${subject}`
  })()

  return (
    <div
      data-testid="failure-banner"
      data-class={classKind}
      role="alert"
      style={{
        ...containerStyle,
        borderRadius: '4px',
        padding: 'var(--space-3) var(--space-4)',
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        position: 'relative',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '20px',
          height: '20px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'var(--color-error)',
          fontSize: '14px',
        }}
      >
        {ICON[classKind]}
      </span>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--color-text-primary)',
            marginBottom: '4px',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '12px',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-2)',
            lineHeight: 1.6,
          }}
        >
          {message}
        </div>

        {remediation && (
          <div
            style={{
              background: 'var(--color-bg-elevated)',
              borderRadius: '3px',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              marginTop: 'var(--space-2)',
            }}
          >
            <div
              style={{
                fontSize: '9px',
                fontWeight: 500,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--color-text-tertiary)',
                marginBottom: '4px',
              }}
            >
              What to do
            </div>
            {remediation}
          </div>
        )}

        {actionHref && actionLabel && (
          <a
            href={actionHref}
            data-testid="failure-banner-action"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-strong)',
              borderRadius: '3px',
              padding: '6px 12px',
              cursor: 'pointer',
              marginTop: 'var(--space-2)',
              textDecoration: 'none',
            }}
          >
            {actionLabel} →
          </a>
        )}

        {mailtoHref && (
          <a
            href={mailtoHref}
            data-testid="failure-banner-contact"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              background: 'transparent',
              color: 'var(--color-error)',
              border: '1px solid var(--color-error)',
              borderRadius: '3px',
              padding: '6px 12px',
              cursor: 'pointer',
              marginTop: 'var(--space-2)',
              textDecoration: 'none',
            }}
          >
            Contact support
          </a>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid="failure-banner-dismiss"
          style={{
            fontSize: '16px',
            color: 'var(--color-text-tertiary)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
            position: 'absolute',
            top: 'var(--space-2)',
            right: 'var(--space-2)',
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}
