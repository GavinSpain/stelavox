# Stelavox V1.x-E — Tier-B Build Checklist
## Admin dashboard + monitoring
## Version 1.0

> **Status: DRAFT.** Authored 2026-05-16 alongside B.3/C/D/F. UI/visualisation choices need user input pre-execution — flagged inline.

---

## §1 — Scope and goals

V1.x-E ships the admin dashboard that visualises the metrics rollup layer V1.x-B.2.4 wrote. Five surfaces:

1. **Real-time scheduler health** — queue depth per class, dispatch rate, current virtual_clock, Class 1 reserved-slot utilisation, active reservations
2. **Failure breakdown** — per-class failure counts over time, auto-recovery rate, drilldown to individual failure_taxonomy_samples rows
3. **Cost tracking** — per-pool / per-operation_type / per-period spend, BYOK vs platform split
4. **batched_24h adoption** — count per intent over time, average batch size, batch SLA distribution
5. **pg_cron + Anthropic API health** — cron job durations, Anthropic API rate-limit headroom (from response headers)

### Sequencing

V1.x-E internal sub-phases:
- **E.1** — `/admin` route shell + auth (org-owner-only) + chart library setup (1 session)
- **E.2** — Real-time scheduler health + failure breakdown views (1-2 sessions)
- **E.3** — Cost tracking + batched_24h adoption views (1-2 sessions)
- **E.4** — pg_cron + Anthropic health + synthetic probes (1 session)
- **E.5** — Tier-A consolidation + Test Report + merge (1 session)

Estimated 4-6 sessions total.

### USER INPUT NEEDED

- Chart library choice (Recharts? Chart.js? Vercel's built-in? — design taste call)
- Drilldown UX (click chart → time range filter → table view? modal?)
- Whether `/admin` is a separate route tree or a tab inside `/settings`
- Synthetic-probe cadence + scope (the build checklist mentions "synthetic probes" but B.2 didn't ship them; E.4 lands them)

---

## §2 — Migrations (2-3, 144-146)

- **M-144 — `metrics_synthetic_probes`** table:
  ```sql
  CREATE TABLE metrics_synthetic_probes (
    id BIGSERIAL PRIMARY KEY,
    probe_kind TEXT NOT NULL,  -- 'anthropic_haiku_completion' | 'edge_function_byok_call' | 'pg_cron_dispatcher_tick'
    probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    duration_ms INTEGER NOT NULL,
    error_summary TEXT NULL
  );
  CREATE INDEX metrics_synthetic_probes_kind_time_idx
    ON metrics_synthetic_probes(probe_kind, probed_at DESC);
  ```
- **M-145 — `synthetic_probe_cron_jobs`**: pg_cron schedules for the synthetic probes (e.g. every 5 min for the BYOK Edge Function call; every 1 min for the dispatcher_tick health check)
- **M-146 — `admin_dashboard_views`** (optional Postgres VIEWs to simplify dashboard queries — reads from metrics_minute_buckets but exposes ergonomic shapes for chart components)

---

## §3 — Library

- **NEW `lib/admin/dashboard-queries.ts`** — typed helpers for the admin dashboard: `getQueueDepthSeries`, `getDispatchRateSeries`, `getFailureBreakdown`, `getBucketUtilisation`, etc.
- **NEW `lib/admin/syntheticProbes.ts`** — probe runners (called by pg_cron via the same pg_notify channel pattern as M-122)
- **MODIFY `lib/scheduler/listener.ts`** — subscribe to additional channels for probe invocations

---

## §4 — UI

- **NEW `app/(app)/admin/page.tsx`** + sub-routes — Inter typography only; no verdigris (admin surfaces are observability not affirmative-action)
- **NEW `components/admin/SchedulerHealthChart.tsx`** + others per the 5 surfaces
- **NEW `components/admin/SyntheticProbeStatusGrid.tsx`** — heartbeat indicators per probe kind

---

## §5 — API routes

- **NEW `GET /api/admin/scheduler-health`** — series data for the chart
- **NEW `GET /api/admin/failure-breakdown`** — per-class + per-op_type rollup
- **NEW `GET /api/admin/cost-rate`** — per-pool spend
- **NEW `GET /api/admin/synthetic-probes`** — recent probe results
- **NEW `POST /api/cron/run-synthetic-probes`** — invoked by listener

---

## §6 — Acceptance + Sign-off

CK-1..CK-8 covering each chart's data correctness + each probe's wiring. Test Report PASS; Tier-A bumps (TA v2.7 → v2.8; Component Spec v2.14 → v2.15; CLAUDE.md → v1.33); merge with `--no-ff` + tag `v1.x-e`.

---

## Changelog

**v1.0 — 2026-05-16** Initial draft authored alongside B.3/C/D/F.
