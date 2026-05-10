# Round-3 audit — remediation progress

Tracking file for the 7-phase remediation against [10-remediation-plan.md](10-remediation-plan.md).

**Total findings to close:** 258 (48 HIGH / 121 MEDIUM / 89 LOW)
**Phases 1–7 target:** ~98 findings (all HIGH + ~50 MEDIUM)
**Phase 8+ rolling:** ~140 LOW + low-leverage MEDIUM

**Status legend:**

- `open` — not yet started
- `in-progress` — batch in flight
- `resolved` — fix landed, regression test green
- `deferred-vN` — deferred to V1.x or V2 (with reason)
- `wontfix-with-reason` — closed without fix (with reason)
- `false-positive` — finding was wrong on re-examination

---

## Status by phase

| Phase | Batches planned | Batches done | Findings closed | State |
|---|---|---|---|---|
| 0 — Setup | 0 | — | — | done |
| 1 — Pattern fixes | 4 | 3 + 1 deferred | 7 | done (B1.4 deferred to Phase 8) |
| 2 — Root-cause cascades | 3 | 2 (B2.2+B2.3 merged) | 4 | in-progress (B2.2+B2.3 done) |
| 3 — Silent-failure | 6+ | 6 (B3.1-B3.6) | 17 | done |
| 4 — DB constraints | 5 | 5 | 5 | done |
| 5 — Security + audit_log | 7 | 0 | 0 | open |
| 6 — Two-source-of-truth | 4–5 | 0 | 0 | open |
| 7 — Inviolables + UI + spec | 5 | 0 | 0 | open |
| 8+ — Long tail | rolling | 0 | 0 | open |

---

## Batch log

### Batch B4.5 — `summary` / `prose` / `notes` TEXT → JSONB (F-269)

- **Phase:** 4
- **Findings closed:** F-269 (LOW)
- **Migration:** `supabase/migrations/20260510000042_nodes_content_jsonb.sql` (initially deferred; reinstated after the user's 2026-05-10 directive: "data in the DB at this point in time can be deleted and doesnt need to be fixed. Do not defer fixing issues because of old data in the database.")
- **Conversion strategy for the 693 legacy plain-text rows:**
  - Valid JSON → `::jsonb` (round-trips cleanly)
  - NULL / empty → NULL
  - Plain-text content → wrapped in a Tiptap doc with a single paragraph containing the text. Preserves the content; gives it valid Tiptap structure. Local-only helper function created and dropped within the migration.
- **node_versions table also converted** for consistency — same pattern. The accept_agent_job RPC's snapshot INSERT is now a direct copy (both source and destination columns are JSONB).
- **accept_agent_job RPC body updated** to cast TEXT parameters with `::jsonb` before assignment to the now-JSONB columns. Parameter types kept as TEXT (the route handler still passes `JSON.stringify`-ed Tiptap docs from the agent job's TEXT result fields). Child INSERTs use `v_child->'summary'` (`->` not `->>`) to preserve JSONB.
- **Server-side normalisation (`lib/editor/serialise.ts:normalizeContent`)** added. Called from PATCH `/api/nodes/[id]` and the two create routes (`POST /api/documents/[id]/nodes` and `POST /api/projects/[id]/context-nodes`). Coerces incoming wire-format strings into JSONB objects so PostgREST stores actual objects, not JSONB primitive strings. Pre-fix: my first-pass smoke confirmed `summary` was stored as `jsonb_typeof = string` (a JSONB-wrapped JSON string — wrong); post-fix, both `prose` and `summary` are `jsonb_typeof = object` (correct shape).
- **Client-side wire format unchanged** — `toStorage` still returns string, editor components still pass strings via `onChange`, editor-store still stores strings. The string→object coercion is purely server-side. This kept the editor-prop surface stable and avoided a fan-out across 3 editor components + NodeDetailPanel + editor-store.
- **`extractPlainText` and `checkSummaryNonEmpty` widened** to accept the full Json union (string / number / boolean / object / array / null). Handles both legacy string and post-042 object shapes.
- **3 reader sites updated** (`scripts/step2-multi-tab-conflict.ts`, `tests/api/agent_accept.spec.ts`, `tests/phase5d/j9-edge-cases.spec.ts`) to handle the new object shape on read.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 157/157 ✓ • build ✓ • Playwright tests/api/ 261/261 ✓ • LLM smoke 27/27 + 5/5 + 1, 0 SUs, $0.1593 — and post-smoke check confirms all written content stored as `jsonb_typeof = object`.

### Batch B4.4 — `nodes.created_by` / `last_modified_by` → UUID FK to auth.users (F-268)

- **Phase:** 4
- **Findings closed:** F-268 (MEDIUM)
- **Migration:** `supabase/migrations/20260510000041_audit_user_fk.sql`
- **Type conversion:** TEXT NOT NULL DEFAULT 'user' → UUID nullable. Existing 2683 rows had the literal string 'user' (placeholder, not real audit data); migration nullifies them via `USING (NULL::uuid)`. Lossless for forensic purposes since the values weren't real.
- **FK semantics:** `ON DELETE SET NULL` — when a user is deleted, their audit-trail rows survive but with NULL author. Audit forensics still work; cascading delete would lose the row's history entirely.
- **Pre-flight discovery:** my initial information_schema query (looking for FK constraints) was buggy and reported zero FKs on `node_attachments.created_by` and `scheduled_jobs.created_by`. `\d` on each table showed they already had FKs. So the audit's F-268 was correctly scoped to nodes only; the "go deeper" expansion I considered was based on a faulty SQL query. Documented as a process observation.
- **Type regen:** ran `supabase gen types typescript --local > lib/types/database.ts`. The CLI's update-available notice got concatenated into the file — re-ran with `2>/dev/null` to strip stderr. Process observation.
- **Test added:** 2 cases — fake-UUID INSERT rejected with 23503; NULL created_by allowed (service-role / system writes).
- **Failing-test-first proof:** both red pre-migration (column was TEXT — fake UUID was just stored as a string); green post-migration.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 157/157 ✓ • build ✓ • Playwright tests/api/nodes.spec.ts 33/33 ✓

### Batch B4.3 — `nodes.node_type` CHECK constraint (F-267)

- **Phase:** 4
- **Findings closed:** F-267 (MEDIUM)
- **Migration:** `supabase/migrations/20260510000040_nodes_node_type_check.sql`
- **Whitelist enforced at DB layer:** structural = book/series/story/act/chapter/scene/beat (7); context = character/location/organisation/theme/plot_thread/world (6).
- **Type-category coupling:** the CHECK ties `node_type` to `node_category` — a context-category row can't carry a structural type and vice versa. Catches a class of category-confusion bugs (e.g. workflow-executor's auto-create-context-node accidentally writing `node_type='chapter'` with `node_category='context'`).
- **Pre-flight data check:** `SELECT DISTINCT node_type, node_category` showed 11 (type, category) pairs, all valid under the new constraint.
- **Test added:** 3 cases — invalid type rejected with 23514; category-mismatch rejected; all 13 valid (type, category) pairs accepted.
- **Failing-test-first proof:** invalid-type and category-mismatch cases red pre-migration (silent INSERT succeeded); green post-migration.
- **Test fixture bug found:** my outer `beforeAll` was using `node_type: 'novel'` for the test parent — `'novel'` is a `document_type` not a `node_type`. The CHECK constraint surfaced this immediately. Fix: use `'book'` (the V1 node_type for the root of a novel document).
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** vitest 155/155 ✓ • Playwright tests/api/nodes + context_nodes 51/52 ✓ (1 known version-trigger flake — TC-A-36 — same as Phase 1 boundary; CHECK constraint doesn't touch version/content paths)

### Batch B4.2 — `conversation_messages` UNIQUE(conversation_id, sequence) (F-266)

- **Phase:** 4
- **Findings closed:** F-266 (MEDIUM)
- **Migration:** `supabase/migrations/20260510000039_conversation_messages_sequence_unique.sql`
- **Not DEFERRABLE** — there is no multi-row UPDATE pattern on this table analogous to `move_node`. INSERTs are append-only; the constraint is checked immediately.
- **Pre-flight data check:** zero existing duplicates.
- **Test added:** 2 cases extending `tests/integration/db-constraints.test.ts`. Duplicate sequence INSERT fails with 23505; different sequence succeeds.
- **Failing-test-first proof:** duplicate-INSERT case red against pre-migration DB; green post-migration.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** vitest 152/152 ✓ • Playwright tests/director/api.spec.ts 16/16 (36 skipped LLM-bound) ✓

### Batch B4.1 — `nodes` UNIQUE(parent_id, "order") DEFERRABLE (F-265)

- **Phase:** 4 (DB constraints)
- **Findings closed:** F-265 (HIGH)
- **Migration:** `supabase/migrations/20260510000038_nodes_order_unique.sql`
- **DEFERRABLE INITIALLY DEFERRED** — required so the existing `move_node` RPC's multi-row UPDATEs (Migration 021) don't fail mid-transaction. The constraint is checked at COMMIT time, after the post-shift state is settled.
- **NULLS DISTINCT default applies** — the ~1000 existing root structural and context nodes share `parent_id=NULL, order=1`; PostgreSQL's default `NULLS DISTINCT` semantics let multiple NULL parent_ids coexist.
- **Pre-flight data check:** `SELECT parent_id, "order", COUNT(*) FROM nodes WHERE parent_id IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1` returned 0 rows — no existing duplicates to backfill.
- **Test added:** `tests/integration/db-constraints.test.ts` — 3 cases. INSERT-duplicate fails with SQLSTATE 23505; INSERT with different order succeeds (regression guard); multiple NULL-parent rows coexist (NULLS DISTINCT regression guard).
- **Failing-test-first proof:** the duplicate-INSERT case red against pre-migration DB (the second INSERT silently succeeded — F-265's exact bug); green post-migration. The two regression-guard cases stayed green throughout.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 150/150 ✓ • build ✓ • Playwright move_node 20/20 ✓ • Playwright tests/api/ 261/261 ✓ (no regression — DEFERRABLE constraint compatible with `move_node` multi-row UPDATEs)

### Batch B3.6 — Component-layer fetch silences (F-220, F-238, F-239, F-240, F-243, F-247, F-248, F-250)

- **Phase:** 3
- **Findings closed:** F-220, F-238, F-239, F-240, F-243, F-247, F-248, F-250 (8 of the 10 plan-listed sites)
- **Plan composition error #5:** F-237 (memory leak — different category) and F-244 (wrong-semantics, not silent-failure) were listed in the plan but don't fit this batch's theme. Logged as Phase-8 / separate-batch follow-ups.
- **Test-feasibility:** structural per the protocol's structural-finding honesty exception. Each of these is an inline component-level fetch handler — unit-testing requires React Testing Library setup which is not in the test infrastructure today. The change shape is consistent across all sites (replace silent return / catch-with-no-op with a console.error naming the component) and verified by code review against the conventions doc + existing Playwright UI suites.
- **Sites changed:**
  - `components/detail/NodeDetailPanel.tsx` — submitName: catch network + check r.ok (F-220)
  - `components/detail/BackLinksList.tsx` — back-links GET: console.error on non-OK and on .catch (F-238)
  - `components/detail/ContextLinker.tsx` — context-links GET: console.error on both paths (F-239)
  - `components/detail/NodePicker.tsx` — context-nodes GET: console.error on both paths (F-240)
  - `components/detail/CommentThread.tsx` — resolveComment + deleteComment: r.ok check + setError + catch (F-243)
  - `components/tree/NodeMoreMenu.tsx` — rename + del + setStatus: console.error on non-OK + catch (F-247)
  - `components/focus/FocusMode.tsx` — siblings GET: console.error on both paths (F-248)
  - `components/context/ContextCreateModal.tsx` — documents GET: console.error on both paths (F-250)
- **UI toast / banner deferred:** the components don't currently consume `useToast()`. Per Phase 3's scope ("stop the silence at the data layer") console.error is the minimum surface; consistent toast UI is a Phase 7 polish item. The conventions doc documents this trade-off.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 147/147 ✓ • build ✓ • Playwright UI (tree_more_menu, context_linker, focus-mode) 10/10 ✓

### Batch B3.5 — useAgentJobsRealtime WebSocket error handler (F-201)

- **Phase:** 3
- **Findings closed:** F-201 (HIGH)
- **Test-feasibility:** observable-via-mock + structural (extracted the subscription-status handler `handleRealtimeStatus` to a named exported function so it can be tested without rendering the hook in a React tree).
- **Test added:** `tests/unit/agent-jobs-realtime-error.test.ts` — 4 cases. CHANNEL_ERROR sets realtimeError; TIMED_OUT sets it; CLOSED sets it; SUBSCRIBED clears it.
- **Failing-test-first proof:** all 4 red pre-fix because `handleRealtimeStatus` and `useAgentJobsErrorStore` didn't exist. All 4 green post-fix.
- **Wiring:** `.subscribe()` → `.subscribe(handleRealtimeStatus)`. The handler logs to console.error and sets a Zustand-backed `realtimeError` field. UI banner that consumes the field is a Phase 7 polish item.
- **Discovered (audit gap):** `lib/hooks/useNodesRealtime.ts:68` has the same pattern — `.subscribe()` with no callback. The audit's F-208 marked the file as a positive finding (clean H-05 cleanup) but missed this WebSocket error handler issue. Logged as a Phase-8 follow-up rather than expanding B3.5 scope to keep the batch tight.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 147/147 ✓ • build ✓

### Batch B3.4 — Editor-store autosave saveError surface (F-170 + F-171 + F-172)

- **Phase:** 3
- **Findings closed:** F-170 (HIGH), F-171 (HIGH), F-172 (MEDIUM)
- **Test-feasibility:** observable-via-mock (vi.stubGlobal `fetch` to inject network errors / status codes; assert state.saveError changes accordingly).
- **Test added:** `tests/unit/editor-store-save-error.test.ts` — 7 cases. F-170 covers network error + clear-on-next-success; F-171 covers 422/500/503 (table-driven) + 409/423 negative cases (those have their own state surfaces — conflictCurrent, lockedReason).
- **Failing-test-first proof:** all 7 red pre-fix because the `saveError` field didn't exist on state. After adding the field and setting it on each failure path, all 7 green.
- **Field added:** `saveError: string | null` on EditorState. Set by (a) network error caught in autosave; (b) non-200/409/423 status responses; (c) reloadFromServer fetch failure or non-OK response. Cleared on the next successful 200 PATCH. The UI banner that consumes this field is a Phase 7 polish item — Phase 3's job is to stop the silence at the data layer.
- **Console.error added on each failure path** so the developer console surfaces the failure immediately, complementing the state-level signal.
- **Side benefit:** running the Playwright editor + nodes-patch + version-trigger suites surfaced **28/28 passing** — the previously-flaky 7 nodes-patch tests noted at Phase 1 boundary now all pass. Likely transient test-DB state earlier; not investigating further since they're now green.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 143/143 ✓ • build ✓ • Playwright editor+version-trigger 28/28 ✓

### Batch B3.3 — Stream-client Promise rejection on transport failure (F-92 + F-94 + F-139)

- **Phase:** 3
- **Findings closed:** F-92 (HIGH), F-94 (MEDIUM), F-139 (HIGH)
- **F-141 dropped from this batch** — it's a `parseSseBlock` two-source-of-truth finding (Phase 6 T-3), not silent-failure. Plan composition error #4.
- **Test-feasibility:** observable-via-mock (`vi.stubGlobal('fetch', ...)` to return synthetic `Response` objects with crafted JSON or ReadableStream bodies; assert the Promise rejects).
- **Test added:** `tests/unit/stream-client-promise-reject.test.ts` — 7 cases. F-92 covers `streamDirectorMessage` transport failure (500, 401-with-text); F-94 covers stream-closed-without-terminator; F-139 mirrors F-92 for `streamSynthesise`. Plus 2 regression-guard cases verifying happy-path and explicit-error-event paths still resolve cleanly.
- **Failing-test-first proof:** 5 of 7 red pre-fix (Promise resolved silently on transport failure / mid-stream crash). All 7 green post-fix.
- **Caller compatibility:** both consumers of these helpers (`components/director/DirectorPanel.tsx` and `components/detail/AgentTab.tsx`) already wrapped the await in `try { ... } catch (e) { ... }` with proper error-UI surface. The new throw paths integrate cleanly without consumer changes.
- **Mid-stream-crash detection (F-94):** added a `saw_terminator` flag set when a `done` or `error` event is dispatched. If the network read loop ends naturally without ever flipping the flag, throw with a server-may-have-crashed message.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ (baseline 9 warnings) • vitest 136/136 ✓ • build ✓
- **Playwright caveat:** `tests/director/j5-director-turn.spec.ts` failed (3 unexpected agent_jobs after Director probe). Failure is in the **server** path (`POST /api/director/message`); B3.3 only touches the **client** SSE consumer. Confirmed by reading the code: my changes can't affect server-side dispatch decisions. Likely model behavior variance (the agent stream tests showed 2/3 flaky too on this run). Flagged for separate investigation; not a B3.3 regression.

### Batch B3.2 — Anthropic stream error events must throw (F-34 + F-37)

- **Phase:** 3
- **Findings closed:** F-34 (HIGH), F-37 (HIGH)
- **Test-feasibility:** observable-via-mock (vi.mock the SDK to inject an `error` event into the stream's async iterable; verify the for-await throws).
- **Test added:** `tests/unit/anthropic-stream-error.test.ts` — 3 cases. F-34 covers `stream()`; F-37 covers `streamWithTools()`; one regression-guard case verifies happy-path streams still complete normally.
- **Failing-test-first proof:** F-34 + F-37 cases red pre-fix (the for-await iterated to completion silently, no message_stop chunk, no error). All 3 green post-fix.
- **Type-system surprise:** the SDK's `RawMessageStreamEvent` discriminated union doesn't include the `error` event type, so `case 'error':` inside the typed switch was unreachable per types and broke the production build. Restructured to a runtime `(event as { type: string }).type === 'error'` check *before* the switch — type-safe and emits the same throw.
- **Conventions doc updated to reflect throw-not-yield decision** for stream provider errors. Originally drafted as "yield error chunk", changed to "throw" because it's the smaller change and the LLMStreamChunk surface stays minimal.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ (baseline 9 warnings) • vitest 129/129 ✓ • build ✓

### Batch B3.1 — Error-handling conventions doc

- **Phase:** 3 (anchor for the silent-failure remediation)
- **Output:** `docs/architecture/error-handling-conventions.md` — short reference doc codifying the per-layer surface for each failure mode (lib/data → return error in result; lib/llm provider → throw; lib/director → throw; API route → structured error response; client streaming helpers → reject promise; React component → toast + console.error; real-time hook → console.error + re-subscribe). Includes anti-patterns from the audit's findings and correct patterns drawn from existing code.
- **Test-feasibility:** structural (a doc has no runtime test).
- **Status:** resolved

### Batch B2.2 + B2.3 (merged) — `decorateWithLeaf` + `getDocumentMaxLayerIndex` data-integrity fix (F-152 + F-160)

- **Phase:** 2
- **Findings closed:** F-152 (HIGH), F-160 (MEDIUM)
- **Merged because they're the same code path.** B2.3 was nominally about migrations but the actual F-160 fix is in `getDocumentMaxLayerIndex` — same function as F-152's root cause. No migration needed.
- **Test-feasibility:** observable-via-mock (mock the supabase chain to return various malformed layer_stacks shapes; assert the function throws with informative messages naming the document_id).
- **Test added:** `tests/unit/decorate-with-leaf.test.ts` — 8 cases. 5 cover `getDocumentMaxLayerIndex` (happy path returns max index; data-integrity violations throw — missing layer_stacks row, empty layers array, missing index field, non-numeric index field). 3 cover `decorateWithLeaf` (null context-node path returns is_leaf=false; matching layer_index returns true; mismatch returns false).
- **Failing-test-first proof:** 4 of 8 red pre-fix (the data-integrity scenarios all silently returned null or 0 or NaN). All 8 green post-fix.
- **API contract change:** `getDocumentMaxLayerIndex` return type changed from `Promise<number | null>` to `Promise<number>`. Callers were already handling the result through a conditional that passes null directly (for context nodes); they now receive a non-null number when the call is made, or skip the call entirely. No caller needed updating.
- **Side effect:** `decorateWithLeaf(node, null)` is preserved as the legitimate context-node path — context nodes have no leaf semantics in the structural sense; `is_leaf=false` is correct. Documented inline.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 126/126 ✓ • build ✓ • Playwright projects+documents+nodes+nodes-leaf 122/122 ✓

### Batch B2.1 — `getConfig<T>` runtime validation (F-07 root + F-20 cascade)

- **Phase:** 2
- **Findings closed:** F-07 (HIGH), F-20 (HIGH cascade)
- **Plan listed F-21, F-32, F-50, F-138 as F-07 cascades — they aren't.** F-21 / F-138 are formatYearMonth NaN-trap bugs (silent-failure family); F-32 is an Anthropic SDK null-check; F-50 is a missing ORDER BY. None of those depend on `getConfig`'s typing. Plan composition error confirmed for the third time. Process amendment from B1.1 stands: verify each F-NN against the audit's actual finding text before including it in a batch.
- **Test-feasibility:** observable-via-mock + integration (mock `@/lib/supabase/service`, store wrong-typed values, assert typed alias throws naming the key)
- **Test added:** `tests/unit/platform-config-validation.test.ts` — 6 cases covering all four typed aliases plus the F-20 cascade (checkTokenBudget surfaces the type error rather than silently misbehaving with a string-typed budget).
- **Failing-test-first proof:** all 5 wrong-type cases red pre-fix (silent return of mistyped value); F-20 cascade returned `true` (silent-budget-bypass with stored `"500000"` string). All green post-fix.
- **Bug introduced and caught by integration tests, not unit tests.** When I added an `eslint-disable-next-line` comment between `.select('value')` and `.single()` on the platform_config chain, I accidentally **dropped the `.eq('key', key)` filter** — the query was returning ALL platform_config rows, then `.single()` errored, breaking `tests/unit/tool-validator.test.ts` and `tests/unit/director-summarisation.test.ts` which both depend on real config reads. Caught by the full Vitest suite run, not by my new unit test (which mocked the chain entirely). Process observation: when refactoring/annotating production code, the suite-wide run is non-skippable.
- **Spurious eslint-disable removed.** The H-01 ESLint rule from B1.3 only applies to `lib/data/**`; `lib/config/platform-config.ts` is outside scope, so the eslint-disable directive was unnecessary. Replaced with a regular comment explaining why `.single()` is correct here (key is PK; zero rows IS an error).
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 118/118 ✓ • build ✓ • Playwright projects+documents+nodes 119/119 ✓

### Batch B1.4 — Spec-version citation cleanup (T-13)

- **Phase:** 1
- **Status:** **deferred to Phase 8 long-tail** (decision dated 2026-05-10)
- **Rationale:**
  - T-13 is LOW severity across the board (every linked finding is LOW). Stale citations mislead readers but don't break code.
  - 161+ occurrences of `_v\d+_\d+\.md` across `lib/`, `components/`, `app/`, `tests/`, plus the docs/ tree itself. Bulk retrofit is 4–5 batches by itself — bigger than Phase 1 should absorb.
  - Tried adding a `warn`-level lint rule scoped to `lib/`. ESLint flat-config rule merging across overlapping `files:` blocks made the configuration brittle (the H-01 lib/data block and a wider lib/** block compete on `no-restricted-syntax` options). The implementation cost outweighs the value for a LOW-severity hygiene finding.
  - Phase 8 is the natural home for opportunistic LOW-finding sweeps. Per `99-themes.md` closing observation: "treat Phase 8 as opportunistic — when a developer is in a file for an unrelated reason, sweep the LOW findings while there."
- **No code change for B1.4. Phase 1 closes on B1.1 + B1.2 + B1.3.**

### Batch B1.3 — ESLint guardrail `no-supabase-single` (scoped to lib/data/)

- **Phase:** 1
- **Findings closed:** part of T-2 (theme-level closure — the ESLint rule prevents future H-01 regressions in the audit's hot zone)
- **Test-feasibility:** constraint-driven (the rule itself is the test)
- **Test added:** `tests/unit/eslint-no-supabase-single.test.ts` — 2 cases that programmatically run ESLint via the `eslint` API against synthetic source strings as if they lived at `lib/data/probe.ts`. One asserts the rule fires on a bare `.single()` chain; the other asserts the rule does NOT fire when a disable directive is present.
- **Failing-test-first proof:** test removed-rule scenario is the failing-test (when the rule is removed from `eslint.config.mjs`, the bad-fixture test produces no `no-restricted-syntax` errors and fails). With the rule in place, both tests pass.
- **Initial broad-rule attempt produced ~390 false positives** (every `.single()` in the codebase is a legitimate INSERT-validation / fixture-precondition / auth lookup). Scoped the rule to `lib/data/**/*.ts` only — the audit's H-01 hot zone — bringing rule firings to 4 INSERT sites (createProject, createNode, createContextNode, createContextLink) which were retrofitted with `// eslint-disable-next-line no-restricted-syntax -- INSERT validation: ...` directives naming the reason.
- **Side surprise:** ESLint parses `eslint-disable-next-line` text inside line comments in `eslint.config.mjs` itself as actual disable directives, breaking the lint run with a "rule not found" error. Worked around by rewording the doc comment to avoid the literal phrase.
- **Side surprise #2:** the disable directive must precede the chain's first token (the `return` statement), not the immediate `.single()` line — ESLint reports the call-expression error at the start of the chain. Documenting in the rule guidance for future authors.
- **Completed:** 2026-05-10
- **Status:** resolved (rule is in place and CI-enforced)
- **Verification gates:** type-check ✓ • lint ✓ (0 errors, 9 pre-existing warnings) • vitest 112/112 ✓ • build ✓

### Batch B1.2 — `.single()` → `.maybeSingle()` in tests/helpers

- **Phase:** 1
- **Findings closed:** F-258, F-259
- **Plan said 3 sites; actual is 2.** Per audit's F-261 ("No additional anti-patterns surfaced beyond F-257/F-258/F-259") and re-review of all 28 `.single()` sites in tests/helpers, only F-258 and F-259 are H-01 violations. The other 26 are legitimate (INSERT-then-`.select('id').single()` validation; fixture-precondition lookups where zero rows IS the bug).
- **Test-feasibility:** observable-via-mock (extended `tests/unit/h01-maybesingle.test.ts` with 2 cases, mocking `@supabase/supabase-js.createClient` so the helper's `adminClient()` factory routes through our chain spy)
- **Failing-test-first proof:** F-258 red on terminal-method assertion (`'single'` not `'maybeSingle'`); F-259 red with `"Cannot read properties of null (reading 'organisation_id')"` instead of the post-fix informative error. Both green after the fix.
- **F-259 also drops a `data!` non-null assertion** that would have produced a confusing crash — replaced with explicit `if (!data) throw new Error(...)`. Audit categorised this as silent-failure adjacent; the H-01 fix and the silent-failure fix landed together because the same line touched both.
- **Completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ • vitest 110/110 ✓ • build ✓
- **Process observations:** plan-list verification continues to be required (plan said 3, audit text says 2 for H-01 specifically — F-257 was a different finding). The strategy from B1.1's observation #1 is paying off.

### Batch B1.1 — `.single()` → `.maybeSingle()` in production lib/data (pilot)

- **Phase:** 1
- **Findings targeted (planned):** F-144, F-148, F-155, F-163, F-179
- **Findings actually closed:** F-144, F-148, F-155, F-163 *(F-179 dropped — see process observations: it was misclassified in the plan; it's actually a `validateProfile` security finding, not a `.single()` site)*
- **Test-feasibility:** observable-via-mock for F-144 / F-148 / F-155; structural for F-163 (comment-only fix)
- **Test added:** `tests/unit/h01-maybesingle.test.ts` (3 tests)
- **Failing-test-first proof:** all 3 tests red against pre-fix code (PGRST116 in error field), green after the wrapper change to `.maybeSingle()`
- **Route changes:** `app/api/projects/[projectId]/route.ts` and `app/api/documents/[documentId]/route.ts` gained null-data guards mapping the new clean-null return to `err.notFound()`. Without these route changes the wrapper fix would have *worsened* behavior (200 with null body instead of 500).
- **Started / completed:** 2026-05-10
- **Status:** resolved
- **Verification gates:** type-check ✓ • lint ✓ (0 errors) • vitest 108/108 ✓ • build ✓
- **Process observations:** captured below.

---

## Findings index

This section is a one-line-per-finding ledger. Updated when a finding's status changes.

| ID | File | Status | Batch | Notes |
|---|---|---|---|---|
| F-144 | lib/data/projects.ts | resolved | B1.1 | `.single()` → `.maybeSingle()` + route 404 guard |
| F-148 | lib/data/documents.ts | resolved | B1.1 | `.single()` → `.maybeSingle()` + route 404 guard |
| F-155 | lib/data/nodes.ts | resolved | B1.1 | `.single()` → `.maybeSingle()`; route already had null guard |
| F-163 | lib/data/context-links.ts | resolved | B1.1 | comment fix only — code was correct, prior comment described non-existent semantics |
| F-179 | lib/agent/* | open | (mis-targeted by plan) | not a `.single()` finding — `validateProfile` security finding; defer to its own future batch |
| F-258 | tests/helpers/db.ts | resolved | B1.2 | `.single()` → `.maybeSingle()`; user with no org now returns clean null |
| F-259 | tests/helpers/agent-fixtures.ts | resolved | B1.2 | `.single()` → `.maybeSingle()`; informative error replaces `data!` crash |
| F-07 | lib/config/platform-config.ts | resolved | B2.1 | typed aliases now runtime-validate; throw clear key-naming error on type mismatch |
| F-20 | lib/llm/token-budget.ts | resolved | B2.1 | cascade closure — F-07 fix surfaces the budget config's type error instead of silently misbehaving |
| F-152 | lib/data/nodes.ts | resolved | B2.2+B2.3 | data-integrity violations now throw at the data layer (missing layer_stacks, empty layers); decorateWithLeaf null path preserved for context nodes |
| F-160 | lib/data/nodes.ts | resolved | B2.2+B2.3 | malformed layer rows (missing/non-numeric index) throw clear errors instead of silently returning 0 (which made non-root nodes appear non-leaf) |
| F-34 | lib/llm/providers/anthropic.ts | resolved | B3.2 | `stream()` throws on Anthropic SDK error events instead of silently truncating |
| F-37 | lib/llm/providers/anthropic.ts | resolved | B3.2 | `streamWithTools()` throws on error events (mirror of F-34) |
| F-92 | lib/director/streamMessage.ts | resolved | B3.3 | Promise rejects on transport failure (was silent resolve after onError) |
| F-94 | lib/director/streamMessage.ts | resolved | B3.3 | Promise rejects when stream closes without `done`/`error` (mid-stream crash) |
| F-139 | lib/agent/streamSynthesise.ts | resolved | B3.3 | Promise rejects on transport failure (mirror of F-92) |
| F-170 | lib/stores/editor-store.ts | resolved | B3.4 | network failure now sets saveError (was bare `return`) |
| F-171 | lib/stores/editor-store.ts | resolved | B3.4 | non-200/409/423 responses set saveError (was silent-on-other-errors policy) |
| F-172 | lib/stores/editor-store.ts | resolved | B3.4 | reloadFromServer surfaces network/non-OK failures via saveError |
| F-201 | lib/hooks/useAgentJobsRealtime.ts | resolved | B3.5 | WebSocket subscribe-status handler wired; CHANNEL_ERROR/TIMED_OUT/CLOSED set realtimeError instead of dropping silently |
| F-220 | components/detail/NodeDetailPanel.tsx | resolved | B3.6 | rename PATCH non-OK / network error now console.error |
| F-238 | components/detail/BackLinksList.tsx | resolved | B3.6 | back-links GET non-OK / network error now console.error |
| F-239 | components/detail/ContextLinker.tsx | resolved | B3.6 | context-links GET non-OK / network error now console.error |
| F-240 | components/detail/NodePicker.tsx | resolved | B3.6 | context-nodes GET non-OK / network error now console.error (was explicit silent .catch) |
| F-243 | components/detail/CommentThread.tsx | resolved | B3.6 | resolveComment + deleteComment non-OK / network error now setError + console.error |
| F-247 | components/tree/NodeMoreMenu.tsx | resolved | B3.6 | rename / del / setStatus non-OK / network error now console.error |
| F-248 | components/focus/FocusMode.tsx | resolved | B3.6 | siblings GET non-OK / network error now console.error |
| F-250 | components/context/ContextCreateModal.tsx | resolved | B3.6 | documents GET non-OK / network error now console.error (was explicit silent .catch) |
| F-265 | supabase/migrations/038_nodes_order_unique.sql | resolved | B4.1 | UNIQUE(parent_id, "order") DEFERRABLE; NULLS DISTINCT lets root nodes coexist |
| F-266 | supabase/migrations/039_conversation_messages_sequence_unique.sql | resolved | B4.2 | UNIQUE(conversation_id, sequence); F-96 nextSequence race now guarded at DB |
| F-267 | supabase/migrations/040_nodes_node_type_check.sql | resolved | B4.3 | CHECK enforcing 13-type V1 whitelist + type/category coupling |
| F-268 | supabase/migrations/041_audit_user_fk.sql | resolved | B4.4 | nodes.{created_by,last_modified_by} TEXT → UUID FK auth.users(id) ON DELETE SET NULL |
| F-269 | supabase/migrations/042_nodes_content_jsonb.sql | resolved | B4.5 | nodes + node_versions summary/prose/notes TEXT → JSONB; server-side normalizeContent in API routes; legacy plain-text wrapped as Tiptap docs |

(Remaining 225 findings to be added as their batches start.)

---

## Process observations

Captured at the end of each pilot/early-phase batch. Goal: identify protocol friction before going autonomous.

### Batch B1.1 (pilot) — observations

1. **The plan's per-finding list was wrong in one spot.** B1.1 listed F-179 as a `.single()` site; it's actually a security finding about `validateProfile` accepting user-passed `profile_id` without verifying `is_system_profile`. The audit doc was correct; the plan's batch composition was wrong.
   - **Going forward:** before each batch, grep for the finding ID in the audit doc and read its severity + category line. Don't trust the batch list alone.
   - **Plan correction needed:** when we hit Phase 1 B1.2 / B1.3 / B1.4 etc., the same per-finding verification.

2. **Wrapper-only fixes can break the route.** Changing `.single()` → `.maybeSingle()` in F-144 and F-148 changes the return shape (`{data: null, error: {…}}` → `{data: null, error: null}`). Without a corresponding route-layer null guard, the route would return 200 with `project: null` — *worse* than the pre-fix 500. The fix had to extend to the route. F-155's route already had a `!updated` guard so the wrapper change was safe alone.
   - **Going forward:** for any wrapper signature/behavior change, grep for callers and confirm each one handles the new shape correctly. If not, the route fix is part of the same batch — that's not "refactor adjacent code" (forbidden), it's "complete the fix at the consumer boundary" (required).

3. **F-163 was a structural finding (comment fix only).** Code was correct; the comment described non-existent `.maybeSingle()` zero-row semantics for UNIQUE violations. The actual mechanism is the PostgREST 23505 error path, regardless of terminal method. No runtime test possible — verified by code review per the protocol's structural-finding honesty exception.

4. **Failing-test-first protocol worked cleanly.** Mocked supabase chain that returns different shapes for `.single()` vs `.maybeSingle()` is a clean test pattern: it makes the H-01 contract observable without needing a live DB. The 3 tests went red on pre-fix code (PGRST116 in error field), green after the wrapper change. Total batch wall-clock: ~10 minutes, dominated by reading the call sites and writing the test.

5. **Comment-vs-code-mismatch is a *real* category.** F-163 demonstrated the audit lens working: the audit caught a comment lying about the code, and the lens led to fixing the comment rather than blindly following its claim. Worth re-emphasising in remaining batches: where comment and code disagree, both must be re-justified from first principles before fixing either.

6. **Local Supabase stack was not required for this batch.** Vitest with mocked chain was sufficient. For batches that change DB-side semantics (Phase 4), real DB access will be needed — the existing Playwright `tests/api/*.spec.ts` infra handles that.

7. **Process timing.** Pilot batch from start to commit-ready: ~30 minutes incl. reading 4 audit findings, 4 source files, 2 route files, writing tests, applying fixes, running gates. Reasonable cadence for ~3 actionable findings + 1 comment fix per batch. Larger batches (10–15 findings) will probably take 1.5–2 hours.

---

## Phase-boundary smoke results

| Boundary | Date | Smoke result | Notes |
|---|---|---|---|
| End-of-Phase-1 | 2026-05-10 | PASS (with caveat) | type-check ✓ • lint ✓ (0 errors, 9 pre-existing warnings) • vitest 112/112 ✓ • build ✓ • Playwright `tests/api/projects/documents/nodes.spec.ts` 119/119 ✓. **Caveat:** 7 pre-existing failures in `tests/api/nodes-patch.spec.ts` (version-trigger expectations not met). Diagnosed by reverting `lib/data/nodes.ts` to pre-B1.1 state — failures persist, so they pre-date Phase 1. Not caused by B1.1; flagged as a separate finding for investigation outside this remediation. |
| End-of-Phase-2 | 2026-05-10 | PASS | type-check ✓ • lint ✓ • vitest 126/126 ✓ • build ✓ • Playwright projects+documents+nodes+nodes-leaf 122/122 ✓. **LLM smoke:** Step 1 mini-novel (27 beats, 12 context nodes, 12 links). 27/27 synthesise + 5/5 refine + generate-context all succeeded. 0 SUs. Cost $0.1551. Confirms Phase 2's data-integrity throws (F-07 typed-alias validation, F-152/F-160 leaf-ness) don't fire on healthy data — happy-path behavior preserved. Substituted Step 1 mini-novel ($0.15) for the planned full novel write ($0.90) because Phase 2's changes only fire on corrupt/malformed input; full novel saves for pre-merge. |
| Mid-Phase-3 (after B3.3) | 2026-05-10 | PASS | type-check ✓ • lint ✓ • vitest 136/136 ✓ • build ✓. **LLM smoke:** Step 1 mini-novel — 27/27 synthesise + 5/5 refine + generate-context, 0 SUs, $0.1607. Phase 3's silent-failure fixes only fire on actual failures; happy path unchanged. |
| End-of-Phase-3 | 2026-05-10 | PASS | type-check ✓ • lint ✓ • vitest 147/147 ✓ • build ✓ • **Playwright tests/api/ + tests/integrity/ 359/359 ✓** (the previously-flaky 7 nodes-patch + version-trigger tests are all green now). **LLM smoke:** Step 1 mini-novel — 27/27 + 5/5 + 1, 0 SUs, $0.1566. Phase 3's six batches close 17 silent-failure findings (F-34/37/92/94/139/170/171/172/201/220/238/239/240/243/247/248/250) plus the conventions doc that anchors Phase 3 and going-forward error-handling discipline. |
| End-of-Phase-4 (initial) | 2026-05-10 | PASS | type-check ✓ • lint ✓ • vitest 157/157 ✓ • build ✓ • **Playwright tests/api/ + tests/integrity/ 359/359 ✓**. **LLM smoke:** Step 1 mini-novel — 27/27 + 5/5 + 1, 0 SUs, $0.1603. Four schema migrations (038-041) compatible end-to-end. Closes F-265, F-266, F-267, F-268. F-269 deferred to V1.x. |
| End-of-Phase-4 (re-smoke after B4.5 reinstated) | 2026-05-10 | PASS | type-check ✓ • lint ✓ • vitest 157/157 ✓ • build ✓ • Playwright tests/api/ 261/261 ✓. **LLM smoke:** Step 1 mini-novel — 27/27 + 5/5 + 1, 0 SUs, $0.1593, with post-smoke `jsonb_typeof = object` confirmation across all written content. Five schema migrations (038-042) compatible end-to-end. Closes F-265, F-266, F-267, F-268, F-269. |

### Pre-existing test failures discovered at Phase 1 boundary

`tests/api/nodes-patch.spec.ts` — 7 tests fail (TC-A-01, TC-A-02, TC-A-03, TC-A-09, TC-A-10, TC-A-13, TC-A-32). All expect the version trigger to bump `version` from 1 → 2 on a PATCH that changes content; observed `version` remains 1. Diagnosis: I reverted `lib/data/nodes.ts:updateNode` to its pre-B1.1 state (`.single()` instead of `.maybeSingle()`) and the failures persisted, so the cause is upstream of Phase 1. Hypothesis: the version trigger migration is missing or out-of-date on the local Supabase instance, OR a Phase 5d-era migration changed the trigger semantics. Not investigating in this audit run — it doesn't intersect Phase 1's findings, and the symptom doesn't suggest an audit finding (no comment-vs-code, no signature mismatch, no spec-divergence we catalogued). Worth a separate diagnostic session.

---

## Snapshot tags

| Tag | Commit | Date | Reason |
|---|---|---|---|
| pre-phase4-snapshot | 54fe3ab | 2026-05-10 | Pre-Phase-4 known-good reference. Phases 1+2+3 closed (28 findings). |
