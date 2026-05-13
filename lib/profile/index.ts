/**
 * Project Profile module — V1.x-A.1.
 *
 * Public exports for the persistent-identity Project Profile artefact.
 */

export * from './types'
export {
  validatePreferences,
  validateAmendmentValue,
  ProjectProfilePreferencesSchema,
} from './preferencesValidator'
export { getProjectProfile, getProjectProfileByDocumentId } from './getProjectProfile'
export {
  buildProfileAmendmentProposal,
  ProposeProfileAmendmentInputSchema,
} from './proposalBuilder'
export type { ProposeProfileAmendmentInput } from './proposalBuilder'
export { applyProfileAmendment, RpcError } from './applyAmendment'
