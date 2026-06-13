'use client'

/**
 * SecurityWarningBanner — Phase 9.E (DR-050).
 *
 * Surfaces when the injection scanner blocks an agent/Director request
 * (HTTP 422 injection_blocked foreground, or an agent_jobs failure with
 * error_message starting 'injection_blocked'). Built on the FailureBanner
 * chassis but with security framing — `--color-status-review` (caution /
 * attention) rather than error-red, because the scanner firing is the
 * system working as intended, not a malfunction.
 *
 * Author lock: "Security is paramount and we can not compromise on
 * security." There is NO override affordance — the message explains the
 * author's two options (rewrite the flagged text, or write the prose
 * manually). The copy itself comes from platform_config
 * (failure.injection_blocked_message) via the failure-message bundle, so
 * the wording is admin-tunable without a deploy.
 *
 * Inviolables: Inter only; no verdigris.
 */

import { useFailureMessages } from '@/lib/ui/useFailureMessages'

export function SecurityWarningBanner({ onDismiss }: { onDismiss?: () => void }) {
  const bundle = useFailureMessages()
  const message =
    bundle?.injection_blocked_message ??
    'The security scanner flagged this text as a possible prompt-injection attempt, so the AI request was blocked.'

  return (
    <div
      data-testid="security-warning-banner"
      role="alert"
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderLeft: '3px solid var(--color-status-review)',
        background: 'var(--color-bg-base)',
        borderRadius: '4px',
        padding: 'var(--space-3) var(--space-4)',
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        position: 'relative',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
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
          color: 'var(--color-status-review)',
          fontSize: '14px',
        }}
      >
        ⛊
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
          Content blocked by security check
        </div>
        <div style={{ lineHeight: 1.55 }}>{message}</div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: '14px',
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}

/**
 * True when an agent_jobs error_message represents an injection block.
 * The runner persists `injection_blocked:<field>` (lib/agent/runner.ts).
 */
export function isInjectionBlockedError(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === 'string' && errorMessage.startsWith('injection_blocked')
}
