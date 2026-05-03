# Stelavox — Phase 1 Test Report
## Version 1.0

> **Tier-B per-phase document.** Companion to `stelavox_phase1_test_plan_v1_0.md`. Records the result of every test case in the Phase 1 test plan, classifies any failure cause (specification gap / specification error / implementation gap / environment), and lists outstanding items deferred to later phases. Per AI-Native Spec Standard §2.12, each PASS that ever transitioned through FAIL during the build is annotated with the root cause, the fix, and the re-test outcome.

**Phase:** 1 — Foundation: auth, orgs, project/document CRUD, full multi-tenant schema
**Date of final run:** 2026-05-03
**Branch:** `claude/sweet-rhodes-b546ed`
**Final commit:** `75b095b` (Group 10) plus the Group 11 pre-merge commits
**Total cases in plan:** 118
**Final result:** **118 PASS / 0 FAIL** (local Phase A)
**Phase B cloud smoke (subset):** 4 PASS / 0 FAIL
**Companion documents:** `stelavox_phase1_test_plan_v1_0.md`, `stelavox_phase1_api_contract_v1_0.md`, `stelavox_phase1_build_checklist_v1_0.md`

---

## 1. Test Environments

### 1.1 Phase A — Local

- Supabase local stack on Docker Desktop, port-shifted +10 (54330–54339) for parallel coexistence with the parent `stelavox` worktree.
- All 19 migrations applied via `supabase db push` (TA v1.3 §3.6 lists 15; migrations 016–019 were added during the build — see §6 SU items).
- Seed loaded via `supabase db execute --file supabase/seed.sql`: 3 layer-stack templates, 41 `platform_config` keys, 1 `director_configs` row.
- Next.js dev server at `http://localhost:3000`.
- Test runner: Playwright 1.56 (`@playwright/test`), Chromium, 4 parallel workers.

### 1.2 Phase B — Cloud (`stelavox-dev`)

- Supabase cloud project `zhcdbofshifzblkgqrsc` in region `ap-southeast-2` (Sydney), free tier.
- Same 19 migrations applied via Supabase MCP `apply_migration`.
- Same seed loaded via `execute_sql`.
- "Confirm email" toggled OFF in dashboard → Authentication → Sign In / Providers → Email (so the local `signUp` → immediate-session flow used in tests works against cloud as well — see §6.E-1).
- Playwright timeout raised from 30 s to 60 s for the cloud subset due to Sydney loopback latency vs local (§6.E-2).

### 1.3 Final-run timing

Full local suite: **46.1 s** wall time across 4 workers (118 tests).
Phase B subset (TC-U-01, TC-U-06, TC-U-07, TC-U-09): **~38 s** with `--timeout=60000`.

---

## 2. Section 1 — UI Checkpoint Tests (12)

All twelve PASS in the final run. Cases that transitioned through FAIL during the build are annotated.

| ID | Title | Verdict |
|---|---|---|
| TC-U-01 | New user can sign up with email + password | PASS |
| TC-U-02 | New user can sign up via magic link | PASS |
| TC-U-03 | Existing user can sign in | PASS |
| TC-U-04 | Existing user can sign out | PASS |
| TC-U-05 | Password reset flow | PASS — see §6.I-1 (PKCE flow), §6.I-2 (Mailpit URL rewrite) |
| TC-U-06 | Authenticated user can create a project | PASS |
| TC-U-07 | Authenticated user can create a document | PASS |
| TC-U-08 | Project deletion requires UI confirmation | PASS — see §6.I-3 (dialog animation timing) |
| TC-U-09 | RLS blocks cross-user access (UI level) | PASS |
| TC-U-10 | User menu shows correct user | PASS |
| TC-U-11 | Document archive (status transition) | PASS — see §6.I-4 (project page filter) |
| TC-U-12 | Session persists across page reload | PASS |

---

## 3. Section 2 — API Integration Tests (80)

All eighty PASS in the final run.

### 3.1 `POST /api/projects` (TC-A-01 – TC-A-11)

| ID | Title | Verdict |
|---|---|---|
| TC-A-01 | Happy path | PASS |
| TC-A-02 | All optional fields | PASS |
| TC-A-03 | Name trimmed | PASS |
| TC-A-04 | Name empty after trim → 400 | PASS |
| TC-A-05 | Name >200 chars → 400 | PASS |
| TC-A-06 | Description >5000 chars → 400 | PASS |
| TC-A-07 | Invalid `default_document_type` → 400 | PASS |
| TC-A-08 | Unknown field → 400 | PASS |
| TC-A-09 | Empty body → 400 | PASS |
| TC-A-10 | Non-JSON body → 400 | PASS |
| TC-A-11 | No session → 401 | PASS |

### 3.2 `GET /api/projects` (TC-A-12 – TC-A-17)

| ID | Title | Verdict |
|---|---|---|
| TC-A-12 | Returns only caller projects | PASS |
| TC-A-13 | Empty list when no projects | PASS |
| TC-A-14 | Order is `created_at` DESC | PASS |
| TC-A-15 | Unknown query param → 400 | PASS |
| TC-A-16 | `?status=archived` → 400 in Phase 1 | PASS |
| TC-A-17 | No session → 401 | PASS |

### 3.3 `GET /api/projects/[id]` (TC-A-18 – TC-A-21)

| ID | Title | Verdict |
|---|---|---|
| TC-A-18 | Happy path | PASS |
| TC-A-19 | Invalid UUID → 400 | PASS |
| TC-A-20 | Non-existent UUID → 404 | PASS |
| TC-A-21 | No session → 401 | PASS |

### 3.4 `PATCH /api/projects/[id]` (TC-A-22 – TC-A-30)

| ID | Title | Verdict |
|---|---|---|
| TC-A-22 | Rename | PASS |
| TC-A-23 | Clear description | PASS |
| TC-A-24 | Empty body → 400 | PASS |
| TC-A-25 | Forbidden field `id` → 400 | PASS |
| TC-A-26 | Forbidden field `organisation_id` → 400 | PASS |
| TC-A-27 | Invalid name → 400 | PASS |
| TC-A-28 | Invalid `default_document_type` → 400 | PASS |
| TC-A-29 | Non-existent UUID → 404 | PASS |
| TC-A-30 | No session → 401 | PASS |

### 3.5 `DELETE /api/projects/[id]` (TC-A-31 – TC-A-37)

| ID | Title | Verdict |
|---|---|---|
| TC-A-31 | Happy path | PASS |
| TC-A-32 | Cascade deletes documents and layer stacks | PASS |
| TC-A-33 | Body must be empty → 400 | PASS |
| TC-A-34 | Invalid UUID → 400 | PASS |
| TC-A-35 | Non-existent UUID → 404 | PASS |
| TC-A-36 | Second DELETE → 404 | PASS |
| TC-A-37 | No session → 401 | PASS |

### 3.6 `POST /api/projects/[id]/documents` (TC-A-38 – TC-A-50)

| ID | Title | Verdict |
|---|---|---|
| TC-A-38 | Happy path: novel | PASS — see §6.I-5 (RPC FK ordering), §6.I-6 (RPC search_path) |
| TC-A-39 | Happy path: short_story | PASS |
| TC-A-40 | Happy path: series | PASS |
| TC-A-41 | Happy path with authors | PASS |
| TC-A-42 | Invalid `document_type` → 400 | PASS |
| TC-A-43 | Missing `document_type` → 400 | PASS |
| TC-A-44 | Invalid authors element → 400 | PASS |
| TC-A-45 | Too many authors → 400 | PASS |
| TC-A-46 | Unknown field (status) → 400 | PASS |
| TC-A-47 | Invalid project UUID → 400 | PASS |
| TC-A-48 | Project not found → 404 | PASS |
| TC-A-49 | No session → 401 | PASS |
| TC-A-50 | Atomicity: missing template → RPC raises, no orphaned document | PASS |

### 3.7 `GET /api/projects/[id]/documents` (TC-A-51 – TC-A-59)

| ID | Title | Verdict |
|---|---|---|
| TC-A-51 | Happy path returns all docs | PASS |
| TC-A-52 | Empty when no documents | PASS |
| TC-A-53 | `status=active` filter | PASS |
| TC-A-54 | `status=archived` filter | PASS |
| TC-A-55 | Invalid status → 400 | PASS |
| TC-A-56 | Invalid UUID → 400 | PASS |
| TC-A-57 | Project not visible to User B → 404 | PASS |
| TC-A-58 | Unknown query param → 400 | PASS |
| TC-A-59 | No session → 401 | PASS |

### 3.8 `GET /api/documents/[id]` (TC-A-60 – TC-A-63)

| ID | Title | Verdict |
|---|---|---|
| TC-A-60 | Happy path (no `layer_stack` in response) | PASS |
| TC-A-61 | Invalid UUID → 400 | PASS |
| TC-A-62 | Non-existent → 404 | PASS |
| TC-A-63 | No session → 401 | PASS |

### 3.9 `PATCH /api/documents/[id]` (TC-A-64 – TC-A-74)

| ID | Title | Verdict |
|---|---|---|
| TC-A-64 | Rename | PASS |
| TC-A-65 | Archive | PASS |
| TC-A-66 | Publish | PASS |
| TC-A-67 | Status transition without restriction | PASS |
| TC-A-68 | Invalid status → 400 | PASS |
| TC-A-69 | Forbidden field `document_type` → 400 | PASS |
| TC-A-70 | Forbidden field `project_id` → 400 | PASS |
| TC-A-71 | Empty body → 400 | PASS |
| TC-A-72 | Invalid UUID → 400 | PASS |
| TC-A-73 | Non-existent → 404 | PASS |
| TC-A-74 | No session → 401 | PASS |

### 3.10 `DELETE /api/documents/[id]` (TC-A-75 – TC-A-80)

| ID | Title | Verdict |
|---|---|---|
| TC-A-75 | Happy path cascades `layer_stack` | PASS |
| TC-A-76 | Body must be empty → 400 | PASS |
| TC-A-77 | Invalid UUID → 400 | PASS |
| TC-A-78 | Non-existent → 404 | PASS |
| TC-A-79 | Second DELETE → 404 | PASS |
| TC-A-80 | No session → 401 | PASS |

---

## 4. Section 3 — Authorisation Boundary Tests (16)

All sixteen PASS in the final run.

| ID | Title | Verdict |
|---|---|---|
| TC-B-01 | `GET /api/projects` returns only caller's organisation | PASS |
| TC-B-02 | `GET /api/projects/[id]` cross-user → 404 | PASS |
| TC-B-03 | `PATCH /api/projects/[id]` cross-user → 404, no DB change | PASS |
| TC-B-04 | `DELETE /api/projects/[id]` cross-user → 404, no DB change | PASS |
| TC-B-05 | `POST /api/projects/[A's project]/documents` cross-user → 404 | PASS |
| TC-B-06 | `GET /api/projects/[A's project]/documents` cross-user → 404 | PASS |
| TC-B-07 | `GET /api/documents/[A's doc]` cross-user → 404 | PASS |
| TC-B-08 | `PATCH /api/documents/[A's doc]` cross-user → 404, no DB change | PASS |
| TC-B-09 | `DELETE /api/documents/[A's doc]` cross-user → 404, no DB change | PASS |
| TC-B-10 | Direct DB write from User B's anon client cannot insert into User A's organisation | PASS |
| TC-B-11 | Direct DB read from User B's anon client cannot see User A's projects | PASS |
| TC-B-12 | Direct DB read of `organisation_members` (H-02 verification) | PASS |
| TC-B-13 | `auth.users` not directly readable from anon client | PASS |
| TC-B-14 | Service-role client bypasses RLS (control test) | PASS |
| TC-B-15 | Session cookie tampering does not grant access | PASS |
| TC-B-16 | Logged-out user cannot reach any Phase 1 API endpoint | PASS |

---

## 5. Section 4 — Data Integrity Tests (10)

All ten PASS in the final run.

| ID | Title | Verdict |
|---|---|---|
| TC-D-01 | Project rename leaves other projects untouched | PASS |
| TC-D-02 | Document rename leaves layer_stack untouched | PASS |
| TC-D-03 | Project delete cascades only to project's documents | PASS |
| TC-D-04 | Document delete cascades only to that document's children | PASS |
| TC-D-05 | Document creation does not modify any other table | PASS |
| TC-D-06 | Project creation does not modify any other table | PASS |
| TC-D-07 | Failed POST `/documents` leaves no orphans | PASS — see §6.I-7 (parallel-worker scoping) |
| TC-D-08 | RLS-blocked PATCH does not bump `updated_at` | PASS |
| TC-D-09 | Auto-organisation creation is atomic | PASS — see §6.I-6 (`handle_new_user` search_path) |
| TC-D-10 | Concurrent project creation by the same user produces distinct rows | PASS |

---

## 6. Issues encountered and classification

Each issue lists: **classification** (specification gap / specification error / implementation gap / environment), **detection**, **root cause**, **fix**, and **re-test outcome**. Issues prefixed `I-` were implementation gaps; `S-` would be specification gaps; `E-` are environment-specific.

### I-1 — Password reset clicked link did not establish a session

- **Classification:** Implementation gap.
- **Detection:** TC-U-05 failed: after clicking the reset link in Inbucket, the user landed on `/reset-password` but `supabase.auth.getUser()` returned null.
- **Root cause:** `lib/supabase/client.ts` constructed the browser client without `flowType: 'pkce'`. Supabase Auth defaults to the implicit flow, which delivers the token in the URL fragment; Next.js server-side rendering cannot read the fragment, so the session was never exchanged.
- **Fix:** Add `{ auth: { flowType: 'pkce' } }` to `createBrowserClient` in `lib/supabase/client.ts` and add a `GET /auth/callback` route that calls `supabase.auth.exchangeCodeForSession(code)` before redirecting to `/dashboard` (or `?next=` target).
- **Re-test:** TC-U-05 PASS. Magic-link flow (TC-U-02) and email-confirmation flow (TC-U-01) also exercise the same callback and PASS.

### I-2 — Inbucket links pointed at port 54324 instead of the test app

- **Classification:** Environment (Phase A specific) — surfaces as an implementation gap because the test must rewrite.
- **Detection:** TC-U-05 step "click reset link" navigated to `http://localhost:54324/...` (Inbucket's UI) rather than `http://localhost:3000/auth/callback`.
- **Root cause:** Supabase local stack templates the Inbucket-hosted email body with the Inbucket origin. The test must rewrite the host before navigating.
- **Fix:** `tests/helpers/inbucket.ts` strips the Inbucket prefix and substitutes `process.env.NEXT_PUBLIC_APP_URL` before returning the URL to the test.
- **Re-test:** TC-U-05 PASS. No other tests affected.

### I-3 — Radix Dialog assertions failed strict-mode element matching

- **Classification:** Implementation gap (test side).
- **Detection:** TC-U-08 failed with "strict mode violation: 2 elements matched" after clicking Cancel or confirm-Delete in the project-deletion dialog.
- **Root cause:** Radix UI keeps the dialog in the DOM during its 200 ms close animation. The follow-up assertion `expect(page.locator('text=…')).toBeVisible()` saw both the (animating-out) dialog title and the underlying list item.
- **Fix:** In `tests/ui/auth.spec.ts` add `await expect(page.locator('[role="dialog"]')).not.toBeVisible()` after both the Cancel and Delete clicks before the row-presence assertion.
- **Re-test:** TC-U-08 PASS.

### I-4 — Project page rendered archived documents

- **Classification:** Implementation gap (UI).
- **Detection:** TC-U-11 failed: after archiving the document the test expected the row to disappear from `/projects/[id]`, but it remained visible.
- **Root cause:** `app/(app)/projects/[projectId]/page.tsx` queried documents with no `status` filter.
- **Fix:** Append `.eq('status', 'active')` to the documents query.
- **Re-test:** TC-U-11 PASS. No other tests affected (the API returns all statuses unless the caller passes `?status=`, so TC-A-51/53/54 still PASS).

### I-5 — RPC `create_document_with_layer_stack` violated FK on first insert

- **Classification:** Implementation gap (database).
- **Detection:** TC-A-38 failed at run-time with `23503` FK violation pointing at `documents.layer_stack_id → layer_stacks.id`.
- **Root cause:** The RPC inserted `documents` first, with `layer_stack_id = v_stack_id`, but `v_stack_id` did not yet exist in `layer_stacks`. `layer_stacks.document_id` is nullable, so the correct order is: insert `layer_stacks` first (with `document_id = NULL`), then `documents` (FK now satisfied), then `UPDATE layer_stacks SET document_id = v_doc_id`.
- **Fix:** Migration **018 — `create_document_with_layer_stack_fix_fk_order.sql`**.
- **Re-test:** TC-A-38, TC-A-39, TC-A-40, TC-A-41 PASS.

### I-6 — `SECURITY DEFINER` functions failed with 42P01 unqualified table

- **Classification:** Implementation gap (database). Affects two functions.
- **Detection:** TC-D-09 failed: `handle_new_user` raised `42P01: relation "organisations" does not exist` when GoTrue invoked the trigger as `supabase_auth_admin`. Separately, TC-A-38 raised the same error when the RPC was called as `authenticated`.
- **Root cause:** Both `handle_new_user()` and `create_document_with_layer_stack()` were declared `SECURITY DEFINER` without an explicit `SET search_path`, so they inherited the caller's `search_path`, which does not include `public`.
- **Fix:** Migration **016** (`handle_new_user`) and Migration **017** (`create_document_with_layer_stack`) — both add `SET search_path = public`.
- **Re-test:** TC-D-09 PASS, all `POST /documents` cases PASS.

### I-7 — TC-D-07 expected count diverged under parallel workers

- **Classification:** Implementation gap (test side).
- **Detection:** TC-D-07 intermittently asserted `expect(layerStacksAfter).toBe(5)` and received 4.
- **Root cause:** The original assertion counted all rows in the test organisation. With four parallel workers each creating documents under `orgA`, the count was non-deterministic across workers.
- **Fix:** Rewrite TC-D-07 to scope all assertions to the freshly-created `project.id`. Because the project is created inside the test's `beforeEach`, the count of `documents` and `layer_stacks` filtered by that `project_id` is unambiguously 0 after the failure-induced deletion.
- **Re-test:** TC-D-07 PASS across multiple runs.

### I-8 — Service-role admin client could not invoke RPC for fixture setup

- **Classification:** Implementation gap (database) — discovered while wiring fixtures, not via a numbered test case.
- **Detection:** Tests that called `admin.rpc('create_document_with_layer_stack', …)` for setup raised `forbidden: caller is not a member of organisation` because `auth.uid()` returns NULL for service-role.
- **Root cause:** The RPC's membership check assumed an authenticated caller and rejected `auth.uid() IS NULL`. Service-role already has full DB access via grants, so the check is redundant for that role.
- **Fix:** Migration **019 — `create_document_allow_service_role.sql`** — wraps the membership and project checks in `IF v_caller IS NOT NULL THEN …` and adds `GRANT EXECUTE … TO service_role`. Adds no new privilege (service_role already bypasses RLS on the underlying tables).
- **Re-test:** All TC-A-38 onward PASS.

### E-1 — Cloud sign-up required email confirmation

- **Classification:** Environment.
- **Detection:** TC-U-01 against `stelavox-dev` failed because `signUp` returned `{ user, session: null }` instead of `{ user, session: <…> }` — the test then could not establish a session for the follow-up assertions.
- **Root cause:** Cloud projects ship with **Confirm email = ON** by default; local stacks ship with it OFF (`supabase/config.toml: enable_confirmations = false`).
- **Fix:** In Supabase dashboard → `stelavox-dev` → Authentication → Sign In / Providers → Email, toggle **Confirm email** OFF for the smoke run.
- **Re-test:** Phase B TC-U-01 PASS.
- **Note for production:** `stelavox-prod` will keep email confirmation ON; production sign-up flow is a Phase 2 deliverable and is tested separately.

### E-2 — Cloud loopback latency exceeded default Playwright timeout

- **Classification:** Environment.
- **Detection:** Phase B TC-U-07 timed out at the default 30 s while waiting for the Sydney SSR round-trip on the new-document POST.
- **Root cause:** `playwright.config.ts` sets `timeout: 30_000`; Sydney → cloud RTT plus Next.js SSR cold-start exceeds this for the first request of a worker.
- **Fix:** Run cloud smoke with `npx playwright test --timeout=60000`. Local default left unchanged.
- **Re-test:** Phase B TC-U-01, TC-U-06, TC-U-07, TC-U-09 PASS in 11.2 s, 6.4 s, 11.2 s, 9.6 s respectively.

---

## 7. Phase B — Cloud smoke results

A 4-case subset of the full plan was re-run against `stelavox-dev` (cloud) on 2026-05-03 with `--timeout=60000` and Confirm-email toggled OFF (§6.E-1, E-2).

| ID | Title | Phase A | Phase B |
|---|---|---|---|
| TC-U-01 | New user can sign up with email + password | PASS | PASS |
| TC-U-06 | Authenticated user can create a project | PASS | PASS |
| TC-U-07 | Authenticated user can create a document | PASS | PASS |
| TC-U-09 | RLS blocks cross-user access (UI level) | PASS | PASS |

The four cases collectively exercise: signup → trigger-driven org+membership creation → API auth → server-side Supabase client → RPC → RLS. No Phase B-only failures observed beyond the two environment items already classified.

---

## 8. Outstanding items

These are tracked but **do not block** the Phase 1 merge.

### 8.1 Spec-update items (already listed in `stelavox_phase1_build_checklist_v1_0.md` §6 as SU-1 … SU-5)

These are migrations and clarifications introduced during Phase 1 that are not yet reflected in the Technical Architecture. To be folded into TA v1.4 in a separate PR.

| Tag | Item |
|---|---|
| SU-1 | Add migrations 001a, 001b, 013, 016, 017, 018, 019 to TA v1.4 §3.6 (the canonical migration list). |
| SU-2 | Document the `layer_stacks.layers` JSONB shape (the array of `{index, node_type, label, description}` objects) in TA v1.4 §3.6 / §4 (data model). |
| SU-3 | Document the `default_document_type` validation choice (Zod enum mirrored to the same V1 enum used for `documents.document_type`). |
| SU-4 | Note the four `SECURITY DEFINER + SET search_path = public` patterns in TA v1.4 §5 (Hazards) — propose H-13. |
| SU-5 | Note the FK-ordering pattern for `documents ↔ layer_stacks` in TA v1.4 §5 — propose H-14. |

### 8.2 Phase-1 review findings (T-11.1 diff sweep)

| Ref | Finding | Action |
|---|---|---|
| F-1 | `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` queries the document by `id` only, with no `project_id` constraint. RLS still blocks cross-org access; cross-project (same org) would render the wrong placeholder. Phase 2 will tighten when the editor lands. | Defer to Phase 2 (editor task). |
| F-2 | `app/(app)/projects/[projectId]/page.tsx:70` has `opacity: doc.status === 'archived' ? 0.6 : 1` but the query filters to `status='active'`, making the branch unreachable. Cosmetic. | Defer to Phase 2 cleanup. |
| F-3 | `app/globals.css:86` maps shadcn's `--primary` to `--color-accent` (verdigris). Currently unreached by Phase 1 components (no `<Button variant="default">`); a Phase 2 component using the default variant would silently violate Inviolable #2. | Phase 2: remap `--primary` to `--color-text-primary` so the shadcn primitive is safe by default. |

### 8.3 Wireframe errata reference

`CLAUDE.md` Spec Library Reference lists `stelavox_wireframe_errata_v1_0.md`, which is not present in `/docs`. No Phase 1 work depended on wireframes, so this did not affect testing. Action: out of Phase 1 scope; reconcile when wireframes are added or when CLAUDE.md is next reviewed.

### 8.4 Trivial fixes applied during Group 11

| Ref | Fix | Location |
|---|---|---|
| F-4 | Seed comment said "40 keys"; file actually defines 41. | `supabase/seed.sql:70` — corrected to "41 keys". |
| F-5 | `lib/types/database.ts` regenerated against `stelavox-dev`. Diff was purely Supabase CLI metadata (added `__InternalSupabase.PostgrestVersion`, removed unused `graphql_public` schema). | `lib/types/database.ts` — replaced. `npm run type-check` passes. |

---

## 9. Phase Checkpoint Verdict

The Phase 1 checkpoint criteria from `stelavox_phase1_build_checklist_v1_0.md` §2 require all 13 conditions to hold. Result:

| # | Criterion | Verdict |
|---|---|---|
| 1 | Sign up works (TC-U-01) | ✅ |
| 2 | Magic link sign-in works (TC-U-02) | ✅ |
| 3 | Sign in / sign out / session persistence (TC-U-03, TC-U-04, TC-U-12) | ✅ |
| 4 | Password reset works (TC-U-05) | ✅ |
| 5 | Project CRUD via UI and API (TC-U-06, TC-U-08, TC-A-01–37) | ✅ |
| 6 | Document CRUD via UI and API (TC-U-07, TC-U-11, TC-A-38–80) | ✅ |
| 7 | RLS blocks cross-user access (TC-B-01–16) | ✅ |
| 8 | All migrations apply cleanly on a fresh database; seed is idempotent | ✅ — verified Phase A and Phase B |
| 9 | `platform_config` is fully seeded | ✅ — 41 keys present |
| 10 | One `director_configs` row with `status='production'` | ✅ |
| 11 | `lib/types/database.ts` is up-to-date and not hand-edited (H-10) | ✅ — regenerated 2026-05-03 |
| 12 | `npm run build`, `lint`, `type-check` all succeed | ✅ |
| 13 | No hardcoded operational values (H-12) | ✅ — Phase 1 has no LLM code; `getConfig()` is wired and tested via cache TTL |

**Verdict: PASS.** Phase 1 is merge-ready.

---

## Changelog

**v1.0 — 2026-05-03** Initial version. Records the final state of all 118 Phase 1 test cases, the 8 implementation issues encountered and resolved during the build, the 2 environment-specific issues for Phase B, and the deferred items for Phase 2 and TA v1.4. Phase verdict: PASS.
