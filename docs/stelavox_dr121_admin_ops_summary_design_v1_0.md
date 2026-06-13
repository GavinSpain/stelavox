# DR-121 (expanded) — Admin Operations Summary · Tier-B Design Note v1.0

**Status:** design, pre-build. Wireframe: `docs/wireframes/wireframe_admin_ops_summary_v1.html`.
**Scope change:** DR-121 was "verify the scheduler-calibration metrics are captured + surfaced." Expanded 2026-06-14 (author: "all of these need to be included … finish it off in admin") to build a full **Operations Summary** — the cross-cutting "is the whole thing healthy right now" view that the per-subsystem dashboard lacks. Folds in the six gaps surfaced in the inventory review.
**Build phase:** Phase 10. Wireframe-first.

---

## 1. Information architecture

`/admin` opens with the **Operations Summary** — five new bands, top to bottom — followed by the existing detailed sections (the drill-down). `/admin/orchestration` and `/admin/payments` stay as-is, linked from the summary.

```
/admin
  ├─ Band 1 · System Health        (NEW — at-a-glance status + issue list)
  ├─ Band 2 · Liveness & Heartbeats (NEW — is everything running)
  ├─ Band 3 · External Dependencies (NEW — Anthropic / DB / Stripe)
  ├─ Band 4 · Volume & Growth       (NEW — orgs, activity, conversion trends)
  ├─ Band 5 · Export & Storage      (NEW — export volume + storage budget)
  ├─ Band 6 · Plan & Subscriber Economics (NEW — plan×cadence×status mix + per-plan budget utilisation)
  ├─ Band 7 · LLM Provider Reconciliation (NEW — platform spend by model, MoM, run-rate, BYOK comparison)
  └─ Detailed sections (EXISTING + DR-121 calibration additions):
       Scheduler throughput · Cost/spend · Failures · Probes ·
       Orchestration (link) · Audit log · Payments (link)
```

Each Band-1 issue and each red/amber tile deep-links to the section or page that explains it.

---

## 2. Exact metrics

Legend: **[derive]** = SELECT over existing data, no new capture · **[capture]** = needs a small new write/probe · **[infra]** = read existing Postgres infra (pg_cron / pg_net).

### Band 1 · System Health  [derive]
- **Overall status** — one of `HEALTHY` / `DEGRADED` / `CRITICAL`, computed:
  - `CRITICAL` if any **critical** capacity alert, OR a core dependency is down (Anthropic probe failing OR DB unreachable), OR the dispatcher heartbeat is stale beyond the hard threshold.
  - `DEGRADED` if any **high** capacity alert, OR a non-core probe is failing, OR the cloud-dispatch transport is stale, OR window failure-rate exceeds the warn threshold.
  - `HEALTHY` otherwise.
- **Active issues** — the deduplicated list behind the status (each: severity, one-line text, deep-link target). Source: capacity-alert evaluator + probe outcomes + heartbeat checks, unified.
- **Last refreshed** — client timestamp; the page polls every 30s (existing cadence).

### Band 2 · Liveness & Heartbeats
- **Dispatcher (local listener)** — `now() − MAX(dispatcher_tick_samples.tick_started_at)`. Green < 90s · amber < 5m · red ≥ 5m. **[derive]**
- **Cloud dispatch transport (pg_net, Option E)** — age of the most recent **200** in `net._http_response` for the dispatcher endpoint. The transport most likely to silently die in prod. Green < 2m · amber < 10m · red ≥ 10m / any recent non-200. **[infra]**
- **pg_cron jobs** — per-job last run + status from `cron.job_run_details` for the 5 jobs (`dispatcher_sweep_http`, `route-sample`, `poll-batches`, `period-rollover`, synthetic-probe sweep): last-run age + succeeded/failed. **[infra]**
- **Realtime delivery** — last **realtime round-trip probe**: write a sentinel row → confirm the realtime echo arrives < N ms. Pass/fail + latency. **[capture — new probe]** (added to the `synthetic_probe_runs` family + a cron entry; mirrors `director_small`).

### Band 3 · External Dependencies
- **Anthropic** — status from the existing `director_small` probe (pass/fail + last-run age) **[derive]**, plus the recent rate of agent-job failures classified as Anthropic-side (5xx / timeout / rate-limit) over the window **[derive]**.
- **Database** — reachable (implicit: the dashboard query ran) + a lightweight `SELECT 1` latency sample. **[derive]**
- **Stripe** — age of the most recent received `subscription_events` row (last-webhook-age) + the existing webhook ingestion-lag figure from the payments substrate. **[derive]**

### Band 4 · Volume & Growth  (window-scoped trends)  [derive]
- **Orgs** — total, broken down by `plan` and by `subscription_status`; **new orgs** in window (`organisations.created_at`); **active orgs** (≥ 1 `agent_jobs` row in window).
- **Trial → paid conversions** in window (orgs transitioning out of `trial`/`trialling` to an active paid status; from `subscription_events` / status change).
- **Activity trends** — Director turns/day, agent jobs/day, tokens/day (sum of `agent_jobs` token columns) as small sparklines over the window.

### Band 5 · Export & Storage
- **Export volume** — `export_jobs` in window: count by `format`, by outcome (completed / failed / cancelled); **failed-export rate**. **[derive]**
- **Storage used** — `SUM(export_jobs.file_size_bytes)` for non-expired exports, shown against the per-file limit (the 50 MB → raised value from the DR-042 discussion) and a soft total budget. **[capture — new column]** (`export_jobs.file_size_bytes`; the runner already computes byte length at upload — persist it; backfill nullable).

### Band 6 · Plan & Subscriber Economics  [derive]
*The consumer side — "am I pricing and allocating right?"*
- **Subscriber mix** — a plan × status × cadence matrix:
  - **Trial** count.
  - Per paid plan (**Writer / Author / Pro / byok_solo**): active count, split **monthly vs yearly**. Cadence is derived per org by mapping `organisations.stripe_price_id` → `priceIdToPlan(...).cadence` (`lib/stripe/plans.ts`). byok_solo flagged as a BYOK plan.
  - Totals: total paid, total trial, MRR (reuse the payments-substrate estimate).
- **Token economics by cohort** — a table, one row per non-BYOK cohort **including Trial**, with absolute totals, not just the bar. Columns:
  - **Users** — active count in the cohort.
  - **Tokens (period)** — `SUM(actual_input_tokens + actual_output_tokens)` from `agent_jobs` joined to `organisations` on `plan`, `route='platform'`, current period. [derive]
  - **Platform $ cost** — `SUM(agent_jobs.cost_usd)` for the cohort = the real Anthropic cost the platform bears for these users. [derive]
  - **Budget utilisation** — the bar + **calendar-elapsed-vs-consumed pace marker** (fill past the marker ⇒ on track to exceed budget) + a 6-mo MoM sparkline. `avg(token_usage_credits / token_allocation_credits)`. Trial has an allocation too (`plan.trial_token_allocation_credits`), so its bar is meaningful — "are trials exhausting their grant?"
  - **Revenue** — MRR contribution (paid plans: price × count; **Trial: $0**).
  - **Net** — Revenue − Platform $ cost. Paid rows show margin; **Trial shows a negative number in red — pure liability.**
  - **Totals footer** — total platform tokens, total platform $ cost, total revenue, net.
  - byok_solo is excluded (no platform tokens / no budget — it uses its own key; its flat fee is near-pure margin, surfaced in the mix table).
- **Trial liability callout** — a dedicated, prominent figure because trial cost is unoffset by revenue:
  - **Trial cost this period** (= the Trial row's Platform $) + **projected month-end** (run-rate).
  - **Avg cost per trial** + **avg cost per *converted* trial** (trial cost ÷ Band-4 conversions) — the acquisition-cost read: is the trial spend buying conversions or leaking?
  - Framed plainly: "Trial tokens are pure cost — no offsetting revenue. Watch against the conversion rate."
- *Why:* paid utilisation is a **margin** signal (high utilisation on a fixed price erodes margin; low means over-allocated / under-priced). Trial utilisation + absolute cost is a **liability** signal — you're paying Anthropic for users who pay nothing, justified only by conversion. Seeing tokens, $, and net side by side turns "average % full" into "what is this cohort actually costing me, and am I making money on it."

### Band 7 · LLM Provider Reconciliation  [derive]
*The provider side — "what will the Anthropic bill be, and what tier must I be on?"*
- **Current-period platform spend (route = `platform` only — BYOK never hits the platform's Anthropic account):**
  - **By model** (Haiku / Sonnet / Opus …): actual tokens (input / output / cache-read / cache-write) + **actual $** = `SUM(agent_jobs.cost_usd)`. Per-model because Anthropic invoices per-model with separate cache tiers.
  - **Total est. $ this period** + **projected month-end** (run-rate = consumed ÷ period-elapsed-fraction). This is the figure to reconcile against the Anthropic dashboard, and the basis for "which Anthropic plan/tier do I need."
- **Month-on-month** — total platform tokens + $ per month over the last ~6 months (from `agent_jobs` grouped by month + model, `route='platform'`). Capacity / tier-planning trend. (`usage_records` provides the same per-month rollup but lacks `model_id`; `agent_jobs` is queried directly for per-model precision — acceptable for an admin, window-bounded view.)
- **BYOK comparison (informational only — NOT platform-billed):**
  - BYOK users (`route='byok'`): count, total tokens, **$0 cost to operator** (they pay their own Anthropic).
  - Comparison: **avg tokens per active user, BYOK vs platform** — surfaces whether uncapped BYOK users consume more than budget-capped platform users (product signal). Clearly labelled "comparative — BYOK tokens hit the user's own provider account."

### Detailed sections — DR-121 original calibration additions (Scheduler throughput)
These were the original DR-121 scope; all data is captured, mostly a surfacing job:
- **WFQ fairness per class** — `dispatch_rate` per class ÷ class weight; shows whether each class got its share. **[derive]**
- **Per-pool bucket utilisation** — `bucket_utilisation` metric per pool (verify it fires under traffic — coded in the rollup, absent in the post-reset local DB). **[derive + verify]**
- **Per-class dispatch distribution** — break the existing total dispatch-rate series out by class. **[derive]**
- **Queue age** — oldest-wait per class as a time series. Only depth is captured today; add age to the minute rollup. **[capture — extend rollup]**
- **Conversation-window pressure** (the proxy, relabelled — not "hit rate") — % of Director turns running with a non-null summary (summarisation-active) and % where the rolling-window slice dropped messages (eviction). Written once per turn from `conversation-context.ts` into `metrics_minute_buckets`. **[capture — context builder]**

---

## 3. New capture (the only must-ship-before-Day-1 items)

Everything in Bands 1–4 + dependency status is derive/infra (no migration). The capture additions, all small:

1. **`export_jobs.file_size_bytes`** (nullable column) — persist the size the runner already computes at upload. Migration + 1 runner line. Backfill not required (old rows show "—").
2. **Realtime round-trip probe** — new `lib/admin/probes/realtime.ts` (write sentinel → await echo → record latency) + a `synthetic_probe_runs.probe_id` value + a cron entry. Mirrors the existing probe runner.
3. **Queue-age in the minute rollup** — add `queue_age` metric_kind (oldest-wait per class) to `metrics_minute_rollup`.
4. **Conversation-window pressure** — emit `conversation_window_pressure` metric (summarisation-active + eviction) per turn from `conversation-context.ts`.

No new tables — items 3 & 4 reuse `metrics_minute_buckets`; item 2 reuses `synthetic_probe_runs`; item 1 is one column.

**Bands 6 & 7 (the economics expansion) add ZERO new capture.** `agent_jobs` already stores `actual_input_tokens` / `actual_output_tokens` / cache tokens, `cost_usd`, `cost_credits`, `model_id`, `route`, `organisation_id`, `completed_at` — so per-model, per-route, per-month token + dollar reconciliation is pure SELECT. Cadence derives from `organisations.stripe_price_id`; budgets from `organisations.token_allocation_credits` + the `plan.*` config. Pricing/$ from `anthropic_pricing` (cache-tier aware). The only consideration is query cost: month-on-month over `agent_jobs` is a windowed scan — fine for an admin view; if it ever needs to be cheaper, a per-model-per-month rollup can be added later without changing the surface.

---

## 4. Build steps (one Phase-10 branch, ordered)
1. Migration: `export_jobs.file_size_bytes` + `queue_age` rollup extension + realtime-probe `probe_id` allowance.
2. Capture wiring: runner size persist · rollup queue-age · context-builder window-pressure · realtime probe + cron.
3. Dashboard API: extend `/api/admin/dashboard` (or a sibling `/api/admin/ops`) with the five bands' derived/infra reads (health rollup, heartbeats, dependencies, volume/growth, export/storage) + the four calibration surfaces.
4. UI: `OperationsSummary` component (Bands 1–5) mounted atop `AdminDashboard`; calibration panels added to the scheduler section. Inter only; no verdigris; status uses `--color-status-review` (amber) / `--color-error` (red) / a neutral-green for healthy.
5. Tests: health-rollup derivation (status thresholds), heartbeat staleness classification, realtime-probe pass/fail, capture unit tests (size persist, queue-age, window-pressure), auth gate.

## 5. Verification plan
- Health rollup: unit test each status threshold (critical/degraded/healthy) against synthetic alert/probe/heartbeat inputs.
- Heartbeats: staleness boundary tests (green/amber/red) for dispatcher, cloud transport, cron jobs.
- Realtime probe: pass on a working echo; fail on timeout.
- Capture: size persisted on a real export; queue-age + window-pressure rows appear in `metrics_minute_buckets`.
- End-to-end: load `/admin` against a seeded DB and confirm every band renders with real values; deep-links resolve.

## 6. Decisions — all locked 2026-06-14
- **OA-1 — LOCKED → atop `/admin`.** Operations Summary renders as bands above the existing detailed sections; not a separate route.
- **OA-2 — LOCKED → new `/api/admin/ops`.** Keeps the existing `/api/admin/dashboard` payload stable; ops reads are independently cacheable.
- **OA-3 — LOCKED → realtime probe every 5 min.** Failures are rare; a per-minute sentinel write would add noise.

No open decisions remain. Wireframe (Bands 1–7) approved 2026-06-14; this note is build-ready for the Phase 10 pass.

---
**Changelog**
**v1.2 — 2026-06-14** Band 6 deepened per author request: the budget-utilisation bars become a **token-economics-by-cohort table** with absolute totals (users · tokens · real Cost $ · util+pace · Revenue · Net) and **Trial included as a cohort**; added a dedicated **Trial liability** callout (trial cost + projected month-end + avg cost/trial + cost-per-converted-trial). Still zero new capture — `agent_jobs` grouped by `organisations.plan`. Wireframe callouts renumbered to 1–15.
**v1.1 — 2026-06-14** Added Bands 6 (Plan & Subscriber Economics) + 7 (LLM Provider Reconciliation) per author request — plan×cadence×status mix, per-plan budget utilisation (MoM + current-period pace), per-model Anthropic-bill reconciliation, BYOK comparison. All derive-only (zero new capture; `agent_jobs` already stores actual tokens + `cost_usd` + model + route). OA-1/2/3 locked; wireframe approved; build-ready.
**v1.0 — 2026-06-14** Initial design note. Expands DR-121 from scheduler-calibration verification to the full Admin Operations Summary (six cross-cutting gaps). Accompanies `wireframe_admin_ops_summary_v1.html`.
