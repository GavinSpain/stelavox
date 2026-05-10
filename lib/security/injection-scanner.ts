/**
 * Prompt-injection pattern scanner.
 *
 * Source: stelavox_technical_architecture_v1_8.md §4.3. Build Checklist T-3.2.
 *
 * Pattern-based pre-scan for user-controlled content before it enters an LLM
 * prompt. Two severity levels:
 *
 *   - HIGH:   block the operation immediately (422 injection_blocked from
 *             API routes; throw from Edge Function context assembly).
 *   - MEDIUM: log to audit trail and continue.
 *
 * Both severities are written to audit_log per TA §4.3 (round-3 audit B5.2
 * fix for F-56's spec-divergence — pre-fix this used console.error only).
 */

import { writeAuditLogEntry } from '@/lib/security/audit'

export interface ScanMatch {
  pattern: string
  severity: 'high' | 'medium'
}

export interface ScanResult {
  clean: boolean
  matches: ScanMatch[]
}

const INJECTION_PATTERNS: Array<{ pattern: RegExp; severity: 'high' | 'medium' }> = [
  // High severity — clear prompt-injection attempts
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i, severity: 'high' },
  { pattern: /you\s+are\s+now\s+(in\s+)?(a\s+)?(new|different|developer|maintenance)/i, severity: 'high' },
  { pattern: /\[SYSTEM\]|\[ADMIN\]|\[OVERRIDE\]/i, severity: 'high' },
  { pattern: /print\s+(your\s+)?(system\s+)?prompt/i, severity: 'high' },
  { pattern: /reveal\s+(your\s+)?(api\s+|secret\s+)?key/i, severity: 'high' },
  { pattern: /DAN\s+mode|jailbreak|override\s+(the\s+)?(system\s+)?prompt/i, severity: 'high' },
  // XML-escape attempts — high severity since they break the spotlighting frame
  { pattern: /<\/user_data>|<system>|<\/system>/i, severity: 'high' },

  // Medium severity — softer manipulation attempts
  { pattern: /act\s+as\s+(if\s+you\s+(are|were)\s+)?a\s+different/i, severity: 'medium' },
  { pattern: /forget\s+(all\s+)?previous\s+instructions/i, severity: 'medium' },
]

/**
 * Scan a single piece of user-controlled content for injection patterns.
 * Returns a ScanResult — `clean: true` means no patterns matched.
 *
 * Caller responsibility:
 *   - HIGH match → block the operation (422 from API; throw from assembler).
 *   - MEDIUM match → log + continue.
 *   - All matches → write an audit_log entry (V2 — for now, console.error).
 */
export function scanContent(content: string): ScanResult {
  const matches: ScanMatch[] = []
  for (const { pattern, severity } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      matches.push({ pattern: pattern.toString(), severity })
    }
  }
  return { clean: matches.length === 0, matches }
}

/**
 * Convenience predicate: did the scan find any HIGH-severity match?
 * Used by API routes to decide whether to return 422 injection_blocked.
 */
export function hasHighSeverityMatch(result: ScanResult): boolean {
  return result.matches.some((m) => m.severity === 'high')
}

/**
 * Audit-log every match.
 *
 * B5.2 (round-3 audit F-56): writes to the audit_log table (TA §4.3 /
 * §4.9 mandate). Console.error retained as a redundant ops-channel for
 * tail-of-failure visibility — if audit_log itself is down,
 * [AUDIT-FALLBACK] in writeAuditLogEntry handles that, plus the
 * [SECURITY] prefix remains in Vercel logs as a backstop.
 */
export function logScanMatches(
  result: ScanResult,
  context: { fieldName: string; nodeId?: string; userId?: string; organisationId?: string },
): void {
  if (result.clean) return
  for (const match of result.matches) {
    console.error('[SECURITY]', 'injection_pattern_match', {
      severity: match.severity,
      pattern: match.pattern,
      field: context.fieldName,
      node_id: context.nodeId,
      user_id: context.userId,
      timestamp: new Date().toISOString(),
    })
    // Map injection-scanner severity ('high' | 'medium' | 'low') to
    // audit_log severity union directly — both vocabularies use the
    // same labels.
    void writeAuditLogEntry({
      event_type: 'injection_pattern_match',
      severity: match.severity as 'high' | 'medium' | 'low',
      organisation_id: context.organisationId,
      user_id: context.userId,
      node_id: context.nodeId,
      metadata: {
        pattern: match.pattern,
        field: context.fieldName,
        timestamp: new Date().toISOString(),
      },
    })
  }
}
