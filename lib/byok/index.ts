/**
 * V1.x-B.1.2 — lib/byok public surface.
 *
 * NOTE: the decrypted-key RPC (`get_user_anthropic_key_for_byok_call`)
 * is INTENTIONALLY NOT wrapped here. Putting it in lib/byok would risk
 * accidental Next.js route invocation, breaking the H-09 invariant
 * (BYOK key plaintext only in Edge Function memory). The Edge Function
 * `supabase/functions/byok-llm-call/` is the only intended caller of
 * that RPC.
 */

export type { UserKeyStatus, UserKeyStatusPresent, UserKeyStatusAbsent, SaveKeyResult, ValidationResult } from './types'

export { validateAnthropicKey, ValidationInfraError } from './validateAgainstAnthropic'
export { saveUserAnthropicKey, SaveKeyError } from './saveUserKey'
export type { SaveUserKeyOutcome } from './saveUserKey'
export { getUserKeyStatus } from './getUserKeyStatus'
export { deleteUserKey } from './deleteUserKey'

// V1.x-C.3 — per-org BYOK helpers (Option A retarget).
export {
  saveOrgAnthropicKey,
  SaveOrgKeyError,
  getOrgKeyStatus,
  deleteOrgKey,
  orgHasByokKey,
} from './orgKey'
export type {
  OrgKeyStatus,
  OrgKeyStatusPresent,
  OrgKeyStatusAbsent,
  SaveOrgKeyResult,
  SaveOrgKeyOutcome,
} from './orgKey'
