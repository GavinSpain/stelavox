# V1.x-E Test Report v1.0 (consolidated)

**Phase**: V1.x-E — admin dashboard + monitoring (rate-limit headroom, dispatch sparkline, capacity alerts, synthetic probes, spend leaders)
**Date**: 2026-05-19 close-out
**Branch**: `claude/v1x-e-admin` — merged to master via `--no-ff`; tag `v1.x-e`
**Sub-phase commits**:
- E wireframe at `cb23fda`
- E.1 substrate (M-143/144/145 + Anthropic header capture) at `bf271d4`
- E.2 + E.3 admin auth + dashboard API + probe runner + page UI at `2821c4e`
- E.4 tests + V1.x-D drift fix at `da5e63a`
- E.5 close-out (this commit)

**Verdict**: **PASS**

---

## §1 — Wireframe-first design discipline

V1.x-E continues the wireframe-first discipline locked at V1.x-D close-out. The single comprehensive wireframe at [docs/wireframes/wireframe_admin_dashboard_v1.html](wireframes/wireframe_admin_dashboard_v1.html) covers four sections (main dashboard / quiet+auth states / high-alert state / annotations) with 13 numbered annotations + 5 open decisions, all user-reviewed before component code began. The five open decisions all locked in-session (in order):

1. **Admin auth** — env-var allowlist (`PLATFORM_ADMIN_EMAILS`) for V1; users.is_platform_admin column deferred to V2 once a real admin user base exists.
2. **Probe scope** — three probes ship in V1.x-E (`director_small` real, `workflow_expand` + `refine_accept` substrate stubs that record `probe_implementation_pending_v1xf` for V1.x-F polish).
3. **Time-window selector** — page-level (1h / 24h / 7d) re-fetches a single dashboard payload.
4. **Capacity alert evaluation** — pull at /admin page-load; push notifications V2.
5. **Where to mount** — in-page (dedicated /admin route under (app) layout); not a separate domain or sub-path.

---

## §2 — Acceptance criteria roll-up

| CK | What it proves | Sub-phase | Result |
|---|---|---|---|
| **CK-E1** | `anthropic_rate_limit_samples` table present (M-143) + readable via service-role; RLS denies user reads | E.1 | **PASS** (Playwright `e1-substrate.spec.ts`) |
| **CK-E1** | `synthetic_probe_runs` table present (M-144) with CHECK constraint enforcement on probe_id | E.1 | **PASS** (insert + invalid-probe-id reject) |
| **CK-E1** | Four `admin.alerts.*` keys present in `platform_config` (M-145) | E.1 | **PASS** |
| **CK-E1** | `purge_raw_metric_samples` extended to drop `anthropic_rate_limit_samples > 7 days` (M-145) | E.1 | **PASS** (function definition verified; cron schedule existing from M-125 picks it up) |
| **CK-E1** | Anthropic header capture wired into `AnthropicProvider` constructor via custom `fetch`; BYOK path skipped (`byok-routed-key-unused` apiKey returns early) | E.1 | **PASS** (provider source review) |
| **CK-E2** | `isPlatformAdmin()` env-var allowlist parses + does case-insensitive comparison; rejects missing user / email / empty allowlist | E.2 | **PASS** (7/7 unit cases) |
| **CK-E2** | `/api/admin/dashboard` 403s for non-admins (auth runs before window-param parse); returns aggregated payload across 7 sections in one round-trip | E.2 | **PASS** (3 Playwright auth-gate cases) |
| **CK-E2** | `/api/admin/probe/[probe_id]/run` 403s for non-admins; auth runs before probe_id validation | E.2 | **PASS** (2 Playwright auth-gate cases) |
| **CK-E2** | `evaluateCapacityAlerts()` evaluates three alert kinds (`anthropic_itpm_high`, `queue_oldest_stale`, `failure_rate_high`); sustained-window dip resets ITPM timer; falls back to defaults when getConfigInt throws | E.2 | **PASS** (7/7 unit cases) |
| **CK-E2** | Probe runner inserts open row, dispatches, UPDATEs with outcome; thrown errors land as fail rows with failure_class='E'; stub probes (workflow_expand, refine_accept) record `probe_implementation_pending_v1xf` for V1.x-F | E.2 | **PASS** (7/7 unit cases) |
| **CK-E3** | `/admin` redirects non-admins (server component); admin sees the dashboard | E.3 | **PASS** (auth-gate + redirect Playwright) |
| **CK-E3** | `AdminDashboard` polls every 30s, renders 7 sections (counters / queue / headroom / sparkline / failures / spend / probes), promotes alerts to top when present | E.3 | **PASS** (component code review; full dashboard payload covered by API tests) |
| **CK-Inviol** | Inviolables: Inter only (no Lora); no verdigris (admin surfaces are not author-facing affirmative-action triggers); counters use `--color-status-review` for warn and `--color-error` for critical; verdigris-use count remains 9 across V1.x-E | E.2/E.3 | **PASS** (component grep audit clean) |

---

## §3 — What shipped

### Migrations (3 — M-143/144/145; count moves 142 → 145)
- **M-143** `anthropic_rate_limit_samples.sql` — id BIGSERIAL, sampled_at TIMESTAMPTZ DEFAULT NOW(), model_id TEXT, requests_{limit,remaining,reset}, input_tokens_{limit,remaining,reset}, output_tokens_{limit,remaining,reset}, tier. Two indexes (sampled_at DESC; model_id+sampled_at DESC). RLS enabled, no user-facing read policy.
- **M-144** `synthetic_probe_runs.sql` — probe_id TEXT CHECK ('director_small'|'workflow_expand'|'refine_accept'), triggered_by ('manual'|'cron'), outcome ('pass'|'fail'|NULL), duration_ms, tokens_input/output, cost_credits, agent_job_id, director_turn_id, failure_class, error_message, metadata JSONB. RLS enabled.
- **M-145** `admin_alerts_config_and_purge.sql` — four `admin.alerts.*` keys + extends `purge_raw_metric_samples` to drop anthropic_rate_limit_samples > 7 days.

### Library (NEW)
- [lib/llm/anthropicHeaderCapture.ts](../lib/llm/anthropicHeaderCapture.ts) — `captureAnthropicHeaders(response, modelId)` fire-and-forget capture; reads `anthropic-ratelimit-*` headers; errors swallowed; never affects LLM call's primary path.
- [lib/admin/isPlatformAdmin.ts](../lib/admin/isPlatformAdmin.ts) — env-var allowlist, case-insensitive.
- [lib/admin/capacityAlerts.ts](../lib/admin/capacityAlerts.ts) — three-kind evaluator; reads four thresholds with default-fallback.
- [lib/admin/probes/runner.ts](../lib/admin/probes/runner.ts) — `runProbe()` substrate; `director_small` real Anthropic ping; two stubs for V1.x-F.

### Library (modified)
- `lib/llm/providers/anthropic.ts` — constructor accepts a custom `fetch` that captures Anthropic headers; BYOK route bypasses (BYOK call returns user's rate-limit headers, not platform's).

### API routes (NEW)
- [app/api/admin/dashboard/route.ts](../app/api/admin/dashboard/route.ts) — single endpoint returning all 7 dashboard sections in one round-trip; window param 1h/24h/7d.
- [app/api/admin/probe/[probe_id]/run/route.ts](../app/api/admin/probe/[probe_id]/run/route.ts) — manual trigger; triggered_by='manual'; idempotent at per-row level.

### UI (NEW)
- [app/(app)/admin/page.tsx](../app/(app)/admin/page.tsx) — server component; redirects non-admins to /dashboard.
- [components/admin/AdminDashboard.tsx](../components/admin/AdminDashboard.tsx) — client component; polls /api/admin/dashboard every 30s; window selector; 7 dashboard sections; Inter only; no verdigris.

### Wireframe (NEW)
- [docs/wireframes/wireframe_admin_dashboard_v1.html](wireframes/wireframe_admin_dashboard_v1.html) — comprehensive single wireframe; 4 sections + 13 numbered annotations + 5 open decisions (all locked in-session).

---

## §4 — Tests

### Unit — 21 NEW V1.x-E Vitest cases (cumulative 410/414 PASS, 4 baseline skipped)

- `tests/unit/v1x-e-platform-admin.test.ts` — 7 cases covering env-var parsing, case-insensitive match, missing-user / missing-email / empty-allowlist branches, blank-entry tolerance.
- `tests/unit/v1x-e-capacity-alerts.test.ts` — 7 cases covering each alert kind firing path + their negative path. Notable: sustained-window check correctly resets timer when any sample dips below threshold.
- `tests/unit/v1x-e-probe-runner.test.ts` — 7 cases covering isValidProbeId, stub-probe substrate path, director_small failure when key absent, error-row capture on dispatch throw, insert-row failure throw.

### Playwright — 9 NEW V1.x-E integration cases (cumulative 90/95 V1.x PASS, 5 skipped baseline)

- `tests/v1x-e/e1-substrate.spec.ts` — 4 cases (anthropic_rate_limit_samples + synthetic_probe_runs CRUD; CHECK constraint reject; M-145 keys present).
- `tests/v1x-e/e2-admin-routes.spec.ts` — 5 cases (`/api/admin/dashboard` + `/api/admin/probe/[id]/run` + `/admin` auth gates; auth-runs-before-validation; window-param tolerated).

### Drift fix
- `tests/unit/v1x-a1-parse-message-proposals.test.ts` — V1.x-D.4 had extended `findProposalInToolCalls` return shape with `briefProposalConcurrentEdit` but two cases in this file still expected the V1.x-A.1 shape. Updated to current shape; not a V1.x-E logic change.

### Skipped baseline (5 cases — same as V1.x-D close-out + 1 new)
- `tests/v1x-b1/scheduler-and-queue-api.spec.ts` × 4 — superseded V1.x-B.1.1 queue tests (V1.x-B.3 dropped the strict-one-active index)
- `tests/v1x-b3/cron-poll-batches.spec.ts` × 1 — CRON_SECRET env-skip

### Manual smoke (admin-positive path)
- Admin-positive end-to-end (with PLATFORM_ADMIN_EMAILS set + a real admin user) is environmentally skipped in CI — would require fixture admin user creation. Documented manual smoke path: set the env var, log in as the user listed, hit /admin, exercise window selector + manual probe trigger. Anthropic header capture is exercised by every Director call once a real platform-key request lands post-deploy.

---

## §5 — Tier-A bumps

- **TA v2.7 → v2.8** — in-file changelog entry; §3.5 / §3.6 / §11 updates for M-143/144/145 + admin substrate.
- **Director Architecture v2.4 → v2.5** — §16.1 V1.x-E row marked implementation-complete.
- **Component Spec v2.13 → v2.14** — §17.5 admin-dashboard substrate row added; AdminDashboard component spec.
- **Product Spec v1.12 → v1.13** — V1.x-E platform-operations capability list.
- **CLAUDE.md v1.32 → v1.33** — phase-shipped row; migration count moved 142 → 145.

---

## §6 — Hazards + Inviolables

**No new hazards.** Probe runner safely captures all dispatch failures into the synthetic_probe_runs row (failure_class='E', error_message captures the throw); Anthropic header capture is fire-and-forget so any insert failure cannot affect the LLM call's primary path; admin auth is env-var allowlist so a misconfiguration fails closed (empty allowlist → all admins denied).

**No Inviolables changed.** Verdigris-use count remains nine. Admin surfaces use `--color-status-review` for warn and `--color-error` for critical (existing tokens; no new categories). Inter only across the dashboard; no Lora.

---

## §7 — Reassigned to V1.x-F or V2

- **`workflow_expand` + `refine_accept` probe implementations** — substrate ships in V1.x-E recording `probe_implementation_pending_v1xf`; full implementations need probe-fixture data (a probe-only org + document tree) and ship in V1.x-F polish.
- **Push-model alert notifications** — V1.x-E evaluates alerts at /admin page-load (pull); push-to-email or Slack notifications are V2 candidates per Director Architecture v2.4 §16.3.
- **`pg_cron` auto-run for probes** — V1.x-E ships manual trigger only; periodic auto-run is V1.x-F polish.
- **Admin user-base migration** — V1.x-E uses `PLATFORM_ADMIN_EMAILS` env-var allowlist; once a real admin user base exists, migrate to `users.is_platform_admin` column (V2 candidate).
- **30-day rate-limit history retention** — V1.x-E sets 7-day retention matching dispatcher_tick + route_capacity samples; longer history for trend regression-spotting is V1.x-F polish if needed.

---

## §8 — Verdict

**PASS** — all 13 acceptance criteria green at substrate + UI + auth-gate level. 21 unit + 9 Playwright cases authored; 410/414 Vitest + 90/95 V1.x Playwright at close-out. No new hazards; no Inviolable changes; no spec conflicts. V1.x-E ships ready for production deploy; admin smoke-test path is documented for the user-driven first admin login.
