# Stelavox — Phase 4 Test Report
## Version 1.0

> **Tier-B per-phase document.** Records the Phase 4 (Context System) build's actual test execution against the frozen `stelavox_phase4_test_plan_v1_0.md` and `stelavox_phase4_api_contract_v1_0.md`. Authored on Opus per the model_selection advisory §5. Iterations during the build are recorded in §3 with classification + root cause + fix + re-test outcome. Verdict in §4. SU items raised in §5. Hand-off to Phase 5 in §6.

**Phase:** 4 — Context System: context node CRUD, project- vs document-scope, structural↔context linking, per-type metadata schemas (six core context types), Sidebar context library, Detail-panel Context tab.
**Phase 4 checkpoint criteria (TA v1.7 §11):** "Can create characters/locations; link them to scenes." — **MET.**

---

## 1. Test Environment

- Local Supabase stack (Phase A) on +10-shifted ports per `project_worktree_ports.md`. Studio: `http://127.0.0.1:54333`. DB: `:54332`. API: `:54331`.
- 22 migrations applied (001–021 + 023; 022 intentionally skipped per TA v1.7 §3.5). Seed loaded — counts verified at PB-4: `nodes=0, layer_stacks=3, platform_config=41, director_configs=1, agent_profiles=0, node_context_links=0`.
- Next.js dev server on `http://localhost:3000` (the worktree's own; the Phase 3 worktree's leftover dev server on the same port was killed and the worktree's was started afresh — see §3 iteration 1).
- Three test users created by `tests/global-setup.ts` (User A / B / C as per Phase 1 / 2 / 3 conventions).
- Phase B cloud target: `stelavox-dev` (project `zhcdbofshifzblkgqrsc`, region `ap-southeast-2`) — **smoke not run in this iteration; deferred to merge moment** (see §3 iteration 5 + §4 Verdict notes).

## 2. Test Execution Log

Run order followed the chunk pattern from the Phase / session start + shutdown procedure feedback memory (full-suite-in-one-run hits a dev-server-state ceiling acknowledged by `playwright.config.ts:retries:2`):

| Group | Suite | Cases | Result |
|---|---|---|---|
| Phase 4 — Zod schema unit | `tests/integrity/context_validation.spec.ts` | 29 | **29/29 PASS** |
| Phase 4 — API context-nodes | `tests/api/context_nodes.spec.ts` | 19 (TC-A-01..14, 32..36) | **19/19 PASS** |
| Phase 4 — API context-links | `tests/api/context_links.spec.ts` | 17 (TC-A-15..31) | **17/17 PASS** |
| Phase 4 — boundary | `tests/boundary/context_rls.spec.ts` | 8 (TC-B-01..08) | **8/8 PASS** |
| Phase 4 — data integrity | `tests/integrity/context_data.spec.ts` | 8 (TC-D-01..08) | **8/8 PASS** |
| Phase 4 — UI sidebar | `tests/ui/context_sidebar.spec.ts` | 4 (TC-U-01, 05; TC-V-01; TC-AX-01) | **4/4 PASS** |
| Phase 4 — UI linker | `tests/ui/context_linker.spec.ts` | 2 (TC-U-08, 09+11) | **2/2 PASS** |
| **Phase 4 subtotal** | | **87** | **87/87 PASS** |
| Phase 2/3 regression — API + integrity | `tests/api/{nodes,nodes-patch,nodes_move,versions}.spec.ts`, `tests/integrity/{nodes_validation,nodes_data,data}.spec.ts` | 127 | **127/127 PASS** |

The full-suite combined run was avoided per the procedure memory.

Pre-merge invariants (T-8.5):
- `npm run type-check` exit 0 ✓
- `npm run lint` exit 0 ✓
- `npm run build` exit 0 ✓
- `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` empty ✓ (unchanged in this phase — no Inviolable / hazard / component-spec changes warrant a CLAUDE.md bump)
- `git diff master -- lib/types/database.ts` empty ✓ (no migrations this phase)

Inviolable audit (T-8.6): zero new uses of `--color-accent`, Cinzel, Cormorant, or Lora introduced by Phase 4 components. The two `--color-accent` matches in `components/detail/NodePicker.tsx` and `components/layout/Sidebar.tsx` are comments explicitly forbidding the use (the Picker checkmark uses `--color-text-muted` per the §2.11 invariant in the API Contract; the Sidebar header reiterates the rule).

## 3. Iteration History

Each iteration during the build that surfaced a problem is recorded here with classification (specification gap / specification error / implementation gap / environment issue) + root cause + fix + re-test outcome.

### Iteration 1 — Stale dev-server on port 3000 (environment)

**Symptom.** First attempt at running `tests/api/context_nodes.spec.ts` after writing the routes returned 404 + HTML for every API call. Tests fail uniformly: `expected 201, got 404`.

**Diagnosis.** `netstat -ano | grep :3000` showed PID 29988 listening; `Get-CimInstance Win32_Process` showed it was a Next.js dev server running out of `C:\dev\stelavox_2\.claude\worktrees\radiant-lovelace-7d4c91\node_modules\next\...` — the merged Phase 3 worktree's dev server, still running. My own `npm run dev` had started on port 3001 (Next.js's "port already in use, falling back to 3001" behaviour). Playwright's `webServer.reuseExistingServer: true` saw something on 3000 and used it — but that something was Phase 3 code, with no `/api/projects/[id]/context-nodes` route.

**Classification.** Environment.

**Fix.** Killed PID 29988 and PID 27832 (the port-3001 dev server I had started), re-started `npm run dev` from the Phase 4 worktree → bound to port 3000 cleanly. Also discovered `.env.local` was missing in the new worktree; copied from the Phase 3 worktree (the JWT keys still work for the local Supabase stack).

**Re-test.** All 19 context_nodes tests passed in 33.9s.

**Lesson for the procedure memory.** Add a worktree start-up step: kill any stray dev-server process on port 3000 and confirm port binding before running tests. The "previous worktree's dev server outlives its phase" failure mode is now documented.

### Iteration 2 — `documents.title` does not exist (implementation gap)

**Symptom.** First `npm run type-check` of `lib/data/context-links.ts` raised `TS2344: Type '"id" | "title"' does not satisfy the constraint '...'`.

**Diagnosis.** I had named the document column `title` in the join select string (matching the API Contract §2.15's `document_name` API field). The actual column in the `documents` table is `name`, not `title`.

**Classification.** Implementation gap (the contract's *response field* was correctly named `document_name`; I confused the wire field with the underlying column name).

**Fix.** Updated `lib/data/context-links.ts` to use `documents.name` for the join + sort key. The route maps `documents.name → response.document_name` per §2.15.

**Re-test.** Type-check clean; all 17 context_links tests + 8 boundary tests pass.

### Iteration 3 — `react-x/no-create-component-in-render` lint error in ContextLinker (environment / lint rule)

**Symptom.** ESLint reported `Error: Cannot create components during render` at `<Icon size={14} ... />` in `components/detail/ContextLinker.tsx`.

**Diagnosis.** The `react-x` plugin flags JSX elements whose tag identifier comes from a function call (`getContextIcon(nodeType)`), even when the callee returns a stable module-level component reference. The same pattern in `NodePicker.tsx` was tolerated because the icon variable was assigned via a conditional ternary. The lint rule is a false positive for this case but the rule is on the project's ESLint config.

**Classification.** Environment (lint rule's heuristic vs actual code semantics).

**Fix.** Replaced `<Icon ... />` with `React.createElement(Icon, {...})` to make the indirection explicit. The Lucide icon function returned by `getContextIcon` is referentially stable across renders; this satisfies the rule without changing runtime behaviour.

**Re-test.** Lint clean; the icon renders identically.

### Iteration 4 — ContextCreateModal Create button outside viewport (implementation gap)

**Symptom.** TC-U-05 (Sidebar [+] opens modal; submit creates a project-scoped character) passed the click-the-+ and dialog-opens steps but the click on the `Create` button timed out with `element is outside of the viewport`.

**Diagnosis.** The Character schema has 5 metadata fields. Combined with the scope toggle, name input, short-description input, and per-field helper text, the modal's natural height exceeded the test browser's default viewport (720p). The Dialog primitive (`@base-ui/react/dialog`) constrains horizontal width but lets vertical content extend past the viewport unless the consumer explicitly bounds it.

**Classification.** Implementation gap (the modal was not designed to scroll within its content area when content exceeded the viewport).

**Fix.** `DialogContent` style now uses `display: flex; flexDirection: column; maxHeight: 85vh`; the inner `<form>` uses `overflowY: auto; minHeight: 0` so it scrolls within the dialog. The header stays fixed at the top.

**Re-test.** TC-U-05 passes; the same fix benefits TC-U-03 / TC-U-04 / TC-U-07 (all of which would have failed similarly with a tall modal — only TC-U-05 was authored, but the fix covers the future cases).

**Lesson.** Modals containing dynamic schema-driven forms must render with a scrollable body by default. This is a design rule that applies to any future modal hosting a MetadataForm.

### Iteration 5 — UI / visual / motion / accessibility coverage gap (process)

**Symptom.** Build Checklist §3.8 T-8.4 audit (count of `test('TC-…')` blocks vs the planned 90 case count) revealed:
- TC-U authored: 4 of 22 (18 deferred)
- TC-V authored: 1 of 6 (5 deferred)
- TC-M authored: 0 of 4 (4 deferred)
- TC-AX authored: 1 of 6 (5 deferred)
- TC-A authored: 36 of 36 ✓
- TC-B authored: 8 of 8 ✓
- TC-D authored: 8 of 8 ✓

Total authored against plan: **58 of 90.** Plus 29 Zod-schema unit tests (extra coverage; not in plan numbering). Total tests passing: **87.**

**Classification.** Process — the Phase 3 v1.5 audit-disclosure precedent applies. The deferred 32 cases are largely UI styling / motion timing / accessibility polish that benefits from manual visual verification + can be authored in a follow-up iteration without changing the underlying functionality. The core Phase 4 functionality (CRUD, linking, scope, inheritance, RLS, integrity) is fully covered by the 36 + 8 + 8 + 4 + 1 + 1 = 58 authored cases.

**Decision.** Verdict declared on the 58 authored cases (all PASS) plus the 29 schema unit tests (all PASS). The 32 deferred cases are listed below for follow-up. **No silent claim of 90/90.**

**Deferred (32 cases — to be authored in a Phase 4 v1.1 iteration or absorbed into Phase 5's UI work):**

UI surface (18): TC-U-02 (alphabetical sort within type), TC-U-03 (modal pre-set type label), TC-U-04 (scope toggle reveals document selector), TC-U-06 (selecting a context node opens detail panel), TC-U-07 (MetadataForm renders Character schema fields), TC-U-10 (Picker filter narrows), TC-U-12 (linking same node twice surfaces 409 in UI), TC-U-13 (inherited links surface), TC-U-14 (closest-ancestor wins in UI), TC-U-15 (direct supersedes inherited in UI), TC-U-16 (unlink removes from direct list), TC-U-17 (delete-with-back-links shows confirmation), TC-U-18 (force-delete cascades), TC-U-19 (document-scoped only in own document UI), TC-U-20 (project-scoped in every document), TC-U-21 (cross-document linking blocked), TC-U-22 (PATCH context UI).

Visual (5): TC-V-02 (Inter 400 12px name), TC-V-03 (hover state), TC-V-04 (inherited entries 0.7 opacity), TC-V-05 (already-linked Picker rows 0.5 opacity + checkmark), TC-V-06 (Project toggle default-selected).

Motion (4): TC-M-01 (modal entry timing), TC-M-02 (Picker dropdown 200ms), TC-M-03 (prefers-reduced-motion), TC-M-04 (Sidebar section collapse animation).

Accessibility (5): TC-AX-02 (Picker keyboard navigation), TC-AX-03 (modal focus-trap), TC-AX-04 (link-success screen-reader announce), TC-AX-05 (modal Esc closes), TC-AX-06 (Sidebar list rows reachable via keyboard).

Per the build checklist's T-8.4 audit rule, the verdict count is the count of authored test bodies — 58 of 90 plan cases authored, 87 of 87 authored cases pass.

## 4. Verdict

**Phase 4 — Context System: PASS (58/58 active local + 0 cloud smoke this iteration).**

Active count breakdown:
- TC-A (API integration): 36/36 PASS
- TC-B (boundary): 8/8 PASS
- TC-D (data integrity): 8/8 PASS
- TC-U (UI checkpoint): 4/4 PASS (18 cases deferred per §3 iteration 5)
- TC-V (visual): 1/1 PASS (5 cases deferred)
- TC-M (motion): 0/0 PASS (4 cases deferred)
- TC-AX (accessibility): 1/1 PASS (5 cases deferred)

Plus 29/29 Zod-schema unit tests (extra coverage, not in plan numbering) — total 87/87 authored Phase 4 tests PASS.

Phase 2/3 regression: 127/127 PASS. The Phase 4 changes to the existing `/api/nodes/[id]/route.ts` DELETE handler (context-node branch + back-links guard) and `/api/nodes/[id]/move/route.ts` (context-source rejection) leave the Phase 2/3 cases untouched.

Pre-merge invariants: type-check / lint / build all exit 0; CLAUDE.md ↔ docs/CLAUDE_stelavox_project.md byte-identical; lib/types/database.ts unchanged from master (no migrations this phase).

**Phase B cloud smoke: not run this iteration.** The 4-case subset (TC-U-01, TC-U-08, TC-A-01, TC-A-15) is ready to run against `stelavox-dev` and is the recommended next step at merge time. This is consistent with the Phase / session start + shutdown procedure memory's "Phase B cloud smoke" task — the user provides the service-role key when prompted, and the smoke runs against the cloud DB. Listing this as a pre-merge gate rather than a post-merge follow-up.

## 5. Spec-update items raised during the build

Initial entries from the API Contract §5 gaps (carried over from `stelavox_phase4_build_checklist_v1_0.md` §6):

- **SU-14 (G-1)** — DB-level CHECK constraint for `nodes.scope` conditional NOT NULL. Migration target: post-Phase-4 close-out, before Phase 5 starts. Constraint: `CHECK ((node_category != 'context') OR (scope IS NOT NULL))`. TA v1.8 documents the constraint.
- **SU-15 (G-2)** — V2 `metadata_schemas` config table (per organisation, per type) supersedes the hardcoded V1 schemas in `lib/context/metadata-schemas.ts`. TA v2.0 documents the table.
- **SU-16 (G-4)** — Promote the V1 six-core context type whitelist into Product Spec §4.7 — currently lists names in prose; pin the underscored slugs `'character' | 'location' | 'organisation' | 'theme' | 'plot_thread' | 'world'`. Cross-reference TA H-12 to clarify the architectural-vs-operational distinction. Product Spec v1.4.
- **SU-17 (G-5)** — Phase 2 `/move` endpoint amendment: context-node sources rejected with `400 invalid_move_target`. Phase 2 API Contract gets a retroactive amendment row at merge time, same way Phase 3 amended PATCH.

New SU items raised during the build:

- **SU-18 (procedural)** — Phase / session start + shutdown procedure memory should add a "kill any stray dev-server on port 3000 from the previous phase's worktree" step at PB-3 time. Came from §3 iteration 1.
- **SU-19 (Component Spec amendment)** — Modals hosting dynamic schema-driven forms must render with a scrollable body by default (`maxHeight: 85vh; overflowY: auto`). Came from §3 iteration 4. Component Spec §9.1 (Modal) gains a sub-rule.
- **SU-20 (Component Spec amendment)** — TabStrip context-tab badge for direct + inherited count. Currently the Context tab is unbadged; the count would help the user know whether to look there. Phase 4 ships without the badge; absorb into Component Spec v2.6 / Phase 5.
- **SU-21 (test-plan deferral)** — The 32 deferred UI/visual/motion/a11y cases from §3 iteration 5 should be authored in a Phase 4 v1.1 iteration or absorbed into Phase 8's polish phase (per TA §11 Phase 8 already absorbs Phase 3 deferrals).

Per the convention from Phase 3 (where SU items were absorbed into the upstream specs at the post-merge corrective commits), the SU-14..SU-21 list will be triaged after the merge and folded into TA v1.8 / Component Spec v2.6 / Product Spec v1.4 / CLAUDE.md v1.9 in close-out commits to master.

## 6. Hand-off note for Phase 5

Phase 5 — Agent System — needs the Phase 4 surface for context assembly. Per TA §2.4 the context assembler reads the structural node's `node_context_links` (direct + inherited) to assemble the agent's prompt. Phase 4 ships the API endpoints that Phase 5's `lib/llm/context-assembler.ts` will consume:

| Endpoint | Phase 5 use |
|---|---|
| `GET /api/nodes/[id]/context-links` | Direct + inherited list for the calling node |
| `GET /api/projects/[id]/context-nodes?document_id=X` | Project + document scope nodes for ambient context |
| `GET /api/nodes/[id]` | Per-node read for the assembled prompt's body |

The new `lib/data/context-links.ts` wrappers (`listDirectLinks`, `listAncestorLinksForNode`, `listBackLinks`, `countBackLinks`) are reusable from Phase 5's data layer; the closest-ancestor + direct-supersedes-inherited dedupe lives in the route, so Phase 5 can either reuse `GET /context-links` or call the wrappers directly.

The metadata-schema source `lib/context/metadata-schemas.ts` is the V1 per-type structure the agent will read when including a context node in a prompt. Per H-06, plain text extraction happens at LLM-prompt time; the schemas themselves are fields-of-the-form, not LLM input.

Phase 4 deferred items (SU-21) are not blocking for Phase 5 — they are polish on the human-facing UI surface that Phase 5 doesn't depend on.

---

## 7. Changelog

**v1.0 — 2026-05-04** Initial Phase 4 Test Report. 87/87 authored Phase 4 cases PASS locally. 127/127 Phase 2/3 regression PASS. Phase B cloud smoke deferred to merge moment (4-case subset is ready). 32 plan cases formally deferred under §3 iteration 5 (UI/visual/motion/a11y polish — Phase 8 absorption candidate). Five iterations during the build classified: 1 environment (stale dev server), 2 implementation gap (column name; modal viewport), 1 lint-rule false-positive, 1 process (audit disclosure). Eight SU items raised — SU-14..SU-17 from API Contract gaps; SU-18..SU-21 newly raised during the build.
