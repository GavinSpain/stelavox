# Stelavox — Phase 1 Pre-Phase Test Plan
## Version 1.0

> **Tier-B per-phase document.** Written before any implementation. Derived from `stelavox_phase1_api_contract_v1_0.md` and the Phase 1 checkpoint criteria in `stelavox_technical_architecture_v1_3.md` §11. Executed at the end of Phase 1; results recorded in `stelavox_phase1_test_report_v1_0.md` (created during Stage 5).

**Phase:** 1 — Foundation: auth, orgs, project/document CRUD, full multi-tenant schema
**Phase 1 checkpoint criteria (Technical Architecture v1.3 §11):** "Can sign up, create project/document, RLS blocks cross-user access."
**Companion documents:** `stelavox_phase1_api_contract_v1_0.md`, `stelavox_phase1_build_checklist_v1_0.md`

---

## 1. Test Environment

### 1.1 Where tests run

Phase 1 is built against the local Supabase stack (Phase A of the dev environment per Technical Architecture §10 / Local Dev Setup §3.3):

- Supabase local stack started via `supabase start` (Docker Desktop required).
- All 12 migrations applied via `supabase db push`.
- `supabase/seed.sql` applied via `supabase db execute --file supabase/seed.sql`.
- Next.js dev server at `http://localhost:3000` (`npm run dev`).
- Studio for visual inspection at `http://localhost:54323`.

A second smoke run is performed against the cloud `stelavox-dev` project (Phase B) before merge — same migrations, same seed, same test cases. Cloud-only differences (cookie domain, redirect URLs) are noted where they affect a test.

### 1.2 Test users

Three test users created via `supabase.auth.signUp` at the start of the run. Each user's signup triggers the H-03 `handle_new_user()` function, which creates a personal organisation with `role = 'owner'`.

| Handle | Email | Password | Display name | Created org slug |
|---|---|---|---|---|
| **User A** | `test-a@example.com` | `Test1234!Test1234!` | `Author A` | `author-a` |
| **User B** | `test-b@example.com` | `Test1234!Test1234!` | `Author B` | `author-b` |
| **User C** | `test-c@example.com` | `Test1234!Test1234!` | `Author C` (used for auth boundary checks) | `author-c` |

Test users are **deleted between full runs** by truncating `auth.users` (via service role) which cascades through all dependent tables. `supabase db reset` is acceptable in Phase A; in Phase B the tester deletes via Studio.

### 1.3 Test data

Pre-loaded by the seed:

- Three layer-stack templates (`is_template = TRUE`, `organisation_id IS NULL`): one per V1 document type (`novel`, `short_story`, `series`).
- All keys in `platform_config` (Migration 012 / §3.7).
- One `director_configs` row with `status = 'production'`.

No project or document fixtures are pre-loaded. All projects and documents in the test plan are created during the run.

### 1.4 Tooling

- **API integration tests:** Vitest + `@supabase/supabase-js` for client construction; `fetch` for HTTP calls. (Or Playwright API-mode for the same purpose.)
- **UI checkpoint tests:** Playwright in headed mode for the human-observable scenarios; the `npm run dev` server hosts the app.
- **Database verification:** Supabase JS service-role client used in test setup/teardown only; **never** used to satisfy assertions about user-visible state. Assertions about user-visible state use the user's session client so RLS is exercised.

### 1.5 Mocking

No external services are mocked in Phase 1. Email is delivered via Supabase Auth's local SMTP (Inbucket at `http://localhost:54324` in Phase A); the tester reads verification links from Inbucket. In Phase B the tester reads from the Supabase Auth dashboard's email logs.

### 1.6 Independence

Test cases are independent: any subset can run in any order. Where a test requires a precondition (e.g. "User A has a project P"), the test creates that state in its setup block and tears it down in its teardown block. No test modifies state that another test reads.

### 1.7 Notation

- **TC-A-NN** — API integration test (Section 3).
- **TC-B-NN** — Authorisation boundary test (Section 4).
- **TC-D-NN** — Data integrity test (Section 5).
- **TC-U-NN** — UI checkpoint test (Section 2).
- **Verdict:** `PASS` if actual matches expected exactly. `FAIL` otherwise; the Test Report classifies the cause.

---

## 2. Section 1 — UI Checkpoint Tests

These verify the Phase 1 checkpoint from a user's perspective: "Can sign up, create project/document, RLS blocks cross-user access."

### TC-U-01 — New user can sign up with email + password
**Spec:** Product Spec §4.1 (Email + password auth, Auto-organisation creation), Technical Architecture H-03.
**Procedure:**
1. Navigate to `/signup`.
2. Enter name `Author A`, email `test-a@example.com`, password `Test1234!Test1234!`.
3. Submit.
4. Open Inbucket (`http://localhost:54324`), find the verification email, click the link.
5. Verify redirect lands at `/dashboard`.
**Expected:**
- The dashboard loads with `Author A` shown in the user menu.
- A row exists in `auth.users` for the email (verify via service-role client in setup, not as the assertion).
- A row exists in `organisations` with name `Author A` (or similar) and `slug = 'author-a'`.
- A row exists in `organisation_members` linking User A to that organisation with `role = 'owner'`.

### TC-U-02 — New user can sign up via magic link
**Spec:** Product Spec §4.1 (Magic link).
**Procedure:**
1. Navigate to `/login`.
2. Click "Email me a magic link", enter `test-magic@example.com`, submit.
3. Open Inbucket, click the magic link.
4. Verify redirect lands at `/dashboard`.
**Expected:**
- Dashboard loads.
- Same DB-side guarantees as TC-U-01 (organisation + membership created via H-03 trigger).

### TC-U-03 — Existing user can sign in
**Spec:** Product Spec §4.1, Session management.
**Setup:** TC-U-01 has run; User A exists.
**Procedure:**
1. Sign out (if signed in).
2. Navigate to `/login`.
3. Enter `test-a@example.com` + correct password.
4. Submit.
**Expected:** Dashboard loads. No new rows created in `organisations` or `organisation_members` (verify count unchanged).

### TC-U-04 — Existing user can sign out
**Spec:** Product Spec §4.1.
**Procedure:** From a signed-in dashboard, open user menu, click "Sign out".
**Expected:** Redirect to `/login`. Refreshing `/dashboard` redirects back to `/login`.

### TC-U-05 — Password reset flow
**Spec:** Product Spec §4.1.
**Procedure:**
1. From `/login`, click "Forgot password", enter `test-a@example.com`, submit.
2. Open Inbucket, click the reset link.
3. Enter a new password twice, submit.
4. Sign in with the new password.
**Expected:** New password works; old password no longer authenticates.

### TC-U-06 — Authenticated user can create a project
**Spec:** Product Spec §4.4 (Project creation), API Contract §3.1.
**Setup:** User A signed in.
**Procedure:**
1. From dashboard, click "New project".
2. Enter name `Untitled Project A1`, submit.
**Expected:**
- Project appears in the dashboard list.
- Navigating to the project shell loads it (page renders without error; document list is empty).

### TC-U-07 — Authenticated user can create a document
**Spec:** Product Spec §4.4 (Document creation), API Contract §3.6.
**Setup:** TC-U-06 has run; project P exists.
**Procedure:**
1. Open project P.
2. Click "New document".
3. Enter name `My First Novel`, document type `Novel`, submit.
**Expected:**
- Document appears in the project's document list.
- Navigating to the document loads the editor shell (Phase 1 shell — empty tree placeholder is acceptable; tree is Phase 2).
- A row exists in `documents` with `document_type = 'novel'`, `status = 'active'`, `layer_stack_id` set.
- A row exists in `layer_stacks` with `is_template = FALSE`, `document_id` set, and `layers` matching the seeded Novel template's `layers`.

### TC-U-08 — Project deletion requires UI confirmation
**Spec:** API Contract §3.5 (cascade delete); UI requirement (no soft-delete in Phase 1).
**Setup:** User A has a project with one or more documents.
**Procedure:**
1. Open project context menu, click "Delete project".
2. Confirmation dialog appears stating that all documents in the project will be deleted.
3. Click "Cancel". Verify project is still present.
4. Repeat steps 1–2; click "Delete". Verify project disappears from list.
**Expected:** Cancel preserves the project. Delete removes the project and its documents (verify via dashboard view as User A).

### TC-U-09 — RLS blocks cross-user access (UI level)
**Spec:** Phase 1 checkpoint, Technical Architecture §3.3.
**Setup:**
- User A creates a project P-A and a document D-A under it.
- Capture `P-A.id` and `D-A.id` from Studio (or from the URL after creation).
**Procedure:**
1. Sign out of A; sign in as User B.
2. Navigate directly to `/projects/<P-A.id>` (paste the URL).
3. Navigate directly to `/projects/<P-A.id>/documents/<D-A.id>`.
**Expected:** Both navigations show the application's "not found" empty state. Neither shows P-A's or D-A's data. The dashboard for User B shows zero projects.

### TC-U-10 — User menu shows correct user
**Spec:** Product Spec §4.1.
**Procedure:** Sign in as User A, observe user menu; sign out, sign in as User B, observe user menu.
**Expected:** Each session displays only that user's email/name.

### TC-U-11 — Document archive (status transition)
**Spec:** Product Spec §4.4 (Document archiving), API Contract §3.9.
**Setup:** User A has a document D.
**Procedure:** Open D; from the document menu, click "Archive". Confirm.
**Expected:**
- Document disappears from the active documents list.
- An "Archived" filter or toggle reveals it.
- DB row has `status = 'archived'`.

### TC-U-12 — Session persists across page reload
**Spec:** Session management (Product Spec §4.1).
**Procedure:** Sign in. Reload the page. Confirm still signed in.
**Expected:** No re-login prompt; user menu unchanged.

---

## 3. Section 2 — API Integration Tests

For every endpoint in the API Contract, every documented case. Each test uses HTTP `fetch` against `http://localhost:3000/api/...` with the relevant test user's auth cookie attached. Setup/teardown uses the service-role client.

### Convention

- "Authenticated as X" means the request carries User X's session cookie.
- Each test asserts: status code, response body shape (key set), and key field values (including types).
- Side-effect verification (DB rows present/absent) uses the service-role client and is part of the assertion.

### 3.1 `POST /api/projects` (§3.1)

**TC-A-01 — happy path**
- Auth: User A.
- Body: `{ "name": "Project Alpha" }`.
- Expected: `201`. Body: `{ "project": { id, organisation_id, name: "Project Alpha", description: null, default_document_type: null, metadata: {}, created_at, updated_at } }`.
- DB: one new row in `projects` with `organisation_id = User A's org id`. No other writes.

**TC-A-02 — happy path with all optional fields**
- Auth: User A.
- Body: `{ "name": "Project Beta", "description": "A trilogy", "default_document_type": "novel" }`.
- Expected: `201`. Response `description` and `default_document_type` match input.

**TC-A-03 — name trimmed before validation and storage**
- Auth: User A.
- Body: `{ "name": "  Padded  " }`.
- Expected: `201`. `project.name === "Padded"`.

**TC-A-04 — name empty after trim → 400**
- Auth: User A.
- Body: `{ "name": "   " }`.
- Expected: `400`. Body: `{ "error": "invalid_name", ... }`. No DB writes.

**TC-A-05 — name >200 chars → 400**
- Auth: User A.
- Body: `{ "name": "a".repeat(201) }`.
- Expected: `400 invalid_name`.

**TC-A-06 — description >5000 chars → 400**
- Auth: User A.
- Body: `{ "name": "P", "description": "x".repeat(5001) }`.
- Expected: `400 invalid_description`.

**TC-A-07 — invalid `default_document_type` → 400**
- Auth: User A.
- Body: `{ "name": "P", "default_document_type": "academic_paper" }`.
- Expected: `400 invalid_document_type`. (Academic paper is V2 only.)

**TC-A-08 — unknown field → 400**
- Auth: User A.
- Body: `{ "name": "P", "owner_id": "<uuid>" }`.
- Expected: `400 unknown_field`.

**TC-A-09 — empty body → 400**
- Auth: User A.
- Body: empty.
- Expected: `400 missing_body`.

**TC-A-10 — non-JSON body → 400**
- Auth: User A.
- Body: `not json`.
- Expected: `400 invalid_json`.

**TC-A-11 — no session → 401**
- Auth: none.
- Body: `{ "name": "Project Alpha" }`.
- Expected: `401 unauthorised`. No DB writes.

### 3.2 `GET /api/projects` (§3.2)

**TC-A-12 — happy path returns only caller's projects**
- Setup: User A has projects P1, P2; User B has projects P3, P4.
- Auth: User A.
- Expected: `200`. `projects` array has length 2 with ids `{P1, P2}` (any order; the contract says newest first — assert that order).

**TC-A-13 — empty list when no projects**
- Setup: User C has no projects.
- Auth: User C.
- Expected: `200 { "projects": [] }`.

**TC-A-14 — order is created_at DESC**
- Setup: User A creates P1, then P2, then P3 in that order.
- Auth: User A.
- Expected: response order `[P3, P2, P1]`.

**TC-A-15 — unknown query param → 400**
- Auth: User A.
- Query: `?foo=bar`.
- Expected: `400 unknown_param`.

**TC-A-16 — `status` query param → 400 in Phase 1**
- Auth: User A.
- Query: `?status=archived`. (Reserved for future use; rejected in Phase 1.)
- Expected: `400 unknown_param`.

**TC-A-17 — no session → 401**
- Auth: none.
- Expected: `401 unauthorised`.

### 3.3 `GET /api/projects/[projectId]` (§3.3)

**TC-A-18 — happy path**
- Setup: User A has project P.
- Auth: User A.
- Path: `/api/projects/<P.id>`.
- Expected: `200 { "project": { ...P } }`.

**TC-A-19 — invalid UUID → 400**
- Auth: User A.
- Path: `/api/projects/not-a-uuid`.
- Expected: `400 invalid_uuid`.

**TC-A-20 — non-existent UUID → 404**
- Auth: User A.
- Path: `/api/projects/00000000-0000-0000-0000-000000000000`.
- Expected: `404 not_found`.

**TC-A-21 — no session → 401**
- Auth: none.
- Path: `/api/projects/<any-uuid>`.
- Expected: `401 unauthorised`.

### 3.4 `PATCH /api/projects/[projectId]` (§3.4)

**TC-A-22 — happy path: rename**
- Setup: User A has project P with name `Original`.
- Auth: User A.
- Body: `{ "name": "Renamed" }`.
- Expected: `200`. `project.name === "Renamed"`. `updated_at > created_at`. DB row reflects update.

**TC-A-23 — happy path: clear description**
- Setup: User A has project P with description `something`.
- Body: `{ "description": null }`.
- Expected: `200`. `project.description === null`.

**TC-A-24 — empty body → 400**
- Body: `{}`.
- Expected: `400 empty_update`.

**TC-A-25 — body includes forbidden field `id` → 400**
- Body: `{ "id": "<some uuid>", "name": "X" }`.
- Expected: `400 unknown_field`. No DB writes.

**TC-A-26 — body includes forbidden field `organisation_id` → 400**
- Body: `{ "organisation_id": "<some uuid>" }`.
- Expected: `400 unknown_field`. No DB writes.

**TC-A-27 — invalid name → 400**
- Body: `{ "name": "" }`.
- Expected: `400 invalid_name`.

**TC-A-28 — invalid `default_document_type` → 400**
- Body: `{ "default_document_type": "essay" }`.
- Expected: `400 invalid_document_type`.

**TC-A-29 — non-existent UUID → 404**
- Path: `/api/projects/00000000-0000-0000-0000-000000000000`.
- Body: `{ "name": "X" }`.
- Expected: `404 not_found`.

**TC-A-30 — no session → 401**
- Auth: none. Body: `{ "name": "X" }`. Expected: `401 unauthorised`.

### 3.5 `DELETE /api/projects/[projectId]` (§3.5)

**TC-A-31 — happy path**
- Setup: User A has project P with no documents.
- Auth: User A.
- Path: `/api/projects/<P.id>`. Body: empty.
- Expected: `200 { "deleted": true, "project_id": "<P.id>" }`. DB row removed.

**TC-A-32 — cascade deletes documents**
- Setup: User A has project P with two documents D1, D2 (each with a layer stack).
- Auth: User A. Path: `/api/projects/<P.id>`.
- Expected: `200`. After: `documents.id IN (D1.id, D2.id)` — zero rows. `layer_stacks.document_id IN (D1.id, D2.id)` — zero rows.

**TC-A-33 — body must be empty → 400**
- Body: `{ "force": true }`.
- Expected: `400 unexpected_body`. DB unchanged.

**TC-A-34 — invalid UUID → 400**
- Path: `/api/projects/abc`.
- Expected: `400 invalid_uuid`.

**TC-A-35 — non-existent UUID → 404**
- Path: `/api/projects/00000000-0000-0000-0000-000000000000`.
- Expected: `404 not_found`.

**TC-A-36 — second DELETE on same id → 404**
- Setup: User A's project P deleted (TC-A-31).
- Auth: User A. Path: `/api/projects/<P.id>`.
- Expected: `404 not_found`. Idempotent in the HTTP sense.

**TC-A-37 — no session → 401**

### 3.6 `POST /api/projects/[projectId]/documents` (§3.6)

**TC-A-38 — happy path: novel**
- Setup: User A has project P. Seed has Novel template.
- Auth: User A.
- Body: `{ "name": "My Novel", "document_type": "novel" }`.
- Expected: `201`. Body has `document` and `layer_stack`. `document.layer_stack_id === layer_stack.id`. `document.root_node_id === null`. `document.director_config_id === null`. `document.status === 'active'`. `document.authors === []`. `layer_stack.is_template === false`. `layer_stack.layers` matches the seed Novel template's `layers`. DB: one new `documents` row, one new `layer_stacks` row, both with `organisation_id` matching the project's.

**TC-A-39 — happy path: short_story**
- Body: `{ "name": "Short", "document_type": "short_story" }`.
- Expected: `201`. `document.document_type === 'short_story'`. Layer stack matches the Short Story template.

**TC-A-40 — happy path: series**
- Body: `{ "name": "Series", "document_type": "series" }`.
- Expected: `201`. Layer stack matches the Series template.

**TC-A-41 — happy path with authors**
- Body: `{ "name": "N", "document_type": "novel", "authors": ["A. Author", "B. Author"] }`.
- Expected: `201`. `document.authors === ["A. Author", "B. Author"]`.

**TC-A-42 — invalid document_type → 400**
- Body: `{ "name": "X", "document_type": "academic_paper" }`.
- Expected: `400 invalid_document_type`.

**TC-A-43 — missing document_type → 400**
- Body: `{ "name": "X" }`.
- Expected: `400 invalid_document_type`. (Required field missing.)

**TC-A-44 — invalid authors element → 400**
- Body: `{ "name": "X", "document_type": "novel", "authors": ["", "B"] }`.
- Expected: `400 invalid_authors`.

**TC-A-45 — too many authors → 400**
- Body: `{ "name": "X", "document_type": "novel", "authors": Array(21).fill("A") }`.
- Expected: `400 invalid_authors`.

**TC-A-46 — unknown field → 400**
- Body: `{ "name": "X", "document_type": "novel", "status": "archived" }`.
- Expected: `400 unknown_field`. (Status is set server-side at creation.)

**TC-A-47 — invalid project UUID → 400**
- Path: `/api/projects/abc/documents`.
- Expected: `400 invalid_uuid`.

**TC-A-48 — project not found → 404**
- Path: `/api/projects/00000000-.../documents`.
- Expected: `404 project_not_found`.

**TC-A-49 — no session → 401**

**TC-A-50 — atomicity: layer stack insert fails → no orphaned document**
- Setup: temporarily remove the Novel template row from `layer_stacks` (via service-role) so step 1 of the forking succeeds in finding nothing and the route returns `500 missing_template`. (This simulates a system error.)
- Auth: User A. Body: `{ "name": "N", "document_type": "novel" }`.
- Expected: `500 missing_template`. After: `documents` has zero new rows for User A's project. (Template restored in teardown.)

### 3.7 `GET /api/projects/[projectId]/documents` (§3.7)

**TC-A-51 — happy path**
- Setup: User A has project P with documents D1 (active), D2 (archived).
- Auth: User A.
- Expected: `200`. `documents` array length 2 with ids `{D1, D2}`, ordered created_at DESC.

**TC-A-52 — empty when no documents**
- Setup: User A has project P with no documents.
- Expected: `200 { "documents": [] }`.

**TC-A-53 — `status=active` filter**
- Setup as TC-A-51. Query `?status=active`.
- Expected: `200`. Only D1 returned.

**TC-A-54 — `status=archived` filter**
- Same setup. Query `?status=archived`.
- Expected: `200`. Only D2 returned.

**TC-A-55 — invalid status → 400**
- Query: `?status=draft`.
- Expected: `400 invalid_status`.

**TC-A-56 — invalid UUID → 400**

**TC-A-57 — project not visible → 404 project_not_found**
- Setup: User A has project P; sign in as User B.
- Auth: User B. Path: `/api/projects/<P.id>/documents`.
- Expected: `404 project_not_found`. (Distinguishes from "project visible, no documents" which would be `200 []`.)

**TC-A-58 — unknown query param → 400**

**TC-A-59 — no session → 401**

### 3.8 `GET /api/documents/[documentId]` (§3.8)

**TC-A-60 — happy path**
- Setup: User A has document D.
- Auth: User A. Path: `/api/documents/<D.id>`.
- Expected: `200 { "document": { ...D } }`. `layer_stack` is **not** included in the response.

**TC-A-61 — invalid UUID → 400**
**TC-A-62 — non-existent → 404**
**TC-A-63 — no session → 401**

### 3.9 `PATCH /api/documents/[documentId]` (§3.9)

**TC-A-64 — happy path: rename**
- Body: `{ "name": "New Name" }`.
- Expected: `200`. `document.name` updated. `updated_at` bumped.

**TC-A-65 — happy path: archive**
- Body: `{ "status": "archived" }`.
- Expected: `200`. `document.status === "archived"`.

**TC-A-66 — happy path: published**
- Body: `{ "status": "published" }`.
- Expected: `200`. `document.status === "published"`.

**TC-A-67 — happy path: status transition without restriction**
- Setup: D with status `archived`.
- Body: `{ "status": "active" }`.
- Expected: `200`. (Phase 1 has no transition rules.)

**TC-A-68 — invalid status → 400**
- Body: `{ "status": "draft" }`.
- Expected: `400 invalid_status`.

**TC-A-69 — forbidden field `document_type` → 400**
- Body: `{ "document_type": "short_story" }`.
- Expected: `400 unknown_field`.

**TC-A-70 — forbidden field `project_id` → 400**
- Body: `{ "project_id": "<other-project-uuid>" }`.
- Expected: `400 unknown_field`. (Cannot move documents between projects in Phase 1.)

**TC-A-71 — empty body → 400**
**TC-A-72 — invalid UUID → 400**
**TC-A-73 — non-existent → 404**
**TC-A-74 — no session → 401**

### 3.10 `DELETE /api/documents/[documentId]` (§3.10)

**TC-A-75 — happy path**
- Setup: User A has document D with layer stack LS.
- Auth: User A. Path: `/api/documents/<D.id>`. Body: empty.
- Expected: `200 { "deleted": true, "document_id": "<D.id>" }`. After: `documents` has no row for D. `layer_stacks` has no row for LS (cascade per Migration 007).

**TC-A-76 — body must be empty → 400**
- Body: `{ "force": true }`.
- Expected: `400 unexpected_body`. DB unchanged.

**TC-A-77 — invalid UUID → 400**
**TC-A-78 — non-existent → 404**
**TC-A-79 — second DELETE → 404**
**TC-A-80 — no session → 401**

---

## 4. Section 3 — Authorisation Boundary Tests

Cross-user, cross-organisation tests. Every Phase 1 endpoint × every "User B attempting to access User A's resource" case. Per the API Contract, **the expected outcome is `404` (not `403`)** for any resource that exists but is invisible to the caller; for list endpoints, the expected outcome is an empty array.

### TC-B-01 — `GET /api/projects` returns only caller's organisation
- Setup: User A has projects {P1, P2}; User B has projects {P3}.
- Auth: User A. Expected: `200`, `projects.length === 2`, ids `{P1, P2}` only — never includes P3.
- Auth: User B. Expected: `200`, `projects.length === 1`, ids `{P3}` only.

### TC-B-02 — `GET /api/projects/[id]` cross-user → 404
- Setup: User A has project P1.
- Auth: User B. Path: `/api/projects/<P1.id>`.
- Expected: `404 not_found`. Body must NOT contain P1's name, description, or any other field.

### TC-B-03 — `PATCH /api/projects/[id]` cross-user → 404, no DB change
- Setup: User A has project P1 with name `Original`.
- Auth: User B. Path: `/api/projects/<P1.id>`. Body: `{ "name": "Hijacked" }`.
- Expected: `404 not_found`. After: P1 in DB still has name `Original`. P1's `updated_at` unchanged.

### TC-B-04 — `DELETE /api/projects/[id]` cross-user → 404, no DB change
- Setup: User A has project P1.
- Auth: User B. Path: `/api/projects/<P1.id>`.
- Expected: `404 not_found`. After: P1 still exists in DB.

### TC-B-05 — `POST /api/projects/[A's project]/documents` cross-user → 404
- Setup: User A has project P1.
- Auth: User B. Path: `/api/projects/<P1.id>/documents`. Body: `{ "name": "X", "document_type": "novel" }`.
- Expected: `404 project_not_found`. After: no new rows in `documents` or `layer_stacks`.

### TC-B-06 — `GET /api/projects/[A's project]/documents` cross-user → 404
- Setup: User A has project P1 with documents.
- Auth: User B. Path: `/api/projects/<P1.id>/documents`.
- Expected: `404 project_not_found`. Body must NOT contain document names from P1.

### TC-B-07 — `GET /api/documents/[A's doc]` cross-user → 404
- Setup: User A has document D1.
- Auth: User B. Path: `/api/documents/<D1.id>`.
- Expected: `404 not_found`.

### TC-B-08 — `PATCH /api/documents/[A's doc]` cross-user → 404, no DB change
- Setup: User A has document D1 with name `Original`.
- Auth: User B. Path: `/api/documents/<D1.id>`. Body: `{ "name": "Hijacked", "status": "archived" }`.
- Expected: `404 not_found`. After: D1 in DB unchanged.

### TC-B-09 — `DELETE /api/documents/[A's doc]` cross-user → 404, no DB change
- Setup: User A has document D1.
- Auth: User B. Path: `/api/documents/<D1.id>`.
- Expected: `404 not_found`. After: D1 still exists.

### TC-B-10 — Direct DB write from User B's anon client cannot insert into User A's organisation
- Setup: User A's organisation_id is known. User B is signed in.
- Procedure: From a client-side Supabase JS instance authenticated as User B, attempt:
  ```typescript
  await supabaseB.from('projects').insert({ organisation_id: <User A's org id>, name: 'Hijack' })
  ```
- Expected: Insert is rejected by RLS (error returned). After: `projects` has zero rows with name `Hijack`. (This proves the RLS chain enforces correctly even without the API route in the picture.)

### TC-B-11 — Direct DB read from User B's anon client cannot see User A's projects
- Setup: User A has projects.
- Procedure: From User B's anon client: `await supabaseB.from('projects').select('*')`.
- Expected: Returns only User B's projects. User A's project ids never appear.

### TC-B-12 — Direct DB read of `organisation_members` (H-02 verification)
- Setup: User A and User B both exist with their auto-organisations.
- Procedure: User B's anon client: `await supabaseB.from('organisation_members').select('*')`.
- Expected: Returns only User B's row (`user_id = User B`). Does not return User A's row. Query does not time out (proves H-02 fix is in place — the policy is `user_id = auth.uid()`, not a self-referential subquery).

### TC-B-13 — `auth.users` not directly readable from anon client
- Setup: any signed-in user.
- Procedure: `await supabaseB.from('users').select('*')` (against `auth.users`).
- Expected: Either RLS rejects or the `auth` schema is not exposed to the anon role. Must NOT return the email/encrypted_password column for any user.

### TC-B-14 — Service-role client bypasses RLS (control test)
- Setup: any data.
- Procedure: From a server-side client constructed with `SUPABASE_SERVICE_ROLE_KEY`: `await client.from('projects').select('*')`.
- Expected: Returns all rows across all organisations. (This is correct service-role behaviour. The control test confirms test infrastructure is wired correctly so other RLS tests are meaningful.)

### TC-B-15 — Session cookie tampering does not grant access
- Setup: User A and User B exist; capture User A's `sb-access-token` cookie value.
- Procedure: As User B (separate browser/session), replace the auth cookie with User A's token; then call `GET /api/projects`.
- Expected: Either:
  (a) the swapped cookie authenticates as User A (i.e. it is a valid token; User B simply impersonates User A — which is a known limitation of cookie-based auth and is not a Phase 1 bug), OR
  (b) the cookie fails validation (e.g. due to httpOnly + SameSite + secure or token signature mismatch).
- The check here is that User B cannot tamper with User A's token to gain elevated privileges beyond what the token already grants. (The test is mainly to ensure JWT signature validation is operating; it should fail to authenticate any forged or modified token.)

### TC-B-16 — Logged-out user cannot reach any Phase 1 API endpoint
- Setup: no session.
- Procedure: For each of the 10 endpoints, issue the corresponding HTTP request with no auth cookie.
- Expected: every response is `401 unauthorised`. No DB reads or writes occur.

---

## 5. Section 4 — Data Integrity Tests

After every modifying operation, verify nothing else changed.

### TC-D-01 — Project rename leaves other projects untouched
- Setup: User A has projects P1, P2, P3.
- Procedure: PATCH P2's name.
- Expected: P1 and P3 rows unchanged (column-by-column equality). Only P2's `name` and `updated_at` changed.

### TC-D-02 — Document rename leaves layer_stack untouched
- Setup: User A has document D with layer stack LS.
- Procedure: PATCH D's name.
- Expected: LS row unchanged. `documents.layer_stack_id` for D unchanged.

### TC-D-03 — Project delete cascades only to project's documents
- Setup: User A has projects P1 (with D1, D2) and P2 (with D3, D4).
- Procedure: DELETE P1.
- Expected: After — `documents` has no row for D1, D2; rows for D3, D4 unchanged. `layer_stacks` for D3, D4 unchanged. `nodes` (any pre-existing) for D3, D4 unchanged. P2 row unchanged.

### TC-D-04 — Document delete cascades only to that document's children
- Setup: User A has documents D1 and D2 in the same project, both with layer stacks.
- Procedure: DELETE D1.
- Expected: D2 row unchanged. D2's layer stack unchanged. D2's project unchanged.

### TC-D-05 — Document creation does not modify any other table
- Setup: snapshot row counts of all V1 user-data tables before the call.
- Procedure: POST a document.
- Expected: counts after call: `documents` +1, `layer_stacks` +1; every other table unchanged. (Specifically: `nodes` +0, `agent_jobs` +0, `audit_log` +0 unless H-03 trigger writes one — that variation is permitted but must be `info` severity.)

### TC-D-06 — Project creation does not modify any other table
- Setup: snapshot row counts.
- Procedure: POST a project.
- Expected: `projects` +1; everything else unchanged.

### TC-D-07 — Failed POST /documents leaves no orphans
- Setup: cause a missing-template failure as in TC-A-50.
- Procedure: POST a document.
- Expected: `500`. After: `documents` count unchanged, `layer_stacks` count unchanged, transaction has rolled back.

### TC-D-08 — RLS-blocked PATCH does not bump `updated_at`
- Setup: User A has project P1; capture `P1.updated_at` before.
- Procedure: User B PATCHes P1 (TC-B-03).
- Expected: `404`. After: `P1.updated_at` is byte-identical to the snapshot. No silent updates.

### TC-D-09 — Auto-organisation creation is atomic
- Setup: drop a debug breakpoint or, more practically, observe state right after a signup completes.
- Procedure: sign up a new user.
- Expected: If `organisations` has the new row, `organisation_members` also has it. There must be no time window where the organisation exists without a membership. (Given the H-03 trigger semantics, this is automatic; verified by checking that the row pair always appears together.)

### TC-D-10 — Concurrent project creation by the same user produces distinct rows
- Setup: User A. Issue two concurrent POST /api/projects calls with body `{ "name": "Same" }`.
- Procedure: `Promise.all([POST, POST])`.
- Expected: both return `201`. After: `projects` has exactly 2 new rows, both with `name = "Same"`, distinct ids. (No idempotency in Phase 1; duplicate names are allowed.)

---

## 6. Verdict Criteria

Phase 1 PASSES if and only if **every** test case in Sections 2, 3, 4, and 5 above resolves to PASS, AND the Phase 1 checkpoint criterion holds:

> "Can sign up, create project/document, RLS blocks cross-user access."

Concretely:

1. All 12 UI checkpoint tests (TC-U-01 through TC-U-12) pass.
2. All 80 API integration tests (TC-A-01 through TC-A-80) pass.
3. All 16 authorisation boundary tests (TC-B-01 through TC-B-16) pass.
4. All 10 data integrity tests (TC-D-01 through TC-D-10) pass.

Total: **118 test cases.**

Any failure is recorded in the Test Report with: severity, classification (specification gap / specification error / implementation gap / environment issue), root-cause analysis, fix applied, and re-test result. A FAIL verdict is permitted to convert to PASS only after re-test.

**No Phase 1 fix may modify a test case to make it pass.** If a test reveals an ambiguity in the API Contract or a spec gap, the contract is updated (with a version bump) and the test is regenerated from the updated contract — never the other way round.

---

## 7. Out of Scope for Phase 1 Tests

Tests for the following are explicitly out of scope and are deferred to their relevant phase:

- Node CRUD (Phase 2).
- Tiptap content fields, summary/prose/notes editing (Phase 3).
- Context node creation, linking, scope (Phase 4).
- Agent operations (Phase 5).
- Locking and node-level workflow (Phase 6).
- DOCX/JSON export endpoint (Phase 7) — the `export_settings` field is exposed in Phase 1 but is opaque and untested.
- Subscription, billing, BYOK, token budget enforcement (V2).
- Real-time subscriptions (Phase 2+ when there is something to subscribe to).
- Audit log read endpoints (V2 UI).
- Mobile client behaviour (Phase 3).

These are listed here so the absence of related tests in Phase 1 is intentional, not an oversight.

---

## 8. Approval

This Test Plan is approved before any implementation begins. Changes after approval are version-bumped on this document. The Test Plan is the authoritative tester's reference for Phase 1.

---

## 9. Changelog

**v1.0 — 2026-05-03** Initial Phase 1 Pre-Phase Test Plan. 118 test cases across UI checkpoint (12), API integration (80), authorisation boundary (16), data integrity (10). Derived from API Contract v1.0 and the Phase 1 checkpoint criterion in Technical Architecture v1.3 §11. Out-of-scope categories enumerated to make absences explicit.
