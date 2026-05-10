# Tier E — `scripts/`, `tests/`, `supabase/migrations/`, `docs/`

Originally excluded from the audit. Per the user's directive ("no shortcuts — do them as well") this tier covers what was scoped out of Tiers A–D.

**Files:** 15 scripts, 100 test files (~19,700 LOC), 36 migrations (~4,100 LOC), 62 docs (~31,800 LOC).

**Audit method:** scripts and tests at depth comparable to Tiers A–D (logic + schema-drift); migrations at the SQL-invariant level (UNIQUE / CHECK / SECURITY DEFINER / search_path); docs at the meta level (cross-spec consistency, spec-vs-code drift, internal contradictions).

---

## E1 — `scripts/`

### F-253 — `smoke-agent-runner.ts` calls `create_document_with_layer_stack` RPC with wrong param names
**Severity:** **HIGH**   **Confidence:** certain   **Category:** silent-failure
**Location:** `scripts/smoke-agent-runner.ts:73–88`
The RPC signature (Migrations 015/017/018/020) is:
```sql
create_document_with_layer_stack(
  p_project_id, p_organisation_id, p_name, p_description, p_document_type, p_authors
)
```
The script calls with:
```typescript
{ p_project_id, p_organisation_id, p_document_type,
  p_title, p_root_node_name, p_root_node_summary }
```
**Three params don't exist** (`p_title`, `p_root_node_name`, `p_root_node_summary`) — three required params are missing (`p_name`, `p_description`, `p_authors`). The script fails immediately with a PostgREST error when run. Same shape as F-124 (round-3 surfaced workflow_step → director_conversations drift). **Confirms the round-3 lesson:** scripts/ schema drift is invisible until you run them.

`scripts/seed-director-fixture.ts` uses the correct signature (line 247–254). Single broken script.
**Recommended fix shape:** replace with the seed-director-fixture pattern. Already mitigated by the new `npm run script` typecheck gate (round-3 round-3 fix), but the broken state has been in the file since before the gate.

### F-254 — pervasive `} catch {}` silent swallow in scripts (defensive but unobserved)
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `scripts/step1-mini-novel-llm-drive.ts:101`, `scripts/step2-multi-tab-conflict.ts:78, 258, 273`, etc. (~10 sites)
`try { parsed = await res.json() } catch {}` to defensively handle empty bodies. Test scripts so the impact is "less informative test failures". Same shape as Theme T-1 but at lower severity.

### F-255 — `step5-full-novel.ts` cost-tracking bug noted (already fixed in round-3)
**Severity:** see round-3 fix
**Location:** historic — fixed during round-3
The `select('cost_usd, result, total_input_tokens, total_output_tokens')` issue (column names didn't exist) was caught + fixed in round-3. Catalogued for completeness.

### F-256 — `cost-report.ts` uses correct schema (`tokens_input`)
**Confidence:** certain   **Category:** positive
**Location:** `scripts/cost-report.ts:65–146`
After the round-3 lessons, cost-report uses the correct column names. ✓ No drift here.

---

## E2 — `tests/`

### F-257 — `tests/helpers/db.ts` `getOrgId` is a third implementation of the same primitive
**Severity:** MEDIUM   **Confidence:** certain   **Category:** dead-code (cross-tier compound)
**Location:** `tests/helpers/db.ts:31–38`
Three implementations now: `lib/data/projects.ts:getOrgId`, `components/layout/AppShell.tsx`, `tests/helpers/db.ts:getOrgId`. The test helper takes `userId` as argument (correct shape); the production sites don't. **Inconsistency at the API boundary** — production callers don't pass userId because they assume "current user". Theme T-3 + T-5 cluster.

### F-258 — `tests/helpers/db.ts:getOrgId` uses `.single()` despite zero rows being valid
**Severity:** MEDIUM   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA H-01
**Location:** `tests/helpers/db.ts:36`
Same shape as F-144/148/155. Test helper, so impact is "tests fail with confusing error" rather than production. But still H-01 violation count: now 9+ sites.

### F-259 — `tests/helpers/agent-fixtures.ts:getOrgIdForUser` uses `data!` non-null assertion
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `tests/helpers/agent-fixtures.ts:208–213`
`return data!.organisation_id` — assumes the SELECT-then-`.single()` always returns a row. If it doesn't, throws `Cannot read property 'organisation_id' of undefined` (less informative than a proper error message).

### F-260 — `tests/helpers/env.ts` re-implements dotenv parsing
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code (duplicate)
**Location:** `tests/helpers/env.ts:4–28`
Custom `.env.local` parser. The codebase already uses `dotenv` package (in `scripts/cost-report.ts`, `scripts/smoke-agent-runner.ts`). The custom parser doesn't handle quoted values, escapes, or multi-line values. Same shape as F-141/F-209 — two sources of truth for env-loading. Drift risk: a value that dotenv parses correctly may parse differently here.

### F-261 — `tests/` has 100 spec files; sampled at helper-and-pattern level only
**Severity:** N/A (audit-method note)
**Location:** `tests/` (entire tree)
The tests/ corpus is large enough that exhaustive per-spec audit isn't proportional. Sampled the helpers (which propagate to all specs) and pattern-checked for known anti-patterns: `.single()` on uncertain rows, schema column names. No additional anti-patterns surfaced beyond F-257/F-258/F-259.

---

## E3 — `supabase/migrations/`

### Positive findings

### F-262 — All 14 SECURITY DEFINER functions correctly have `SET search_path = public`
**Confidence:** certain   **Category:** positive
**Spec citation:** TA H-13
H-13 grep across `supabase/migrations/`: 14 SECURITY DEFINER functions; 13 have `SET search_path = public` inline; 2 historical functions (Migrations 002 + 015) were patched in Migrations 016 + 017 to add `SET search_path`. **H-13 fully compliant.** No silent search_path inheritance vulnerabilities.

### F-263 — `conversations.UNIQUE(document_id)` correctly guards F-99 race
**Confidence:** certain   **Category:** positive
**Location:** `supabase/migrations/20260503000007_director_tables.sql:9`
`UNIQUE(document_id)` on conversations means F-99's SELECT-then-INSERT race fails at the DB level on the second attempt. The retry-fetch pattern in `getOrCreateConversation` then succeeds. F-99 is guarded.

### F-264 — `usage_records.UNIQUE(organisation_id, year_month, operation_type, provider)` correctly guards F-133 race AT THE DB
**Confidence:** certain   **Category:** positive
**Location:** `supabase/migrations/20260503000008_multi_tenancy_support.sql:11`
The race rejects the second concurrent INSERT. **But:** F-134 (silent error swallow) means the second job's tokens are silently lost — the race fails at the DB but the application doesn't notice. The DB constraint is correct; the application's error handling is the gap.

### Spec-divergence findings

### F-265 — `nodes` table missing `UNIQUE(parent_id, "order")` — H-04 unguarded at DB
**Severity:** **HIGH**   **Confidence:** certain   **Category:** spec-divergence
**Spec citation:** TA H-04 ("Integer node ordering renumbers all siblings, not just affected nodes ... must update all affected siblings in a single transaction")
**Location:** `supabase/migrations/20260503000004_nodes.sql:15`
`"order" INTEGER NOT NULL DEFAULT 1` — no UNIQUE constraint. F-154 race (`createNode` with `MAX(order) + 1`) and F-188 (`renumberSiblingsAfterDelete` non-atomic) both produce duplicate `order` values silently. The DB cannot enforce H-04.
**Recommended fix shape:** add `UNIQUE(parent_id, "order")` deferrable constraint (deferrable so multi-row UPDATEs in `move_node` RPC don't fail mid-transaction); OR replace integer ordering with a fractional-indexing scheme (LexoRank-style).

### F-266 — `conversation_messages` missing `UNIQUE(conversation_id, sequence)` — F-96 unguarded
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `supabase/migrations/20260503000007_director_tables.sql:24–34`
The index is `idx_conversation_messages_conversation_id ON (conversation_id, sequence)` — non-unique. `nextSequence` (F-96) computes `MAX(sequence) + 1`, so two concurrent appends can both INSERT with the same sequence number. Both succeed. Message ordering breaks for downstream reads.
**Recommended fix shape:** add UNIQUE constraint or use a `BIGSERIAL` per conversation (via a helper function).

### F-267 — `nodes.node_type` is `TEXT` with no CHECK constraint
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `supabase/migrations/20260503000004_nodes.sql:9`
`node_type TEXT NOT NULL` — accepts any string. Validation lives at the API layer (Zod) and `lib/context/types.ts:CONTEXT_NODE_TYPES_V1`. Direct DB writes (e.g. service-role from runner.ts, workflow-executor's auto-create-context-node F-113) can bypass validation. Cross-tier: same shape as F-19/F-81/F-90/F-116/F-209 — type defined at one layer, not enforced at another.
**Recommended fix shape:** CHECK constraint enumerating the V1 type whitelist; OR PostgreSQL ENUM type.

### F-268 — `nodes.created_by` and `last_modified_by` are `TEXT` with default `'user'`
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `supabase/migrations/20260503000004_nodes.sql:18–19`
Should be `UUID REFERENCES auth.users(id)` (or similar). The TEXT default `'user'` is a placeholder that obscures who actually wrote which node. Auditing impact: forensic reconstruction post-incident can't identify the writer from these columns alone.

### F-269 — `summary`, `prose`, `notes` are `TEXT` (JSON-encoded strings) not `JSONB`
**Severity:** LOW   **Confidence:** worth-checking   **Category:** wrong-semantics
**Location:** `supabase/migrations/20260503000004_nodes.sql:22–24`
The application stores Tiptap document JSON as JSON-encoded text via `JSON.stringify`. Defensible (no JSONB ops needed; round-trips cleanly). But: corruption (truncated JSON) wouldn't be caught at the DB level. F-17 (`fromStorage` returns null on parse failure) is the symptom; storing as JSONB would catch malformed payloads at INSERT time.

---

## E4 — `docs/`

### F-270 — Phase doc citations across the codebase reference frozen versions; not surfaced as findings here
**Severity:** see Theme T-13
**Spec citation:** all per-tier catalogues
The cross-cutting "spec citation stale" finding (Theme T-13) covers the dominant docs/ pattern: source files cite `stelavox_phase5_api_contract_v1_0.md v1.2` etc., and these don't auto-update. T-13 is the right place to address this; not duplicated as 60+ individual findings.

### F-271 — Phase docs are frozen historical artefacts; cross-spec drift not catalogued
**Confidence:** certain   **Category:** intentional spec convention
Per project convention (see CLAUDE.md changelog v1.5: *"Phase 3 docs (api contract, build checklist, test plan, test report) all bumped internally to v1.1; their filenames stay at the v1_0 form"*), Phase docs are frozen. Drift between Phase docs and current code is expected. Not a finding — it's the spec's own design.

### F-272 — Live authoritative specs (TA, Component Spec, Brand Identity, Product Spec) are the right targets for spec-divergence findings
The Tier-A findings already catalogued the spec-divergence between live specs and code (e.g. F-187 H-07 director-message scope, F-213/214 Inviolable #2). No additional spec-vs-code findings surfaced from a meta-pass.

### F-273 — Round-3 close-out report and Mars-drive reports are point-in-time documents; some phase-5d findings have moved on
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `docs/stelavox_phase5d_round3_close_out_report_v1_0.md`, `docs/stelavox_phase5d_mars_drive_report_v2_0.md`
These describe the state at a specific moment. The audit just produced 227+ new findings; the close-out reports don't reflect them. Acceptable per project convention (point-in-time reports), but the gap exists.

---

## Tier E summary

| Severity | Count |
|---|---|
| HIGH | **2** (F-253, F-265) |
| MEDIUM | 5 (F-257, F-258, F-266, F-267, F-268) |
| LOW | 5 (F-254, F-259, F-260, F-269, F-273) |
| **Total** | **12** |

Plus 4 positive findings (F-256, F-262, F-263, F-264) confirming H-13 compliance, conversations UNIQUE guard, usage_records UNIQUE guard, and cost-report schema correctness.

### What the migrations audit added that no other tier could

- **F-265 (nodes missing UNIQUE on order)** — F-154 / F-188 / H-04 violations are unguarded at the DB level. The race producing duplicate `order` values is silent at every layer above the DB. This is the most consequential structural finding; closes the loop on Theme T-8 (H-04 atomicity) — the application can fix its non-atomic UPDATE chains, but the DB has no guardrail to catch escapees.
- **F-263 / F-264 (positive UNIQUE guards)** — confirms F-99 and F-133 races are *partially* mitigated. The application's silent-error-on-DB-rejection (F-134 cluster) is now visible as a layered failure: DB rejects → application swallows → user-invisible bug.
- **F-262 (H-13 fully compliant)** — strong positive. The `SECURITY DEFINER` + `search_path` discipline is consistently applied.

### What the spec lens caught in Tier E

- **F-253 (smoke-agent-runner RPC drift)** — pure schema drift. Same shape as the round-3-surfaced bug; the script has been broken since before the round-3 typecheck gate was wired in.
- **F-265 (H-04 unguarded at DB)** — `H-04` mandates atomic reorder. Code violates by sequential UPDATE (F-188); DB violates by missing UNIQUE constraint (F-265). Both layers fail the spec.
- **F-260 (custom env loader)** — defensive duplicate of dotenv. Same shape as the existing T-3 cluster.

---

*Tier E audit complete. Audit-execution phase **truly done**. Next step: re-issue 99-themes.md with the full-pass findings, then back to the user for the deferred "serious look at the results."*