/**
 * Brief module — V1.x-A.1 (operation-level).
 *
 * Public exports for the operation-level Brief artefact.
 */

export * from './types'
export { detectStageTriggerCycles } from './cycleDetector'
export type { CycleCheckResult } from './cycleDetector'
export { buildBriefProposal, ProposeBriefInputSchema } from './proposalBuilder'
export type { ProposeBriefInput, BriefProposalStepInput } from './proposalBuilder'
export { getActiveBriefForDocument, getBriefById } from './getBriefState'
export { acceptBrief, completeBriefStage, cancelBrief, BriefRpcError } from './rpcWrappers'
