# Round-3 audit — remediation plan

**Status:** approved 2026-05-10. Items 1–4 of section 7 signed off. Items 5–8 deferred until hit. Pilot batch in flight (B1.1).

**Scope:** the 258 findings catalogued in `01-` through `09-`, summarised in `99-themes.md`.

**Constraints from the user:**
1. Don't take the project backwards. Significant simultaneous changes cause issues.
2. Small batches that can be tested as we go.
3. Group related types of errors together.
4. **Failing-test-first.** A test that doesn't fail before the fix is not a useful test.
5. Acknowledge that some findings (race conditions, structural refactors) can't be cleanly demonstrated via test. Be explicit when so.

---

## 1. Failing-test-first protocol

**The non-negotiable rule:** before any fix, the regression test must exist AND must fail against the unfixed code. Only then is the fix written. The test passing is the acceptance gate.

### Per-finding test-feasibility classification

Every finding gets one of four labels in the per-batch ticket:

| Label | Meaning | Default test approach |
|---|---|---|
| **demonstrable** | The failure can be reliably triggered in a test | Write a Playwright/Vitest test that hits the bug; verify red; fix; verify green |
| **observable-via-mock** | The failure surfaces with a mocked dependency (network drop, deleted row, malformed payload) | Vitest with mocked fetch / Supabase / etc.; verify red; fix; verify green |
| **constraint-driven** | The fix IS a DB / type / lint constraint; the constraint itself acts as the test | Add migration / lint / type assertion; verify it rejects the bad input |
| **structural** | Two-source-of-truth, code-style, naming. No runtime test that fails meaningfully. | Document the fix, run the existing suite to confirm no regression. Acknowledge the gap. |

For **structural** items I'll be explicit: "this finding has no failing-test-first proof; the fix is verified by code review + downstream tests not regressing." That meets your standard for honesty but doesn't pretend test coverage exists.

### Test infrastructure to build *as we hit each pattern*

Not upfront. Each batch where we first hit a pattern adds the helper.

- `tests/helpers/fetch-mock.ts` — simulate transport failures for component tests (T-1 cluster)
- `tests/helpers/race.ts` — spawn N concurrent calls, assert no duplicates (T-4 cluster)
- `tests/helpers/missing-row.ts` — delete a row in setup, then invoke X, assert graceful response (T-2 cluster)
- `tests/helpers/realtime-mock.ts` — simulate WebSocket disconnect (T-1 component-layer real-time)
- ESLint rule `no-supabase-single` — flags `.single()` calls without an inline comment justifying (T-2)
- ESLint rule `verdigris-allowlist` — flags `var(--color-accent)` outside the sanctioned files (T-12)
- Build-time check `zod-to-json-schema` — generates JSON Schema from Zod, fails CI on drift (T-3 / F-81)

---

## 2. Batch sizing

**Target: 5–15 findings per batch.** Each batch:

- Shares a root cause OR adjacent files OR the same shape
- Fits in one focused work session
- Is reviewable in one read of the diff
- Produces a testable change (failing-test-first → fix → passing-test)
- Leaves the codebase in a working state at every commit

**One git commit per batch** (or a small ladder of related commits if fix needs to be staged). Rollback = `git revert` of that range. Each commit message lists the F-NNN findings it closes.

**Branches:** one per phase. Within a phase, batches land sequentially on the phase branch. Phase merges to master only when all batches are green.

---

## 3. Verification gates

**Between every batch (within a phase):**

- TypeScript type-check passes (`npm run type-check`, including scripts/ per the round-3 gate)
- ESLint passes (`npm run lint`)
- Production build passes (`npm run build`)
- Existing Phase-5d test suite passes (the 107 active tests)
- The new failing-test-first test passes (was red before, green after)

**Between every phase:**

- All-of-the-above
- Smoke run of one Director conversation end-to-end (proposal → Approve → execute → completion)
- Smoke run of Steps 1–5 from the round-3 launch-hardening drill (sub-novel scale, ~5 minutes)
- A1 lib/llm spec lens re-check (the spec-divergence backfill that landed in round-3)

**Mid-phase smoke (any phase with ≥5 batches):**

Halfway through Phase 3, Phase 5, and Phase 7 (the ones with 5+ batches), run Steps 1–5 local smoke. Don't run the full novel — too slow for a mid-phase checkpoint. The point is to catch a regression while the suspect list is 2 batches, not 6.

**Full novel write (V1 launch standard) at three points only:**

| Checkpoint | When | Cost cap | Rationale |
|---|---|---|---|
| **Post-Phase-2** | After F-07 + F-152 cascades land | $1 | Biggest behavioural blast radius; if novel still writes, the foundation held |
| **Post-Phase-4** | After all 5 DB-constraint migrations | $1 | Biggest data risk; if novel still writes, schema changes are clean |
| **Pre-merge** | Final gate before merging back to master | $1 | The launch standard *is* the launch gate |

Three runs at ~$0.90 each. Cheap insurance vs. compounding regression across 30 batches before discovery.

**Visual regression at Phase 7 boundaries only.** Phases 1–6 should be visually inert; a visual regression in those would itself be a smoking gun, so Step 4 of round-3 covers it on demand. Phase 7 is the UI/Inviolable phase, so visual regression runs at its mid-point and at completion.

**Pre-Phase-5 snapshot tag.** Immediately before Phase 5 starts, tag the master commit (`pre-audit-phase5-snapshot`). Phase 5 touches security/audit_log/RLS-adjacent code — having a clean rollback point is much cheaper than cherry-picking out 4–5 batches under pressure.

**Stop-the-line rule.** If any single batch produces **2+ unexpected failures** (existing tests breaking, not the failing-test-first tests we authored), pause that phase. Diagnose the cross-cutting cause before continuing. Two unrelated breakages from one batch is the signal that the change had wider blast radius than intended.

**Rollback policy:** if any verification gate fails, revert the batch's commit and re-attempt with the gate's failure as the regression test.

---

## 4. Phase ordering

Seven phases. Order chosen by **risk of breakage × dependency** — lowest-risk-first, dependencies-first.

### Phase 0 — Set up the protocol (no code changes)

**Output:** this plan, signed off.

- Decide test-first conventions
- Decide batch-size cap
- Decide verification gates (above)
- Add `PROGRESS.md` tracker file

### Phase 1 — Trivially low-risk pattern fixes

**Closes:** Theme T-2 (H-01 violations, 10 sites), part of Theme T-13 (spec citations)

**Why first:** straightforward search-and-replace. Each site is a one-line fix. Low risk of regression, high count of closed findings.

**Batches:**
- B1.1 — `.single()` → `.maybeSingle()` in production lib/data (5 sites: F-144, F-148, F-155, F-163; one in agent-helper F-179)  
  - Test-feasibility: **observable-via-mock**. Setup: delete row before query. Assert function returns null or throws controlled error. Repeat per site.
- B1.2 — `.single()` in tests/helpers (3 sites). Test-feasibility: **demonstrable** (delete row in test setup, run helper, assert).
- B1.3 — Add ESLint rule banning bare `.single()` without justification comment. Test-feasibility: **constraint-driven** — the rule itself.
- B1.4 — Lint rule + cleanup for spec-version citations (T-13). Test-feasibility: **constraint-driven**.

**Estimated batches:** 4. **Estimated findings closed:** ~15.

### Phase 2 — Root-cause fixes that cascade

**Closes:** F-07 + cascade (F-20, F-21, F-32, F-50, F-138). F-152 / F-160 + cascade (F-195 affecting every node-API response).

**Why second:** these are individual functions whose fixes propagate to many sites. Each fix is local but its effect is wide.

**Batches:**
- B2.1 — `getConfig<T>` runtime validation (F-07). Each typed alias gets a real coercion + zod check. Test-feasibility: **demonstrable** — store a string in platform_config where the alias claims number; verify the function throws clearly. Cascade tests: F-20, F-21, F-32, F-50, F-138 each get a regression test that demonstrates their failure mode using the now-fixed primitive.
- B2.2 — `decorateWithLeaf` null-cascade fix (F-152). When `getDocumentMaxLayerIndex` returns null, throw rather than silently set is_leaf=false. Test-feasibility: **observable-via-mock** — mock the fetch to return null, verify route returns 500 with clear error rather than wrong UI gates.
- B2.3 — Migrations 037-equivalent for any lingering F-160 cases (Math.max on layers with index undefined). Test-feasibility: **demonstrable**.

**Estimated batches:** 3. **Estimated findings closed:** ~10 (5 root + 5 cascading).

### Phase 3 — Project-wide silent-failure convention (Theme T-1, the largest cluster)

**Closes:** Theme T-1 — 26+ sites of silent-failure-on-transport.

**Why third:** Theme T-1 is the dominant pattern; closing it closes a quarter of the audit. But it requires discipline — each site needs a regression test before fix.

**Batches:**
- B3.1 — Convention decision: write `docs/architecture/error-handling-conventions.md` describing what every fetch/transport error must do. Surface (toast / console.error / banner / re-throw). NOT a code change yet.
- B3.2 — `lib/llm/providers/anthropic.ts` stream loops (F-34, F-37). Add `case 'error':` paths. Test-feasibility: **observable-via-mock** — mock SDK stream to emit error event; assert chunk yielded.
- B3.3 — `lib/director/streamMessage.ts`, `lib/agent/streamSynthesise.ts` Promise-resolve-on-failure (F-92, F-94, F-139, F-141 dedupe). Test-feasibility: **observable-via-mock** — return non-OK from fetch; assert Promise rejects (not resolves).
- B3.4 — `lib/stores/editor-store.ts` autosave silent failure (F-170, F-171, F-172). Test-feasibility: **observable-via-mock** — fail PATCH; assert "save failed" banner appears.
- B3.5 — `lib/hooks/useAgentJobsRealtime.ts` WebSocket error handler (F-201). Test-feasibility: **observable-via-mock** — Supabase channel `subscribe` callback fires `CHANNEL_ERROR`; assert banner / re-subscribe.
- B3.6 — Component-layer fetch silences (10 sites: F-220, F-237, F-238, F-239, F-240, F-243, F-244, F-247, F-248, F-250). Test-feasibility: **observable-via-mock** with the new `tests/helpers/fetch-mock.ts`. One batch per ~3 sites to keep diffs reviewable.

**Estimated batches:** 6+ (last one might split into 3–4 sub-batches). **Estimated findings closed:** ~22.

### Phase 4 — DB-layer constraints (Themes T-4, T-8, T-14)

**Closes:** F-265 (nodes UNIQUE), F-266 (conversation_messages UNIQUE), F-267/268 (CHECK constraints), partial F-154/F-188.

**Why fourth:** migrations are higher-risk (data state changes). Need to follow this phase only after T-1 silent-failure is fixed, because some constraint violations will *now surface as errors* that the silent-failure layer was hiding.

**Batches:**
- B4.1 — Migration: add `UNIQUE(parent_id, "order")` to nodes (deferrable so multi-row UPDATEs in `move_node` don't fail mid-transaction). Test-feasibility: **constraint-driven** — INSERT two rows with same parent + order; assert second fails. Plus: existing `move_node` RPC must still work; integration test for reorder.
- B4.2 — Migration: add `UNIQUE(conversation_id, sequence)` to conversation_messages. Test-feasibility: **constraint-driven**.
- B4.3 — Migration: CHECK constraint on `nodes.node_type`. Test-feasibility: **constraint-driven** — INSERT bad node_type; assert reject.
- B4.4 — Migration: convert `created_by` / `last_modified_by` to UUID FK to auth.users (or an audit-log indirection). Test-feasibility: **constraint-driven** — bad UUID / non-existent user FK fails.
- B4.5 — Migration: validate JSONB shape on summary/prose/notes (CHECK that it parses as Tiptap doc). Test-feasibility: **constraint-driven**. Defer to V1.x if too risky.

**Estimated batches:** 5. **Estimated findings closed:** ~10.

**Risk:** these migrations are irreversible-ish (constraints can be DROP'd but data backfill may have happened). Run on local first, then a Vercel preview branch DB, then prod.

### Phase 5 — Security + auth + audit_log

**Closes:** F-56 (audit_log), F-95 (summariser bypass), F-100 (H-08 runtime check), F-187 (Director routes H-07), F-124 (workflow_step H-07), F-74 (rate-limit fail-open decision), F-89 (assertConversationAuthor exemption).

**Why fifth:** security work needs the fail-loud foundation from Phase 3 (so audit events actually surface) and the constraint foundation from Phase 4 (so locked nodes / RLS edge cases work).

**Batches:**
- B5.1 — Migration: `audit_log` table with RLS. Test-feasibility: **constraint-driven**.
- B5.2 — Replace 3 `console.error('[SECURITY]', ...)` sites with `writeAuditLogEntry()` (F-56 sites). Test-feasibility: **demonstrable** — trigger a canary leak in a test; assert audit_log row exists.
- B5.3 — `summariseConversation` security frame (F-95). Wrap with escapeXml + scanContent. Test-feasibility: **demonstrable** — feed a known injection pattern through; assert it's neutralised in the summariser's prompt.
- B5.4 — H-08 runtime check on `runAgenticTurn` write-tool results (F-100). Test-feasibility: **observable-via-mock** — define a test write tool that simulates a DB write inside its body; assert the executor aborts.
- B5.5 — Director routes call `checkTokenBudget` (F-187, F-124). Test-feasibility: **observable-via-mock** — mock org with depleted budget; assert 402 from director/message and from workflow approve.
- B5.6 — Rate-limit fail-open decision (F-74). Discuss with user first: fail-closed (deny on query failure) vs explicit doc of fail-open. Test-feasibility per decision.
- B5.7 — `assertConversationAuthor` no-user-messages exemption (F-89). Decision required: enforce at trigger level or accept the bypass with a doc note.

**Estimated batches:** 7. **Estimated findings closed:** ~12.

### Phase 6 — Two-source-of-truth refactors (Theme T-3)

**Closes:** F-19 (BYOK), F-81 (tool schemas), F-90/F-91/F-145/F-149/F-203/F-206 (manual row types), F-116 (target_field), F-141 (parseSseBlock dup), F-209 (metadata schema dup), F-217/F-143/F-257 (getOrgId triple), F-260 (env loader dup).

**Why sixth:** these are bigger refactors. Need confidence that the failure-loud + constraint layers below have stabilised, so silent regressions don't slip through.

**Batches:**
- B6.1 — Generate JSON Schema from Zod (F-81). Build script. Test-feasibility: **constraint-driven**.
- B6.2 — Replace manual row types with `Database['public']['Tables']['X']['Row']` imports (F-90, F-91, F-145, F-149, F-203, F-206). Test-feasibility: **constraint-driven** — TypeScript catches drift.
- B6.3 — Single `isByok(org)` helper, single `getOrgId` helper (F-19, F-217/143/257). Test-feasibility: **demonstrable** — multi-org user, assert deterministic org selection.
- B6.4 — Consolidate `parseSseBlock` (F-141), env loader (F-260), JSON-array extractor (F-120), nodeTypeIcon (F-245), the two NodePicker components (F-246), the two extractPlainText (F-241), the metadata-schemas drift (F-209). Test-feasibility: **structural** — verify behaviour unchanged via existing tests.

**Estimated batches:** 4–5. **Estimated findings closed:** ~14.

### Phase 7 — Inviolables + UI alignment + spec docs

**Closes:** F-213, F-214, F-251 (T-12 verdigris), F-187 director-message comment-vs-code-mismatch from F-71, F-101, F-105 (T-11 generic catch-all), F-39, F-67, F-97, F-103, F-128 (T-9 H-12 hardcoded), F-44, F-51, F-164 (T-10 sequential walks), spec-doc updates (T-13).

**Why seventh:** these are visible / aesthetic / process fixes. Get them last so the high-leverage structural fixes are stable underneath.

**Batches:**
- B7.1 — Inviolable #2 design decision (revert vs broaden). Then code change. Test-feasibility: **constraint-driven** via verdigris-allowlist ESLint rule.
- B7.2 — Typed error classes for generic catch-alls (F-71, F-101, F-105). Test-feasibility: **demonstrable** — trigger each cause, assert distinct error type.
- B7.3 — H-12 hardcoded values → platform_config (F-39, F-67, F-97, F-103, F-128, F-167, F-193, F-199). Test-feasibility: **demonstrable** — change the config value, assert behaviour changes.
- B7.4 — Sequential walks → single Postgres `walk_ancestors` RPC (F-44, F-51, F-164, F-190). Test-feasibility: **demonstrable** — measure round-trip count before/after.
- B7.5 — Spec doc updates (T-13). Update TA v2.2 → v2.3 with all the spec-divergences code has caught up to.

**Estimated batches:** 5. **Estimated findings closed:** ~15.

### Phase 8+ — Long tail

The remaining LOW findings + V2 deferrals + low-leverage MEDIUMs. Each batched by file or by adjacent area. Rough count: ~140 findings remaining after Phases 1–7.

**Suggestion:** treat Phase 8 as opportunistic — when a developer is in a file for an unrelated reason, sweep the LOW findings while there. Don't dedicate sprints to it.

---

## 5. Total estimate

| Phase | Batches | Findings closed | Estimated effort |
|---|---|---|---|
| 0 | 0 | — | 1 session (this plan + protocol setup) |
| 1 | 4 | 15 | 1–2 sessions |
| 2 | 3 | 10 | 1 session |
| 3 | 6+ | 22 | 3–4 sessions |
| 4 | 5 | 10 | 2 sessions (incl. migration verification) |
| 5 | 7 | 12 | 3 sessions |
| 6 | 4–5 | 14 | 2–3 sessions |
| 7 | 5 | 15 | 2 sessions |
| 8+ | rolling | ~140 | opportunistic |
| **Total (Phases 1–7)** | **~35** | **~98 of 258** | **~14–17 sessions** |

After Phase 7, the **48 HIGH findings should all be closed plus ~50 of the MEDIUM**. The remaining ~140 LOW + low-leverage MEDIUMs run on opportunistic schedule.

---

## 6. Tracking

`docs/audit/round3-codebase-audit/PROGRESS.md` (new file). Maintains:

- Per-batch entry: date, scope, findings closed, regressions surfaced, rollback if any
- Per-finding status: `open` / `in-progress` / `resolved` / `deferred-to-Vx` / `wontfix-with-reason`
- Phase summary at each phase boundary

---

## 7. Open decisions (need user sign-off before Phase 1 starts)

1. **Approve the 7-phase ordering above** — or reorder if you have a different view.
2. **Approve 5–15 findings per batch as the cap.**
3. **Approve the failing-test-first protocol** as the non-negotiable rule.
4. **Approve the structural-finding honesty exception** — some findings have no failing-test-first proof, and we'll be explicit when so.
5. **F-74 (rate-limit fail-open)** — fail-closed, or document the fail-open in TA? This is a security-policy call I shouldn't make alone.
6. **F-89 (assertConversationAuthor "shouldn't occur" exemption)** — enforce structurally or accept with a doc note?
7. **Inviolable #2 fix (F-213, F-214)** — revert (use text-primary) or broaden the spec to cover Director affirmative-action flows?
8. **Branch strategy** — one branch per phase, or cherry-pick batches into master as they go? The former is safer, the latter ships value sooner.

Sign off on items 1–4 and we proceed to Phase 1. Items 5–8 can be decided when we hit them.

---

*Awaiting user approval. No code changes are in flight.*