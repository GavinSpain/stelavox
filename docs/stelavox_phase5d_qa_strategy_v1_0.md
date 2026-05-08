# Stelavox — Phase 5d QA Strategy
## Version 1.0

> **Tier-B per-phase document.** Frozen for Phase 5d build. Companion to `stelavox_phase5d_test_plan_v1_0.md` and `stelavox_phase5d_build_checklist_v1_0.md`. This is the strategy and discipline document — it answers *what kind of testing this is*, *what we will and will not catch*, and *what rules every Phase 5d test obeys*. The Test Plan is the catalogue of cases; this document is the contract that governs how those cases are written.

**Phase:** 5d — Quality Assurance & End-to-End Confidence.

**Audience.** Future Claude sessions writing Phase 5d test code, future humans reviewing it, and the user evaluating the suite's value at Phase 5d close-out.

---

## 1. Why Phase 5d exists

Phase 5c shipped on 2026-05-08. During post-merge user-driven verification, **five bugs surfaced** that no prior test caught:

1. **CSP missing `wss://*.supabase.co`** — Supabase Realtime websocket failed silently on the Vercel deploy. AgentTab IDLE→COMPLETE never fired. Local dev was unaffected because `next dev` doesn't apply `vercel.json` headers.
2. **`workflow_executor` passed plain text to `accept_agent_job`** — the user-Accept route did the Tiptap-JSON conversion; the workflow path didn't. Acts 2 and 3 corrupted in production.
3. **`workflow_executor` profile resolution always picked `refine_beat_prose`** — used `.order('created_at', { ascending: true }).limit(1)` to pick a system refine profile, ignoring (operation_type, node_type, target_field) tuple.
4. **`<workflow_proposal>` XML leaking to user-visible text deltas** — the Director executor's text-delta stream included raw XML that should have been parsed silently and surfaced as a structured PlanCard event.
5. **TC-A-30 cross-suite isolation** — Vitest + Playwright tests collided on the same shared j5-novel main document.

Every bug lived at an **integration seam** between substrate components that individually work. Unit tests pass. Per-phase API tests pass. The user clicks a button and watches the bug.

**This is the structural gap Phase 5d closes.** Phase 5d is the testing layer above the per-phase suites that asserts the system holds together end-to-end across all 10 user journeys.

---

## 2. What Phase 5d is and is not

### 2.1 What Phase 5d is

A **confidence-builder** — a test suite the user can point at and say "I trust this" before pushing a substantial change to master. It catches:

- **Integration-seam regressions** — when component A's contract with component B silently shifts. Phase 5c bugs 1, 2, 3, 4 all match this pattern.
- **Cross-feature regression** — when a J5 change breaks J3.
- **Cross-environment regression** — when local works and Vercel doesn't (CSP, runtime, websocket).
- **Cross-path equivalence** — when the user-clicked path and the workflow-dispatched path diverge in their handling of the same operation. Phase 5c bug 2 was exactly this.
- **Test-isolation drift** — when two tests start sharing state by accident. Phase 5c bug 5 (SU-50) was this.

### 2.2 What Phase 5d is not

- **Not a launch gate.** The user assesses progress as Journeys land; doesn't pre-commit to "all 10 Journeys before V1". A Journey that ships gives confidence on that journey; the umbrella verdict is rolling.
- **Not a quality gauge for LLM output.** Voice fidelity, prose quality, narrative coherence — these are agent-profile and Director eval concerns. Phase 5d asserts the **wire works**, not that the **prose is good**.
- **Not a replacement for Phase 1-5c per-phase tests.** Those exist. They run. They catch what they were authored to catch. Phase 5d is layered above, not a rewrite.
- **Not a unit-test or contract-test layer.** Phase 5d operates at the user-journey granularity — multi-step flows ending in observable user-visible state. Single-function tests stay in Vitest.
- **Not a performance suite.** Phase 5d asserts upper-bound wall-time on user-visible loads (e.g. "tree renders within 2s") but doesn't track regression deltas. Performance regression is Phase 8.
- **Not an exhaustive a11y audit.** Phase 5d re-runs the existing AX cases as cross-feature regression. AX expansion is Phase 8.

### 2.3 The boundary, restated

Phase 5d catches **system-level integration faults that are user-visible and reproducible from a fresh login**. Anything narrower is a unit test or a contract test. Anything broader (model quality, performance benchmarking, exhaustive a11y) is a different discipline.

---

## 3. The integration-seam doctrine

Every Phase 5c bug had the same shape. The component on each side of the seam worked in isolation. The contract between them was the failure point.

### 3.1 Examples from Phase 5c

| Seam | What worked alone | What failed at the seam |
|---|---|---|
| Browser ↔ Supabase Realtime over Vercel CSP | Local dev: AgentTab works. Production CSP allowed `https://*.supabase.co`. | The websocket scheme is `wss`, not `https`. CSP rejected the upgrade. AgentTab status stuck. |
| `workflow_executor` ↔ `accept_agent_job` RPC | The RPC works given Tiptap JSON. The user-Accept route converts. | The workflow_executor passed plain text. The RPC stored it. SummaryEditor couldn't parse on read. |
| `workflow_executor` ↔ `agent_profiles` table | The user-Accept route resolves profile by `(op, node_type, target_field)`. | The workflow_executor sorted by `created_at` and took the first. Always `refine_beat_prose`. |
| `Director.executor` ↔ `streamMessage` client ↔ `DirectorMessage` rendering | The XML-to-PlanCard parser works. The text-delta SSE channel works. | The text-delta stream emitted raw XML before the parser ran. Users saw XML. |

### 3.2 The doctrine

**Phase 5d test cases prefer to assert at the seam, not at the leaf.** A test that exercises only the user-Accept route doesn't catch bug 2; a test that exercises the workflow-Accept and asserts on the persisted Tiptap-JSON shape **does**.

Concretely:

- **Cross-path tests assert equivalent post-conditions.** Both paths writing to the same row must produce a row with the same structural shape. TC-J5-19 (user-Accept Tiptap shape), TC-J6-16 (workflow-Accept Tiptap shape), and the cross-cut between them are the seam test.
- **Cross-environment tests assert that the same flow works on Vercel as on local.** TC-J7-05 (CSP wss positive case) + TC-J7-06 (CSP wss negative-as-guard) are the seam test for environment.
- **Cross-feature tests assert a J5 change doesn't break a J3 case.** Implemented as the umbrella regression run after each Journey.
- **Cross-stream tests assert the wire envelope is structured before the renderer reads it.** Phase 5c bug 4 was caught by adding 9 unit tests to the chunk-parser; Phase 5d adds the matching user-journey case (TC-J6-05 — adversarial XML in user input doesn't echo to deltas).

---

## 4. Test-data isolation discipline

**Every test owns its own document.** No exceptions.

### 4.1 The contract

For every Phase 5d test:

1. The test calls `createIsolatedDoc({...})` once at start.
2. The helper returns `{ docId, cleanup }`.
3. The test registers `cleanup` in `afterEach`.
4. The test reads / writes only within `docId`'s scope.
5. After `afterEach`, the document and all descendant nodes / agent_jobs / workflows / comments / context_links are deleted.

### 4.2 Why it's load-bearing

SU-50 (Phase 5c bug 5) was a TC-A-30 / TC-A-15 collision: both reused `j5-novel` main document, neither cleaned up. The collision was non-deterministic — depending on test order, one test would see the other's residue. The fix was a guarded test-mode delete that ran in `afterAll`.

The Phase 5d isolation contract makes this category structurally impossible. A test cannot see another test's state because the documents don't overlap.

### 4.3 What the helper does

`createIsolatedDoc({ template, seedNodes, seedAgentProfiles })`:

1. INSERT a new project owned by the current test user's org
2. INSERT a new document under that project, with the requested template (Novel / Short Story / Series — currently three)
3. Optionally seed extra nodes (e.g. for J5's "synthesise on a beat that already has a refine result" scenarios)
4. Return `{ docId, projectId, cleanup }` where `cleanup` cascades-deletes the project (and thus the document and everything below it)

The implementation lives at `tests/helpers/isolation.ts`. It is the **only** way Phase 5d tests create documents. Reuse of the corpus's `j5-novel` main document is forbidden in Phase 5d; the corpus stays as a Director eval fixture, not a Phase 5d data source.

### 4.4 Lint / convention enforcement

The convention is enforced by review (no test ships without `createIsolatedDoc + cleanup`) and re-asserted in each Journey's Test Report under "isolation hygiene: clean / dirty". A dirty Test Report is a stop-the-line condition for the umbrella merge.

---

## 5. Model coupling — assert structure, not content

**Phase 5d tests do not assert on model output strings.** Ever.

### 5.1 The rule

A Phase 5d test for an LLM-bearing flow asserts:

- An `agent_jobs` row exists with `status='completed'`
- `tokens_input + tokens_output > 0`
- `result_prose` is non-null
- `result_prose` parses as Tiptap JSON
- `result_prose` is at least N characters (where N is small, e.g. 50)
- The wire envelope is well-formed (e.g. for SSE: events arrive in order `agent_job_created` → ≥1 `text_delta` → `usage` → `agent_job_complete`)

A Phase 5d test does **not** assert:

- That the prose contains specific words
- That the prose is in a particular voice
- That the prose makes narrative sense
- That the prose is a particular length

### 5.2 Why

LLM outputs are non-deterministic. Asserting on output content makes the test flaky. More importantly, it conflates two concerns:

- **Wire correctness** — does the Anthropic API return tokens, do they reach the database, does the user see them?
- **Output quality** — is the prose good?

Phase 5d is wire-correctness only. Output quality is the Director eval methodology (`docs/stelavox_director_eval_methodology_v1_0.md`), the agent-profile tuning loop, and human review. They are different disciplines with different cadences and different gates.

### 5.3 What this means in practice

A Phase 5d synthesise test that today asserts `expect(result.text).toContain('chapter')` would fail Phase 5d's discipline review. It must be replaced with `expect(result.tokens_output).toBeGreaterThan(0); expect(parseTipTap(result.text).type).toBe('doc')`.

The exception: cross-model verification (TC-J5-22) asserts on **schema-level structure**, not content — every model produces a Tiptap-JSON doc, but the words inside vary. The test PASSES if all three models return well-formed structure and FAILs if any returns malformed structure.

### 5.4 Implications for the cross-model carry-forward

Phase 5b's j5-novel probe corpus uses model output as a reference for issue detection. That corpus stays in place for Director eval (a different methodology). Phase 5d does not import j5-novel's content-level assertions. The only J5 case that touches j5-novel is TC-J5-22, and that case asserts only on wire structure.

---

## 6. Failure-as-merge-block contract

**Red CI on the Phase 5d suite blocks merges to master.**

### 6.1 The scope

The merge-blocking gate is the **non-LLM 146-case subset** running on every PR. Specifically:

- Per-PR CI runs `npx playwright test --project=chromium` filtered to non-LLM cases (`grep -L 'LLM cost' tests/phase5d`)
- Failures are red status checks on the PR
- The PR cannot be merged with red status checks (GitHub branch-protection)

### 6.2 What's not merge-blocking

- **LLM-bearing 30-case subset** — runs manually pre-merge on PR author's box; verdict captured in PR body. Author-attestation, not CI.
- **Cloud-smoke 16-case subset** — runs after merge. Failures don't auto-revert; trigger investigation.
- **Cross-model verification** — runs once per substantial change. Author-attestation.
- **Visual regression** — runs as `--update-snapshots` only on intentional UI-change PRs. Defaults to "no diff allowed"; updates require author intent.

### 6.3 Per-PR test-ownership convention

**Every PR that adds a feature must include its own Phase 5d cases.** A new feature without a Phase 5d test fails review.

Specifically:

- A new surface (route or interactive component) → at least one TC-J{n}-* case
- A new move (atomic action) → at least one happy + one common-sad case targeting that move
- A new integration seam → at least one cross-cutting case asserting the seam contract

This is enforced at PR review, not by a robot. The reviewer checks that the PR's diff includes a `tests/phase5d/` change touching the right Journey file.

### 6.4 What "merge-blocking" doesn't mean

- It does not mean "every Phase 5d failure halts work." A flaky test that retries-clean is not a block. A test that fails twice in a row at master HEAD without a corresponding code change is a flake-budget item, not a merge-block.
- It does not mean "Vercel deploy failures block merge." Vercel deploys after merge; cloud-smoke runs after deploy. Cloud-smoke is observation, not gate.
- It does not mean "all 10 Journeys must exist before any merges." Phase 5d ships rolling per Journey; a PR merging to master uses whichever Journeys have shipped at that point. The umbrella merge-block tightens over time.

---

## 7. Local-first, Vercel-as-smoke methodology

**Build the suite locally. Verify on local. Smoke-subset on Vercel after merge.**

### 7.1 Why local-first

- **Cost.** Running 146 cases on Vercel per PR would saturate the Hobby plan's compute minutes.
- **Iteration speed.** Local dev's `npm run dev` + Playwright's `reuseExistingServer: true` give ~30s test cycles. Vercel deploys are 60-90s alone.
- **Debuggability.** Failures on local give full DOM, full network log, full database state via `psql`. Vercel failures give only the Playwright trace.
- **Phase 5c bug 1 informed this.** That bug was Vercel-specific, but it surfaced on Vercel, not in CI. Cloud-smoke catches the *category* of Vercel-only bugs without making Vercel a per-PR dependency.

### 7.2 What Vercel cloud-smoke actually catches

The 16-case CS-* subset is selected to exercise specifically:

- CSP / `vercel.json` headers
- WebSocket upgrades (Realtime)
- Edge / Node.js runtime differences
- Cron schedule (the recovery sweep route)
- Vercel-specific timeouts (`maxDuration` on streaming routes)
- The full env-var resolution chain (production vs preview vs development scopes)

The 130 non-LLM cases that don't run on Vercel test browser ↔ app ↔ Supabase. Those don't change between environments.

### 7.3 The env-swap pattern

Cloud-smoke runs by:

1. Backing up `.env.local`
2. Loading `.env.servicekey` (per `reference_servicekey_storage.md`) into `.env.local`
3. Pointing `.env.local` at `stelavox-dev`'s Supabase URL + keys
4. Setting `PLAYWRIGHT_APP_URL=https://stelavox.vercel.app`
5. Running `npx playwright test --project=cloud-smoke` (a new project filter)
6. Restoring `.env.local` regardless of pass/fail

This pattern was established in Phase 5b cloud smoke and persisted in Phase 5c. Phase 5d wraps it in `scripts/run-cloud-smoke.ts`.

### 7.4 What about preview deploys?

Vercel preview deploys per PR are deferred (CLI bug at Phase 5c close-out — `project_phase5c_progress.md`). When preview deploys are functional again, an optional Phase 5d enhancement runs cloud-smoke against the PR's preview URL. Until then, cloud-smoke runs only against `stelavox-dev` post-merge.

---

## 8. Hazard-escalation ladder

When Phase 5d catches a bug, the question is: where does the fix go? Phase 5d is a test phase, not an architecture phase. But Phase 5d **discovers** architecture problems regularly. The escalation ladder:

| Level | Symptom | Resolution |
|---|---|---|
| **Test-only** | A flake under load; a stale POM selector; a test-data isolation slip | Fix the test. No upstream change. Note in Test Report. |
| **Implementation gap** | Code diverged from a correct spec | Fix the code. No spec change. Note in Test Report. |
| **Specification gap** | Spec didn't address this case; agent inferred wrong | Update the spec; then fix the code. Bump TA / Component Spec / Product Spec as appropriate. Note in Test Report. |
| **Specification error** | Spec addressed it but was wrong | Correct the spec; then fix the code. Bump appropriate spec. Note in Test Report. |
| **New invariant** | The bug reveals a constraint that was never named | Add a hazard entry (H-NN) to TA. Bump CLAUDE.md's hazard summary. Note in Test Report and the relevant `feedback_*` memory. |

Phase 5c's five bugs map to:

| Bug | Level | Resolution |
|---|---|---|
| 1. CSP wss missing | New invariant | Captured as `reference_vercel_csp_websocket.md`; would warrant H-16 if Phase 5d surfaces a second instance |
| 2. workflow_executor plain-text | Implementation gap | Fixed in commit `fc9f14a`; same family covered by SU-52 for the user-clicked refine path |
| 3. workflow_executor profile resolution | Implementation gap | Fixed in commit `e533377`; SU-52 covers the user-clicked path |
| 4. `<workflow_proposal>` XML leak | Implementation gap | Fixed in commit `a65ee4d` with 9 unit tests |
| 5. TC-A-30 isolation | Test-only | Fixed in commit `89d7661`; informed PB-8's `createIsolatedDoc` discipline |

If Phase 5d catches a bug at the "New invariant" level, the umbrella session bumps TA and CLAUDE.md. If it catches only Implementation gaps, no spec bump is needed; Test Reports record.

---

## 9. Selectors, fixtures, and stability

### 9.1 Selectors

- **`data-testid` is the contract.** Every Phase 5d POM uses `data-testid` selectors. If a component lacks the right `data-testid`, the test session adds one as a one-line component change in the same PR.
- **`getByRole` and `getByLabel` are fallbacks.** They apply when the selector targets a semantic element (e.g. button, heading) that doesn't need a specific testid.
- **CSS class selectors are forbidden.** Tailwind classes change on UI redesigns; they are not contracts.
- **Text-content selectors are discouraged.** They couple tests to copy. Acceptable only when the text is part of the UX contract (e.g. button labels in Component Spec).

### 9.2 Fixtures

- **Auth fixture:** every test logs in as a fresh test user (or reuses a session-stable test user per worker). The `tests/helpers/auth.ts` helper handles this.
- **Document fixture:** every test creates its own document via `createIsolatedDoc`. **Never** reuses j5-novel's main document.
- **Agent profile fixture:** Phase 5d uses the system profiles seeded by Migration 027 + 033. Custom profiles are out-of-scope (custom profile lifecycle is SU-24, V2 scope).
- **Director config fixture:** Phase 5d uses the production Director config (synced via Migration 031). Custom configs are not tested.

### 9.3 Stability

Tests should be deterministic. If a test depends on timing (e.g. autosave 2s idle), the helper provides an explicit wait, not a sleep. If a test depends on Realtime, the test waits for the specific event with a generous timeout, not a sleep. The existing `tests/helpers/autosave.ts` and similar helpers are the pattern.

If a test is intermittently flaky, log it in the Journey's Test Report under "flake budget" and revisit in the umbrella session. Recurring flake at the umbrella level is investigated; a flake that reproduces under load is treated as a real bug, not a test issue.

---

## 10. The relationship to Phase 1-5c tests

Phase 5d is **additive**. The existing `tests/api`, `tests/integrity`, `tests/boundary`, `tests/ui`, `tests/visual`, `tests/accessibility`, `tests/agent`, `tests/director` suites stay in place and continue to run.

### 10.1 Layering

- **Phase 1-5c suites** — narrow, per-phase, contract-level assertions on individual surfaces and APIs.
- **Phase 5d suite** — broad, cross-feature, journey-level assertions on user-visible flows.

A failure in either suite blocks merge. They share the same Playwright runner, same dev-server config, same Supabase stack.

### 10.2 What Phase 5d does NOT replace

- Per-phase API tests (`tests/api`) — those test contracts, not journeys
- Tiptap-specific tests (`tests/integrity`) — those test data invariants
- Boundary tests (`tests/boundary`) — those test layer-mounting rules at the H-15 level
- Existing visual baselines — those stay; J10 adds new ones, doesn't replace

### 10.3 Cross-suite isolation

Phase 5d's `createIsolatedDoc` discipline applies to Phase 5d tests only. Phase 1-5c tests retain their existing fixture patterns (some use `j5-novel`, some seed-and-cleanup ad hoc, some use beforeAll/afterAll).

If a Phase 1-5c test causes Phase 5d flake (the SU-50 pattern in reverse), the response is:

1. First, fix the Phase 5d test to use `createIsolatedDoc` (it should already)
2. If the collision is unavoidable (shared system profile rows, shared Director config), the Phase 1-5c test is amended to clean up
3. If the Phase 1-5c test cannot be safely amended without breaking its own assertions, the umbrella full-suite run is gated to "Phase 1-5c first, then Phase 5d, separately" — they do not interleave

---

## 11. What success looks like

### 11.1 Per Journey

A Journey ships when:

- Every case in that Journey's Test Plan §4 matrix has a corresponding `test('TC-J{n}-{nn}: ...')` in a `.spec.ts` file
- Every case PASSES at master HEAD
- The Journey's POMs are in `tests/pages/` and used (no inline selectors)
- Cloud-smoke for that Journey's CS-* subset PASSES on `stelavox-dev`
- The Test Report is authored with verdict, isolation hygiene, and any SU items
- The merge commit is a `Phase 5d.J{n} — {topic}` commit

### 11.2 Phase 5d as a whole

Phase 5d ships when:

- All 10 Journey CKs are green at master HEAD
- The umbrella full-suite (446 cases — 270 Phase 1-5c + 176 Phase 5d) PASSES at master HEAD
- The umbrella cloud-smoke (16 CS-* cases) PASSES on `stelavox-dev`
- The umbrella Test Report (`stelavox_phase5d_test_report_v1_0.md`) is authored with per-Journey verdicts and the cumulative SU registry
- Any SU items requiring upstream-spec amendment are absorbed (TA / Product Spec / Component Spec bumps as needed)
- CLAUDE.md is bumped with Phase 5d shipped status

### 11.3 What Phase 5d does NOT promise

- That no bugs will reach production. Phase 5d catches a category of bugs; other categories (model quality, performance, edge-case race conditions in production load) remain.
- That every regression will be caught. Phase 5d is a confidence layer, not a proof. A regression that doesn't intersect any of the 176 cases will not be caught.
- That Phase 5d's coverage is exhaustive. The matrix is selective (one case per (surface, move) cell at most). Adding cases per-PR (the test-ownership convention) is how coverage grows over time.

---

## 12. Operating principles, summarised

The five rules every Phase 5d test obeys:

1. **Own your data.** Use `createIsolatedDoc`; clean up in `afterEach`; never share state with another test.
2. **Assert structure, not content.** Wire correctness over output quality.
3. **Use POMs, not inline selectors.** If a `data-testid` is missing, add it in the same PR.
4. **Default to Haiku.** Cross-model only on TC-J5-22 carry-forward.
5. **Test the seam, not the leaf.** Where two components meet is where Phase 5c bugs lived; that's where Phase 5d cases focus.

The five rules every PR obeys:

1. **Add Phase 5d cases for new surfaces / moves / seams.** No feature ships without its own E2E coverage.
2. **Don't break the umbrella.** A green umbrella at master HEAD is the merge gate.
3. **Pre-merge LLM verdict in the PR body.** Author-attests for the LLM-bearing subset.
4. **Don't reuse `j5-novel` main doc.** Phase 5d tests use isolated docs.
5. **Fix the bug, not the test.** A test that catches a real bug stays catching that bug.

---

## 13. Changelog

**v1.0 — 2026-05-08** Initial Phase 5d QA Strategy. Twelve sections covering: why Phase 5d exists (the five Phase 5c post-merge bugs that revealed the integration-seam testing gap); what Phase 5d is and is not (confidence-builder, not launch gate; integration seams, not LLM quality; cross-feature regression, not exhaustive a11y); the integration-seam doctrine (assert at the seam, not the leaf, with cross-path / cross-environment / cross-feature / cross-stream rules); test-data isolation discipline (createIsolatedDoc + cleanup contract; SU-50 was the lesson); model coupling (assert structure not content; Haiku 4.5 default; cross-model only on carry-forward); failure-as-merge-block contract (non-LLM 146-case subset is the per-PR gate; LLM-bearing manual pre-merge; cloud-smoke post-merge; per-PR test-ownership); local-first / Vercel-as-smoke methodology (env-swap pattern; preview-deploy deferred); hazard-escalation ladder (test-only / impl gap / spec gap / spec error / new invariant); selector + fixture + stability rules (data-testid contract; getByRole/getByLabel fallback; tailwind-class selectors forbidden; text-content selectors discouraged); the relationship to Phase 1-5c tests (additive, not replacement; cross-suite isolation discipline); what success looks like (per Journey rolling acceptance; umbrella verdict; what Phase 5d explicitly does NOT promise); ten operating principles summarised. No new H-NN hazards introduced. No upstream-spec changes — this document is the strategy contract for Phase 5d execution.
