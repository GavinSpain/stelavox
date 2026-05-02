# Stelavox — Phase 1 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** The ordered, executable task list for Phase 1. Every task is sized to fit in one Claude Code session, has an explicit acceptance criterion, and references the spec section that authorises it. The agent works through this list top-to-bottom, marking each checkbox complete as the acceptance criterion is satisfied.

**Phase:** 1 — Foundation: auth, orgs, project/document CRUD, full multi-tenant schema
**Goal:** Deliver a runnable application where a user can sign up, sign in, and create a project and document; cross-user access is blocked at the database by RLS; the full multi-tenant schema is in place to serve as foundation for subsequent phases.
**Deliverable:** A merge-ready branch in which all 118 test cases in `stelavox_phase1_test_plan_v1_0.md` pass, deployed against a Phase A (local) Supabase stack and smoke-tested against Phase B (cloud `stelavox-dev`).
**Estimated weeks:** 1–2 (per Technical Architecture v1.3 §11).
**Dependencies on prior phases:** None — this is the first build phase.
**Companion documents:** `stelavox_phase1_api_contract_v1_0.md` (frozen), `stelavox_phase1_test_plan_v1_0.md` (frozen).

---

## 1. Pre-Build Prerequisites

Before any task in §3 begins:

- [ ] **PB-1.** The local development environment is set up per `stelavox_local_dev_setup_v2_1.md` §1–4. `node`, `npm`, `git`, Docker Desktop, and the Supabase CLI are installed and verified. Acceptance: `node --version`, `supabase --version`, and `docker info` all succeed.
- [ ] **PB-2.** The repository is cloned at `C:\dev\stelavox_2`, on a fresh feature branch from `main`. Branch name format: `feature/phase-1-foundation`. Acceptance: `git rev-parse --abbrev-ref HEAD` prints `feature/phase-1-foundation`.
- [ ] **PB-3.** `.env.local` exists at the repository root with the Phase A values from Local Dev Setup §3.3. The file is gitignored. Acceptance: `git check-ignore -v .env.local` prints a match.
- [ ] **PB-4.** The Supabase local stack starts cleanly: `supabase start` returns the connection details; Studio is reachable at `http://localhost:54323`. Acceptance: visiting Studio shows an empty schema (no Stelavox tables yet).
- [ ] **PB-5.** The API Contract (v1.0) and Test Plan (v1.0) are reviewed and approved by the human. Acceptance: human acknowledges in writing or via commit message.
- [x] **PB-6.** The `[SPEC GAP]` resolution in §3.4 (layer-stack JSON shape) is approved by the human. **Cleared 2026-05-03** — shape locked, recorded in §3.4 and API Contract §5 G-1.

If any prerequisite fails, work stops and the cause is fixed before §3 begins.

---

## 2. Phase Checkpoint Criteria

The phase is considered complete when **every** condition holds. The Test Plan tests these:

1. **Sign up works** — a new email + password user is created via the UI; the H-03 trigger creates the user's organisation and `owner` membership in a single transaction; the user lands on `/dashboard`. (Tested by TC-U-01.)
2. **Magic link sign-in works** — passwordless flow completes via Inbucket. (TC-U-02.)
3. **Sign in / sign out / session persistence work** — the cookie-based session round-trips, persists on reload, and clears on sign-out. (TC-U-03, TC-U-04, TC-U-12.)
4. **Password reset works** — full reset flow via email link. (TC-U-05.)
5. **Project CRUD works through the UI and API** — create, read, list, rename, delete (with cascade). (TC-U-06, TC-U-08, TC-A-01–TC-A-37.)
6. **Document CRUD works through the UI and API** — create (with layer stack fork), read, list, rename, archive, delete. (TC-U-07, TC-U-11, TC-A-38–TC-A-80.)
7. **RLS blocks cross-user access at every endpoint** — User B cannot read, modify, or delete User A's resources via API or via direct DB client. (TC-B-01–TC-B-16.)
8. **All 12 migrations apply cleanly in order** on a fresh database. Re-applying the seed file is idempotent (`ON CONFLICT DO NOTHING`). (Tested as part of CI-style runs in Stage 6.)
9. **`platform_config` is fully seeded** — all keys in Technical Architecture §3.7.4 are present. (Asserted via Studio inspection per Local Dev Setup §4.1.)
10. **One `director_configs` row exists with `status = 'production'`.** (Same.)
11. **`lib/types/database.ts` is up-to-date** with the migrated schema and is not edited by hand. (Hazard H-10.)
12. **`npm run build`, `npm run lint`, `npm run type-check` all succeed** on the final branch state.
13. **No hardcoded operational values** — any token budget, model id, duration, price, or limit referenced in the Phase 1 codebase comes from `getConfig()` (Hazard H-12). Phase 1 has limited need for `getConfig()` (mainly for default values not currently surfaced), but the rule applies wherever a value is read.

The Test Plan's Verdict Criteria (§6) is the single authoritative pass/fail rule.

---

## 3. Ordered Task List

Tasks are grouped by subsystem. Within a group, complete top to bottom. Across groups, complete top to bottom unless explicitly marked **(parallelisable)**.

> **Reminder for the agent (per global CLAUDE.md):** before each task, propose the change in one sentence and wait for confirmation. Diagnose before fixing if anything fails. Never refactor adjacent code in the same change.

---

### 3.1 Project scaffold and tooling

The Next.js + Tailwind scaffold and the design tokens are already in place from the initial commit (`bc419c5 Scaffold Stelavox`). These tasks confirm the scaffold matches the spec and add what Phase 1 needs.

- [ ] **T-1.1.** Verify the Next.js 15 App Router scaffold matches `stelavox_technical_architecture_v1_3.md` §2.1 and §2.2. Acceptance: `app/`, `components/`, `lib/`, `styles/`, `supabase/` directories exist; `next.config.ts`, `tsconfig.json`, `package.json` present; `npm run dev` starts on port 3000.
- [ ] **T-1.2.** Add Phase 1 dependencies to `package.json`: `@supabase/supabase-js`, `@supabase/ssr`, `drizzle-orm`, `drizzle-kit`, `zod`. Acceptance: `npm install` succeeds; lockfile updated; no peer-dep warnings beyond ones already present.
- [ ] **T-1.3.** Confirm `styles/tokens.css` is loaded from `app/globals.css` and that token variables resolve in dev. Acceptance: a `<div style={{ color: 'var(--color-accent)' }}>` in `app/page.tsx` renders verdigris (verify in browser devtools).
- [ ] **T-1.4.** Verify `npm run lint` and `npm run type-check` pass on the unmodified scaffold. Acceptance: both commands exit 0.
- [ ] **T-1.5.** Add an `npm run db:types` script to `package.json` that runs `supabase gen types typescript --linked > lib/types/database.ts`. Acceptance: the script exists in `package.json`. (Used in T-3.13 and any time migrations change.)

### 3.2 Supabase client wiring

Authoritative spec: Technical Architecture v1.3 §3.4, Hazard H-09 (no service-role client outside Edge Functions / server-only contexts).

- [ ] **T-2.1.** Create `lib/supabase/client.ts` exporting `createBrowserClient()` using `@supabase/ssr`. Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Acceptance: `import { createBrowserClient } from '@/lib/supabase/client'` resolves; no server-only imports.
- [ ] **T-2.2.** Create `lib/supabase/server.ts` exporting `createServerClient()` using `@supabase/ssr` with Next.js `cookies()`. Acceptance: file imports `cookies` from `next/headers`; the export is the **only** way Phase 1 API routes get a Supabase client.
- [ ] **T-2.3.** Create `lib/supabase/service.ts` exporting `createServiceRoleClient()` using `SUPABASE_SERVICE_ROLE_KEY`. Acceptance: file is server-only (`import 'server-only'` at the top); used **only** by the (future) `getConfig()` helper and migration tooling, never by Phase 1 API routes.
- [ ] **T-2.4.** Create `lib/supabase/middleware.ts` (cookie refresh helper) for the Next.js `middleware.ts`. Acceptance: helper signs in / refreshes the cookie session per Supabase SSR docs.
- [ ] **T-2.5.** Create `middleware.ts` at the repository root that calls the helper from T-2.4 on all routes except `_next` static assets. Acceptance: middleware compiles; signed-in users have refreshed sessions on every request.

### 3.3 Database schema — migrations

> **Authority note.** The migration SQL files are authoritative. The DDL in Technical Architecture v1.3 §3.6 is summary; if any task below paraphrases a column list, the SQL file wins. Migration ordering MUST NOT change.

> **Workflow.** For each migration: (a) create the file with `supabase migration new <description>` so the timestamp prefix is auto-generated; (b) paste the SQL; (c) run `supabase db push`; (d) verify in Studio; (e) regenerate types per T-3.13.

- [ ] **T-3.1.** Migration **001** — Core tables: `organisations`, `organisation_members`, `organisation_invites`, `projects`, `layer_stacks`, `documents`, `agent_profiles`. Spec: Technical Architecture §3.6 Migration 001. Acceptance: all 7 tables exist after `supabase db push`; column types and CHECKs match the spec; `agent_profiles.is_system_profile` defaults `FALSE`.
- [ ] **T-3.2.** Migration **002** — `nodes` table with all fields from §3.6 Migration 002. Includes RLS policy `org_members_access_nodes`. Acceptance: table exists with 30+ columns; all 6 indexes present; RLS enabled.
- [ ] **T-3.3.** Migration **003** — `node_versions`, `node_comments`, `node_context_links` with their RLS policies. Spec: §3.6 Migration 003. Acceptance: 3 tables; RLS enabled on all.
- [ ] **T-3.4.** Migration **004** — `agent_jobs`, `agent_reports` with indexes and RLS. Spec: §3.6 Migration 004. Acceptance: 2 tables; RLS enabled.
- [ ] **T-3.5.** Migration **005** — `conversations`, `conversation_messages`, `workflows`, `workflow_steps` with RLS. Spec: §3.6 Migration 005. Acceptance: 4 tables; RLS enabled; the `conversation_messages` policy chains through `conversations`.
- [ ] **T-3.6.** Migration **006** — `node_locks`, `usage_records`, `subscription_events`, `audit_log` with RLS. Spec: §3.6 Migration 006. Acceptance: 4 tables; the `audit_log` policy is restricted to `owner`/`admin` for SELECT.
- [ ] **T-3.7.** Migration **007** — Add `layer_stacks.document_id` FK to `documents`; create `export_jobs` with RLS. Spec: §3.6 Migration 007. Acceptance: FK exists with `ON DELETE CASCADE`; `export_jobs` has the RLS policy.
- [ ] **T-3.8.** Migration **008** — `backup_configs`, `backup_jobs` with RLS. Spec: §3.6 Migration 008. Acceptance: 2 tables; RLS enabled.
- [ ] **T-3.9.** Migration **009** — `nodes.mobile_notes` and `nodes.attachment_count` (`IF NOT EXISTS`). Spec: §3.6 Migration 009. Acceptance: columns present; GIN index `idx_nodes_mobile_notes` exists.
- [ ] **T-3.10.** Migration **010** — `node_attachments` table, `update_attachment_count()` trigger function and trigger, Storage bucket `node-attachments` with size and MIME limits, storage RLS policy. Spec: §3.6 Migration 010. Acceptance: table, trigger, bucket all present; bucket has `file_size_limit = 52428800`.
- [ ] **T-3.11.** Migration **011** — `director_configs`, `documents.director_config_id` FK, `scheduled_jobs`, the seed Director v1.0 row. Spec: §3.6 Migration 011. Acceptance: tables exist; one `director_configs` row with `status = 'production'`. The seed row's `system_prompt` is currently a placeholder string (`'-- loaded from supabase/seed/director-v1.0.txt --'` per the migration); creating the actual prompt file is a Phase 5 task — Phase 1 stores the placeholder verbatim.
- [ ] **T-3.12.** Migration **012** — `platform_config` table. Spec: Technical Architecture §3.7.2. Acceptance: table exists with 6 columns; RLS enabled with no user-facing read policy.
- [ ] **T-3.13.** Run `npm run db:types` to regenerate `lib/types/database.ts`. Spec: Hazard H-10. Acceptance: file regenerated; `npm run type-check` passes; **the file is not edited by hand**.
- [ ] **T-3.14.** Verify the H-03 trigger from Technical Architecture §5 H-03 is in place. If §3.6 Migration 001 does not include the trigger (it does not — the migration creates `organisations` and `organisation_members` but not the `auth.users` trigger), add a new migration **001a_handle_new_user_trigger.sql** that defines `handle_new_user()` and the `on_auth_user_created` trigger. Acceptance: a new user inserted into `auth.users` automatically results in a matching `organisations` row and an `organisation_members` row with `role = 'owner'`. Verified via `supabase db reset` followed by inserting a synthetic user (or via Studio sign-up).

  **Spec gap note (G-?):** The Technical Architecture documents the trigger only in the Hazards register (H-03), not in the migration sequence. This task creates the missing migration. After Phase 1 merge, propose adding the trigger SQL to the §3.6 Migration list (likely as Migration 001 addendum) so future readers see it in the migration sequence rather than only in the hazards register.

  **Trigger SQL (verbatim from H-03):**
  ```sql
  CREATE OR REPLACE FUNCTION handle_new_user()
  RETURNS TRIGGER SECURITY DEFINER AS $$
  DECLARE
    new_org_id UUID;
    user_name  TEXT;
    user_slug  TEXT;
  BEGIN
    user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
    user_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]+', '-', 'g'));
    -- ensure slug uniqueness by suffixing the user id if needed
    IF EXISTS (SELECT 1 FROM organisations WHERE slug = user_slug) THEN
      user_slug := user_slug || '-' || substr(NEW.id::text, 1, 8);
    END IF;
    INSERT INTO organisations (name, slug) VALUES (user_name, user_slug)
      RETURNING id INTO new_org_id;
    INSERT INTO organisation_members (organisation_id, user_id, role)
      VALUES (new_org_id, NEW.id, 'owner');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  ```

  This expands the H-03 sketch with two practical safeguards: (a) fallback to `split_part(email, '@', 1)` when no `name` metadata is supplied (e.g. magic-link signups); (b) slug uniqueness via user-id suffix. Both safeguards are ordinary defensive coding, not contested design choices, but flag them in the Test Report under "specification updates required" so Technical Architecture v1.4 can absorb them.

- [ ] **T-3.15.** Verify `organisation_members` RLS policy uses `user_id = auth.uid()` directly (not a self-referential subquery). Spec: Hazard H-02. Acceptance: in Studio, the policy SQL contains exactly `USING (user_id = auth.uid())`; query timing on `SELECT * FROM organisation_members` returns instantly (no recursion timeout).

  Migration 001 in §3.6 does not show explicit RLS policies for `organisation_members`. If T-3.1 leaves the table with no policy, add the policy here (idempotent migration **001b_membership_rls.sql**):

  ```sql
  ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "members_see_their_orgs" ON organisation_members
    FOR SELECT USING (user_id = auth.uid());
  CREATE POLICY "users_self_insert_membership" ON organisation_members
    FOR INSERT WITH CHECK (user_id = auth.uid());
  -- No UPDATE/DELETE policy — those are V2 (admin operations only).
  ```

  Add the same explicit RLS for `organisations`:

  ```sql
  ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "members_see_their_orgs" ON organisations
    FOR SELECT USING (
      id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    );
  -- No INSERT policy — organisations are created exclusively by the H-03 SECURITY DEFINER trigger.
  -- No UPDATE/DELETE policy in Phase 1 — V2 introduces owner-only update.
  ```

  Add the same for `projects` and `documents`:

  ```sql
  ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "org_members_access_projects" ON projects
    FOR ALL USING (
      organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    );

  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "org_members_access_documents" ON documents
    FOR ALL USING (
      organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    );

  ALTER TABLE layer_stacks ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "layer_stacks_access" ON layer_stacks
    FOR ALL USING (
      organisation_id IS NOT NULL
      AND organisation_id IN (SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())
    );
  -- The is_template = TRUE rows have organisation_id IS NULL and are read by the service role only,
  -- never directly by the user — the document-creation route reads templates via the service-role client.
  ```

  Acceptance: every Phase 1 user-data table (`organisations`, `organisation_members`, `projects`, `documents`, `layer_stacks`) has an explicit RLS policy verified in Studio.

  **Spec note:** Migration 001 in Technical Architecture v1.3 §3.6 does not include these policies; T-3.15 adds them as a separate Phase 1 migration. Flagged in §6 below for incorporation into Technical Architecture v1.4 (specification gap).

### 3.4 Layer-stack template seed [APPROVED 2026-05-03]

The Tier-A documents specify that Phase 1 ships built-in templates for Novel, Short Story, and Series, but they do not specify the `layer_stacks.layers` JSONB shape. The shape below is the **minimum** that supports forking-at-creation and a Phase 2 tree renderer. **Approved by the human on 2026-05-03 with no additional fields requested.** Shape is locked for Phase 1; subsequent phases may add JSONB keys without a migration.

**Approved shape:**

```json
{
  "layers": [
    { "index": 0, "node_type": "book",    "label": "Book",    "description": "Top-level container" },
    { "index": 1, "node_type": "act",     "label": "Act",     "description": "Major structural division" },
    { "index": 2, "node_type": "chapter", "label": "Chapter", "description": "Standard chapter" },
    { "index": 3, "node_type": "scene",   "label": "Scene",   "description": "A single dramatic unit" },
    { "index": 4, "node_type": "beat",    "label": "Beat",    "description": "Atomic prose unit" }
  ]
}
```

`layers` is an ordered array of objects, each with `index` (integer, ascending from 0), `node_type` (string, snake_case identifier matching the eventual Phase 2 node-type registry), `label` (string, display name), and `description` (string).

The three V1 templates differ only in their `layers` array:

- **Novel:** `book → act → chapter → scene → beat` (5 layers as above).
- **Short Story:** `story → scene → beat` (3 layers).
- **Series:** `series → book → act → chapter → scene → beat` (6 layers).

This shape is **deliberately minimal** — it carries only what the layer concept needs (ordered hierarchy of types). Anything richer (per-layer status defaults, prose-vs-summary policy per layer, default agent profile per layer) is deferred to the phase that needs it. The structure is forward-compatible: new fields can be added without a migration because the column is JSONB.

- [x] **T-3.16.** **Human-approval gate — CLEARED 2026-05-03.** Layer-stack `layers` JSONB shape approved as proposed; no additional fields requested. Implementation may proceed to T-3.17 without further approval.
- [ ] **T-3.17.** Create `supabase/seed.sql` (or extend the Migration 011 seed) with three `layer_stacks` rows, all `is_template = TRUE`, `organisation_id = NULL`, `document_id = NULL`. Each row has `name`, `document_type`, and the `layers` JSONB shown above. Acceptance: Studio shows three template rows; selecting one returns a `layers` array of the expected length.
- [ ] **T-3.18.** Add the platform-config seeds from Technical Architecture §3.7.5 to `supabase/seed.sql`. Acceptance: `platform_config` row count matches the canonical key list in §3.7.4 (40 keys plus or minus any future additions).
- [ ] **T-3.19.** Make `supabase/seed.sql` re-runnable: every INSERT uses `ON CONFLICT (...) DO NOTHING` (or equivalent). Apply via `supabase db execute --file supabase/seed.sql` and re-apply to confirm no errors and no duplicate rows. Acceptance: two consecutive applications produce identical row counts.

### 3.5 `getConfig()` helper

Authoritative spec: Technical Architecture v1.3 §3.7.3.

- [ ] **T-4.1.** Create `lib/config/platform-config.ts` exporting `getConfig`, `getConfigInt`, `getConfigString`, `getConfigBool` per the §3.7.3 listing. Use the service-role client from T-2.3. Cache TTL: 60 seconds. Acceptance: a unit test (or a temporary `app/api/_debug/config` route under `NODE_ENV=development` only) reads e.g. `token_budget.trial` and returns `1000000`.
- [ ] **T-4.2.** Phase 1 has limited need for `getConfig()` calls (no agent code, no token budget enforcement yet). Audit the Phase 1 code added in §3.6 and §3.7 below for any numeric or string literal that should come from `platform_config` per Hazard H-12. Acceptance: every operationally-tunable value in the Phase 1 codebase is read via `getConfig()`. Examples in Phase 1: none currently identified — but the audit must produce a documented null result rather than an unaudited assumption.

### 3.6 Auth UI

Authoritative spec: Product Specification v1.2 §4.1; design tokens in `styles/tokens.css`; component spec in `stelavox_component_specification_v2_0.md`.

> The auth screens are styled per the brand: dark / light per token defaults; Inter on form labels and buttons; verdigris reserved per the Five Inviolables (which means the auth screens use no verdigris — they are not one of the nine permitted locations). Use `--color-text-primary` for primary CTAs.

- [ ] **T-5.1.** Create `app/(auth)/layout.tsx` — the auth shell. Plain centred form, no app chrome. Acceptance: visiting any `/login`, `/signup`, etc. route uses this layout, not the main app shell.
- [ ] **T-5.2.** Create `app/(auth)/signup/page.tsx`. Form fields: name, email, password, confirm password. Calls `supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: '/auth/callback' } })`. On success: shows "check your email" state. Acceptance: signup form submits; success message shown; verification email visible in Inbucket.
- [ ] **T-5.3.** Create `app/(auth)/login/page.tsx`. Two flows on the same page: email + password, and "magic link" toggle. Calls `signInWithPassword` or `signInWithOtp`. Acceptance: both flows authenticate against an existing user; magic-link email visible in Inbucket.
- [ ] **T-5.4.** Create `app/(auth)/forgot-password/page.tsx` and `app/(auth)/reset-password/page.tsx`. Forgot calls `resetPasswordForEmail`; Reset reads the recovery code, sets the new password via `updateUser({ password })`. Acceptance: end-to-end password-reset flow completes via Inbucket.
- [ ] **T-5.5.** Create `app/auth/callback/route.ts` — the redirect handler. `GET` reads `code` query param; calls `supabase.auth.exchangeCodeForSession(code)`; redirects to `/dashboard` on success or `/login?error=<reason>` on failure. Acceptance: clicking an Inbucket verification link lands on the dashboard.
- [ ] **T-5.6.** Confirm the H-03 trigger fires on every signup path (email + password, magic link). Acceptance: after every signup test, Studio shows a fresh `organisations` row and `organisation_members` row.

### 3.7 Authenticated app shell and routes

- [ ] **T-6.1.** Create `app/(app)/layout.tsx` — wraps authenticated routes; redirects to `/login` if no session. Renders the user menu (sign out). Acceptance: navigating to `/dashboard` while logged out redirects; while logged in, the user menu is present.
- [ ] **T-6.2.** Create `app/(app)/dashboard/page.tsx` — server component. Fetches the user's projects via the server Supabase client and renders the list with a "New project" button. Empty state shown when no projects. Acceptance: TC-U-06 setup works.
- [ ] **T-6.3.** Create `app/(app)/projects/[projectId]/page.tsx` — server component. Fetches the project and its documents. Shows the document list with a "New document" button. 404 page when the project is not visible. Acceptance: TC-U-07 setup works; TC-U-09 produces the not-found state.
- [ ] **T-6.4.** Create `app/(app)/projects/[projectId]/documents/[documentId]/page.tsx` — Phase 1 stub. Renders the document name, status, and a placeholder where the editor will go in later phases. Acceptance: navigating to a valid document loads the page; cross-user navigation produces the not-found state.
- [ ] **T-6.5.** Create UI components for: "New project" button + dialog, "New document" button + dialog (with document type selector for V1 set), project context menu (Rename, Delete with confirmation), document menu (Rename, Archive, Delete with confirmation). Acceptance: TC-U-06, TC-U-07, TC-U-08, TC-U-11 all run.

### 3.8 API routes

> Pattern reminder (Technical Architecture v1.3 §3.4): API routes are thin — validate, authenticate, delegate to `lib/`. Business logic in `lib/`. RLS enforces auth; routes do not filter by `user_id` directly.

- [ ] **T-7.1.** Create `lib/validation/projects.ts` — Zod schemas for project POST and PATCH bodies. Mirror API Contract §3.1 and §3.4 exactly, including the strict "no unknown keys" rule (`.strict()`). Acceptance: unit tests confirm the schemas accept all valid bodies and reject every documented invalid case.
- [ ] **T-7.2.** Create `lib/validation/documents.ts` — same for documents. Acceptance: same.
- [ ] **T-7.3.** Create `lib/validation/uuid.ts` — a UUID validator that returns either a typed string brand or a typed error. Acceptance: rejects non-UUID strings; accepts canonical UUIDs.
- [ ] **T-7.4.** Create `lib/api/errors.ts` — helper that produces the `{ error, message? }` JSON body and the right status code. Used by every route to keep the error envelope identical. Acceptance: every route uses this helper.
- [ ] **T-7.5.** Create `lib/data/projects.ts` — typed CRUD wrappers over the Supabase server client for projects. `createProject`, `listProjects`, `getProject`, `updateProject`, `deleteProject`. Acceptance: each function returns the contract shape exactly; types come from `lib/types/database.ts`.
- [ ] **T-7.6.** Create `lib/data/documents.ts` — same for documents, plus `createDocumentWithLayerStack` which performs the atomic two-insert transaction (T-7.7). Acceptance: each function returns the contract shape; the create function returns both `document` and `layer_stack` in a single result.
- [ ] **T-7.7.** Create the SQL function `create_document_with_layer_stack(...)` as a `SECURITY INVOKER` Postgres function so the two inserts happen in a single transaction with RLS enforced by the caller's session. Add it as Migration **013_create_document_with_layer_stack.sql**. Acceptance: function is callable from the route via `supabase.rpc('create_document_with_layer_stack', { ... })`; on RLS failure, both inserts roll back.

  **Function sketch:**
  ```sql
  CREATE OR REPLACE FUNCTION create_document_with_layer_stack(
    p_project_id UUID,
    p_organisation_id UUID,
    p_name TEXT,
    p_description TEXT,
    p_document_type TEXT,
    p_authors TEXT[]
  ) RETURNS JSONB
  LANGUAGE plpgsql SECURITY INVOKER AS $$
  DECLARE
    v_template layer_stacks%ROWTYPE;
    v_doc_id UUID := gen_random_uuid();
    v_stack_id UUID := gen_random_uuid();
  BEGIN
    -- Templates are organisation_id IS NULL and bypass user RLS only because we read via service role
    -- in the API route. This RPC is invoked by the user's session, so we read the template via a
    -- separate dedicated SELECT from a SECURITY DEFINER companion function; or, equivalently, the
    -- API route fetches the template with the service-role client and passes the full layers JSONB
    -- as a parameter. The build-checklist task implements the latter for simplicity.
    -- (Spec note: the contract permits 500 missing_template if the lookup fails.)
    INSERT INTO documents (id, organisation_id, project_id, name, description, document_type,
                           layer_stack_id, status, authors, export_settings)
    VALUES (v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
            v_stack_id, 'active', COALESCE(p_authors, '{}'), '{}'::jsonb)
    RETURNING id INTO v_doc_id;

    INSERT INTO layer_stacks (id, document_id, organisation_id, name, document_type, is_template, layers)
    VALUES (v_stack_id, v_doc_id, p_organisation_id,
            (SELECT name FROM layer_stacks WHERE is_template AND document_type = p_document_type AND organisation_id IS NULL LIMIT 1),
            p_document_type, FALSE,
            (SELECT layers FROM layer_stacks WHERE is_template AND document_type = p_document_type AND organisation_id IS NULL LIMIT 1));

    -- Final return: rows are visible inside the transaction
    RETURN jsonb_build_object(
      'document',    (SELECT row_to_json(d) FROM documents d WHERE d.id = v_doc_id),
      'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id)
    );
  END;
  $$;
  ```

  Note: the template lookup inside this function reads `layer_stacks` rows where `organisation_id IS NULL`. The RLS policy from T-3.15 explicitly excludes those rows from user-session reads. To bypass, use `SECURITY DEFINER` for the template lookup OR pass the template's `name` and `layers` from the API route (which used the service-role client to fetch them). The build agent picks one and notes the choice; recommend the parameter-passing approach for simpler RLS reasoning.

- [ ] **T-7.8.** Implement `app/api/projects/route.ts` — `POST` and `GET` per API Contract §3.1 and §3.2. Acceptance: TC-A-01 through TC-A-17 pass.
- [ ] **T-7.9.** Implement `app/api/projects/[projectId]/route.ts` — `GET`, `PATCH`, `DELETE` per §3.3, §3.4, §3.5. Acceptance: TC-A-18 through TC-A-37 pass.
- [ ] **T-7.10.** Implement `app/api/projects/[projectId]/documents/route.ts` — `POST` and `GET` per §3.6 and §3.7. The `POST` handler:
  1. Resolves the caller's organisation per the contract §2.10.
  2. Verifies the project is visible (`maybeSingle()` — Hazard H-01).
  3. Reads the matching template via the service-role client (templates are `organisation_id IS NULL`).
  4. Calls `create_document_with_layer_stack` (or executes the two inserts in a JS-level transaction wrapper).
  5. Returns the contract shape.
  Acceptance: TC-A-38 through TC-A-59 pass.
- [ ] **T-7.11.** Implement `app/api/documents/[documentId]/route.ts` — `GET`, `PATCH`, `DELETE` per §3.8, §3.9, §3.10. Acceptance: TC-A-60 through TC-A-80 pass.
- [ ] **T-7.12.** Wire all UI mutations from §3.7 to the API routes. Acceptance: every UI test in §2 of the Test Plan can create the state it needs through the UI rather than directly via the DB.

### 3.9 Phase A → Phase B smoke test (parallelisable with T-8.x)

- [ ] **T-9.1.** Apply all migrations to `stelavox-dev` cloud project: `supabase link --project-ref <dev-ref>` then `supabase db push`. Acceptance: 12 migrations applied; Studio shows the same schema as Phase A.
- [ ] **T-9.2.** Apply seed file to `stelavox-dev`. Acceptance: same row counts in `platform_config`, `layer_stacks` (templates), `director_configs`.
- [ ] **T-9.3.** Reconfigure `.env.local` to Phase B values (per Local Dev Setup §3.4) and re-run TC-U-01, TC-U-06, TC-U-07, TC-U-09 against the cloud DB. Acceptance: all four pass with the cloud project. Then revert `.env.local` to Phase A for further work.

### 3.10 Test execution

- [ ] **T-10.1.** Implement the test harness as specified in Test Plan §1.4. Acceptance: `npm run test` executes Sections 2–5 of the Test Plan.
- [ ] **T-10.2.** Run all 118 test cases. Acceptance: every test passes. Failures are recorded in the Test Report (created in Stage 5 of the Pipeline) and triaged before re-test.
- [ ] **T-10.3.** Run `npm run build`, `npm run lint`, `npm run type-check`. Acceptance: all three commands exit 0.

### 3.11 Pre-merge checks

- [ ] **T-11.1.** Diff review: re-read every changed file. Confirm no hardcoded operational values; no Cinzel or Cormorant outside `components/brand/`; no verdigris outside the nine permitted locations (Phase 1 introduces zero of the nine — none of the nine surfaces exists yet — so the count must be exactly zero in Phase 1 code).
- [ ] **T-11.2.** Confirm `lib/types/database.ts` matches the migrated schema. Acceptance: regenerate; `git diff` is empty.
- [ ] **T-11.3.** Confirm CLAUDE.md and the docs library copy of CLAUDE.md (`docs/CLAUDE_stelavox_project.md`) are byte-identical. Acceptance: `diff CLAUDE.md docs/CLAUDE_stelavox_project.md` is empty.
- [ ] **T-11.4.** Update CLAUDE.md's Spec Library Reference table if any spec document version was bumped during Phase 1 (e.g. Technical Architecture v1.3 → v1.4 if T-3.14 / T-3.15 / T-7.7 spec gaps are absorbed). Acceptance: the Spec Library Reference table reflects the latest versions of all referenced docs.
- [ ] **T-11.5.** Bump the Phase 1 version of these Tier-B documents if any change has been made since v1.0. Acceptance: every Tier-B document's changelog has an entry for the latest version.
- [ ] **T-11.6.** Compose the Phase 1 Test Report at `docs/stelavox_phase1_test_report_v1_0.md` per AI-Native Spec Standard §2.12. Acceptance: every test case in the Test Plan is listed with PASS / FAIL and (if FAIL) root cause + fix + re-test outcome.

---

## 4. Locked Migration Ordering

Migrations apply in this exact order. Reordering any item below produces FK violations or RLS-policy-on-missing-table errors. **Do not change.**

```
001  core_tables                        (organisations, organisation_members, organisation_invites,
                                         projects, layer_stacks, documents, agent_profiles)
001a handle_new_user_trigger            (T-3.14 — H-03 trigger)
001b membership_rls                     (T-3.15 — Phase 1 RLS policies for org/membership/projects/documents/layer_stacks)
002  nodes
003  versioning_comments_context_links  (node_versions, node_comments, node_context_links)
004  agent_jobs_and_reports
005  director_tables                    (conversations, conversation_messages, workflows, workflow_steps)
006  multi_tenancy_support              (node_locks, usage_records, subscription_events, audit_log)
007  export_and_layer_stack_fk          (layer_stacks.document_id FK; export_jobs)
008  cloud_backup
009  mobile_notes_and_attachment_count
010  node_attachments                   (table, trigger, storage bucket, storage RLS)
011  director_config_and_scheduler      (director_configs, documents.director_config_id FK,
                                         scheduled_jobs, seed Director v1.0 row)
012  platform_config
013  create_document_with_layer_stack   (T-7.7 — RPC for atomic document creation)
```

Migrations 001a, 001b, and 013 are introduced in Phase 1 and are not yet documented in Technical Architecture v1.3 §3.6. They must be incorporated into the next minor version of that document (see §6 below).

---

## 5. Migration Authority Note

Every column, type, default, and CHECK constraint summarised in §3 above is a **summary** of the migration SQL files. **The migration SQL is authoritative.** When implementing any task that involves a column or constraint, the agent reads the SQL file rather than the prose summary. If the prose summary in this checklist disagrees with the SQL, the SQL wins and the checklist is corrected (with a version bump).

---

## 6. Specification Updates Required After Phase 1

These are tracked here so they cannot be forgotten when Phase 1 merges. Each becomes a follow-up PR against the Tier-A documents.

| # | Document | Change | Reason |
|---|---|---|---|
| SU-1 | Technical Architecture §3.6 | Add Migration 001a (H-03 trigger) and 001b (membership/project/document RLS) to the migration list. | T-3.14 and T-3.15 added them as Phase 1 work; they belong in the migration sequence, not just in the hazards register. |
| SU-2 | Technical Architecture §3.6 | Add Migration 013 (`create_document_with_layer_stack` RPC). | T-7.7 added it. |
| SU-3 | Technical Architecture §11 | Note that Phase 1 introduces Migrations 001a, 001b, and 013 in addition to 001–012. | Accuracy. |
| SU-4 | Product Specification §4.6 | Document the `layer_stacks.layers` JSONB shape (the §3.4 proposal in this checklist, post-approval). | Removes the Phase 1 spec gap so future phases have an authoritative shape. |
| SU-5 | Technical Architecture §3.6 (Migration 001) | Document the `default_document_type` allowed values constraint at the API layer (currently only validated by the API; no DB CHECK). | Keeps the API contract defensible without a DB CHECK so adding V2 types is a code-only change. (Optional — could go either way.) |

The Test Report records which of these were incorporated post-merge.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| H-03 trigger fails for an edge-case email format | Low | High (user gets stuck) | T-3.14 adds slug-collision and missing-name fallbacks. TC-U-02 (magic-link signup with no name metadata) covers it. |
| RLS policy mistake leaks data across orgs | Low | Critical | TC-B-01 through TC-B-16 directly probe every endpoint and every direct DB path. |
| Migration order changes between dev and prod | Low | High | Migrations are numbered SQL files committed to git; `supabase db push` applies them in filename order. T-9.x verifies cloud-side. |
| Layer-stack template seed shape changes mid-phase | Medium | Medium | T-3.16 forces a human-approval gate before the seed is written. After approval, the shape is locked for the phase. |
| Hardcoded operational values slip in | Medium | Low (not yet load-bearing in Phase 1, but compounding) | T-4.2 audit; T-11.1 diff review. |
| `.maybeSingle()` vs `.single()` confusion | Medium | Medium | H-01 is in the project CLAUDE.md and is reviewed before T-7.5 / T-7.6 implementation. |
| Two-insert document creation produces orphans on partial failure | Low | High (data integrity) | T-7.7 wraps in a Postgres function or a single-transaction RPC; TC-A-50 and TC-D-07 verify. |

---

## 8. Approval

This checklist is approved before §3 work begins. Approval must include explicit sign-off on §3.4 (the layer-stack JSON shape). After approval, changes are version-bumped, not silently edited.

---

## 9. Changelog

**v1.0 — 2026-05-03** Initial Phase 1 Build Checklist. 11 task groups, ~70 tasks total, ordered to satisfy the Phase 1 checkpoint criterion. Three migrations introduced beyond Technical Architecture §3.6 (001a, 001b, 013) — flagged for inclusion in TA v1.4 via SU-1, SU-2, SU-3. The §3.4 layer-stack JSON shape was approved by the human on 2026-05-03; PB-6 and T-3.16 cleared on the same date. Checklist is now approved and ready for §3 work to begin.
