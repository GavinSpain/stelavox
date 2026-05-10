// Audit log writer (round-3 audit B5.1 + B5.2; closes F-56).
//
// TA §4.3 / §4.5 / §4.9: every security-relevant event must persist to
// the audit_log table for forensic reconstruction. Pre-fix the same
// events landed only in `console.error('[SECURITY]', ...)` — visible in
// Vercel runtime logs, not queryable, no per-org filterability, no
// retention guarantee.
//
// `writeAuditLogEntry` is the canonical entry point. Callers (canary
// leak detector, injection scanner, tool-call validator, Anthropic
// throttle observer, etc.) hand in an event_class + severity + payload
// + the contextual UUIDs they have. The helper writes the row via the
// service-role client (RLS allows service_role INSERT only — see
// migration 044) and is fire-and-forget from the caller's perspective.
//
// Failure mode: if the audit write itself fails (DB down, RLS
// misconfiguration, etc.), the helper falls back to console.error with
// the structured payload AND the original audit-write error. The
// caller's path is never blocked by audit failure (audit is observability,
// not a security gate). Rationale: silently dropping audit on DB
// failure is bad, but blocking a Director conversation on audit failure
// is worse — Vercel logs remain a fallback channel until DB recovers.

import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

// Stable column-name pairing with the audit_log table. The table uses
// `event_type` and `metadata`; the helper exposes those names directly
// so callers don't have to remember a mapping. (The audit's F-56
// references "event_class" / "payload" but those are conceptual —
// the actual column names predate the audit per Migration 008.)
export interface AuditLogEntry {
  event_type:      string
  severity:        AuditSeverity
  organisation_id?: string | null
  user_id?:        string | null
  document_id?:    string | null
  conversation_id?: string | null
  node_id?:        string | null
  metadata?:       Record<string, unknown>
}

export async function writeAuditLogEntry(entry: AuditLogEntry): Promise<void> {
  const supabase = createServiceRoleClient()
  const row = {
    event_type:      entry.event_type,
    severity:        entry.severity,
    organisation_id: entry.organisation_id ?? null,
    user_id:         entry.user_id ?? null,
    document_id:     entry.document_id ?? null,
    conversation_id: entry.conversation_id ?? null,
    node_id:         entry.node_id ?? null,
    metadata:        entry.metadata ?? {},
  }

  const { error } = await supabase.from('audit_log').insert(row as never)

  if (error) {
    // Fallback to console so the event is at least visible somewhere.
    // The structured payload still goes to logs — operations can grep
    // for `[AUDIT-FALLBACK]` to find these.
    console.error('[AUDIT-FALLBACK] audit_log insert failed', {
      audit_error: error.message,
      entry: row,
    })
  }
}
