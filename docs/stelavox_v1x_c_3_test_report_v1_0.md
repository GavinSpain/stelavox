# V1.x-C.3 Test Report v1.0

**Phase**: V1.x-C.3 — per-org BYOK Option A (re-target from per-user)
**Date**: 2026-05-17
**Branch**: `claude/v1x-c-cost-substrate` (NOT MERGED — V1.x-C merges as a unit at C.4 close-out alongside C.1.a/b + C.2)
**Implementation commit**: this commit
**Verdict**: **PASS** (sub-phase report; full V1.x-C close-out at C.4)

> **Scope note.** V1.x-C.3 is the third sub-phase of V1.x-C. C.1.a (pricing substrate) + C.1.b (runner integration) + C.2 (plan model) shipped in prior commits on the same branch. C.4 (close-out + Tier-A bumps + merge) remains.

---

## §1 — Decisions ratified before edits

**BYOK plan eligibility.** User-locked decision 2026-05-17: BYOK-eligible = `byok_solo` + `byok_team` only. The other locked plan slugs (trial / writer / author / pro) cannot enable per-org BYOK. Org must switch its plan via the subscription flow (V2 Stripe pass) before enabling BYOK. Rationale: Product Spec v1.9 §3.1 presents BYOK Tiers and Platform Tiers as discrete alternative subscriptions, not a fallback chain — Model A (mutually exclusive) wins over Model B (allocation-then-BYOK).

**Header strategy on the Edge Function.** The BYOK Edge Function (`supabase/functions/byok-llm-call/`) accepts EITHER `x-stelavox-org-id` (V1.x-C.3 preferred) OR `x-stelavox-user-id` (V1.x-B.1.2 legacy, transition window). Factory's precedence picks org first, falls back to user when no org key, falls back to platform — so the Edge Function never sees both headers in practice; defence-in-depth picks org if both arrive.

**Per-user deprecation policy.** Per-user `user_anthropic_keys` rows are marked `deprecated_at = NOW()` after the one-shot migration. `userHasByokKey()` filters out deprecated rows so the factory's Option A layer 2 only routes via per-user keys that haven't been absorbed into the org yet. The per-user path stays alive through the V1 transition window; final removal is V2.

---

## §2 — Scope ratified by checkpoints

| CK | What it proves | Method | Result |
|---|---|---|---|
| **CK-6** | M-136 added the per-org BYOK metadata columns; M-138 added the per-user deprecation column | Insert a fresh org with no BYOK; read new columns and assert NULL defaults; probe `user_anthropic_keys.deprecated_at` SELECT path | **PASS** (2/2 Playwright cases) |
| **CK-7** | Factory routing precedence: per-org BYOK eligibility check (`byok_enabled AND vault_id`) is correct; M-139 service-role-only GRANT enforced | Unit-mocked supabase client × 5 helper-decision cases (orgHasByokKey returns true only when both signals set) + Playwright integration (orgHasByokKey semantics against live test orgs + M-139 RPC reachable from service-role with `no_byok_key_for_org` for an org without a key) | **PASS** (5/5 unit + 2/2 Playwright cases) |
| **CK-8** | enable_org_byok refuses non-BYOK plans; migrate_per_user_keys_to_org returns aggregate counts; re-invocation is idempotent (deprecated_at filter); userHasByokKey filters deprecated rows | RPC calls against live Postgres + Vitest mocks for the user-key path | **PASS** (3/3 Vitest user-key filter cases + 3/3 Playwright migration/idempotency cases) |
| **CK-Inviol** | Verdigris use count remains 9 (no UI surface introduced in C.3) | No new `--color-accent` use; OrgAnthropicKeyPanel deferred to C.4 | **PASS** |

CK-9 + CK-10 (CostMeter UI + plan-based admission API integration) belong to C.4 (UI close-out) and were already addressed structurally in C.2.

---

## §3 — What shipped

### Migrations (4 new — count moves 135 → 139)

- **M-136** `organisations_byok_revive.sql` — ALTER TABLE adds `byok_api_key_last_four CHAR(4) NULL` + `byok_api_key_last_validated_at TIMESTAMPTZ NULL` columns (per-user M-103 parity). The pre-existing `byok_enabled` / `byok_provider` / `byok_api_key_vault_id` columns from M-001 stay as-is. Two SECURITY DEFINER RPCs: `enable_org_byok(p_org_id)` and `disable_org_byok(p_org_id)` (admin-only; plan eligibility check on enable; idempotent).

- **M-137** `org_anthropic_key_rpcs.sql` — Three SECURITY DEFINER RPCs:
  - `save_org_anthropic_key(p_org_id, p_key, p_validation_completed_at)` — admin-only; plan-eligibility check; inserts Vault secret; flips byok_enabled to TRUE.
  - `get_org_anthropic_key_status(p_org_id)` — read-only for any org member; returns `{ present, byok_enabled, plan, last_four, last_validated_at }`.
  - `delete_org_anthropic_key(p_org_id)` — admin-only; clears all per-org BYOK columns and deletes the Vault secret.
  All include `SET search_path = public` per H-13.

- **M-138** `migrate_per_user_keys_to_org.sql` — ALTER TABLE adds `user_anthropic_keys.deprecated_at TIMESTAMPTZ NULL`. SECURITY DEFINER one-shot function `migrate_per_user_keys_to_org()` iterates each non-deprecated per-user key, resolves the user's primary org (owner > admin > member, oldest joined_at as tiebreak), and either transfers the key to the org (if plan-eligible + org doesn't have its own key) or marks the per-user row deprecated. Returns `{ transferred, deprecated, skipped }`. Idempotent — filtered by `deprecated_at IS NULL`. Function INVOKED once at migration time.

- **M-139** `byok_get_for_call_rpc_v2.sql` — SECURITY DEFINER `get_org_anthropic_key_for_byok_call(p_org_id)` returning the decrypted Vault key as TEXT. Service-role-only (NO `GRANT TO authenticated`) per H-09. Mirrors M-104's per-user equivalent.

### Library

- **NEW [lib/byok/orgKey.ts](../lib/byok/orgKey.ts)** — TypeScript wrappers around M-137: `saveOrgAnthropicKey`, `getOrgKeyStatus`, `deleteOrgKey`. Plus `orgHasByokKey()` — service-role helper for the factory's Option A precedence (checks `byok_enabled AND byok_api_key_vault_id` on the org row). Public surface exported via [lib/byok/index.ts](../lib/byok/index.ts).

- **REWRITTEN [lib/llm/factory.ts](../lib/llm/factory.ts)** — Three-layer Option A precedence:
  1. Per-org BYOK if `organisation.byok_enabled === true AND byok_api_key_vault_id` on the passed-in row, OR confirmed via DB lookup. Routes via `ByokProvider({ supabaseUrl, serviceRoleKey, orgId })`.
  2. Per-user BYOK (transition window) if `userId` provided AND `userHasByokKey()` returns true (deprecated rows excluded). Routes via `ByokProvider({ supabaseUrl, serviceRoleKey, userId })`.
  3. Platform key via `AnthropicProvider(process.env.ANTHROPIC_API_KEY)`.

- **UPDATED [lib/llm/providers/byok.ts](../lib/llm/providers/byok.ts)** — `ByokProviderConfig` is now a discriminated union accepting EXACTLY ONE of `userId` or `orgId`. The custom fetch sets the matching header (`x-stelavox-user-id` or `x-stelavox-org-id`) accordingly.

- **UPDATED [lib/llm/byok.ts:userHasByokKey](../lib/llm/byok.ts)** — adds `.is('deprecated_at', null)` filter. Logs a deprecation warning when an active per-user key is found (visibility signal that the transition window is in use). The synchronous `isByok()` helper is unchanged.

- **UPDATED [supabase/functions/byok-llm-call/index.ts](../supabase/functions/byok-llm-call/index.ts)** — accepts EITHER `x-stelavox-org-id` (preferred) OR `x-stelavox-user-id` (legacy); calls `get_org_anthropic_key_for_byok_call` or `get_user_anthropic_key_for_byok_call` accordingly. Defence-in-depth: if both headers arrive, org wins.

### Test files

- **NEW [tests/unit/v1x-c3-byok-routing.test.ts](../tests/unit/v1x-c3-byok-routing.test.ts)** — 8 Vitest unit cases (3 for `userHasByokKey` deprecation filter behaviour; 5 for `orgHasByokKey` semantics across all combinations of `byok_enabled` × `vault_id` × error paths).

- **NEW [tests/v1x-c3/org-byok-substrate.spec.ts](../tests/v1x-c3/org-byok-substrate.spec.ts)** — 7 Playwright integration cases covering M-136 columns + M-138 column + enable_org_byok plan-eligibility refusal + migrate_per_user_keys_to_org aggregate shape + idempotency + orgHasByokKey semantics + M-139 service-role-only enforcement.

---

## §4 — Verification gates

| Gate | Result | Detail |
|---|---|---|
| `npm run type-check` | **PASS** | 0 errors |
| Vitest full unit suite | **381/385 PASS** | 4 skipped baseline; 0 failures across 41 files (incl. 8/8 new C.3 routing) |
| Playwright V1.x regression (a1 + b1 + b1-2 + b2 + b3 + c1 + c2 + c3) | **96 passed / 4 skipped** | 4 skipped = baseline V1.x-B.1.1 queue tests carried over from B.3 supersession; +7 new V1.x-C.3 cases all PASS |

---

## §5 — Hazard tracking

- **H-09 (BYOK key plaintext only in Edge Function memory)** — preserved. The decrypted-key-returning RPC (`get_org_anthropic_key_for_byok_call`) has NO `GRANT TO authenticated`; service-role only. CK-7's M-139 reachability test confirms the function body executes only when called with service-role; the Edge Function is the sole intended caller. The Next.js process never sees the decrypted key (the custom fetch sends the request body to the Edge Function, which adds the `x-api-key` header on the server-to-Anthropic hop).
- **H-13 (SECURITY DEFINER search_path)** — every new RPC body declares `SET search_path = public`.
- **No new hazards** introduced. The org-vs-user header dispatch in the Edge Function uses an if/else with a defence-in-depth "org wins" tiebreak — no race or footgun pattern.

---

## §6 — Deferred to V1.x-C.4 close-out

| Item | Why deferred | Lands in |
|---|---|---|
| `OrgAnthropicKeyPanel` UI + `/settings/org-api-keys` route | UI surface | V1.x-C.4 |
| `POST /api/org/anthropic-key` + DELETE / GET API routes | UI substrate path; tests at C.4 will drive the end-to-end save → validate → status round trip | V1.x-C.4 |
| `POST /api/cron/period-rollover` (resets `token_usage_credits` + advances `current_period_start`) | Period rollover is V1.x-C.4 surface | V1.x-C.4 |
| Tier-A doc bumps (TA v2.5 → v2.6; Director Architecture v2.3 → v2.4; Component Spec v2.12 → v2.13; Product Spec v1.10 → v1.11; CLAUDE.md → v1.31) | Single consolidation pass | V1.x-C.4 close-out |
| Edge Function live deploy + cloud cutover smoke | Local dev path verified via the unit + integration suites; live deploy + Anthropic call against a real BYOK key remains a user-driven verification | V1.x-C.4 |
| Final per-user removal (`user_anthropic_keys` table drop + `lib/byok/saveUserKey.ts` etc.) | Transition window — V1 users may still be on per-user. Removal is a V2 cleanup | V2 |
| Merge to master + tag `v1.x-c` | V1.x-C merges as a unit | V1.x-C.4 close-out |

---

## §7 — Sign-off

V1.x-C.3 **PASSES** at substrate level. The per-org BYOK pipeline is wired end-to-end at the data + library + factory + Edge Function layers; the factory's Option A precedence correctly routes per-org → per-user (transition window) → platform; the per-user path is gated on the new `deprecated_at IS NULL` filter so the M-138 one-shot's deprecation marks effectively retire migrated keys.

**Next sub-phase: V1.x-C.4** — close-out: UI substrate (CostMeter + OrgAnthropicKeyPanel + PlanPanel), `/api/org/anthropic-key` route trio, period-rollover cron, Tier-A doc bumps, consolidated V1.x-C Test Report, merge to master with `--no-ff` + tag `v1.x-c`.

---

## Changelog

**v1.0 — 2026-05-17** Initial issue covering V1.x-C.3 per-org BYOK substrate landing on branch `claude/v1x-c-cost-substrate` at this commit.
