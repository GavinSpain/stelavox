# Stelavox — Phase 5d Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5d build. Companion to `stelavox_phase5d_test_plan_v1_0.md` and `stelavox_phase5d_qa_strategy_v1_0.md`. Lists every pre-build prerequisite, every phase-checkpoint criterion, the per-Journey sprint plan, the page-object catalog, the per-sprint tasks, and the risk register. Cross-cutting build conventions inherited from prior phases are not restated.

**Phase:** 5d — Quality Assurance & End-to-End Confidence.

**Multi-session note.** Phase 5d ships across multiple sessions, one Journey per session (estimated 6-12 sessions including the trilogy session). Each Journey merges to master independently as a Phase 5d sub-merge once its CK passes. The trilogy session (this) authors no test code.

---

## 1. Pre-build prerequisites

### PB-1 — Trilogy authored and reviewed

`docs/stelavox_phase5d_test_plan_v1_0.md`, `docs/stelavox_phase5d_build_checklist_v1_0.md`, `docs/stelavox_phase5d_qa_strategy_v1_0.md` — all three present, mutually consistent, and reviewed by the user. The trilogy is the contract for Phase 5d; no test code lands until the trilogy is merged.

### PB-2 — Master is at Phase 5c close-out

```
git -C C:/dev/stelavox_2 log --oneline | head -3
# Expect 9b8d445 (Ignore .vercel/ directory) at HEAD
```

If master has advanced past Phase 5c close-out (e.g. another phase's substrate landed in parallel), pause and reconcile before any Phase 5d sprint starts — the page-object catalog assumes Phase 5c surfaces and may need amendment.

### PB-3 — Local Supabase running on +10 ports + seed populated

`supabase status` shows green; Migration 033 applied (system profiles count = 22; per `project_phase5c_progress.md`); seed.sql loaded; `j5-novel` corpus available via `scripts/seed-director-fixture.ts`.

### PB-4 — Anthropic key + shell-env workaround

`.env.local` has `ANTHROPIC_API_KEY=sk-ant-...` set to a real key. The shell may carry an empty `ANTHROPIC_API_KEY` env var that overrides `.env.local` (per `reference_anthropic_key_shell_override.md`); prepend `unset ANTHROPIC_API_KEY` to dev / test invocations.

### PB-5 — Existing test runners both green

```
npx playwright test                   # Phase 1-5c suite (excluding the one carry-forward Character role-enum drift)
npm run test:unit                     # 32/32 PASS
```

These are the regression baselines Phase 5d's per-PR CI will preserve. If either suite fails at master HEAD, fix that first.

### PB-6 — Page-object catalog scaffolded

Before J1 starts, `tests/pages/` directory exists with at least one POM (e.g. `LoginPage.ts`) demonstrating the convention. The full catalog is built incrementally per Journey, but the convention is locked at PB-time so no Journey reinvents it. See §4 below.

### PB-7 — Journey-tagged test runner config

`playwright.config.ts` extended with project tags `j1` through `j10` so a single Journey can run in isolation:

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  // Phase 5d Journey filters
  { name: 'j1', testMatch: /tests\/phase5d\/j1-.*\.spec\.ts/ },
  // ... j2 through j10
]
```

This keeps the `chromium` project as the default (running everything) while letting CI / the user run `npx playwright test --project=j5` to scope to a single Journey.

### PB-8 — Test-data isolation helper (`createIsolatedDoc`)

Before J1, ship a small helper at `tests/helpers/isolation.ts`:

```ts
export async function createIsolatedDoc(opts: {...}): Promise<{ docId, cleanup }>
```

Every Phase 5d test calls this once at start, captures `docId`, and registers `cleanup` in `afterEach` regardless of pass/fail. **SU-50 was the lesson** — TC-A-30 collided with TC-A-15 because both reused the same j5-novel main document and neither cleaned up. The helper enforces "every test owns its own doc" by construction.

### PB-9 — `feedback_haiku_default.md` honoured

The runner config defaults all LLM-bearing cases to Haiku 4.5 (model id `claude-haiku-4-5-20251001`). Per-test override only when the test explicitly cross-validates (TC-J5-22).

### PB-10 — Cloud-smoke runner stub

A small CI script at `scripts/run-cloud-smoke.ts` exists (or its scaffolding does) that:
1. Loads `.env.servicekey` (per `reference_servicekey_storage.md`)
2. Swaps `.env.local` to point at `stelavox-dev`
3. Runs the CS-* subset against `https://stelavox.vercel.app`
4. Restores `.env.local` to local Supabase

The script can be a stub at PB time; J1 fleshes it out with the first CS case.

---

## 2. Phase Checkpoint Criteria

Phase 5d's CK list has one per Journey + a cross-cutting umbrella CK:

### CK-J1 — J1 Onboarding ships

All TC-J1-* cases authored and PASS. Cloud-smoke CS-01, CS-02 PASS on `stelavox-dev`. Page-object catalog has `LoginPage`, `SignupPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `EmailVerificationPage`. Test Report `stelavox_phase5d_j1_test_report_v1_0.md` authored.

### CK-J2 — J2 Document creation ships

All TC-J2-* cases authored and PASS. Cloud-smoke CS-03, CS-04, CS-05 PASS. Page-object catalog adds `DashboardPage`, `ProjectPage`, `NewProjectModal`, `NewDocumentModal`, `NodeTreePage` (the document editor entry point). Test Report J2 authored.

### CK-J3 — J3 Manual authoring ships

All TC-J3-* cases authored and PASS. Cloud-smoke CS-06, CS-07, CS-08, CS-09 PASS. Page-object catalog adds `NodeDetailPanelPage`, `SummaryEditorPage`, `NotesEditorPage`, `ProseEditorPage`, `WordCountPage`, `FocusModePage`, `VersionHistoryPage`, `CommentThreadPage`, `ConflictBannerPage`. Test Report J3 authored.

### CK-J4 — J4 Context system ships

All TC-J4-* cases authored and PASS. Page-object catalog adds `MetadataFormPage`, `ContextLinkerPage`, `BackLinksListPage`. Test Report J4 authored.

### CK-J5 — J5 Single-node agent ops ships

All TC-J5-* cases authored and PASS. Cloud-smoke CS-10, CS-11, CS-16 PASS. Page-object catalog adds `AgentTabPage`, `AgentJobHistoryPage`. Cross-model verification (TC-J5-22) ran with PASS on Haiku 4.5 + Sonnet 4.6 + Opus 4.7. Test Report J5 authored.

### CK-J6 — J6 Director + workflow ships

All TC-J6-* cases authored and PASS. Cloud-smoke CS-12, CS-13, CS-14 PASS. Page-object catalog adds `DirectorPanelPage`, `ConversationThreadPage`, `PlanCardPage`, `ExecutionCardPage`, `DirectorInputPage`, `NodePickerPage`. Test Report J6 authored.

### CK-J7 — J7 Synthesise streaming ships

All TC-J7-* cases authored and PASS. Cloud-smoke CS-15 (CSP regression guard) PASS — both as positive (CSP correct → AgentTab works) and as negative (CSP missing wss:// → test detects). Page-object catalog adds `AgentStreamingSurfacePage`. Test Report J7 authored.

### CK-J8 — J8 Cross-cutting ships

All TC-J8-* cases authored and PASS. No new POMs (J8 reuses existing surfaces); J8 adds `tests/helpers/securityProbes.ts` for cross-org / RLS / canary fixtures. Test Report J8 authored.

### CK-J9 — J9 Edge / sad paths ships

All TC-J9-* cases authored and PASS. J9 adds `tests/helpers/networkSimulation.ts` for upstream-failure simulation (Anthropic 5xx, 429, network drop). Test Report J9 authored.

### CK-J10 — J10 Visual regression ships

All TC-J10-* baselines captured into `tests/visual/baselines/phase5d/`. CI runs `playwright test --project=j10 --update-snapshots` on intentional UI changes (gated by `--update-snapshots` flag, never auto). Test Report J10 authored.

### CK-UMB — Umbrella regression

After every Journey ships, the full chromium project runs and PASSES. The umbrella CK is met when all 10 Journey CKs are green AND a single full-suite run is green at master HEAD.

### CK-DOC — Documentation absorption

After CK-UMB met, author `stelavox_phase5d_test_report_v1_0.md` (umbrella). No upstream-spec bumps unless Phase 5d surfaces a hazard requiring TA / Component Spec amendment (see §5 SU registry).

---

## 3. Per-Journey sprint plan

Each Journey is one session, scoped to ~3-4 hours of focused work, ending with merge-to-master and a Test Report. The order is:

1. **Trilogy session** (this one — no test code)
2. **J1 Onboarding** — fastest Journey, validates the methodology
3. **J2 Document creation** — depends on J1's auth helpers
4. **J3 Manual authoring** — large Journey; may split across 2 sessions if 28 cases is too dense
5. **J4 Context system**
6. **J5 Single-node agent ops** — first LLM-heavy Journey; revisits the methodology
7. **J6 Director + workflow** — most complex Journey
8. **J7 Synthesise streaming** — Phase 5c carry-forward + CSP guard
9. **J8 Cross-cutting** — security + locks + status
10. **J9 Edge / sad paths**
11. **J10 Visual regression**
12. **Umbrella session** — full regression + Test Report v1.0 + close-out

Sessions can be reordered if a high-value Journey surfaces an integration bug worth fixing first; the dependency chain (J1 → J2 → J3 → J5/J6) is loose, not strict.

### 3.1 Session structure (every Journey session)

A standard Phase 5d session walks:

1. **Read Tier-B trilogy + prior Journey's Test Report** — ~10 min
2. **Confirm master + worktree state** — ~5 min, per `feedback_phase_session_procedure.md`
3. **Author/extend page-object catalog for this Journey** — ~30 min
4. **Author the Journey's spec files** — `tests/phase5d/j{n}-{topic}.spec.ts` — ~90 min
5. **Run locally; iterate on flake / fixture / selector issues** — ~30 min
6. **Cloud-smoke for this Journey's CS-* subset** — ~10 min, env-swap pattern
7. **Author Test Report `stelavox_phase5d_j{n}_test_report_v1_0.md`** — ~15 min
8. **Pre-merge invariants** (`type-check`, `lint`, `build`, `test:unit`, full Playwright) — ~10 min
9. **Push branch + merge to master with `--no-ff`** — ~5 min
10. **Update `project_phase5d_progress.md` memory** — ~5 min

Total: ~3.5 hours per Journey.

---

## 4. Page-object catalog

Every Phase 5d test uses a Page Object Model (POM) — no inline selectors in `.spec.ts` files. The catalog grows incrementally per Journey.

### 4.1 Conventions

- **Location:** `tests/pages/`
- **Naming:** `{Surface}Page.ts` mapping 1:1 to a §2 Test Plan surface where possible
- **Shape:** A class with `goto()` (where applicable), `locators` as getters, and **action methods** that perform a move + return a post-condition descriptor
- **Selector strategy:** prefer `data-testid`, fallback `getByRole` / `getByLabel`. **Never** use raw CSS selectors that depend on Tailwind classes — those are not contracts. If a `data-testid` doesn't exist, the spec session adds one to the component as a one-line PR-bundled change
- **No assertions in POMs** — POMs surface state for the spec to assert

### 4.2 Catalog (target shape)

The full catalog at Phase 5d completion:

| POM | Source surface | Authored in Journey | Notes |
|---|---|---|---|
| `LoginPage` | S-AUTH-01 | J1 | |
| `SignupPage` | S-AUTH-02 | J1 | |
| `ForgotPasswordPage` | S-AUTH-03 | J1 | |
| `ResetPasswordPage` | S-AUTH-04 | J1 | |
| `EmailVerificationPage` | S-AUTH-05 | J1 | Uses Inbucket helper |
| `DashboardPage` | S-PROJ-01 | J2 | |
| `ProjectPage` | S-PROJ-02 | J2 | |
| `NewProjectModal` | S-PROJ-03 | J2 | |
| `NewDocumentModal` | S-PROJ-04 | J2 | |
| `NodeTreePage` | S-DOC-01, S-DOC-05, S-DOC-06, S-DOC-07 | J2 | Composes the doc editor + tree as one POM since they always co-mount |
| `NodeDetailPanelPage` | S-DET-01, S-DET-02, S-DET-15 | J3 | Tab strip + conflict banner included |
| `SummaryEditorPage` | S-DET-03 | J3 | |
| `NotesEditorPage` | S-DET-04 | J3 | |
| `MetadataFormPage` | S-DET-05 | J4 | |
| `ProseEditorPage` | S-DET-06 | J3 | Selection-tooltip helper exposed |
| `WordCountPage` | S-DET-07 | J3 | |
| `FocusModePage` | S-FOC-01..S-FOC-04 | J3 | |
| `VersionHistoryPage` | S-DET-13 | J3 | Browse + hover-diff only (V1) |
| `CommentThreadPage` | S-DET-14 | J3 | |
| `ContextLinkerPage` | S-DET-11 | J4 | |
| `BackLinksListPage` | S-DET-12 | J4 | |
| `AgentTabPage` | S-DET-09 | J5 | |
| `AgentJobHistoryPage` | S-DET-10 | J5 | |
| `AgentStreamingSurfacePage` | S-STR-01..S-STR-03 | J7 | Composes the streaming surface + cancel + post-stream |
| `DirectorPanelPage` | S-DIR-01 | J6 | |
| `ConversationThreadPage` | S-DIR-02..S-DIR-05 | J6 | |
| `PlanCardPage` | S-DIR-06 | J6 | |
| `ExecutionCardPage` | S-DIR-07 | J6 | |
| `DirectorInputPage` | S-DIR-08 | J6 | |
| `NodePickerPage` | S-DIR-09 | J6 | Used by both Director and J4's ContextLinker if surfaces share it |
| `ToastPage` | S-SYS-01 | J9 | Used by error-path cases |
| `ModalPage` | S-SYS-02 | J3 | Generic modal helper |
| `NodeStatusBadgePage` | S-SYS-04 | J5 | Snapshot in J10 |

### 4.3 Helper modules

| Helper | Used by | Notes |
|---|---|---|
| `tests/helpers/isolation.ts` | All | `createIsolatedDoc` per PB-8 |
| `tests/helpers/auth.ts` | All | Already exists; extend if needed |
| `tests/helpers/inbucket.ts` | J1 | Already exists |
| `tests/helpers/db.ts` | All | Already exists; direct-DB assertions |
| `tests/helpers/agent-fixtures.ts` | J5, J6 | Already exists; agent_jobs seeding |
| `tests/helpers/director-fixtures.ts` | J6 | Already exists |
| `tests/helpers/context-fixtures.ts` | J4 | Already exists |
| `tests/helpers/securityProbes.ts` | J8 | New — cross-org probe, RLS probe, canary mock injection |
| `tests/helpers/networkSimulation.ts` | J9 | New — Anthropic 5xx, 429, mid-stream disconnect simulation via MSW or upstream stub |
| `tests/helpers/cspSnapshot.ts` | J7 | New — assert `vercel.json` headers contain expected CSP entries |

---

## 5. Tasks per Journey

Per-Journey task lists in this Build Checklist are intentionally summarised — the full breakdown lives in each Journey's session. The following per-Journey table names the substrate-level deliverables:

### 5.1 J1 — Onboarding

| T | Task |
|---|---|
| T-1.1 | POMs: `LoginPage`, `SignupPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `EmailVerificationPage` |
| T-1.2 | Spec: `tests/phase5d/j1-onboarding.spec.ts` — 14 cases |
| T-1.3 | Cloud-smoke: CS-01, CS-02 |
| T-1.4 | Test Report J1 |
| T-1.5 | Merge as `Phase 5d.J1 — onboarding journey` |

### 5.2 J2 — Document creation

| T | Task |
|---|---|
| T-2.1 | POMs: `DashboardPage`, `ProjectPage`, `NewProjectModal`, `NewDocumentModal`, `NodeTreePage` |
| T-2.2 | Spec: `tests/phase5d/j2-document-creation.spec.ts` — 21 cases |
| T-2.3 | Cloud-smoke: CS-03, CS-04, CS-05 |
| T-2.4 | Test Report J2 |
| T-2.5 | Merge as `Phase 5d.J2 — document creation journey` |

### 5.3 J3 — Manual authoring (may split across 2 sessions)

| T | Task |
|---|---|
| T-3.1 | POMs: `NodeDetailPanelPage`, `SummaryEditorPage`, `NotesEditorPage`, `ProseEditorPage`, `WordCountPage`, `FocusModePage`, `VersionHistoryPage`, `CommentThreadPage`, `ModalPage` |
| T-3.2 | Spec: `tests/phase5d/j3-manual-authoring.spec.ts` — 28 cases (split into `j3a-` and `j3b-` if session is too dense) |
| T-3.3 | Cloud-smoke: CS-06, CS-07, CS-08, CS-09 |
| T-3.4 | Test Report J3 |
| T-3.5 | Merge as `Phase 5d.J3 — manual authoring journey` |

### 5.4 J4 — Context system

| T | Task |
|---|---|
| T-4.1 | POMs: `MetadataFormPage`, `ContextLinkerPage`, `BackLinksListPage` |
| T-4.2 | Spec: `tests/phase5d/j4-context-system.spec.ts` — 13 cases |
| T-4.3 | Test Report J4 |
| T-4.4 | Merge as `Phase 5d.J4 — context system journey` |

### 5.5 J5 — Single-node agent ops

| T | Task |
|---|---|
| T-5.1 | POMs: `AgentTabPage`, `AgentJobHistoryPage`, `NodeStatusBadgePage` |
| T-5.2 | Spec: `tests/phase5d/j5-agent-ops.spec.ts` — 23 cases |
| T-5.3 | Cross-model verification: extend the existing `scripts/run-director-comparison.ts` to support synthesise probes (or use the existing one if Phase 5c already extended it) and run on Haiku/Sonnet/Opus |
| T-5.4 | Cloud-smoke: CS-10, CS-11, CS-16 |
| T-5.5 | Test Report J5 |
| T-5.6 | Merge as `Phase 5d.J5 — agent ops journey` |

### 5.6 J6 — Director + workflow

| T | Task |
|---|---|
| T-6.1 | POMs: `DirectorPanelPage`, `ConversationThreadPage`, `PlanCardPage`, `ExecutionCardPage`, `DirectorInputPage`, `NodePickerPage` |
| T-6.2 | Spec: `tests/phase5d/j6-director.spec.ts` — 18 cases |
| T-6.3 | Cloud-smoke: CS-12, CS-13, CS-14 |
| T-6.4 | Test Report J6 |
| T-6.5 | Merge as `Phase 5d.J6 — director + workflow journey` |

### 5.7 J7 — Synthesise streaming

| T | Task |
|---|---|
| T-7.1 | POM: `AgentStreamingSurfacePage` |
| T-7.2 | Helper: `tests/helpers/cspSnapshot.ts` |
| T-7.3 | Spec: `tests/phase5d/j7-synthesise-streaming.spec.ts` — 9 cases |
| T-7.4 | Cloud-smoke: CS-15 (CSP regression guard) |
| T-7.5 | Test Report J7 |
| T-7.6 | Merge as `Phase 5d.J7 — synthesise streaming journey` |

### 5.8 J8 — Cross-cutting (locks, status, RLS, security)

| T | Task |
|---|---|
| T-8.1 | Helper: `tests/helpers/securityProbes.ts` |
| T-8.2 | Spec: `tests/phase5d/j8-cross-cutting.spec.ts` — 15 cases |
| T-8.3 | Test Report J8 |
| T-8.4 | Merge as `Phase 5d.J8 — cross-cutting journey` |

### 5.9 J9 — Edge / sad paths

| T | Task |
|---|---|
| T-9.1 | Helper: `tests/helpers/networkSimulation.ts` |
| T-9.2 | POM: `ToastPage` |
| T-9.3 | Spec: `tests/phase5d/j9-edge-cases.spec.ts` — 14 cases |
| T-9.4 | Test Report J9 |
| T-9.5 | Merge as `Phase 5d.J9 — edge cases journey` |

### 5.10 J10 — Visual regression

| T | Task |
|---|---|
| T-10.1 | Spec: `tests/phase5d/j10-visual.spec.ts` — 21 baselines captured into `tests/visual/baselines/phase5d/` |
| T-10.2 | CI gating: `--update-snapshots` only on intentional UI-change PRs |
| T-10.3 | Test Report J10 |
| T-10.4 | Merge as `Phase 5d.J10 — visual regression journey` |

### 5.11 Umbrella session

| T | Task |
|---|---|
| T-UMB.1 | Full Playwright run (all `j1` through `j10` projects + `chromium`) at master HEAD; iterate any flake |
| T-UMB.2 | Cross-Journey regression review — does any J{n} case break a prior Journey? |
| T-UMB.3 | Cumulative cloud-smoke run on `stelavox-dev` — all 16 CS-* cases |
| T-UMB.4 | Author `stelavox_phase5d_test_report_v1_0.md` (umbrella) |
| T-UMB.5 | Decide: any SU items raised during Phase 5d that warrant a TA / Product Spec / Component Spec amendment? Bump and merge if so; otherwise no upstream-spec change |
| T-UMB.6 | Final merge `Phase 5d shipped — QA & E2E confidence layer complete` |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **Flaky tests under sequential suite load** — the existing config runs `fullyParallel: false` with `retries: 2` to absorb dev-server-state issues; Phase 5d adds 176 cases on top of an existing ~270 | Author POMs with explicit `await page.waitForLoadState('networkidle')` where needed; use Playwright's `expect.toPass()` for async assertions; never use sleep-based waits. If flake persists, add a "flake budget" log to the Journey's Test Report. |
| **Page-object drift** — Phase 5c bug pattern shows surface contracts can shift quietly (the `<workflow_proposal>` text-delta leak); a POM frozen at J6 could mask a regression that breaks the contract | POMs assert on `data-testid` attributes only; if a `data-testid` is missing, the test session adds it as a one-line component change in the same merge. POM action methods return descriptors that the spec asserts, not booleans — failures surface what changed. |
| **LLM cost creep** — 30 LLM-bearing cases × repeated Phase 5d iterations could spend $20+ if iteration is inefficient | All LLM-bearing cases default to Haiku 4.5 (cheap; per `feedback_haiku_default.md`). Cross-model only runs once per Phase 5d-substantial-change. CI per PR runs zero LLM cases. |
| **Cloud-smoke false-positive** — Vercel transient deploy issues could flake CS-* cases | Cloud smoke runs once after merge, not per-PR; flakes don't block merge. Consecutive flakes (3 in a row) escalate to investigation. |
| **Test-data isolation gaps** — a missed `cleanup` in `afterEach` could re-create the SU-50 collision for new tests | PB-8's `createIsolatedDoc` returns `{ docId, cleanup }`; lint rule (custom or convention-enforced via review) catches missing `afterEach(cleanup)`. Each Journey's Test Report explicitly notes "isolation hygiene: clean / dirty" per spec file. |
| **CSP regression guard (TC-J7-06) false-positive** — the negative-case test asserts that removing wss:// CSP entry breaks the AgentTab; it's a meta-test that may be brittle | Implement TC-J7-06 as a dev-only test that mutates `vercel.json` in-memory (does not write to disk) and reloads with a custom CSP header. If too brittle, downgrade to a static assertion: "vercel.json's connect-src array contains exactly these entries" (one-line file snapshot). |
| **Umbrella full-suite reliability** — running 446 tests (270 existing + 176 new) at once may saturate the dev-server-state ceiling | Per `feedback_phase_session_procedure.md`, run in chunks (one Journey project at a time). The umbrella full-suite is a "last green run on a quiet machine" gate, not the per-PR gate. |
| **POM duplication with prior phases' helpers** — Phase 1-5c authored ad-hoc page helpers in `tests/helpers/`; Phase 5d POMs may duplicate | First 2 Journeys (J1, J2) audit `tests/helpers/` for re-usable selectors; consolidate where practical, leave alone where the older helper is a closed-form fixture (e.g. `tree.ts` is fine). Don't aggressively refactor — Phase 5d is additive. |
| **CI cost** — running the non-LLM 146-case suite on every PR is ~5-10 minutes Playwright time | Reasonable for a confidence-builder phase. If CI time becomes a friction point, gate to `git diff --name-only` to skip Journeys that don't touch their surface area; revisit at Phase 5d close-out. |

---

## 7. Dual-environment policy

Per Phase 5d scope memo: **local-first, Vercel-as-smoke**.

- **Per-PR CI** runs the non-LLM 146-case suite against local Supabase (CI's docker stack matches dev's `supabase start` ports, *not* the +10-shifted ports — CI is a fresh stack each run, no port collision).
- **Pre-merge gate** runs the LLM-bearing 30-case suite locally, manually, on the PR author's box (not CI; cost discipline). The author paste-quotes the verdict in the PR body.
- **Post-merge cloud-smoke** runs the 16-case CS-* subset against `stelavox-dev` via the script at `scripts/run-cloud-smoke.ts`. Cloud-smoke runs **after** merge to master, not as a merge gate, to avoid blocking on Vercel transient flake.
- **Cross-model** runs once per Phase 5d-substantial-change on the PR author's box.

This minimises cost (zero LLM in CI, ~$0.77/PR pre-merge, ~$0.30/merge cloud-smoke) and isolates Vercel runtime failures (Phase 5c bug #1) without making Vercel a per-PR dependency.

---

## 8. SU registry

Pre-staged for any SU items raised during Phase 5d build. Items are added here as Journeys progress; closed out at the umbrella session.

| ID | Description | Owner | Disposition |
|---|---|---|---|
| (TBD) | (Open during build; tracked in per-Journey Test Reports) | | |

Likely candidates (prediction, not commitment):

- A `data-testid` audit pass surfaced as POMs are written (low-risk; per-PR add)
- The `CommandPalette` surface (S-SYS-03) may not exist in code; reconcile against Spec
- `SentenceFocus` deferred per CLAUDE.md — already deferred to Phase 8
- Restore-from-version (M-VER-04) is V1.x — already noted, not a Phase 5d task

---

## 9. Changelog

**v1.0 — 2026-05-08** Initial Phase 5d Build Checklist. Ten prerequisites (PB-1 through PB-10) covering trilogy authoring, master state, Supabase + seed, Anthropic key, regression baseline, page-object catalog scaffold, Journey-tagged Playwright projects, test-data isolation helper, model defaulting, cloud-smoke runner stub. Eleven Phase Checkpoint Criteria — one per Journey (CK-J1..CK-J10) plus the umbrella regression (CK-UMB) and documentation absorption (CK-DOC). Per-Journey sprint plan with one session per Journey + an umbrella close-out session (12 sessions total including this trilogy session). Page-object catalog with 33 POMs and 9 helper modules, attributed to authoring Journey. Per-Journey task tables (T-1.1..T-UMB.6). Risk register with nine entries focused on flake, drift, cost, isolation hygiene, and umbrella reliability. Dual-environment policy: local-first per-PR, manual pre-merge LLM gate, post-merge cloud-smoke on `stelavox-dev`, no-cross-model-on-CI. SU registry pre-staged for build-time additions.
