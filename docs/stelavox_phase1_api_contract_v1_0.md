# Stelavox — Phase 1 API Contract
## Version 1.0

> **Tier-B per-phase document.** Single source of truth for every API endpoint introduced in Phase 1. Frozen for the duration of Phase 1. Changes after approval are version-bumped on this document, not silently edited.

**Phase:** 1 — Foundation: auth, orgs, project/document CRUD, full multi-tenant schema
**Authoritative spec sources:** `stelavox_technical_architecture_v1_3.md`, `stelavox_product_specification_v1_2.md`
**Companion documents:** `stelavox_phase1_test_plan_v1_0.md`, `stelavox_phase1_build_checklist_v1_0.md`

---

## 1. Phase Scope

### 1.1 Routes added in Phase 1

| # | Route | Method | Purpose |
|---|---|---|---|
| 1 | `/api/projects` | `POST` | Create a project in the caller's organisation |
| 2 | `/api/projects` | `GET` | List projects in the caller's organisation |
| 3 | `/api/projects/[projectId]` | `GET` | Read a single project |
| 4 | `/api/projects/[projectId]` | `PATCH` | Rename / update project metadata |
| 5 | `/api/projects/[projectId]` | `DELETE` | Delete a project (cascades to documents and nodes) |
| 6 | `/api/projects/[projectId]/documents` | `POST` | Create a document in a project (forks layer stack from template) |
| 7 | `/api/projects/[projectId]/documents` | `GET` | List documents in a project |
| 8 | `/api/documents/[documentId]` | `GET` | Read a single document |
| 9 | `/api/documents/[documentId]` | `PATCH` | Rename / archive a document |
| 10 | `/api/documents/[documentId]` | `DELETE` | Delete a document |

### 1.2 Routes modified in Phase 1

None. Phase 1 is greenfield.

### 1.3 Routes removed in Phase 1

None.

### 1.4 Auth surface

Authentication uses Supabase Auth's client SDK. Stelavox adds **no custom auth API endpoints** in Phase 1. The auth surface is:

- **Sign up (email + password):** `supabase.auth.signUp({ email, password, options: { data: { name } } })`
- **Sign in (email + password):** `supabase.auth.signInWithPassword({ email, password })`
- **Magic link:** `supabase.auth.signInWithOtp({ email })`
- **Password reset:** `supabase.auth.resetPasswordForEmail(email)`
- **Sign out:** `supabase.auth.signOut()`
- **Session refresh:** handled automatically by Supabase Auth middleware

The only Stelavox-owned route on the auth surface is a thin redirect handler:

| Route | Method | Purpose |
|---|---|---|
| `/auth/callback` | `GET` | Supabase Auth code-exchange handler (email confirmation, magic link) |

`/auth/callback` exchanges the `code` query parameter for a session via `supabase.auth.exchangeCodeForSession(code)` and redirects to `/dashboard` on success or `/login?error=...` on failure. No JSON body. Not part of the API surface for testing purposes; covered by UI tests.

**Auto-organisation creation** is implemented as an `auth.users` `AFTER INSERT` trigger that calls a `SECURITY DEFINER` function (per Hazard H-03). This is a database-layer concern, not an API concern. Verified in the Test Plan via TC-A-04.

---

## 2. Cross-Cutting Rules

### 2.1 Authentication

All Phase 1 API routes require an authenticated Supabase session. The session is supplied as the Supabase auth cookie set by `@supabase/ssr` on the browser. Routes use the **server Supabase client** (`createServerClient`) — never the anon client and never the service-role client (except where explicitly noted).

**On every request, the route MUST:**

1. Construct a server Supabase client.
2. Call `supabase.auth.getUser()`.
3. If `user` is `null`, return `401 Unauthorised` with `{ "error": "unauthorised" }`.

### 2.2 Authorisation

All Phase 1 tables (`projects`, `documents`, `layer_stacks`) are protected by RLS policies that chain through `organisation_members.user_id = auth.uid()`. **API routes never filter by `user_id` directly.** The route uses the server Supabase client; RLS is the enforcement mechanism.

**Belt-and-braces ownership checks (per Technical Architecture §3.4) apply to PATCH and DELETE only.** GETs and POSTs that operate on a path-bound resource rely on RLS returning empty results for unauthorised access (which the route translates to `404`).

### 2.3 Error envelope

All error responses use this exact shape:

```json
{ "error": "<error_code>", "message": "<human-readable explanation>" }
```

`message` is optional; `error` is mandatory and is a stable machine-readable identifier (snake_case ASCII).

### 2.4 Status codes used in this phase

| Code | When |
|---|---|
| `200 OK` | Successful GET, PATCH, or DELETE |
| `201 Created` | Successful POST that created a resource |
| `400 Bad Request` | Request body or query param failed validation |
| `401 Unauthorised` | No valid session |
| `403 Forbidden` | Authenticated user has no organisation membership (rare; should not happen if H-03 trigger is correct) |
| `404 Not Found` | Resource does not exist OR exists but is not visible to this user (RLS empty result) |
| `409 Conflict` | Resource state prevents the operation (e.g. attempt to create with conflicting unique field) |
| `500 Internal Server Error` | Unhandled exception |

**`404` vs `403` choice:** A resource that exists but is owned by another organisation returns `404`, not `403`. This is to avoid leaking the existence of resources outside the caller's organisation. RLS produces this naturally — the row is invisible, the route's `maybeSingle()` returns `null`, the route returns `404`.

### 2.5 Validation rules — common

- All `name` fields: `1–200` characters after trimming. Whitespace-only strings reject as `400 invalid_name`. Leading/trailing whitespace is trimmed before validation and storage.
- All `description` fields: `0–5000` characters. `null` is permitted.
- All UUID path params: must match the canonical 36-character UUID format (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`). Malformed UUIDs return `400 invalid_uuid`. (Next.js will accept arbitrary strings in the dynamic segment; the route is responsible for validating.)
- All JSON request bodies must parse as JSON. Non-JSON bodies return `400 invalid_json`. Empty bodies on POST/PATCH return `400 missing_body`.
- Unknown fields in request bodies are **rejected** (return `400 unknown_field`). This is strict to catch typos and prevent silent loss of intent.

### 2.6 Idempotency

| Route | Idempotent | Mechanism |
|---|---|---|
| `POST /api/projects` | No | Each call creates a new row |
| `POST /api/projects/[id]/documents` | No | Each call creates a new document and forks a new `layer_stacks` row |
| `GET *` | Yes | Read-only |
| `PATCH *` | Yes (idempotent in the HTTP sense — same body produces same final state) | Last-write-wins on `updated_at` |
| `DELETE *` | Idempotent: deleting an already-deleted row returns `404` (the second call's view is correct) |

No `Idempotency-Key` header is honoured in Phase 1. Document creation is exposed to the duplicate-submit problem; mitigation is left to the UI in Phase 2+.

### 2.7 Rate limiting

Not implemented in Phase 1. (Vercel and Supabase apply infrastructure-level limits, but no per-user application-level rate limiting is configured. Tracked as a follow-up for V2.)

### 2.8 Pagination

Not implemented in Phase 1. List endpoints return all rows visible to the caller. **Implication:** an organisation with thousands of projects or documents will get a large response. This is acceptable for Phase 1 given the foundation scope. Tracked for Phase 2+ once node trees create real volume.

### 2.9 Timestamps and date formats

All timestamps are ISO 8601 UTC strings produced by `JSON.stringify` of a JavaScript `Date`: `"2026-05-03T12:34:56.789Z"`. No timezones other than UTC are emitted. Timestamps in request bodies are not accepted in Phase 1 (the database sets `created_at` and `updated_at`; clients cannot override).

### 2.10 Caller's organisation

All Phase 1 endpoints operate within "the caller's organisation". Per Phase 1 scope, every user has exactly **one** organisation (created by the H-03 trigger at signup). The route resolves it as:

```sql
SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid() LIMIT 1
```

If this query returns zero rows, the route returns `403 no_organisation` (an indication that the H-03 trigger failed for this user — a system error, not user error). Phase 2 introduces multi-org membership and active-org switching; Phase 1 assumes one membership per user.

---

## 3. Endpoint Specifications

> **Authoritative column lists:** Field names, types, constraints, and check constraints below summarise Migration 001 (`organisations`, `projects`, `layer_stacks`, `documents`) from Technical Architecture v1.3 §3.6. **The migration SQL is authoritative.** When in doubt, verify against `supabase/migrations/`.

---

### 3.1 `POST /api/projects` — Create project

**Authentication.** Required (§2.1).

**Authorisation.** Authenticated user must have at least one row in `organisation_members`. The new project is created in that organisation. RLS chain: `projects.organisation_id` IN `(SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid())` (insert policy).

**Request body schema.**

```typescript
{
  name: string,                    // required; 1–200 chars after trim
  description?: string | null,     // optional; 0–5000 chars; null permitted
  default_document_type?: string   // optional; one of 'novel' | 'short_story' | 'series' for V1
}
```

**Validation.**

- `name` — required, must be string, after trimming must be 1–200 chars. Reject empty / whitespace-only as `400 invalid_name`.
- `description` — if present, must be string or `null`, ≤5000 chars.
- `default_document_type` — if present, must be string, must be one of `'novel'`, `'short_story'`, `'series'`. Other values reject as `400 invalid_document_type`. (Other document types are V2+; rejecting them in Phase 1 is intentional.)
- Any other top-level field rejects as `400 unknown_field`.

**Response — success (`201 Created`).**

```typescript
{
  project: {
    id: string,                         // UUID
    organisation_id: string,            // UUID
    name: string,
    description: string | null,
    default_document_type: string | null,
    metadata: Record<string, unknown>,  // empty object {} for new projects
    created_at: string,                 // ISO 8601 UTC
    updated_at: string                  // ISO 8601 UTC
  }
}
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_json` | Request body did not parse as JSON |
| `400` | `missing_body` | Request body is empty |
| `400` | `invalid_name` | `name` missing, not a string, or empty after trim, or >200 chars |
| `400` | `invalid_description` | `description` not a string/null or >5000 chars |
| `400` | `invalid_document_type` | `default_document_type` not in the V1 set |
| `400` | `unknown_field` | Unknown top-level key in body |
| `401` | `unauthorised` | No session |
| `403` | `no_organisation` | User has no `organisation_members` row |
| `500` | `internal_error` | Unhandled exception |

**Side effects.**

- One row inserted into `projects` with `organisation_id` resolved per §2.10.
- No other writes.

**Idempotency.** Not idempotent. Each call creates a new row.

---

### 3.2 `GET /api/projects` — List projects

**Authentication.** Required.

**Authorisation.** RLS returns only rows whose `organisation_id` is in the caller's `organisation_members`.

**Query parameters.**

- `status` — optional. Reserved for future use; **rejected with `400 unknown_param`** in Phase 1 if supplied. (Kept here so future addition is non-breaking.)

No other query parameters are accepted. Unknown parameters reject as `400 unknown_param`.

**Response — success (`200 OK`).**

```typescript
{
  projects: Array<{
    id: string,
    organisation_id: string,
    name: string,
    description: string | null,
    default_document_type: string | null,
    metadata: Record<string, unknown>,
    created_at: string,
    updated_at: string
  }>
}
```

Order: `created_at DESC` (most recent first). Empty array if no projects.

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `unknown_param` | Any unrecognised query parameter |
| `401` | `unauthorised` | No session |
| `403` | `no_organisation` | User has no `organisation_members` row |
| `500` | `internal_error` | Unhandled exception |

**Side effects.** None.

**Idempotency.** Yes (read-only).

---

### 3.3 `GET /api/projects/[projectId]` — Read project

**Authentication.** Required.

**Authorisation.** RLS chain on `projects` table.

**Path parameters.**

- `projectId` — UUID. Malformed → `400 invalid_uuid`.

**Response — success (`200 OK`).**

```typescript
{
  project: {
    id: string,
    organisation_id: string,
    name: string,
    description: string | null,
    default_document_type: string | null,
    metadata: Record<string, unknown>,
    created_at: string,
    updated_at: string
  }
}
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `projectId` not a valid UUID |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Project does not exist OR is not visible to caller (RLS empty result) |
| `500` | `internal_error` | Unhandled exception |

**Side effects.** None.

**Idempotency.** Yes.

---

### 3.4 `PATCH /api/projects/[projectId]` — Update project

**Authentication.** Required.

**Authorisation.** RLS-based. Belt-and-braces: route fetches the project first via `maybeSingle()`; if `null`, returns `404` before attempting the update.

**Path parameters.** `projectId` — UUID.

**Request body schema.** All fields optional; at least one must be present.

```typescript
{
  name?: string,                    // 1–200 chars after trim
  description?: string | null,      // 0–5000 chars; null permitted
  default_document_type?: string    // 'novel' | 'short_story' | 'series' (V1) — or null to clear
}
```

**Validation.**

- Body must be a JSON object with at least one key. Empty object → `400 empty_update`.
- Same field rules as POST (§3.1).
- Unknown fields → `400 unknown_field`.
- `id`, `organisation_id`, `metadata`, `created_at`, `updated_at` may **not** be set via PATCH. Including any of them returns `400 unknown_field`. (`metadata` is reserved for later phases.)

**Response — success (`200 OK`).**

```typescript
{
  project: {
    id: string,
    organisation_id: string,
    name: string,
    description: string | null,
    default_document_type: string | null,
    metadata: Record<string, unknown>,
    created_at: string,
    updated_at: string                // bumped to NOW()
  }
}
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `projectId` not a valid UUID |
| `400` | `invalid_json` / `missing_body` | Body parsing failed or empty |
| `400` | `empty_update` | Body has no permitted fields |
| `400` | `invalid_name` / `invalid_description` / `invalid_document_type` / `unknown_field` | Field validation failures |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Project does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.**

- One `UPDATE` on `projects` setting the supplied columns plus `updated_at = NOW()`.
- No other writes.

**Idempotency.** Yes (HTTP idempotent — same body produces same final state).

---

### 3.5 `DELETE /api/projects/[projectId]` — Delete project

**Authentication.** Required.

**Authorisation.** RLS-based. Belt-and-braces fetch first; `404` if not visible.

**Path parameters.** `projectId` — UUID.

**Request body.** Must be empty. Non-empty body → `400 unexpected_body`.

**Response — success (`200 OK`).**

```json
{ "deleted": true, "project_id": "<uuid>" }
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `projectId` not a valid UUID |
| `400` | `unexpected_body` | Request body not empty |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Project does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.**

- The matched row in `projects` is deleted.
- `documents` rows referencing this project cascade-delete (FK `ON DELETE CASCADE`).
- `nodes` rows referencing those documents cascade-delete (FK chain).
- `layer_stacks` rows for those documents cascade-delete via `documents → layer_stacks` FK chain (Migration 007).
- All other tables that FK to `projects`, `documents`, or `nodes` cascade per their migration definitions.

**Cascade delete is destructive and irreversible in Phase 1.** No soft-delete. (Versioning exists at node level but not at project level.) The UI must therefore present a confirmation step before calling DELETE; that is a UI requirement (see UI checkpoint test TC-U-08), not an API requirement.

**Idempotency.** Idempotent in the HTTP sense — a second DELETE on the same `projectId` returns `404`, which is the correct view of the post-delete state.

---

### 3.6 `POST /api/projects/[projectId]/documents` — Create document

**Authentication.** Required.

**Authorisation.** Project must exist and be visible to caller (RLS on `projects`). New document inherits `organisation_id` from the project. RLS on `documents` and `layer_stacks` ensures the caller has permission to insert.

**Path parameters.** `projectId` — UUID.

**Request body schema.**

```typescript
{
  name: string,                       // required; 1–200 chars after trim
  description?: string | null,        // optional; 0–5000 chars
  document_type: 'novel' | 'short_story' | 'series',  // required; V1 set only
  authors?: string[]                  // optional; array of strings, each 1–100 chars; max 20 entries; default []
}
```

**Validation.**

- `name` — same as project name rules.
- `document_type` — required; reject anything outside the V1 set (`'novel'`, `'short_story'`, `'series'`) as `400 invalid_document_type`.
- `description` — same as project.
- `authors` — if present, must be an array of strings; each element trimmed must be 1–100 chars; max array length 20. Empty array permitted.
- Unknown fields → `400 unknown_field`.

**Server-side computed fields.**

- `organisation_id` — copied from `projects.organisation_id`.
- `project_id` — from path.
- `status` — defaults to `'active'` (DB default). Not settable in Phase 1.
- `layer_stack_id` — see "Layer stack forking" below.
- `root_node_id` — `null` in Phase 1. (Root node creation is a Phase 2 deliverable. Documented null, observable null.)
- `director_config_id` — `null` in Phase 1. (Director is Phase 5.)
- `export_settings` — `{}`.

**Layer stack forking.** Per Product Specification §4.6 (Template forking) and Migration 001/007:

1. Look up the system layer-stack template matching `document_type` (`is_template = TRUE`, `document_type = <requested>`, `organisation_id IS NULL`).
2. If no template is found → `500 missing_template` (system seeding failure; should be impossible in a correctly seeded environment).
3. Insert a new row into `layer_stacks` with `is_template = FALSE`, `organisation_id = <document's org>`, `document_id = <new document id>`, `name = <template name>`, `document_type = <requested>`, `layers = <copied JSONB>`.
4. The forking inserts must occur in a single transaction with the document insert — partial state (document with no layer stack) is forbidden.

**Note on transaction boundary.** Because `layer_stacks.document_id` references `documents.id` (FK added in Migration 007), the document row must be inserted first, then the layer stack row, with both visible only on commit. Implement via a `SECURITY INVOKER` Postgres function `create_document_with_layer_stack(...)` or via Supabase JS sequential inserts wrapped in a Drizzle transaction. Either is acceptable; the build checklist specifies one approach.

**Response — success (`201 Created`).**

```typescript
{
  document: {
    id: string,
    organisation_id: string,
    project_id: string,
    name: string,
    description: string | null,
    document_type: string,
    layer_stack_id: string,             // FK to the forked stack
    root_node_id: null,                 // null in Phase 1
    status: 'active',
    export_settings: Record<string, unknown>,
    authors: string[],
    director_config_id: null,           // null in Phase 1
    created_at: string,
    updated_at: string
  },
  layer_stack: {
    id: string,
    document_id: string,
    organisation_id: string,
    name: string,
    document_type: string,
    is_template: false,
    layers: unknown[],                  // copied from template; opaque to API contract
    created_at: string,
    updated_at: string
  }
}
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `projectId` not a valid UUID |
| `400` | `invalid_json` / `missing_body` | Body parsing failed or empty |
| `400` | `invalid_name` / `invalid_description` / `invalid_document_type` / `invalid_authors` / `unknown_field` | Field validation failures |
| `401` | `unauthorised` | No session |
| `404` | `project_not_found` | Project does not exist OR not visible to caller |
| `500` | `missing_template` | No system layer-stack template seeded for this `document_type` |
| `500` | `internal_error` | Unhandled exception |

**Side effects.**

- One row inserted into `documents`.
- One row inserted into `layer_stacks` (forked copy).
- Both inserts in a single transaction.

**Idempotency.** Not idempotent. Each call creates new rows.

---

### 3.7 `GET /api/projects/[projectId]/documents` — List documents in a project

**Authentication.** Required.

**Authorisation.** RLS on `projects` ensures project visibility; RLS on `documents` filters to those belonging to a visible project.

**Path parameters.** `projectId` — UUID.

**Query parameters.**

- `status` — optional. One of `active`, `archived`, `published`. Filters results. If omitted, returns all statuses. Invalid value → `400 invalid_status`.
- Unknown parameters → `400 unknown_param`.

**Response — success (`200 OK`).**

```typescript
{
  documents: Array<{
    id: string,
    organisation_id: string,
    project_id: string,
    name: string,
    description: string | null,
    document_type: string,
    layer_stack_id: string | null,
    root_node_id: string | null,
    status: 'active' | 'archived' | 'published',
    export_settings: Record<string, unknown>,
    authors: string[],
    director_config_id: string | null,
    created_at: string,
    updated_at: string
  }>
}
```

Order: `created_at DESC`. Empty array if no documents (or project not visible — same observable as no documents in Phase 1; see the **404 vs empty list** note below).

**Note: 404 vs empty list.** If `projectId` is not visible to the caller, RLS makes `projects` lookup return null and `documents` lookup return empty. The route returns:

- `404 project_not_found` if the project itself is not visible (route checks `projects` first).
- `200 { documents: [] }` if the project is visible but has no documents.

The route MUST therefore perform the `projects` visibility check before listing documents.

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `projectId` not a valid UUID |
| `400` | `invalid_status` | `status` query param outside the V1 set |
| `400` | `unknown_param` | Unrecognised query parameter |
| `401` | `unauthorised` | No session |
| `404` | `project_not_found` | Project does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.** None.

**Idempotency.** Yes.

---

### 3.8 `GET /api/documents/[documentId]` — Read document

**Authentication.** Required.

**Authorisation.** RLS on `documents`.

**Path parameters.** `documentId` — UUID.

**Response — success (`200 OK`).**

```typescript
{
  document: {
    id: string,
    organisation_id: string,
    project_id: string,
    name: string,
    description: string | null,
    document_type: string,
    layer_stack_id: string | null,
    root_node_id: string | null,
    status: 'active' | 'archived' | 'published',
    export_settings: Record<string, unknown>,
    authors: string[],
    director_config_id: string | null,
    created_at: string,
    updated_at: string
  }
}
```

The `layer_stack` is **not** included in this endpoint's response. (Layer stack contents are loaded separately when the editor needs them — Phase 2.)

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `documentId` not a valid UUID |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Document does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.** None.

**Idempotency.** Yes.

---

### 3.9 `PATCH /api/documents/[documentId]` — Update document

**Authentication.** Required.

**Authorisation.** RLS-based. Belt-and-braces fetch first; `404` if not visible.

**Path parameters.** `documentId` — UUID.

**Request body schema.** All fields optional; at least one required.

```typescript
{
  name?: string,                                       // 1–200 chars after trim
  description?: string | null,                         // 0–5000 chars
  status?: 'active' | 'archived' | 'published',        // status transitions
  authors?: string[]                                   // same rules as POST
}
```

**Validation.**

- `name`, `description`, `authors` — same rules as POST.
- `status` — must be one of the three allowed values. Other values → `400 invalid_status`. **No transition restrictions in Phase 1** (any status may transition to any other status). Phase 6 introduces transition rules; for now, the column accepts any allowed value.
- `document_type`, `id`, `organisation_id`, `project_id`, `layer_stack_id`, `root_node_id`, `director_config_id`, `export_settings`, `created_at`, `updated_at`, `metadata` — all forbidden in PATCH; including any → `400 unknown_field`.
- Unknown fields → `400 unknown_field`.

**Response — success (`200 OK`).**

```typescript
{
  document: {
    id: string,
    organisation_id: string,
    project_id: string,
    name: string,
    description: string | null,
    document_type: string,
    layer_stack_id: string | null,
    root_node_id: string | null,
    status: 'active' | 'archived' | 'published',
    export_settings: Record<string, unknown>,
    authors: string[],
    director_config_id: string | null,
    created_at: string,
    updated_at: string                                 // bumped
  }
}
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `documentId` not a valid UUID |
| `400` | `invalid_json` / `missing_body` / `empty_update` | Body parsing/empty/no fields |
| `400` | `invalid_name` / `invalid_description` / `invalid_status` / `invalid_authors` / `unknown_field` | Field failures |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Document does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.** One `UPDATE` on `documents`. `updated_at` bumped.

**Idempotency.** Yes.

---

### 3.10 `DELETE /api/documents/[documentId]` — Delete document

**Authentication.** Required.

**Authorisation.** RLS-based. Belt-and-braces fetch first.

**Path parameters.** `documentId` — UUID.

**Request body.** Must be empty. Non-empty → `400 unexpected_body`.

**Response — success (`200 OK`).**

```json
{ "deleted": true, "document_id": "<uuid>" }
```

**Response — errors.**

| Status | Body `error` | When |
|---|---|---|
| `400` | `invalid_uuid` | `documentId` not a valid UUID |
| `400` | `unexpected_body` | Request body not empty |
| `401` | `unauthorised` | No session |
| `404` | `not_found` | Document does not exist OR not visible to caller |
| `500` | `internal_error` | Unhandled exception |

**Side effects.**

- The matched row in `documents` is deleted.
- `layer_stacks` rows with `document_id = <this>` cascade-delete (FK from Migration 007).
- `nodes` rows with `document_id = <this>` cascade-delete (FK from Migration 002).
- All other downstream FK cascades fire per their migration definitions.

**Idempotency.** Idempotent in the HTTP sense (second call returns `404`).

---

## 4. Test Cases

The complete test inventory derives from this contract and lives in `stelavox_phase1_test_plan_v1_0.md`. Every endpoint above produces at least:

- One happy-path test (success response shape and side effects verified).
- One auth-failure test (no session → `401`).
- One cross-organisation auth-boundary test (User B attempts to access User A's resource → `404` or empty list).
- One test per documented `400` error case.

The test plan is the authoritative tester's reference; this contract is the authoritative shape reference.

---

## 5. Specification Gaps Found While Writing This Contract

Per the AI-Native Project Specification Standard §1.4, gaps surfaced during contract authoring are documented and either resolved before implementation or carried as risks.

| # | Gap | Status | Required action before Phase 1 implementation |
|---|---|---|---|
| G-1 | `layer_stacks.layers` JSONB shape is not defined in the Tier-A documents but Phase 1 must seed Novel/Short Story/Series templates. | **Resolved — 2026-05-03.** Shape approved as proposed in Build Checklist §3.4: `[{ index, node_type, label, description }]`. Locked for Phase 1. | None — gate cleared. Post-merge, SU-4 propagates the shape into Product Specification v1.3 §4.6. |
| G-2 | `documents.export_settings` JSONB shape is not defined. Migration 001 declares the column; Phase 1 returns it as `{}`. No keys are read or written in Phase 1. | **Resolved** — treated as opaque object in Phase 1; concrete shape deferred to Phase 7 (export). |
| G-3 | `projects.metadata` JSONB shape is not defined. As above — opaque, `{}` in Phase 1. | **Resolved** — opaque in Phase 1. |
| G-4 | The Product Specification states "audit log writes" are Phase 1, but the migration writes are not enumerated. | **Resolved** — Phase 1 writes no `audit_log` rows because billing, role changes, and lock-release events do not occur until Phase 2+. The trigger from H-03 may optionally write an `info`-severity row at signup; this is left to the build checklist as an optional task. |
| G-5 | `default_document_type` on `projects` is allowed to be any string in Migration 001 (no `CHECK` constraint). The contract restricts it to the V1 set at the API layer. | **Resolved** — API-layer validation. Future document types add to the V1 set without a migration. |

---

## 6. Approval

Before implementation begins, the human reviews and approves this contract. After approval, changes require a version bump on this document (e.g. v1.1) and a corresponding update to the Test Plan and Build Checklist. Silent edits are forbidden.

---

## 7. Changelog

**v1.0 — 2026-05-03** Initial Phase 1 API contract. Ten endpoints across two resource trees (projects, documents). Auth flows handled via Supabase Auth client SDK; auto-organisation creation handled via the H-03 `auth.users` trigger (no custom auth API endpoint). Cross-cutting rules cover error envelope, status code semantics (notably `404` for both "not found" and "RLS-invisible"), idempotency, validation conventions. Five specification gaps documented in §5; G-1 (layer-stack JSON shape) resolved by human approval on 2026-05-03 — shape locked for Phase 1. Contract is now approved and frozen for Phase 1 implementation.
