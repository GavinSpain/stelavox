# V1.x-F Test Report v1.0 (consolidated)

**Phase**: V1.x-F — failure-mode UX + probe completion (`report_capability_limit` Director tool + failure-state UI substrate + real `workflow_expand` + `refine_accept` probes + pg_cron auto-run)
**Date**: 2026-05-19 close-out
**Branch**: `claude/v1x-f-failure` — merged to master via `--no-ff`; tag `v1.x-f`
**Sub-phase commits**:
- v1x-f kickoff (build checklist v1.1) at `d44b269`
- F wireframe (`wireframe_failure_mode_ux_v1.html`) at `3bacb16`
- F.1 (`report_capability_limit` tool + CapabilityLimitCard + M-146) at `1af1974`
- F.2 (failure-message templates + FailureToast + FailureBanner + M-147) at `36da4b5`
- F.3 (probe completion + pg_cron + M-148) at `813c126`
- F.3 close-out (this commit)

**Verdict**: **PASS**

---

## §1 — Wireframe-first design discipline

Single comprehensive wireframe at [docs/wireframes/wireframe_failure_mode_ux_v1.html](wireframes/wireframe_failure_mode_ux_v1.html) covering all failure-state UI surfaces (CapabilityLimitCard + FailureToast Class A/C + FailureBanner Class D/E + Class B Resume reference). Five open decisions all locked in-session before component code began:

| ID | Decision | Lock |
|---|---|---|
| D1 | Class A toast | Silent on 1st retry; surface on 2nd onward (most transient errors self-heal invisibly) |
| D2 | Class C toast | Surface only when back-off ≥ `failure.class_c_min_pause_seconds` (default 15s; sub-threshold pauses are dispatcher-internal noise) |
| D3 | Class E admin contact | `mailto:` for V1 with address in `failure.class_e_admin_contact` config key (default `support@stelavox.io`); in-app feedback form is V2 |
| D4 | Banner dismiss persistence | localStorage `failure-banner-dismissed:<job_id>` per-job-id (same pattern as V1.x-D StoppedFollowOnBanner) |
| D5 | CapabilityLimitCard re-trigger | Re-emit on every over-capability request (conversation rolling window may have dropped the prior artefact; re-emission is cheap and deterministic) |

The wireframe-first discipline locked at V1.x-D is now firmly established as a working principle (`feedback_wireframe_first_for_ui.md`).

---

## §2 — Acceptance criteria roll-up

| CK | What it proves | Sub-phase | Result |
|---|---|---|---|
| **CK-F1** | M-146 Director config v1.10 production with 19 tools (= v1.9's 18 + `report_capability_limit`); single-production-version invariant holds (v1.9 deprecated) | F.1 | **PASS** (4 Playwright + 12 unit cases) |
| **CK-F1** | `execReportCapabilityLimit` propose-only per H-08; rejects invalid `detected_limit` enum + empty `suggested_alternative` + empty `reason`; returns `capability_limit_proposal` artefact on valid input | F.1 | **PASS** (5/5 happy-path + 3 error-path unit cases) |
| **CK-F1** | iteration-runner + parse-message-proposals extended for the new artefact; SSE skip-list updated; v1.10 system prompt teaches self-rejection before partial execution | F.1 | **PASS** (substrate + system-prompt assertion) |
| **CK-F1** | `CapabilityLimitCard` mounts in DirectorPanel conversation thread; `--color-info` border (NOT verdigris); "Adjust request" text-link (no fill / no background) | F.1 | **PASS** (component code review; Inviolable audit clean) |
| **CK-F2** | M-147 six `failure.*` `platform_config` keys present with correct value_types | F.2 | **PASS** (5 Playwright cases) |
| **CK-F2** | `failure.class_c_min_pause_seconds=15` (D2) + `failure.class_e_admin_contact` contains `support@stelavox.io` (D3) | F.2 | **PASS** |
| **CK-F2** | `interpolateFailureMessage` substitutes `{token}` literally; missing tokens pass through; numeric coercion; matches M-147 template shapes for Classes A / D / E | F.2 | **PASS** (9/9 unit cases) |
| **CK-F2** | `FailureToast` Class A (`--color-info`) + Class C (`--color-status-review`) + `FailureBanner` Class D (3px error border) + Class E (full border + gradient + mailto: CTA) render shapes match wireframe | F.2 | **PASS** (component code review) |
| **CK-F3** | `scripts/seed-probe-fixtures.ts` idempotent; creates probe org + project + document + expand target + refine target; writes 4 deterministic IDs into `platform_config` | F.3 | **PASS** (script run twice — first creates, second reuses with `--reset` to recreate) |
| **CK-F3** | `runWorkflowExpandProbe` + `runRefineAcceptProbe` gracefully return `probe_fixtures_not_seeded` with remediation hint when fixture pointers absent; never throw | F.3 | **PASS** (5/5 unit cases on vi.mock-isolated path) |
| **CK-F3** | M-148 pg_cron schedule registers 3 staggered daily jobs; `request_synthetic_probe()` RPC validates `probe_id` against the M-144 CHECK enum + emits pg_notify on `synthetic_probe_request` channel | F.3 | **PASS** (RPC accept-valid + reject-invalid Playwright + docker exec direct cron.job verification) |
| **CK-F3** | `POST /api/cron/run-probes` Bearer CRON_SECRET auth gate; auth runs before probe_id validation; 200 with probe outcomes regardless of pass/fail | F.3 | **PASS** (3 Playwright auth-gate cases) |
| **CK-Inviol** | Verdigris-use count remains 9 across V1.x-F surfaces — zero new uses (CapabilityLimit "Adjust request" is text-link; FailureToast uses `--color-info` / `--color-status-review`; FailureBanner uses `--color-error`) | F.1–F.3 | **PASS** (grep audit clean; wireframe audit table) |

---

## §3 — What shipped

### Migrations (3 — M-146 / M-147 / M-148; count moves 145 → 148)

- **M-146** `director_v1_10_report_capability_limit.sql` — deprecates v1.9; v1.10 production with 19 tools; system prompt appended with self-rejection paragraph.
- **M-147** `failure_user_messages_config.sql` — 6 `failure.*` platform_config keys (5 string templates + 1 integer threshold).
- **M-148** `pg_cron_synthetic_probes.sql` — `request_synthetic_probe(probe_id)` SECURITY DEFINER + 3 staggered pg_cron jobs.

### Director tool registry V1.10 (19 tools)

V1.9's 18 + `report_capability_limit` synthetic write-tool (propose-only per H-08; returns `capability_limit_proposal` artefact; user "approves" by reformulating their request manually — no DB write).

### Library (NEW)

- [lib/director/tools/write.ts](../lib/director/tools/write.ts) — `execReportCapabilityLimit` executor appended.
- [lib/director/types.ts](../lib/director/types.ts) — `CapabilityLimitArtefact` type + `capability_limit_proposal?` field on `WriteToolResult`.
- [lib/director/schemas.ts](../lib/director/schemas.ts) — `report_capability_limit` zod schema (strict; 3 fields); added to `WRITE_TOOL_NAMES` (now 11).
- [lib/director/parse-message-proposals.ts](../lib/director/parse-message-proposals.ts) — `ToolCallProposals.capabilityLimitProposal` field added.
- [lib/ui/failureMessages.ts](../lib/ui/failureMessages.ts) (server-only) — `getClass{A,C,D,E}Message` + `getClassCMinPauseSeconds` + `getClassEAdminContact` + `getFailureMessageBundle`.
- [lib/ui/failureMessageInterpolate.ts](../lib/ui/failureMessageInterpolate.ts) (client-safe) — `interpolateFailureMessage()` for `{token}` substitution.
- [lib/admin/probes/workflow-expand.ts](../lib/admin/probes/workflow-expand.ts) — real `workflow_expand` probe implementation.
- [lib/admin/probes/refine-accept.ts](../lib/admin/probes/refine-accept.ts) — real `refine_accept` probe implementation.
- [lib/admin/probes/runner.ts](../lib/admin/probes/runner.ts) — dispatch updated to load real implementations; `pendingImplementation` removed.

### Library (modified)

- [lib/director/iteration-runner.ts](../lib/director/iteration-runner.ts) — IterationEvent union extended with `capability_limit_proposal`; H-08 guard + artefact extraction + summariser + atom-size serialiser fallback + end-of-turn proposal-yielding chain all extended.
- [lib/director/sse.ts](../lib/director/sse.ts) — `'capability_limit_proposal'` added to skip-list.
- [lib/director/tools/index.ts](../lib/director/tools/index.ts) — `report_capability_limit` registered in `writeTools` array + `TOOL_EXECUTORS` map (with model-facing description).

### UI (NEW)

- [components/director/CapabilityLimitCard.tsx](../components/director/CapabilityLimitCard.tsx) — Director self-rejection card.
- [components/feedback/FailureToast.tsx](../components/feedback/FailureToast.tsx) — Class A/C toast.
- [components/feedback/FailureBanner.tsx](../components/feedback/FailureBanner.tsx) — Class D/E banner.

### UI (modified)

- [components/director/DirectorPanel.tsx](../components/director/DirectorPanel.tsx) — mounts CapabilityLimitCard in `renderBriefSlot` when iteration emits the artefact.

### Wiring deliberately deferred

FailureToast + FailureBanner ship as pure-render components without an automatic wiring path into per-failure-class Realtime subscription. Per-surface adoption (AgentTab, SchedulerPanel, AppShell global notifier) happens incrementally rather than as a blanket F.2 rewrite of existing working error paths. Reduces F.2 blast radius to component substrate only.

### API routes (NEW)

- [app/api/cron/run-probes/route.ts](../app/api/cron/run-probes/route.ts) — Vercel-Cron fallback to the pg_cron schedule; Bearer CRON_SECRET auth.

### Probe fixtures

- [scripts/seed-probe-fixtures.ts](../scripts/seed-probe-fixtures.ts) — idempotent seeder; `--reset` for clean re-seed. Creates `_stelavox_probes` org/project/document; populates 4 `probe.fixture.*` config keys.

---

## §4 — Tests

### Unit — 26 NEW V1.x-F Vitest cases

- `tests/unit/v1x-f1-report-capability-limit.test.ts` — 12 cases (executor happy/error paths + registry wiring + zod schema strict + parse-message-proposals extraction).
- `tests/unit/v1x-f2-failure-messages.test.ts` — 9 cases (interpolation correctness against all 3 real M-147 template shapes + edge cases).
- `tests/unit/v1x-f3-probe-fixtures-gating.test.ts` — 5 cases (fixture-absence graceful failure shape + never-throws + isValidProbeId regression).

### Playwright — 14 NEW V1.x-F integration cases

- `tests/v1x-f/f1-capability-limit-substrate.spec.ts` — 4 cases (M-146 substrate; v1.10 sole production; 19 tools; prompt teaches self-rejection; v1.9 deprecated).
- `tests/v1x-f/f2-substrate.spec.ts` — 5 cases (M-147 keys present + correct types + D2/D3 defaults + Class D/E template tokens).
- `tests/v1x-f/f3-substrate.spec.ts` — 5 cases (M-148 RPC validation + cron route auth gate + fixture-pointer presence-or-absence).

### Test drift (necessary updates)

- `tests/v1x-a1/profile-and-brief-substrate.spec.ts` — Director config v1.9/18 → v1.10/19 + report_capability_limit (same supersession pattern V1.x-F.1 applied to the b1 stage-trigger test).
- `tests/v1x-b1/stage-trigger-and-runtime.spec.ts` — v1.9/18 → v1.10/19 + report_capability_limit.
- `tests/unit/v1x-b1-cancel-brief-schema.test.ts` — WRITE_TOOL_NAMES length 10 → 11.
- `tests/unit/v1x-a1-parse-message-proposals.test.ts` — empty return shape gains `capabilityLimitProposal: null` (5th field).
- `tests/unit/v1x-e-probe-runner.test.ts` — removed two cases that asserted the V1.x-E.2 `pendingImplementation` stub behaviour (probes now create their own service-role clients so fakeSvc doesn't intercept; fixture-gating coverage moved to dedicated F.3 unit test using `vi.mock`).

### Final regression

- **type-check**: 0 errors.
- **Vitest**: **434/438 PASS** (4 baseline skipped); 0 failures.
- **Playwright V1.x-F**: **14/14 PASS**.
- **Playwright V1.x full regression** (a1 + b1 + b1-2 + b2 + b3 + c + d + e + f): **103/109 PASS** (5 baseline skipped + 1 pre-existing flake in `tests/v1x-b2/integration.spec.ts` `metrics_minute_rollup` — local DB accumulated 19 dispatcher_tick_samples in the test's minute bucket vs the 3 it inserts; test-isolation bug pre-dating F.3, not regression).

---

## §5 — Tier-A bumps in lockstep

- **TA v2.8 → v2.9** — §3.5 migration count 145 → 148; §3.6 schema additions (M-148 cron function); §3.7.4 7 new platform_config keys (6 from M-147 + 4 `probe.fixture.*` from seed script); §5 — no new hazards; §11 V1.x-F row checkpoint MET.
- **Director Architecture v2.5 → v2.6** — §4 tool registry V1.10 (19 tools); §10 failure-class UX implementation-complete at substrate level; §17 admin dashboard probes section updated.
- **Component Spec v2.14 → v2.15** — NEW §17.12 CapabilityLimitCard + NEW §17.13 FailureToast + FailureBanner.
- **Product Spec v1.13 → v1.14** — §11 V1.x-F user-visible capability list.
- **CLAUDE.md v1.33 → v1.34** — V1.x-F SHIPPED row.

---

## §6 — Hazards + Inviolables

**No new hazards.** Probe runner safely captures all dispatch failures into the synthetic_probe_runs row (failure_class='E', error_message captures the throw); `report_capability_limit` is propose-only per H-08 (verified by iteration-runner's H-08 invariant guard extended to recognise the new artefact); `getClassEAdminContact` reads from platform_config (H-12 preserved); pg_cron `request_synthetic_probe` validates `probe_id` against the M-144 CHECK enum (matches synthetic_probe_runs.probe_id invariant).

**No Inviolables changed.** Verdigris-use count remains nine. V1.x-F adds **zero** new verdigris uses:
- CapabilityLimitCard: `--color-info` border + text-link affordance (no fill / no background)
- FailureToast: `--color-info` (Class A) / `--color-status-review` (Class C)
- FailureBanner: `--color-error` (Class D + Class E)

Inviolable audit table in the wireframe (5/5 PASS).

---

## §7 — Reassigned / deferred to V1.x post-launch polish or V2

- **`refine_accept` accept-path exercise** — V1.x-F.3 probe exercises the refine half (LLM call + parse + result persistence via runAgentJob) but does NOT call `accept_agent_job` (cleanup would need to roll back the version-bump + node_versions row insert). Accept-path exercise is V2 polish.
- **Push-model failure notifications** — V1.x-F evaluates failures pull-style at /admin page-load (V1.x-E); push-to-email or Slack is V2 candidate per Director Arch v2.6 §16.3.
- **30-day rate-limit history retention bump** — D-F3-1 decision locked at F.3 implementation: keep 7-day default from M-145; revisit post-launch if dashboard signal warrants.
- **FailureToast + FailureBanner per-surface adoption** — components ship as pure-render substrate; AgentTab / SchedulerPanel / AppShell global notifier integration happens incrementally.
- **Admin user-base migration to `users.is_platform_admin` column** — V1.x-E V2 carry-over; PLATFORM_ADMIN_EMAILS env-var allowlist remains the V1 path.
- **Reflective Director completion acknowledgement** — V2 per Director Arch v2.6 §16.3 (mechanical completion ships in V1.x-D).
- **Pre-existing `tests/v1x-b2/integration.spec.ts` `metrics_minute_rollup` flake** — test-isolation bug (local DB accumulated dispatcher_tick_samples in target bucket); not F.3-caused; queue separately.

---

## §8 — Verdict

**PASS** — all 13 acceptance criteria green at substrate + UI + auth-gate level. 26 unit + 14 Playwright cases authored; 434/438 Vitest + 103/109 V1.x Playwright at close-out. No new hazards; no Inviolable changes; no spec conflicts. V1.x-F closes the failure-mode UX loop AND completes the V1.x-E probe substrate. V1 launch standard (user-driven full novel test per `project_launch_standard.md`) remains the resumption gate — V1.x-F shipping does NOT auto-imply V1 launch readiness; the user drives the launch-readiness test personally.
