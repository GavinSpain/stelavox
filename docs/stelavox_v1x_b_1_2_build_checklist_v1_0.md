# Stelavox — V1.x-B.1.2 Build Checklist
## Version 1.0

> **Tier-B per-phase document.** Frozen for V1.x-B.1.2 build. The second sub-phase of V1.x-B per the four-way split locked in `docs/sessions/v1x_b_design_session_record_2026-05-14.md` §15. **Self-contained BYOK module.** Companion to (future) `stelavox_v1x_b_1_2_test_report_v1_0.md`. Source of truth for what gets built and in what order. Spec doc amendments listed in §4 land in lockstep with the build.

**Phase:** V1.x-B.1.2 — BYOK substrate. Per-user Anthropic API keys, encrypted via Supabase Vault, dispatched through a Supabase Edge Function (per H-09 — BYOK key plaintext never materialises outside Edge Function memory). The interface contract for `route='byok'` already lands in V1.x-B.1.1 (`mayDispatch({route})` accepts the parameter; B.1.1 policy is byok → pass-through). V1.x-B.1.2 wires the actual BYOK module behind that interface.

**Substrate at V1.x-B.1.2 start:**

- Master HEAD `78fc8cc` (V1.x-B.1.1 merge — Scheduler engine + Brief lifecycle + UI substrate, 2026-05-14).
- Migration count: 102.
- Director config v1.8 in production; 17 tools.
- Existing `lib/llm/factory.ts` has a stubbed V2 BYOK branch (line 51-54) marking the integration site.
- Existing `lib/llm/byok.ts` has `isByok(org)` helper for the per-org case (B6.3 audit).
- Existing `organisations` table has per-org BYOK columns (`byok_enabled`, `byok_provider`, `byok_api_key_vault_id`) — left in place but unused; deprecation candidate for V2.
- Active worktrees: `clever-knuth-c29e27` (this work, branch `claude/v1x-b-1-2-byok`); earlier worktrees preserved per phase procedure.

**Locked decisions (clarified at V1.x-B.1.2 kickoff 2026-05-14):**

1. **Per-user BYOK keys.** `user_anthropic_keys` table tied to `auth.users` per design record §9. Existing per-org BYOK columns (`organisations.byok_*`) left in place but unused — deprecation candidate for V2 alongside any UI surfaces that consume them. Matches typical SaaS pattern; one user with multiple orgs uses the same key everywhere.
2. **Add-time validation = tiny completion call.** POST `/v1/messages` with `model.byok_key_validation` (already in `platform_config` — Haiku 4.5) + `max_tokens=1`. Verifies the key works for the actual usage pattern; costs ~$0.0001 per validation; gives an honest pass/fail signal.
3. **Single `byok-llm-call` Edge Function.** One Supabase Edge Function routes all BYOK operation types internally. Thin transport for the decrypted key; deployment + monitoring + testing surface stays at one entry point.
4. **UI placement = new `/settings/api-keys` route.** User menu in Header gains a Settings link. Dedicated settings sub-route for clean separation; future settings (notification prefs, profile, etc.) can grow there.
5. **Single key per user in V1.** Multiple keys (named profiles, key rotation flow, etc.) are V2 candidates per design record §9.
6. **Greenfield — no existing BYOK users.** No backfill / migration of in-flight key data; ship the schema cleanly.

---

## 1. Pre-Build Prerequisites

### PB-1 — Worktree and branch

Currently on `claude/v1x-b-1-2-byok` in `.claude/worktrees/clever-knuth-c29e27` (spawned at master `78fc8cc` 2026-05-14; npm installed; `.env.local` copied; type-check clean baseline).

### PB-2 — Supabase stack health + Vault availability

```
supabase status                                               # all services healthy
docker exec supabase_db_stelavox_2 psql -U postgres -d postgres -c "SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';"
```

Confirm `supabase_vault` extension is installed. If not, install via Migration 103's preamble.

### PB-3 — Snapshot before any migration runs

```
supabase db dump --local --schema public -f snapshots/stelavox_local_<YYYY-MM-DD>_pre_v1x_b_1_2.schema.sql
supabase db dump --local --data-only -f snapshots/stelavox_local_<YYYY-MM-DD>_pre_v1x_b_1_2.data.sql
```

### PB-4 — V1.x-B.1.2 spec library in source

```
ls docs/stelavox_v1x_b_1_1_test_report_v1_0.md          # V1.x-B.1.1 ship verdict
grep -m1 "## Version 1.27" CLAUDE.md                    # CLAUDE.md current
diff CLAUDE.md docs/CLAUDE_stelavox_project.md          # empty diff
ls docs/sessions/v1x_b_design_session_record_2026-05-14.md
```

Read `docs/sessions/v1x_b_design_session_record_2026-05-14.md` §9 for BYOK scope context. Read TA v2.3.3 §5 H-09 for the BYOK key plaintext invariant.

### PB-5 — Type baseline + tests green for V1.x-B.1.1

```
npm run type-check     # exit 0
npm run lint           # 0 errors, 14 pre-existing warnings
npm run build          # passes
npm run test:unit -- tests/unit/v1x-a1-*.test.ts tests/unit/v1x-b1-*.test.ts   # 66 pass
npm run test -- tests/v1x-a1/ tests/v1x-b1/                                    # 30 pass
```

### PB-6 — Cheap-model override

Per `feedback_haiku_default.md`, all LLM testing uses Haiku 4.5. The `model.byok_key_validation` config key (already seeded — Haiku 4.5) is what add-time validation uses.

### PB-7 — Kill stale dev server on port 3000

Per `feedback_phase_session_procedure.md` step 4 — if `netstat -ano | grep ':3000\s.*LISTENING'` shows a leftover Next.js process from `witty-knuth-8700e4` (the V1.x-B.1.1 worktree), kill it before starting `npm run dev` in `clever-knuth-c29e27`. Otherwise Playwright `webServer.reuseExistingServer:true` will target the stale server and tests of new routes will 404.

---

## 2. Phase Checkpoint Criteria

V1.x-B.1.2 is COMPLETE when all CKs are green.

### CK-1 — `user_anthropic_keys` table exists with Vault-backed encryption

Table created with `vault.secrets`-backed key column; RLS scoped so a user can only see / write their own row; UNIQUE on `user_id` (single key per user in V1).

### CK-2 — Add-time validation against Anthropic round-trips successfully

Save flow: user submits key → server runs tiny completion call against `model.byok_key_validation` with `max_tokens=1` → on 200 OK, save the key to Vault + the row; on 401/403, reject with structured error and don't save. Test verifies both branches.

### CK-3 — Edge Function dispatcher invokes Anthropic

`supabase/functions/byok-llm-call/index.ts` accepts `(operation_type, payload, user_id)` from a service-role caller; decrypts the key in Edge Function memory; invokes Anthropic; returns response. Streaming responses pipe through.

### CK-4 — `lib/llm/factory.ts` routes BYOK to Edge Function

When a user has a BYOK key on file, `getProvider({user, organisation, operationType})` returns a provider that dispatches via the Edge Function. When no key, returns the existing `AnthropicProvider` against the platform key. Existing non-BYOK callers unchanged.

### CK-5 — `mayDispatch({route})` honoured

`route='byok'` actually goes through Edge Function path (not the platform throttle's cap=1). `route='platform'` continues to honour cap=1. Verified with a Playwright test that exercises both paths against the real Edge Function (locally; cloud Edge Functions deferred to V1.x-B.2 cloud rollout).

### CK-6 — Settings UI panel works end-to-end

`/settings/api-keys` route renders. Single input + Save button + Delete button + status indicator. On save, surfaces validation pass/fail inline. On delete, prompts confirm + clears. Status indicator shows: present / absent / rejected.

### CK-7 — H-09 invariant: no BYOK plaintext outside Edge Function memory

Audit by:
- `grep -r "anthropic_api_key" app/ lib/ components/ tests/` returns only:
  - The save endpoint (which forwards to Vault + immediately drops the value)
  - The Edge Function (`supabase/functions/byok-llm-call/`)
- No console.log / structured log / error trace exposes the key.
- The Vault-encrypted value is never SELECTed into the Next.js process; `get_user_anthropic_key_status` returns metadata only (present / absent / last_validated_at).

### CK-8 — Existing V1.x-A.1 + V1.x-B.1.1 regressions pass

All 40 V1.x-A.1 + 26 V1.x-B.1.1 Vitest unit tests pass (66 total). All 8 V1.x-A.1 + 22 V1.x-B.1.1 Playwright tests pass (30 total). Director executor unchanged; only the factory routing path is touched.

### CK-9 — Pre-merge invariants

```
npm run type-check     # exit 0
npm run lint           # 0 errors
npm run build          # passes
diff CLAUDE.md docs/CLAUDE_stelavox_project.md   # empty
```

H-10 discipline: `lib/types/database.ts` regenerated post-migrations.

### CK-10 — Test Report + close-out + merge

`stelavox_v1x_b_1_2_test_report_v1_0.md` PASS verdict. Spec doc amendments per §4 land in lockstep. CLAUDE.md → v1.28. Memory updates. Merge to master with `--no-ff`.

---

## 3. Ordered Task List

### 3.1 Migrations — schema + RPCs + Edge Function deployment

#### T-1.1 — Migration 103: `user_anthropic_keys` table

`supabase/migrations/<YYYYMMDD>000103_user_anthropic_keys.sql`:

- `CREATE EXTENSION IF NOT EXISTS supabase_vault;` (idempotent if already installed)
- `CREATE TABLE user_anthropic_keys`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  - `vault_secret_id UUID NOT NULL` — pointer to the row in `vault.secrets` that holds the encrypted key (UPDATE ON DELETE CASCADE / SET NULL — Vault doesn't enforce FK, so caller must clean up via the delete RPC)
  - `last_four CHAR(4) NOT NULL` — last 4 chars of the key for "is this the right key?" UX confirmation (matches typical SaaS pattern; not security-relevant)
  - `last_validated_at TIMESTAMPTZ NOT NULL` — when add-time validation last passed
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - `UNIQUE (user_id)` — single key per user in V1
- RLS: `FOR SELECT USING (auth.uid() = user_id)`; writes restricted to the SECURITY DEFINER RPCs in M-104.
- No realtime publication (changes don't need to push to other clients; user owns their key, single device or refresh on next page load).

#### T-1.2 — Migration 104: SECURITY DEFINER RPCs

`supabase/migrations/<YYYYMMDD>000104_user_anthropic_keys_rpcs.sql`:

- `save_user_anthropic_key(p_key TEXT, p_validation_completed_at TIMESTAMPTZ)` — caller must have already done validation via the API route (see T-3.2). Logic: insert into `vault.secrets` (returns id); UPSERT `user_anthropic_keys` row keyed on `auth.uid()`; if previous row existed, delete the previous Vault secret. Returns `{key_id, last_four, last_validated_at}`.
- `get_user_anthropic_key_status()` — returns `{present: bool, last_four?: string, last_validated_at?: timestamp}`. Never returns the key itself. Service-role + authenticated callable.
- `get_user_anthropic_key_for_byok_call(p_user_id UUID)` — service-role ONLY. Returns the decrypted key from `vault.secrets`. The Edge Function is the only caller. Per H-09 the response value never reaches Next.js API routes.
- `delete_user_anthropic_key()` — deletes the user's `user_anthropic_keys` row + the corresponding `vault.secrets` row.

All RPCs include `SET search_path = public` per H-13.

#### T-1.3 — Apply migrations + regenerate types

```
supabase migration up --local
supabase gen types typescript --local > lib/types/database.ts
npm run type-check
```

#### T-1.4 — Edge Function deployment scaffolding

`supabase/functions/byok-llm-call/index.ts` — see §3.2 for the full file. Local dev: `supabase functions serve byok-llm-call` runs it on `http://localhost:54331/functions/v1/byok-llm-call`. Cloud rollout: deferred to V1.x-B.2 cloud-smoke; local works for B.1.2 substrate verification.

### 3.2 Edge Function — `byok-llm-call`

#### T-2.1 — Author `supabase/functions/byok-llm-call/index.ts`

Single Edge Function (Deno runtime). Behaviour:

- POST endpoint; expects body `{ operation_type, anthropic_request }` where `anthropic_request` is the full Anthropic Messages API payload prepared by the caller (model + messages + tools etc.).
- Authenticates via Supabase JWT — extracts `user_id` from the JWT claims.
- Calls `get_user_anthropic_key_for_byok_call(user_id)` via the service-role Supabase client to retrieve the decrypted key into Edge Function memory.
- Performs the Anthropic call — passes the request through; supports streaming (SSE) responses by piping the body.
- Returns the Anthropic response. Edge Function process exits; key is garbage-collected with the function context.
- On Anthropic error: returns the error to the caller; never logs the key. Best-effort: reset internal references to the key string before returning.

H-09 audit: the key string only exists inside this function's variable scope. Function returns; scope dies; key gone.

### 3.3 lib changes

#### T-3.1 — `lib/byok/` new module

Files:

- `lib/byok/types.ts` — `UserKeyStatus`, `SaveKeyResult`, `ValidationResult`.
- `lib/byok/validateAgainstAnthropic.ts` — `validateAnthropicKey(key: string): Promise<{valid: true} | {valid: false, reason: string}>`. Calls Anthropic Messages API with `model.byok_key_validation` (Haiku) + `max_tokens=1`; returns `valid: true` on 200, `valid: false, reason` on 401/403/4xx. Network errors are surfaced as a separate error class so the caller can distinguish "key bad" from "validation infrastructure problem".
- `lib/byok/saveUserKey.ts` — orchestrates: validate → save_user_anthropic_key RPC. Returns the saved key status.
- `lib/byok/getUserKeyStatus.ts` — wraps `get_user_anthropic_key_status` RPC.
- `lib/byok/deleteUserKey.ts` — wraps `delete_user_anthropic_key` RPC.
- `lib/byok/index.ts` — public surface.

The decrypted-key RPC (`get_user_anthropic_key_for_byok_call`) is **NOT** wrapped in lib/byok; it's only callable from the Edge Function. Putting it in lib/byok would risk a Next.js route accidentally calling it (H-09 violation).

#### T-3.2 — `lib/llm/byok.ts` extended

Add `userHasByokKey(userId: string): Promise<boolean>` — wraps `get_user_anthropic_key_status` and returns the `present` field. Cached for the request lifetime via a small per-request memo (no across-request caching — too easy to get stale on key add/delete).

#### T-3.3 — `lib/llm/factory.ts` revised

`getProvider` signature extended: `getProvider({organisation, user, operationType, profileModelId})`. Logic:

1. Compute `modelId` per existing precedence (organisation overrides → profileModelId).
2. `if (await userHasByokKey(user.id))` → return a `ByokProvider` instance that dispatches via the Edge Function URL.
3. Else → existing `AnthropicProvider` with platform `process.env.ANTHROPIC_API_KEY`.

`ByokProvider` is a new class in `lib/llm/providers/byok.ts` implementing the `LLMProvider` interface. Its `streamMessage` / `generate` methods POST to the Edge Function with the constructed Anthropic request payload + return the response.

Existing call sites already pass `organisation` + `operationType` + `profileModelId`; they'll need a `user` parameter added. Audit-and-update via `grep -r "getProvider("` — touches the agent runner + Director executor (~5-10 call sites).

### 3.4 API routes

- `POST /api/user/anthropic-key` — body `{key: string}`. Validates via `lib/byok/validateAgainstAnthropic`; on success calls `save_user_anthropic_key` RPC. Returns 200 with `{last_four, last_validated_at}` or 422 with `{error, reason}` on validation failure.
- `DELETE /api/user/anthropic-key` — calls `delete_user_anthropic_key` RPC. Returns 200 `{deleted: true}`.
- `GET /api/user/anthropic-key/status` — calls `get_user_anthropic_key_status` RPC. Returns `{present, last_four?, last_validated_at?}`.

All three routes are user-scoped (`auth.uid()` from session); RLS gates the Vault row access; the routes never see the decrypted key.

### 3.5 UI

#### T-5.1 — `components/settings/AnthropicKeyPanel.tsx`

Single-input + Save + Delete + status indicator. Composition:

- Status indicator at top: green dot + "Key set, validated <relative time>" when present; muted "No BYOK key set" when absent; red dot + "Key validation failed: <reason>" when last save attempt failed.
- Input field: type=password, placeholder "sk-ant-..." (helper text: "Your Anthropic API key. Encrypted at rest. Only used to dispatch your LLM calls — never logged.")
- Save button (verdigris use #7 — affirmative-action triggers family; same as existing Approve buttons): disabled while validation in flight; surfaces inline error on failure.
- Delete button (destructive-token, NOT verdigris): triggers confirmation dialog before calling DELETE.

Inviolable #2 honoured — Save is verdigris (within the existing affirmative-action triggers family); no other verdigris use.

Inter typography only; structural panel.

#### T-5.2 — Settings page route

`app/(app)/settings/api-keys/page.tsx` — server component that mounts `AnthropicKeyPanel`.

Could also add a generic `app/(app)/settings/page.tsx` index page with a navigation list (just one entry for now). Keeps the URL space clean for future settings additions.

#### T-5.3 — Header user-menu link

Extend `components/layout/Header.tsx` (or wherever the user menu lives) — add a "Settings" link below the existing email + Sign out. Routes to `/settings`.

### 3.6 Tests

#### T-6.1 — Vitest unit tests

`tests/unit/v1x-b1-2-byok-validation.test.ts` — `validateAnthropicKey` shape: mocks Anthropic Messages API with vi.mock; verifies 200 → valid, 401 → invalid with reason, network error surfaces separately.

`tests/unit/v1x-b1-2-byok-status-shape.test.ts` — `getUserKeyStatus` response shape on present + absent paths (Supabase RPC mocked).

#### T-6.2 — Playwright integration tests

`tests/v1x-b1-2/byok-substrate.spec.ts`:

- CK-2 PASS: save with a fake-but-syntactically-valid key returns 422; save with the actual `ANTHROPIC_API_KEY` from env (testing-only fallback) returns 200 + status reflects `present`.
- CK-1 PASS: after save, `user_anthropic_keys` row exists; `vault.secrets` row exists; `last_four` matches; RLS prevents another user from reading it.
- CK-6 PASS: settings page renders; status indicator updates after save; delete clears.
- CK-7 PASS: a defensive grep-style assertion (run as a Vitest test, not Playwright) — no source file outside `supabase/functions/byok-llm-call/` and `lib/byok/saveUserKey.ts` references the env var name pattern that would suggest the key escaped.

#### T-6.3 — Regression

```
npm run test:unit -- tests/unit/v1x-a1-*.test.ts tests/unit/v1x-b1-*.test.ts tests/unit/v1x-b1-2-*.test.ts
npm run test -- tests/v1x-a1/ tests/v1x-b1/ tests/v1x-b1-2/
```

### 3.7 Close-out

#### T-7.1 — Test Report

`docs/stelavox_v1x_b_1_2_test_report_v1_0.md` — same shape as V1.x-B.1.1 Test Report.

#### T-7.2 — Spec doc bumps (light pass, consistent with V1.x-B.1.1's deferral logic)

- TA v2.3.3 → v2.3.4 (in-file changelog entry; filename unchanged): document M-103 + M-104; update H-09 mitigation status (was "key plaintext only in Edge Function memory" — now "implemented in V1.x-B.1.2 via Edge Function `byok-llm-call`"); §3.5 migration count 102 → ~104.
- CLAUDE.md v1.27 → v1.28: Critical Component Specifications row for `AnthropicKeyPanel`; "Current phase tasks" cell rewritten for V1.x-B.1.2 SHIPPED; changelog entry.
- Director Architecture v2.2 + Component Spec v2.11 + Product Spec v1.10 partial-update bumps **continue to defer** to the Tier-A consolidation pass alongside V1.x-B.2 (consistent with V1.x-B.1.1 v1.27's deferral logic).

#### T-7.3 — Memory updates

- New `project_v1x_b_1_2_shipped.md` capturing branch SHA, verdict, deferred items, master HEAD post-merge.
- `project_v1x_b_1_2_next_session_prep.md` retitled as historical snapshot.
- Update follow-ups memo if any new items raised during the build.

#### T-7.4 — Merge to master

```
git push origin claude/v1x-b-1-2-byok
git -C C:/dev/stelavox_2 checkout master && git pull
git -C C:/dev/stelavox_2 merge --no-ff claude/v1x-b-1-2-byok -m "<merge message>"
git -C C:/dev/stelavox_2 push origin master
```

---

## 4. Spec doc amendments landing in lockstep

### §4.1 TA v2.3.3 → v2.3.4 (in-file changelog entry)

Documents:
- §3.5 migration count 102 → 104
- §3.6 new migration blocks (M-103 user_anthropic_keys + M-104 RPCs + Vault interaction)
- §5 H-09 mitigation status updated
- §11 Phase Plan V1.x-B.1.2 row checkpoint MET

### §4.2 CLAUDE.md v1.27 → v1.28

Documents:
- New Critical Component Specifications row: `AnthropicKeyPanel` (Inter only; verdigris use #7 for Save; destructive-token Delete; status indicator)
- "Current phase tasks" cell rewritten for V1.x-B.1.2 SHIPPED
- Changelog entry summarising scope + tests + deferred items + next phase (V1.x-B.2 — full traffic engineering implementation + executor refactor for per-iteration decomposition + push-model triggers + dispatcher + Stop button + Tier-A consolidation pass)

### §4.3 Deferred bumps

Director Architecture v2.2 + Component Spec v2.11 + Product Spec v1.10 partial-update bumps continue to defer to the Tier-A consolidation pass alongside V1.x-B.2. The TA v2.3.4 + CLAUDE.md v1.28 updates here keep the spec ↔ code mirror coherent for the BYOK-shipped scope.

---

## 5. Changelog

**v1.0 — 2026-05-14** Initial version. Frozen for V1.x-B.1.2 build per the V1.x-B design session record's four-way V1.x-B split + the four locked design decisions confirmed at V1.x-B.1.2 kickoff (per-user keys; tiny-completion validation; single Edge Function; `/settings/api-keys` route).
