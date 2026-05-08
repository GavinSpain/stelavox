# Stelavox — Phase 5d Umbrella Test Report
## Version 1.0

> **Tier-B umbrella per-phase document.** Closes Phase 5d. Aggregates J1-J10 verdicts, totalises SU items, captures the cumulative state at master HEAD `46f6321`. Companion to the per-Journey Test Reports.

**Phase:** 5d — Quality Assurance & End-to-End Confidence.

**Verdict:** PHASE 5d SHIPS — confidence-builder layer complete in the form authored. Active scope tightly scoped per QA Strategy §11.3 ("Phase 5d does NOT promise that no bugs will reach production").

---

## 1. Cumulative state

### 1.1 Final scoreboard

| Journey | Active PASS | Skipped | Test Report |
|---|---|---|---|
| J1 — Onboarding | 13 | 1 | `stelavox_phase5d_j1_test_report_v1_0.md` |
| J2 — Document creation (v1.0 partial → J2.B) | 17 | 4 | `stelavox_phase5d_j2_test_report_v1_1.md` |
| J3 — Manual authoring | 17 | 10 | `stelavox_phase5d_j3_test_report_v1_0.md` |
| J4 — Context system | 12 | 2 | `stelavox_phase5d_j4_test_report_v1_0.md` |
| J5 — Single-node agent ops | 10 | 13 | `stelavox_phase5d_j5_test_report_v1_0.md` |
| J6 — Director + workflow | 6 | 11 | `stelavox_phase5d_j6_j7_j8_j9_j10_test_report_v1_0.md` |
| J7 — Synthesise streaming | 3 | 7 | (same bundle) |
| J8 — Cross-cutting | 5 | 9 | (same bundle) |
| J9 — Edge / sad paths | 4 | 7 | (same bundle) |
| J10 — Visual regression | 8 | 8 | (same bundle) |
| **Total** | **95 active** | **72 skipped** | — |

**Cumulative wall time:** ~5 minutes across all 10 Journey suites in single-worker mode.

**Cumulative LLM spend:** ~$0.01 (Haiku, TC-J5-01 dispatch only).

### 1.2 Phase 5d sequence on master

```
46f6321 Merge Phase 5d.J6-J10 — bundled tail-end journeys
a226bdf Phase 5d.J6-J10 — bundled tail-end journeys
09fbeab Merge Phase 5d.J5
8e41519 Merge Phase 5d.J4 — context system journey
b10e748 Merge Phase 5d.J3 — manual authoring journey (partial)
8188809 Merge Phase 5d.J2.B — tree-mutation cases + SU-J1-2 a11y
1e05d42 Merge Phase 5d.J2 — document creation journey (partial)
abfba1f Merge Phase 5d.J1 — onboarding journey
d36a16e Merge Phase 5d Tier-B trilogy
504fa22 Phase 5d Tier-B: Test Plan + Build Checklist + QA Strategy v1.0
9b8d445 Phase 5c close-out (entry point)
```

---

## 2. What Phase 5d caught

Per QA Strategy §1 — Phase 5d's value is integration-seam regressions. The phase caught and closed:

### 2.1 Real findings

| ID | Description | Disposition |
|---|---|---|
| **Phase 5c bug #1 regression guard** | `vercel.json` CSP must list `wss://*.supabase.co` separately from `https://*.supabase.co` for Realtime WebSockets to upgrade on Vercel. | **TC-J7-05+06 PASS** — static-file regression guard prevents recurrence without needing a live Vercel deploy. |
| **Phase 5c bug #2 regression guard** | `accept_agent_job` RPC requires Tiptap-JSON-stringified prose (not plain text) — `workflow_executor` previously diverged from user-Accept route. | **TC-J5-19 PASS** — direct RPC contract verified. |
| **Phase 5c bug #5 family (SU-52)** | refine profile resolution must dispatch on (operation_type, node_type, target_field-encoded-in-name) — not by `created_at` ordering. | **TC-J5-08v + TC-J6-16 PASS** — system profiles for all 5 refine variants verified. |
| **Phase 4 SU-17** | `/api/nodes/[id]/move` must reject context-source nodes being children of non-source parents. | **TC-J4-11 PASS**. |
| **Migration 024 (SU-14)** | nodes.scope conditional NOT NULL CHECK for context-category nodes. | **TC-J4-09 + TC-J4-10 PASS**. |
| **Product Spec v1.4 §4.7 (SU-16)** | V1 six-core context whitelist enforced. | **TC-J4-13 PASS**. |
| **H-15 leaf-only mounting** | ProseEditor must not mount on non-leaf nodes; tree must hide Add-child on leaves. | **TC-J3-09 + TC-J2-12 PASS**. |
| **H-04 sibling-reorder atomicity** | (covered by Phase 2 prior-art tests/ui/tree_drag_drop.spec.ts; J2-18..21 deferred as drag-drop fragile in Playwright). | Phase 2 prior-art retained. |
| **Optimistic concurrency** | PATCH with stale expected_version → 409. | **TC-J9-09 PASS**. |
| **Cross-org RLS on every surface** | Project / Document / Node / Conversation / Context-link API endpoints. | **TC-J2-04, J2-10, J2-17, J3-RLS, J4-04-cross-org, J4-06, J5-RLS, J6-18, J6-RLS, J8-06 PASS**. |
| **Anti-enumeration on signup + forgot-password** | Same response regardless of email existence. | **TC-J1-02 + TC-J1-06 PASS**. |
| **PKCE single-use auth code** | Recovery link replay rejected. | **TC-J1-09 PASS**. |
| **Inviolable #4 (typeface boundary)** | SummaryEditor/NotesEditor Inter; ProseEditor Lora. | **TC-J3-01, J3-05, J3-08 PASS**. |
| **Inviolable #2 (verdigris caret)** | ProseEditor caret-color uses `--color-accent`. | **TC-J3-10 PASS**. |
| **Component Spec §6.2 (FocusBreadcrumb)** | `pointer-events:none` + max opacity ≤0.21. | **TC-J3-19 PASS**. |
| **Component Spec §5.13 (NotesEditor Link allowed)** | (skipped in J3 — assertion shape mismatch; SU-J3-1). | Open. |

### 2.2 False alarms unmasked

| ID | Original concern | Reality |
|---|---|---|
| SU-J2-1 | "API returns 500 instead of 404 for cross-org" | Turbopack stale-cache. With wiped `.next/`, route returns correct 404. |
| SU-J2-2 | "API returns 500 instead of 400 for malformed input" | Same root cause — Turbopack stale-cache. |

Both are closed; the operative SU is **SU-J2-4** (process amendment to wipe `.next/` between Phase 5d Journey iterations).

### 2.3 Test-side iterations during build

15 iteration cycles across the 10 Journeys, all classified per CLAUDE.md "Spec vs Implementation Classification":

- 5 "Test-only" — POM/component contract divergence (selector strategy, label association, response shape)
- 4 "Environment" — Turbopack stale cache, dev-server port reuse, env file copy
- 3 "Spec ambiguity" — workflow state-machine guard semantics, status enum CHECK constraints, lock release semantics
- 0 "Implementation gap" — no real code-side bugs found by Phase 5d that haven't already been caught by Phase 5c

---

## 3. SU items at Phase 5d close

### 3.1 Closed in Phase 5d

| ID | Description | Closure |
|---|---|---|
| SU-J1-2 | Auth forms label-input linkage | Nested input under label across 4 auth pages |
| SU-J2-1 | Cross-org GET → 500 | False alarm (Turbopack) |
| SU-J2-2 | Malformed input → 500 | False alarm (Turbopack) |
| SU-J2-3 | NodeTreePage readiness | Simplified to `goto + waitForLoadState('networkidle')` matching Phase 2 prior-art |

### 3.2 Open at Phase 5d close (none launch-blocking)

| ID | Description | Disposition |
|---|---|---|
| SU-J1-1 | Local Supabase has no login rate-limit | Cloud-smoke covers; or local config alignment follow-up |
| SU-J1-3 | Test Plan §3.10 cross-tab logout description error | Test Plan v1.1 amendment |
| SU-J2-4 | Phase 5d Journey iterations need `.next/` wipe between runs | `feedback_phase_session_procedure.md` amendment |
| SU-J3-1 | Notes Link mark survival assertion shape | Schema-level Tiptap inspection follow-up |
| SU-J3-2 | SelectionTooltip + synthetic Ctrl+A timing | Mouse-drag selection follow-up |
| SU-J3-3 | Version trigger fires only on API path | API-routed pre-population follow-up |
| SU-J3-4 | Locked-beat read-only signal spec clarification | Spec-side decision |
| SU-J3-5 | Multiple surfaces lack data-testid (CommentThread, VersionHistory hover, FocusBreadcrumb, AgentTab, DirectorPanel, etc.) | Single small data-testid PR — high-value cross-cut for J2-J10 follow-ups |
| SU-J6 family | Workflow state-machine guards reject admin-seeded rows | Director-flow-driven test follow-up |
| SU-J8 family | Lock release + status enum spec clarification | Spec-side |

10 open SUs at Phase 5d close. None are launch-blocking; most are small follow-up PRs.

---

## 4. Cloud-smoke status

Per Build Checklist §7 dual-environment policy, cloud-smoke is observation, not gate.

**Cloud-smoke verification approach taken:**

The most valuable single cloud-smoke case — **TC-J7-05+06 (CSP regression guard)** — was authored as a **static-file check** of `vercel.json` rather than a live Vercel hit. This:

- Runs in CI on every PR (no manual env swap)
- Catches Phase 5c bug #1 (the wss:// CSP omission) before merge
- Doesn't depend on Vercel deploy state
- Costs $0 to run

The remaining `@cloud`-tagged cases (TC-J1-10 login happy on Vercel) are:

- Already covered by J1's local run with the same logic
- Available for opt-in manual verification via the documented procedure in `scripts/run-cloud-smoke.ts` header

**No cloud-smoke run was executed against `stelavox.vercel.app` during this Phase 5d build session.** A future user-initiated manual run is the right path; the env-swap procedure is documented.

---

## 5. Cumulative infrastructure shipped

### 5.1 POMs (`tests/pages/`)
- LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, EmailVerificationPage, DashboardPage (J1)
- ProjectPage, NodeTreePage (J2)
- NodeDetailPanelPage (J3)

### 5.2 Helpers (`tests/helpers/`)
- `isolation.ts` — `createIsolatedDoc`, `findUserByEmail`, `deleteUserByEmail`, `getOrganisationIdForUser` (J1, used by J2+)
- `j3-fixture.ts` — `setupJ3Fixture` Act→Chapter→Scene→Beat (J3, used by J4+)

### 5.3 Spec files (`tests/phase5d/`)
- 10 Journey spec files (j1 through j10)
- ~3,000 lines of test code
- 167 total test entries (95 active + 72 skipped)

### 5.4 Visual baselines (`tests/phase5d/j10-visual.spec.ts-snapshots/`)
- 3 PNG baselines (login, signup, dashboard-empty)
- Update via `npx playwright test --project=j10 --update-snapshots` on intentional UI changes

### 5.5 Playwright project tags
- `chromium` (full suite, default)
- `j1` through `j10` (per-Journey filtering)
- `cloud-smoke` (grep `@cloud`)

### 5.6 Stub script
- `scripts/run-cloud-smoke.ts` — documented stub for the env-swap pattern

---

## 6. App-side changes shipped during Phase 5d

Two touched components (SU-J1-2 a11y closure):

- `app/(auth)/signup/page.tsx` — Field component nests input inside label
- `app/(auth)/login/LoginForm.tsx` — same
- `app/(auth)/forgot-password/page.tsx` — direct labels nested
- `app/(auth)/reset-password/page.tsx` — same

No upstream-spec versions were bumped; no new H-NN hazards added (per QA Strategy §8 escalation ladder, no Phase 5d finding warranted a hazard entry).

---

## 7. What Phase 5d explicitly does NOT promise

Per QA Strategy §11.3:

- That no bugs will reach production. Phase 5d is a confidence layer, not a proof.
- That every regression will be caught. The 95 cases are selective, not exhaustive.
- That UI surfaces with no data-testids are tested. Many SU-J3-5 family cases are deferred.
- Live LLM workflows are tested. The integration-seam contracts are; the actual prose quality is the Director eval methodology's domain.
- Mobile or cross-browser is tested. Desktop Chromium only.

---

## 8. Pre-merge gates at Phase 5d close

| Gate | Status |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run test:unit` | 28/28 PASS |
| All 10 Journey projects | 95 active PASS, 72 skipped, 0 failed |

---

## 9. Recommended follow-up priority

1. **SU-J3-5 data-testid PR** — single small change unlocks ~30 deferred UI cases across J3, J5, J6, J7, J8, J10
2. **SU-J2-4 process amendment** — fold `.next/` wipe into `feedback_phase_session_procedure.md`
3. **SU-J3-1, J3-2, J3-3** — small follow-ups on Notes Link mark, mouse-drag selection, API-routed version pre-pop
4. **SU-J3-4, J6, J8 spec clarifications** — workflow state machine guards, lock release contract, status enum transition matrix
5. **Real cloud-smoke run** when user wants Vercel verification

None of these are launch-blocking.

---

## 10. Verdict

**PHASE 5d SHIPS** as a confidence-builder layer. 95 active passing tests across 10 Journeys form the merge-blocking suite for future work. The Phase 5c bug pattern has explicit regression guards. Cumulative spend was minimal ($0.01 Haiku).

Phase 5d's contract — "every PR that adds a feature must include its own Phase 5d cases" (QA Strategy §6.3) — is now active.

---

## 11. Changelog

**v1.0 — 2026-05-09** Initial Phase 5d Umbrella Test Report. 95 active PASS / 72 skipped / 0 failed across 10 Journey suites. 4 SU items closed during Phase 5d build (SU-J1-2 a11y, SU-J2-1/J2-2 false alarms, SU-J2-3 readiness pattern). 10 SU items remain open at close — none launch-blocking. Phase 5c bug #1, #2, #5 regression guards in place. Cloud-smoke run deferred to opt-in manual verification; the most valuable cloud-smoke case (CSP) authored as a static vercel.json check that runs locally. 3 visual baselines captured.
