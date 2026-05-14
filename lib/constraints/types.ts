import 'server-only'

/**
 * V1.x-B.1.1 — Atom-size guardrail types (interface contract).
 *
 * Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.3 T-3.3
 *         + design record §8 (atom-size guardrails).
 *
 * SESSION-1 SCOPE — types + minimal preflightCheck stub. Session 2
 * wires the recordViolation path + integrates the preflight call into
 * the per-iteration runner and the tool-result serialiser.
 *
 * Three risk areas the guardrails cover (design record §8):
 *   1. A tool returning a massive payload — per-tool result-size cap.
 *   2. Pathological multi-iteration turns — max-iterations-per-turn cap.
 *   3. Project Profile growing unbounded — soft watch in B.1.1 only.
 *
 * Limit-exceeded rejections are Class D failures (validation) per
 * Director Arch v2.0 §10.4.
 */

/** Configurable cap categories — each maps to a platform_config key. */
export type ViolationType =
  | 'tool_result_size_exceeded'
  | 'iterations_per_turn_exceeded'
  | 'profile_size_warned'

/** Returned by preflightCheck — caller surfaces Class D failure on .ok=false. */
export type PreflightResult =
  | { ok: true }
  | {
      ok: false
      violation: {
        type: ViolationType
        attempted_value: number
        configured_cap: number
        message: string
      }
    }

/**
 * Context attached to constraint_violations rows for capability-tuning
 * telemetry (M-094). Open-ended — caller adds whatever's most useful
 * for the rejection type.
 */
export interface ViolationContext {
  organisation_id?: string
  user_id?: string
  document_id?: string
  brief_id?: string
  tool_name?: string
  operation_type?: string
  notes?: string
}
