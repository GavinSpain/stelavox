'use client'

/**
 * FailureSurface — Phase 9.E (DR-020) adoption wrapper.
 *
 * Ties classifyFailure + the failure-message bundle + interpolation into
 * a single mountable surface. Callers pass a failed-request descriptor
 * ({ status, errorCode, rawError, node }); the surface classifies it,
 * fetches the configured template, interpolates per-event tokens, and
 * renders the right FailureToast (A/C) or FailureBanner (D/E).
 *
 * Renders nothing when:
 *   - there is no failure (status + rawError both null), or
 *   - the failure belongs to a dedicated surface (423 lock → DR-046;
 *     422 injection → DR-050) so it doesn't double-render.
 *
 * Inviolables: inherits the Toast/Banner styling — Inter only, no
 * verdigris.
 */

import { FailureBanner } from './FailureBanner'
import { FailureToast } from './FailureToast'
import { classifyFailure } from '@/lib/ui/classifyFailure'
import { interpolateFailureMessage } from '@/lib/ui/failureMessageInterpolate'
import { useFailureMessages } from '@/lib/ui/useFailureMessages'

export interface FailureDescriptor {
  /** HTTP status, or null for a network/throw failure. */
  status: number | null
  /** Server `error` field, when present. */
  errorCode?: string | null
  /** Raw human error string (server message or exception message). */
  rawError?: string | null
  /** Operation label for the Class-D template's {failure_class}. */
  operation?: string
  /** Node name for the Class-D template's {node_name}. */
  nodeName?: string
  /** Job id for the Class-E template's {job_id}. */
  jobId?: string
}

const CLASS_TITLES: Record<'A' | 'C' | 'D' | 'E', string> = {
  A: 'Temporary issue',
  C: 'Paused briefly',
  D: 'Request rejected',
  E: 'Something went wrong',
}

export function FailureSurface({
  failure,
  onDismiss,
}: {
  failure: FailureDescriptor | null
  onDismiss: () => void
}) {
  const bundle = useFailureMessages()
  if (!failure) return null
  if (failure.status === null && !failure.rawError) return null

  const classification = classifyFailure(failure.status, failure.errorCode)
  if (!classification) return null // dedicated surface owns this

  const { classKind, surface } = classification
  const reason = failure.rawError ?? failure.errorCode ?? 'unknown error'

  // Build the message from the configured template when the bundle has
  // loaded; fall back to a plain reason string until then.
  let message = reason
  if (bundle) {
    switch (classKind) {
      case 'A':
        message = interpolateFailureMessage(bundle.class_a_template, {
          attempt: 1,
          max_attempts: 3,
        })
        break
      case 'C':
        message = interpolateFailureMessage(bundle.class_c_template, {
          pause_seconds: bundle.class_c_min_pause_seconds,
        })
        break
      case 'D':
        message = interpolateFailureMessage(bundle.class_d_template, {
          failure_class: failure.operation ?? 'requested',
          node_name: failure.nodeName ?? 'this item',
          reason,
        })
        break
      case 'E':
        message = interpolateFailureMessage(bundle.class_e_template, {
          job_id: failure.jobId ?? 'n/a',
        })
        break
    }
  }

  if (surface === 'toast') {
    return (
      <FailureToast
        classKind={classKind as 'A' | 'C'}
        title={CLASS_TITLES[classKind]}
        message={message}
        onDismiss={onDismiss}
      />
    )
  }

  // Class D: budget rejections (402) get a remediation block + plan link.
  const isBudget = failure.status === 402
  return (
    <FailureBanner
      classKind={classKind as 'D' | 'E'}
      title={CLASS_TITLES[classKind]}
      message={message}
      remediation={
        classKind === 'D' && isBudget
          ? 'You can upgrade your plan or convert to bring-your-own-key to keep using the Director.'
          : undefined
      }
      actionLabel={classKind === 'D' && isBudget ? 'Manage plan' : undefined}
      actionHref={classKind === 'D' && isBudget ? '/settings/plan' : undefined}
      contactEmail={classKind === 'E' ? bundle?.class_e_admin_contact : undefined}
      contactSubjectPrefix={classKind === 'E' ? 'Stelavox failure' : undefined}
      jobId={failure.jobId}
      onDismiss={onDismiss}
    />
  )
}
