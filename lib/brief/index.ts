/**
 * Brief module — V1.x-A.
 *
 * Public exports for the Brief substrate. Consumers (Director tool
 * registry, API routes, UI components) import from this barrel.
 */

export * from './types'
export { validatePreferences, validateAmendmentValue, BriefPreferencesSchema } from './preferencesValidator'
export { detectStageTriggerCycles } from './cycleDetector'
export type { CycleCheckResult } from './cycleDetector'
export {
  buildBriefProposal,
  buildBriefAmendmentProposal,
  ProposeBriefInputSchema,
  ProposeBriefAmendmentInputSchema,
} from './proposalBuilder'
export type { ProposeBriefInput, ProposeBriefAmendmentInput } from './proposalBuilder'
export { getBriefState, getBriefStateByDocumentId } from './getBriefState'
export { applyBriefProposal, RpcError } from './applyProposal'
export { applyBriefAmendment } from './applyAmendment'
