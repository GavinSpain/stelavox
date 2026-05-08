# Stelavox — Phase 5d.J1 Onboarding Test Report
## Version 1.0

> **Tier-B per-journey document.** First Journey of Phase 5d. Records verdict, per-case outcome, isolation hygiene, decisions, and SU items raised during J1.

**Journey:** J1 — Onboarding (signup → org → first project).

**Verdict:** PASS.

**Run summary:** 13 passed / 1 skipped (planned) / 0 failed. 34.1s wall time on local Supabase + Mailpit. Single Playwright worker.

**Master state at merge:** `d36a16e` (Phase 5d trilogy merge) before J1 lands.

---

## 1. Per-case results

| TC ID | Status | Wall time | Notes |
|---|---|---|---|
| TC-J1-01 | PASS | 1.4s | Direct dashboard redirect (local enable_confirmations=false). H-03 trigger atomicity verified — owner role on org row. |
| TC-J1-02 | PASS | 2.7s | Anti-enumeration: duplicate signup attempt does NOT create a second user row, never silently auths as the existing user. |
| TC-J1-03 | PASS | 1.3s | HTML5 minLength=8 blocks form submission for sub-8-char passwords. Defence-in-depth: no user row created. |
| TC-J1-04 | PASS | 1.3s | XSS injection in name field stored as literal text in user_metadata. window.__pwned never set on dashboard. |
| TC-J1-05 | PASS | 3.2s | Mailpit polled, recovery email arrived, click landed on /reset-password. |
| TC-J1-06 | PASS | 5.8s | Forgot-password for unknown email shows always-success message, no DB write, no email sent (Mailpit empty after 5s). |
| TC-J1-07 | PASS | 3.1s | Full reset flow: forgot → email → reset-form → dashboard → logout → login with new password. |
| TC-J1-08 | PASS | 437ms | Malformed recovery code → /auth/callback → /login?error=verification_failed. |
| TC-J1-09 | PASS | 2.6s | PKCE auth code is single-use; replay rejected with /login?error=verification_failed. |
| TC-J1-10 | PASS | 1.2s | Login valid creds → /dashboard. Tagged @cloud for cloud-smoke subset. |
| TC-J1-11 | PASS | 1.3s | Wrong password → "Invalid email or password" surfaced; URL stays on /login. |
| **TC-J1-12** | **SKIP** | — | **Planned skip.** Local Supabase config does not enforce login rate-limit. Behaviour is provider-side, only observable on cloud. Queued as J1 SU candidate (see §3 SU-1). |
| TC-J1-13 | PASS | 1.2s | Newly-signed-up user lands on /dashboard with `count(projects)=0` and "New project" CTA visible. |
| TC-J1-14 | PASS | 1.9s | Sign-out from header → /login; subsequent /dashboard navigation bounces to /login. |

**Active cases: 13/13 PASS. Skipped (planned): 1. Failures: 0.**

---

## 2. Iterations during build

Per CLAUDE.md "Spec vs Implementation Classification", every iteration during the build is recorded with classification + root cause + fix.

### 2.1 Iteration 1 — Selector strategy mismatch

**Symptom.** Initial run had TC-J1-01 + TC-J1-05 timing out at 30s × 3 attempts (`x` markers on retries). The remaining cases were aborted by the kill before they could run.

**Diagnosis.** POMs used `getByLabel('Email')` etc. The auth pages (`app/(auth)/{login,signup,forgot-password,reset-password}/`) place `<label>` and `<input>` as siblings inside a wrapper div, with no `htmlFor`/`id` linkage. Playwright's `getByLabel` resolver cannot match a label to its input without that linkage. Filling the email input never happened; signup form never submitted; the `waitForURL('/dashboard')` timed out.

**Classification.** Test-only — the contract between POM and component diverged. The components themselves are correct; the POMs assumed an a11y-correct label association that the components don't yet provide.

**Fix.** Switched all four auth POMs to `input[type="email"|"password"|"text"]` selectors. These are stable HTML semantic contracts (the `type` attribute is part of the form contract, not a styling concern). For two-password forms (signup, reset-password), used `.locator('input[type="password"]').first()` and `.nth(1)` per the existing Phase 1 pattern in `tests/ui/auth.spec.ts`.

**SU candidate raised.** SU-J1-2 (see §3) — adding `htmlFor`/`id` linkage to the auth forms would improve a11y AND let POMs use semantic `getByLabel` selectors. Low-risk, deferred as a small follow-up PR.

**Re-run.** All 13 active cases PASS in 34.1s.

---

## 3. SU items raised in J1

| ID | Description | Disposition |
|---|---|---|
| **SU-J1-1** | Login attempt rate-limit not testable on local Supabase. Local config has no rate-limit enforcement on `signInWithPassword`. Cloud Supabase enforces ~30/hour by default but the local stack does not match this. TC-J1-12 is currently `test.skip()`. | **Open.** Either (a) configure local Supabase to mirror cloud rate-limit, or (b) move TC-J1-12 to cloud-smoke subset only. Resolution depends on whether other Journeys surface similar local-vs-cloud config gaps. Tracking in `project_phase5d_progress.md`. |
| **SU-J1-2** | Auth forms (login/signup/forgot/reset) have `<label>` + `<input>` as siblings with no `htmlFor`/`id` linkage. This works for visual identification but breaks `getByLabel` resolver and is sub-optimal for screen readers. | **V1.x candidate.** Small one-line change per Field component in each auth page. Defer to a non-Phase-5d PR; J1 POMs use `input[type=...]` selectors which are stable for HTML forms. |
| **SU-J1-3** | "Cross-tab logout via Realtime broadcast" was scoped in Test Plan §3.10 / TC-J1-14 description. Stelavox's actual cross-tab logout mechanism is Supabase's localStorage auth-state sync, NOT Realtime broadcast. This is a Test Plan description error. | **Test Plan amendment** at next Plan revision (or Phase 5d umbrella close-out). The case TC-J1-14 itself is correct as authored — single-tab logout + dashboard-redirects-back-to-login. Cross-tab is a different mechanism that can be tested in a separate case (J8 cross-cutting candidate). |

None of the J1 SU items are launch-blocking or invariant-violating. SU-J1-1 is a config gap. SU-J1-2 is a small a11y improvement. SU-J1-3 is a description-level Test Plan correction.

---

## 4. Isolation hygiene

Per QA Strategy §4 — every Phase 5d test owns its own data and cleans up.

**Hygiene: clean.**

J1's spec pattern:
- `createdEmails: string[]` per-test array
- `test.beforeEach`: reset `createdEmails`
- `test.afterEach`: cascade-delete each email's user via `deleteUserByEmail()` (cascades to organisation_members + organisations + projects via FKs)

Tests that pre-create users via `admin.auth.admin.createUser` push the email into `createdEmails` so cleanup catches them. Tests that DON'T create users (TC-J1-03 short-password fail; TC-J1-06 unknown-email forgot; TC-J1-08 malformed-token; TC-J1-11 wrong-password against seeded USERS.B; TC-J1-12 skipped) explicitly do not push.

`createIsolatedDoc` is in place at `tests/helpers/isolation.ts` but **not yet exercised** by J1 — the auth journey doesn't create projects/documents. J2 is the first Journey that exercises the helper end-to-end.

---

## 5. Page-object catalog deltas

J1 added the following POMs to `tests/pages/`:

- `LoginPage.ts`
- `SignupPage.ts`
- `ForgotPasswordPage.ts`
- `ResetPasswordPage.ts`
- `EmailVerificationPage.ts`
- `DashboardPage.ts`

Plus the `tests/helpers/isolation.ts` helper and the `playwright.config.ts` extension with `j1`..`j10` + `cloud-smoke` project tags. The cloud-smoke runner stub at `scripts/run-cloud-smoke.ts` is in place.

**Convention notes for J2+:**

- POMs use type-based input selectors (`input[type="email"]`, `input[type="password"]`) where forms have unlinked labels. `getByRole` for buttons + links works correctly because button text is the accessible name.
- POMs are short — no assertions inside the POM; they expose locators + perform actions and let the spec assert.
- Cleanup is owned by the spec, not the POM — POMs don't know about test isolation.

---

## 6. Cloud-smoke status

Per Build Checklist CK-J1: "Cloud-smoke CS-01, CS-02 PASS on `stelavox-dev`".

**Status: deferred to post-merge follow-up.** The cloud-smoke runner at `scripts/run-cloud-smoke.ts` is a documented stub for J1; it requires manual env-swap (per `reference_servicekey_storage.md`) which is out of scope for the J1 build session. J2 will flesh out the automated runner with the first real CS-* execution.

The two cases tagged `@cloud` in `tests/phase5d/j1-onboarding.spec.ts` (TC-J1-10) are runnable against the Vercel deploy via:

```
PLAYWRIGHT_APP_URL=https://stelavox.vercel.app npx playwright test --project=cloud-smoke
```

…with `.env.local` swapped to `stelavox-dev` credentials. This is a manual operation that the user runs ad-hoc; CI does not currently run cloud-smoke.

This deferral does **not** block the J1 merge per the dual-environment policy (Build Checklist §7): "Post-merge cloud-smoke runs the 16-case CS-* subset … after merge to master, not as a merge gate, to avoid blocking on Vercel transient flake." J1 ships with the local-suite-clean verdict; cloud-smoke is observation, not gate.

---

## 7. Pre-merge gates at J1 commit

| Gate | Status |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 (no new warnings) |
| `npm run build` | exit 0 |
| `npm run test:unit` | 28/28 PASS (4 skipped — no Anthropic key in env, expected) |
| Phase 5d J1 suite (`--project=j1`) | 13/13 PASS, 1 skipped (planned) |

Phase 1-5c regression suite NOT re-run for J1 — per QA Strategy §11.1 (umbrella regression) the cross-Journey regression is verified at Phase 5d close-out, not per-Journey. The new `j1` Playwright project is additive; the existing `chromium` project still runs everything when invoked directly.

---

## 8. Verdict

**J1 PASSES.**

CK-J1 met:
- ✓ All TC-J1-* cases authored and PASS (13/13 active, 1 planned skip)
- ✓ Page-object catalog has LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, EmailVerificationPage, DashboardPage
- ⏳ Cloud-smoke CS-01/CS-02 deferred to post-merge follow-up (per dual-environment policy)
- ✓ Test Report `stelavox_phase5d_j1_test_report_v1_0.md` authored

Phase 5d.J1 ships to master as `Phase 5d.J1 — onboarding journey`.

---

## 9. Changelog

**v1.0 — 2026-05-09** Initial Phase 5d.J1 Test Report. 13 active cases PASS, 1 planned skip (TC-J1-12 login rate-limit, local Supabase doesn't enforce). 34.1s wall time, single worker. One iteration during build (selector-strategy mismatch — `getByLabel` doesn't resolve unlinked labels; switched to `input[type=...]` selectors). Three SU items raised: SU-J1-1 (local rate-limit config gap), SU-J1-2 (a11y label linkage), SU-J1-3 (Test Plan §3.10 description error re cross-tab logout mechanism). All non-blocking. Cloud-smoke deferred to post-merge follow-up per dual-environment policy. Six POMs added to `tests/pages/`; `tests/helpers/isolation.ts` shipped (not yet exercised by J1, used by J2+); `playwright.config.ts` extended with `j1`..`j10` + `cloud-smoke` project tags; `scripts/run-cloud-smoke.ts` stub. CK-J1 met (with cloud-smoke as observation, not gate).
