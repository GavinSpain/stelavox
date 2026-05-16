# Stelavox V1.x-F — Tier-B Build Checklist
## Failure-mode UX + probe completion
## Version 1.1

> **Status: APPROVED for build, 2026-05-19** (refreshed from v1.0 2026-05-16 draft at V1.x-F kickoff after V1.x-E shipped). Scope refresh: (a) absorbs V1.x-E probe-completion carry-overs as F.3 (real `workflow_expand` + `refine_accept` implementations + pg_cron auto-run + 30-day retention if needed); (b) drops M-148 `failure_taxonomy_user_messages` table in favour of `platform_config` keys (5 string templates don't justify a table); (c) inserts wireframe step at the top per wireframe-first discipline locked at V1.x-D (memory `feedback_wireframe_first_for_ui.md`); (d) version-number alignment: target Tier-A bumps are now TA v2.8 → v2.9, Director Arch v2.5 → v2.6, Component Spec v2.14 → v2.15, Product Spec v1.13 → v1.14, CLAUDE.md v1.33 → v1.34. Locks the Director-knows-its-limits operating philosophy from V1.x-LB session memory.

---

## §1 — Scope and goals

V1.x-F closes the failure-mode UX loop AND completes the V1.x-E probe substrate. Four concerns:

1. **`report_capability_limit` synthetic Director tool** — a write-tool the Director can invoke when it detects the user's request exceeds its capability boundaries (e.g. "create scenes for chapters 1-50" when the per-iteration cap is 30). Returns a structured "I cannot do this in one go because X; here's the closest thing I can do" artefact that the user surfaces in conversation.
2. **Class-C self-rejection prompt content** — Director system prompt amendments so the model recognises capacity-limited situations + chooses `report_capability_limit` proactively rather than failing silently.
3. **Failure-state UI surfaces** — per-failure-class user-facing messages + recovery affordances. Class A retries (silent → progress dot during retry); Class B interrupted (Resume button — landed in V1.x-D, regression-checked only here); Class C capacity (informational toast); Class D validation (error banner with remediation guidance); Class E hard system (escalation prompt + admin-contact CTA).
4. **V1.x-E probe completion** (carry-over from V1.x-E SHIPPED memo) — real `workflow_expand` + `refine_accept` probe implementations against probe-fixture data; pg_cron auto-run for probes; 30-day rate-limit retention (only if regression-spotting needs it — defer if not).

### Sequencing

V1.x-F is **three sub-phases**:
- **F.1** — Wireframe + `report_capability_limit` tool + Director prompt v1.10 amendment + tests (~1 session — wireframe step inline)
- **F.2** — Failure-state UI surfaces (Class A/C/D/E — B already shipped) + tests (~1 session)
- **F.3** — V1.x-E probe completion + pg_cron auto-run + Tier-A consolidation + merge (~1-2 sessions)

Estimated 3-4 sessions total.

### Wireframe

Per discipline locked at V1.x-D: one comprehensive `docs/wireframes/wireframe_failure_mode_ux_v1.html` authored at F.1 kickoff covering all failure-state surfaces (CapabilityLimitCard inline + FailureToast for Class A/C + FailureBanner for Class D/E) + per-class colour-token assignments + open decisions locked in-session before component code.

---

## §2 — Migrations (3, M-146..M-148)

- **M-146** — `director_config_v1_10` — Director system prompt v1.10 adds `report_capability_limit` tool to the registry (**19 tools** = V1.9's 18 from B.3 + `report_capability_limit`). The prompt body amendment teaches the model when to invoke it (per-iteration cap detection / token-budget-headroom check / multi-batch protocol fallback).
- **M-147** — `failure_user_message_config_keys` — 5 platform_config string keys: `failure.class_a_message`, `failure.class_c_message`, `failure.class_d_message_template`, `failure.class_e_message`, `failure.class_e_admin_contact`. Templates support `{job_id}` + `{failure_class}` + `{reason}` interpolation (simple `replaceAll` — no full templating engine). `value_type='string'`.
- **M-148** — `synthetic_probe_cron_schedule` — pg_cron schedule for daily auto-run of all 3 probes at staggered times (director_small 04:15, workflow_expand 04:30, refine_accept 04:45 UTC); probe-runner library + endpoint already in place from V1.x-E.2. Also extends `purge_raw_metric_samples` retention for `anthropic_rate_limit_samples` from 7d → 30d IF the V1.x-E rollout shows trend value beyond 7d (decision deferred to F.3 with default keep-7d if signal unclear).

All include `SET search_path = public` per H-13.

---

## §3 — Library

- **NEW `lib/director/tools/reportCapabilityLimit.ts`** — write-tool implementation per H-08 (propose-only). Returns a `WriteToolResult` with `capability_limit_artefact: { detected_limit: 'per_iteration_cap'|'token_budget'|'tool_count'|'other', suggested_alternative: string, reason: string }`. The user "approves" by reading + reformulating their request — no DB write.
- **EXTEND `lib/director/parse-message-proposals.ts`** — recognise `<capability_limit_proposal>` in iteration-runner end-of-turn parsing. Adds `capabilityLimitProposal` field to `findProposalInToolCalls` return shape (mirror the V1.x-D.4 `briefProposalConcurrentEdit` extension pattern).
- **NEW `lib/ui/failureMessages.ts`** — typed lookup `getFailureMessage(class: 'A'|'C'|'D'|'E', ctx: { jobId?: string; reason?: string }): Promise<string>`. Reads platform_config templates + interpolates. Server-only.
- **NEW `lib/admin/probes/workflow-expand.ts`** + `lib/admin/probes/refine-accept.ts` — real probe implementations replacing the V1.x-E `pendingImplementation` stubs in [lib/admin/probes/runner.ts](lib/admin/probes/runner.ts). Each invokes the actual agent pipeline against a designated probe org's fixture document tree.
- **NEW `scripts/seed-probe-fixtures.ts`** — idempotent seed for the probe-only organisation + document + canonical fixture nodes (Project Profile, Brief, single book/act/chapter for workflow_expand target; single leaf scene with prose for refine_accept target). Run once per environment.

---

## §4 — UI

- **NEW `components/director/CapabilityLimitCard.tsx`** — renders in conversation thread when iteration emits `capability_limit_artefact`. Shows the detected limit + suggested alternative + reason; single "Adjust request" button (text-only with `--color-text-primary` underline — informational, NOT verdigris because there's nothing to approve).
- **NEW `components/feedback/FailureToast.tsx`** — surfaces Class A retries + Class C capacity messages as transient toasts (extend existing `components/feedback/Toast` + `ToastManager` patterns). Auto-dismisses; uses `--color-info` for Class A (retry-in-progress informational) + `--color-status-review` for Class C (capacity attention).
- **NEW `components/feedback/FailureBanner.tsx`** — in-page banner for Class D (validation) + Class E (hard system). Class D uses `--color-error` left border + remediation guidance; Class E uses `--color-error` filled + admin-contact CTA. Manual dismiss.
- **AdminDashboard probe row extension** — F.3 adds a "Last cron-run" column showing the most-recent `triggered_by='cron'` outcome alongside the manual-trigger row (existing wireframe already accommodates).

---

## §5 — Tests

- **F.1** — 6 unit tests on `reportCapabilityLimit` tool definition + executor (H-08 propose-only invariant; artefact shape; parse-message-proposals integration); 2 Playwright on CapabilityLimitCard render.
- **F.2** — 4 unit tests on `failureMessages.ts` (each class + interpolation); 4 Playwright on FailureToast + FailureBanner per-class render + dismiss behaviour.
- **F.3** — 4 unit tests on probe runner (workflow_expand + refine_accept happy + failure paths); 2 Playwright on probe trigger + admin dashboard probe-row updates; pg_cron schedule presence check.

Final V1.x regression: 410+16 = ~426 Vitest cases; 90+12 = ~102 Playwright cases.

---

## §6 — Acceptance + Sign-off

| CK | What it proves | Sub-phase |
|---|---|---|
| **CK-F1** | `report_capability_limit` tool live in Director registry V1.10 (19 tools); prompt teaches self-rejection on per-iteration-cap detection | F.1 |
| **CK-F1** | CapabilityLimitCard renders artefact in conversation thread; no verdigris (informational) | F.1 |
| **CK-F2** | 5 platform_config keys land + `getFailureMessage()` interpolates correctly | F.2 |
| **CK-F2** | FailureToast surfaces Class A (retry) + Class C (capacity) with correct tones | F.2 |
| **CK-F2** | FailureBanner surfaces Class D (validation) + Class E (hard system) with correct tones + remediation | F.2 |
| **CK-F2** | Class B already shipped (V1.x-D Resume); regression checked only — no new code | F.2 |
| **CK-F3** | `workflow_expand` probe runs against fixture and records pass (or graceful skip when fixtures absent) | F.3 |
| **CK-F3** | `refine_accept` probe runs against fixture and records pass | F.3 |
| **CK-F3** | pg_cron schedule M-148 fires all 3 probes daily | F.3 |
| **CK-Inviol** | Verdigris-use count remains nine; CapabilityLimitCard + FailureToast + FailureBanner add zero verdigris uses | F.1–F.3 |

Test Report `stelavox_v1x_f_test_report_v1_0.md` PASS; **Tier-A bumps**: TA v2.8 → **v2.9**; Director Architecture v2.5 → **v2.6**; Component Spec v2.14 → **v2.15**; Product Spec v1.13 → **v1.14**; CLAUDE.md v1.33 → **v1.34**. Merge with `--no-ff`; tag `v1.x-f`.

---

## §7 — Sequencing rationale + deferrals

**Why F.3 is here, not deferred:** the V1.x-E plumbing is fresh in context (probe runner just shipped); the deferred-to-V1.x-F label is already attached to the stub probes; bundling avoids a separate polish-only session. Decision locked with user 2026-05-19 at V1.x-F kickoff.

**Why platform_config keys for failure messages, not a new table:** 5 string templates with simple `{var}` interpolation don't justify a new table + RLS + migration. Decision locked with user 2026-05-19.

**Deferred to V1.x post-launch polish or V2:**
- Push-model alert notifications (still V2 per Director Arch v2.5 §16.3)
- Admin user-base migration to `users.is_platform_admin` column (V2 once admin user base exists)
- Reflective Director completion acknowledgement (V2 per Director Arch v2.5 §16.3)
- 30-day rate-limit retention if signal doesn't justify (F.3 starts with default 7d; bumps only if V1.x-E data shows value)

**V1 launch gate:** V1 launch standard (user-driven full novel test) per `project_launch_standard.md` remains the resumption gate. V1.x-F shipping does NOT auto-imply V1 launch readiness — the user drives the launch-readiness test personally.

---

## Changelog

**v1.1 — 2026-05-19** Scope refresh at V1.x-F kickoff. Folded V1.x-E probe-completion carry-overs in as F.3; dropped M-148 failure messages table in favour of platform_config keys; inserted wireframe-first step at top per V1.x-D-locked discipline; refreshed target Tier-A version numbers against actual current state (TA v2.8 / Director Arch v2.5 / Component Spec v2.14 / Product Spec v1.13 / CLAUDE.md v1.33 post-V1.x-E).

**v1.0 — 2026-05-16** Initial draft authored alongside B.3/C/D/E.
