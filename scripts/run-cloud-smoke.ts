/**
 * Phase 5d cloud-smoke runner — stub.
 *
 * Per Build Checklist PB-10 + QA Strategy §7.3, cloud-smoke runs against
 * stelavox-dev post-merge using the env-swap pattern from Phase 5b/5c:
 *
 *   1. Back up .env.local
 *   2. Load .env.servicekey (per reference_servicekey_storage.md) and overlay
 *   3. Set PLAYWRIGHT_APP_URL=https://stelavox.vercel.app
 *   4. Run `playwright test --project=cloud-smoke`
 *   5. Restore .env.local regardless of pass/fail
 *
 * J1 ships this as a documented stub. J2 fleshes it out with the first
 * real CS-* run. The spec contract is captured in cases tagged @cloud
 * inside the j*-onboarding.spec.ts files.
 *
 * To run the cloud-smoke subset locally against the deployed Vercel app:
 *   1. Manually copy stelavox-dev's NEXT_PUBLIC_SUPABASE_URL, anon key, and
 *      service role key into .env.local
 *   2. PLAYWRIGHT_APP_URL=https://stelavox.vercel.app npx playwright test --project=cloud-smoke
 *   3. Revert .env.local
 *
 * Future work (queued, not blocking J1):
 *   - Implement automatic env swap from .env.servicekey
 *   - Add a `--rollback` flag that re-points the env back to local
 *   - Add a notion of "cloud-smoke health budget" (e.g. tolerate one transient
 *     Vercel/Supabase blip per merge before alerting)
 */

console.log('[cloud-smoke] stub — manual env swap required for J1.')
console.log('[cloud-smoke] See scripts/run-cloud-smoke.ts header for the procedure.')
console.log('[cloud-smoke] J2 expands this into an automated run.')
process.exit(0)
