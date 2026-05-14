/**
 * V1.x-B.1.1 — lib/constraints public surface.
 *
 * Session-1 ships types + preflightCheck / getCap. Session 2 adds the
 * recordViolation INSERT path + integration into the per-iteration
 * runner and tool-result serialiser.
 */

export type { ViolationType, PreflightResult, ViolationContext } from './types'
export { getCap, preflightCheck } from './preflight'
