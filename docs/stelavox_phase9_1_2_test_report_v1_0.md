# Stelavox — Phase 9.1 + 9.2 Test Report
## Version 1.0

**Phases under test:** 9.1 (security + correctness hardening) and 9.2 (cloud cutover), executed and merged 2026-06-10..11.

**Verdict:** **PASS.** All 12 V1 Deliverables Register items closed (9 in 9.1, 3 in 9.2); cloud transport activated and proven autonomous; no Inviolable changes; no new hazards; verdigris-use count unchanged at 12.

---

## 1. Scope

### Phase 9.1 — Security + correctness hardening
First V1 work package out of the Phase 9 reset. Drawn from the V1 Deliverables Register's hardening cluster:

- **DR-095** — Director rate-limit fail-policy (audit F-74)
- **DR-096** — `audit_log` writes on critical events + admin-section viewer (audit F-56; author-broadened mid-review)
- **DR-097** — Silent-failure theme guard rule (audit T-1)
- **DR-098** — H-01 `.single()` violations sweep (audit T-2)
- **DR-100** — `usage_records` race / billing-data-loss (audit F-133/F-134)
- **DR-102** — F-89 `assertConversationAuthor` admits any caller on conversations with no user messages
- **DR-103** — Injection-frame centralisation (audit T-7)
- **DR-111** — `getConfig<T>` runtime validation (audit F-07; flagged "single most-leveraged fix")
- **DR-112** — `decorateWithLeaf` silent fallback (audit F-152/F-160)

### Phase 9.2 — Cloud cutover
Three register items that share a deployment dependency, so executed as one mini-phase:

- **DR-063** — Scheduler-listener cloud home
- **DR-067** — Cloud DB sync (~150 missing migrations on stelavox-dev)
- **DR-117** — Cron probes (M-148 schedule) in cloud

---

## 2. Recon findings (per item)

A required preamble to Phase 9.1 was verifying audit findings against current code — the underlying audit was a month old. The recon (three parallel Explore agents, 2026-06-10) found:

| Item | Recon finding |
|---|---|
| DR-095 | Open: count-query error silently coerced to 0, allowing the request through |
| DR-096 | Open: 3 critical-event sites still on `console.error`; no admin viewer |
| DR-097 | **CLOSED at site level** (Anthropic stream, autosave, SSE, accept paths all throw / surface state); zero empty catches remain in production code |
| DR-098 | **CLOSED at site level**; `lib/data/**` carries ESLint scoped rule banning `.single()` |
| DR-100 | Open: SELECT-then-INSERT-or-UPDATE race; both branches' errors unchecked |
| DR-102 | Open: `if (!data) return null` admits any caller |
| DR-103 | **CLOSED at site level** (all 5 flagged sites carry scan→escape→wrap); F-73 documented as a design choice backed by Zod structural validation |
| DR-111 | **CLOSED**: typed `getConfigInt/Number/String/Bool` variants with runtime throw-on-mismatch; 61 call sites |
| DR-112 | **CLOSED**: explicit throws on missing/malformed layer_stacks |

**Five items were substantially closed by the May audit remediation batches without the PROGRESS.md tracker recording it.** The session-1 build scope shrank from "build all nine" to "fix the four open ones + verify the closed five + add the guard rules + close the audit-log viewer half of DR-096."

---

## 3. Code shipped — Phase 9.1

### DR-095 — Fail-closed rate limit
`app/api/director/message/route.ts`: config-fetch and count-query failure branches now return retryable **503 `rate_limit_check_unavailable`** with `retry_after_seconds: 10`. Previously the count-query error left `recentCount` undefined and `(undefined ?? 0) >= limit` evaluated false — silent fail-open. Policy locked: occasional spurious retries during DB blips are acceptable; unverified dispatch is not.

### DR-102 — `assertConversationAuthor` fallback
`lib/director/route-helpers.ts`: when a conversation has no user messages, falls back to verifying the caller is a member of the conversation's organisation. Service-role client (per caller convention) so RLS can't carry the check — explicit `conversations` + `organisation_members` lookups; any lookup error fails closed. V1 single-user orgs make membership = author by definition; the structural fix tightens when multi-user orgs arrive in V2.

### DR-100 — Usage records via atomic RPC (M-215)
New `increment_usage_record(p_organisation_id, p_year_month, p_operation_type, p_provider, p_tokens_*)` SECURITY DEFINER `SET search_path = public`. Body is a single `INSERT ... ON CONFLICT ... DO UPDATE SET tokens_input = usage_records.tokens_input + EXCLUDED.tokens_input ...` — additive, atomic, no race possible. `lib/agent/job-lifecycle.ts:updateUsageRecords` now calls the RPC and checks the error; on failure writes a `high`-severity `audit_log` row of `event_type='usage_record_write_failed'` (preserves billing-reconciliation observability instead of silently dropping it). Grant: `service_role` only; revoked from `anon`, `authenticated`, `PUBLIC`.

### DR-096 — `audit_log` critical-event writes
Three sites that previously only `console.error`'d now also write `audit_log`:
- `lib/agent/job-lifecycle.ts:notifyWorkflowIfStep` → `workflow_advance_failed` (high)
- `lib/agent/job-lifecycle.ts:persistRunningStart` → `agent_job_transition_failed` (high)
- `lib/agent/runner.ts` catch-all → `agent_job_failed` (medium; injection/canary paths already write their own from inside the scanner modules)

### DR-096 (UI half) — Admin audit-log viewer
Per `wireframe_admin_audit_log_v1.html` (D1–D6 + OQ-1..3 at recommendations). `GET /api/admin/dashboard` gains `audit_log_recent` (newest 50 in window, all severities, org-name join) + `window_total` + `?audit_before` cursor for pagination. `AdminDashboard` gets a seventh section: severity filter chips with counts (client-side filter so counts stay honest); 5-column rows (severity dot · relative time · monospace `event_type` + metadata preview · org with short-UUID + name · soft-ref hints); click-to-expand inline JSON forensics; Load-50-more cursor pagination; empty state. Zero verdigris; admin-surface convention (Inter + JetBrains Mono only) preserved.

### DR-097 — Silent-failure guard rule
Project-wide ESLint rule: `no-empty: ['error', { allowEmptyCatch: false }]`. Caught 8 residual empty catches in drive scripts on first run — each now carries a justification comment. Production code was already clean (recon-verified zero empty catches in `lib/` + `app/` + `components/`).

---

## 4. Code shipped — Phase 9.2

### DR-063 + DR-117 — pg_net transport (M-216 + M-217)
**Design decision (locked 2026-06-10):** the database is the scheduler's clock; Vercel is stateless compute. Instead of renting an always-on worker (Option A) to hold the LISTEN connection that Vercel cannot host, the DB now calls OUT over HTTPS via `pg_net`.

**M-216 substrate:**
- `invoke_scheduler_endpoint(p_path TEXT)` SECURITY DEFINER helper. Double-gated: no-op unless `scheduler.cloud_dispatch_base_url` is set in `platform_config` AND a `cron_secret` exists in Vault. Every failure path swallowed with `RAISE WARNING` so a transport hiccup never aborts the calling trigger's transaction.
- **Completion push** — `agent_jobs_notify_completion` trigger body extended: still `pg_notify` (for the local LISTEN listener), additionally invokes `/api/cron/dispatcher-tick`. Director iterations chain in cloud at HTTP latency (~3s typical).
- **Enqueue push** — new `trg_agent_jobs_enqueue_dispatch_push` AFTER INSERT trigger (`WHEN NEW.queue_status = 'queued' AND NEW.consumer_kind = 'dispatcher'`): fresh queues dispatch immediately, covering both workflow approvals and the push-model evaluator with a single mechanism.
- **Cadence functions** — `request_batch_poll` + `request_route_capacity_sample` + `request_synthetic_probe` (M-148, DR-117) all gain the gated HTTP invoke.
- `request_dispatcher_tick` deliberately stays `pg_notify`-only (1s pg_cron cadence; an HTTP-per-second firehose is unacceptable).
- New 1-minute `dispatcher_sweep_http` pg_cron job is the cloud sweep for stragglers, aging promotion, and crash recovery.

**Routes:** new `/api/cron/route-sample` (CRON_SECRET auth); `/api/cron/poll-batches` normalised from divergent `CRON_AUTH_TOKEN` to fleet-standard `CRON_SECRET`.

**M-217 timeout fix:** first cloud invocation surfaced that `pg_net`'s default `timeout_milliseconds=5000` was right under `dispatcher-tick`'s actual runtime (~4–5s on an empty queue) — server completed 200 successfully but pg_net recorded a client-side timeout that would have masked real HTTP errors under noise. Bumped to 30000ms. `http_post` is async; the timeout is just the response-recording ceiling.

### DR-067 — Cloud DB sync
stelavox-dev cloud was at migration `20260512104456` (V1.x-LB ship date) — month-old test residue, missing ~150 migrations. Reset and re-applied via `supabase db reset --linked`: 208/208 migrations + seed.

**Latent bug surfaced by the reset:** seven migrations from the May 17–19 multi-phase sprint (sequence numbers 142–148) carried date stamps that contradicted their sequence numbers — V1.x-D/E/F substrate stamped `20260518`/`20260519` sorted *after* Phase 6/7 + Director prompt migrations stamped `20260517` with higher sequence numbers. Sequence numbers encode the true dependency order: M-164 (Director v1.11) transforms the v1.10 config that M-146 creates, so replaying in filename order failed at M-164 with a `NOT NULL` violation on the missing source row. The live local DB never noticed because migrations were applied incrementally in authoring order; the inversion only fired on the first from-scratch replay. Restamped all seven to `20260517` (filename order now equals sequence order; verified zero inversions across all 209 files); local `schema_migrations` history updated to match. **This fix protects every future environment, prod included.**

---

## 5. Migrations applied

| ID | File | Purpose |
|---|---|---|
| M-215 | `20260610000215_increment_usage_record_rpc.sql` | DR-100 atomic UPSERT |
| M-216 | `20260610000216_pg_net_cloud_dispatch.sql` | DR-063 pg_net transport + DR-117 probe transport |
| M-217 | `20260611000217_pg_net_timeout_bump.sql` | M-216 hotfix — pg_net timeout 5000ms → 30000ms |
| Restamp | 7 files renamed (M-142..M-148) | DR-067 latent replay-ordering bug |

Migration count: 214 → 217 net (+ 7 restamps).

---

## 6. Verification — checkpoints

### CK-1 — DR-095 fail-closed rate limit
Verified by reading the route diff: both failure branches return 503 with `retry_after_seconds`. `tests/unit/phase9-1-hardening.test.ts` covers `assertConversationAuthor` (which uses the same fail-closed posture) explicitly; the rate-limit path itself is exercised in the V1.x-B.2 director smoke suites which continued to pass post-merge.

### CK-2 — DR-102 author fallback (8/8 cases PASS)
`tests/unit/phase9-1-hardening.test.ts`:
- (5) no user messages + caller IS org member → `null` (pass)
- (6) no user messages + caller NOT a member → 403 `not_conversation_author`
- (7) first user message author mismatch → 403 (regression guard)
- (8) first user message author match → `null` (regression guard)

### CK-3 — DR-100 atomic UPSERT (8/8 cases PASS)
Same test file:
- (1) first call INSERTs fresh row with given tokens
- (2) second call ADDS to existing row (`tokens_input` 100 → 150)
- (3) 8 concurrent calls: total = before + 80 (no lost updates — the structural race that M-215 closes is empirically gone)
- (4) anon role rejected (RPC grant is service-role only)

### CK-4 — DR-096 admin viewer
Diagnostic spec `tests/diagnostic/admin-audit-log.spec.ts` against live local app:
- Section renders (`data-testid="admin-audit-log"`)
- 7d window shows 49 rows (audit_log already populated by local dev usage)
- "High" chip filter narrows to 14 rows
- Click expands metadata JSON (`event_type:`, `metadata:` present in expansion)
- Click again collapses
- Screenshot captured (`tests/diagnostic/admin-audit-log.png`)

### CK-5 — DR-097 lint rule
`npm run lint` after rule landed: zero new no-empty violations in production code; 8 caught in drive scripts (all subsequently fixed with justification comments).

### CK-6 — Type-check + Vitest regression
`npm run type-check`: 0 errors. `npx vitest run`: **1073/1073 PASS** (one m173-h26 sampling flake on first run, clean on second — pre-existing test fixture fragility, not Phase 9 induced).

### CK-7 — V1.x-apollo regression
After M-215/216 landed: **211 passed + 1 known-baseline-flaky** (Scenario 3 mid-flight cancel cascade — documented pre-Phase-9 flake; the new INSERT trigger from M-216 introduces zero new failures across the apollo simulator + transition-matrix suites).

### CK-8 — Cloud DB sync (DR-067)
`supabase migration list --linked` after reset: 208/208 applied. Schema verification via direct cloud query:
- migrations_applied: 208
- agent_profiles: 22 (seeded)
- production_director_configs: 1 (v1.28 — current)
- realtime_publication_tables: 14 (M-214 included)
- pg_cron jobs: 12 (`dispatcher_sweep_http` included)
- builtin_export_profiles: 5

### CK-9 — Cloud transport activation (DR-063)
- `scheduler.cloud_dispatch_base_url` set to `"https://stelavox.vercel.app"`
- Vault `cron_secret` seeded; matches Vercel env var (first 6 chars verified by user)
- `dispatcher-tick` accepts `Bearer <CRON_SECRET>` → 200 with valid tick result
- Manual `SELECT invoke_scheduler_endpoint('/api/cron/dispatcher-tick')` records 200 in `net._http_response` (no `error_msg`)
- `dispatcher_sweep_http` pg_cron firing autonomously every minute, 200s recorded
- `route-sample` cron firing autonomously, 200s recorded

### CK-10 — Enqueue trigger (deferred to first real signup)
The `trg_agent_jobs_enqueue_dispatch_push` AFTER INSERT trigger exists on cloud (verified via `pg_trigger`); its trigger condition (`queue_status='queued' AND consumer_kind='dispatcher'`) is exercised by the Vitest suite locally. End-to-end "agent_jobs INSERT → pg_net POST → Vercel tick" was not artificially fired against cloud because the post-reset DB has zero organisations (`handle_new_user` auto-creates orgs on signup; a hand-crafted org would pollute the clean cloud DB). **The first real cloud signup will exercise this path naturally and `net._http_response` will record it.**

---

## 7. Surprises and decisions

### Recon-shrink
What we budgeted as a 9-item build became a 4-item build + 5 verification items + 2 closure-bookkeeping items + guard rules + the audit-log viewer. The recon was load-bearing — without it the session would have rebuilt five already-closed items.

### M-217 surfaced by the smoke
Per the testing methodology, the cloud smoke wasn't a rubber stamp — it surfaced a real timeout-tuning issue that would have produced noisy `net._http_response` rows masking real failures forever. Smoke earned its keep.

### Migration restamp
The latent date-stamp/sequence-number inversion in seven May migrations is a separate-but-important fix unlocked by the reset. Every future env is safer because of it.

### Provider-neutral consumption surfacing preserved
Audit-log viewer surfaces internal observability data — token totals appear in failure metadata but never as user-facing dollar values. Consistent with V1.x-D BYOK posture.

---

## 8. Inviolables

**All six intact.** Verdigris-use count remains 12. Phase 9.1+9.2 added zero new verdigris uses: error-class surfaces in the audit-log viewer use `--color-error` and `--color-status-review` (severity vocabulary); Director Send + Approve still use the existing affirmative-action use #7 family; admin chrome stays neutral as established in V1.x-E.

No new Cinzel sites. No Cormorant Garamond italic anywhere. No Lora outside its existing prose-surface mounts. Inviolable #1 (prose lowest-noise) untouched.

---

## 9. Hazards

**No new hazards.** All migrations include `SET search_path = public` per H-13. The pg_net helper is reliability-bounded by the gates + RAISE WARNING + 30s timeout: a transport failure cannot abort the trigger transaction, cannot block the agent_jobs write, cannot crash pg_cron. The cloud listener absence is not a hazard — by design — because the cron sweep is the safety floor.

---

## 10. Deliverables Register state after this report

| Item | State | Pointer |
|---|---|---|
| DR-063 cloud listener | ✓ shipped | M-216 + M-217 |
| DR-067 cloud DB sync | ✓ shipped | reset + 208 migrations applied |
| DR-095 rate-limit fail-closed | ✓ shipped | `app/api/director/message/route.ts` |
| DR-096 audit_log + admin viewer | ✓ shipped | code half + `wireframe_admin_audit_log_v1.html` |
| DR-097 silent-failure guard | ✓ shipped | ESLint `no-empty` rule |
| DR-098 H-01 sweep | ✓ shipped (pre-existing) | already closed; verified |
| DR-100 usage UPSERT | ✓ shipped | M-215 |
| DR-102 F-89 fix | ✓ shipped | `lib/director/route-helpers.ts` |
| DR-103 injection-frame | ✓ shipped (pre-existing) | already closed; verified |
| DR-111 getConfig validation | ✓ shipped (pre-existing) | already closed; verified |
| DR-112 decorateWithLeaf | ✓ shipped (pre-existing) | already closed; verified |
| DR-117 cron probes | ✓ shipped | rides M-216 transport |

**V1 hard-blocker list reduced from 22 to 10.** Remaining V1 buckets: B (Stripe) · D (Director context) · E (UX batch — 5 items) · 3 Phase-10 folds.

---

## 11. Tier-A propagation

- TA v2.18 → **v2.19** (§3 migration count + §11 Phase 9.1 / 9.2 row marked MET + new hazard candidates considered and rejected)
- Director Architecture v2.8 → **v2.9** (Option E transport added as canonical cloud-dispatch path; §16.3 V2 backlog updated — no items moved)
- CLAUDE.md v1.51 → **v1.52** (this report's summary + register state + work-package status table)

---

**Verdict: PASS.** Phase 9.1 + 9.2 shipped 2026-06-11; merged to master at `a3b3056` (M-216) + `63354b4` (M-217). Cloud dispatch transport autonomous and proven via `net._http_response` 200 OK rows. Local-dev listener path unchanged (still ms-latency). No Inviolables changed; verdigris-use count remains 12; no new hazards.
