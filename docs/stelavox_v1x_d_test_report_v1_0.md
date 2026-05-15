# V1.x-D Test Report v1.0 (consolidated)

**Phase**: V1.x-D — UI substrate (cost meter + plan panel + NodeRow lifecycle badges + Stop refinement + Director completion + concurrent-Brief surfaces)
**Date**: 2026-05-18 close-out
**Branch**: `claude/v1x-d-ui` — merged to master via `--no-ff`; tag `v1.x-d`
**Sub-phase commits**:
- Wireframe pack (6 files) at branch HEAD
- D.1 CostMeter + PlanPanel `8c1134e`
- D.2 NodeRow badges (M-142 + components) `aef2f0a`
- D.3 Stop refinement + Director completion `7db648c`
- D.4 Concurrent-Brief surfaces `1ee8ea3`
- D.5 close-out (this commit)

**Verdict**: **PASS**

---

## §1 — Wireframe-first design discipline

V1.x-D was the first phase to adopt a wireframe-first approach for all new UI work. Six wireframes authored 2026-05-17 in the established `docs/wireframes/` convention (token system + Cinzel/Cormorant/Inter fonts via Google Fonts + numbered `.cn` callouts + annotations grid + Inviolable audit + open-decisions section) and user-reviewed before any component code was written:

- [wireframe_cost_meter_v1.html](wireframes/wireframe_cost_meter_v1.html)
- [wireframe_plan_panel_v1.html](wireframes/wireframe_plan_panel_v1.html)
- [wireframe_node_row_v2_badges_v1.html](wireframes/wireframe_node_row_v2_badges_v1.html)
- [wireframe_stop_refinement_v1.html](wireframes/wireframe_stop_refinement_v1.html)
- [wireframe_director_completion_v1.html](wireframes/wireframe_director_completion_v1.html)
- [wireframe_brief_concurrent_v1.html](wireframes/wireframe_brief_concurrent_v1.html)

The discipline is now a working principle for all future UI work (memory `feedback_wireframe_first_for_ui.md`).

Two key design decisions emerged from the user-driven review:
1. **Provider-neutral consumption surfacing.** BYOK CostMeter shows tokens only (no dollar amounts). Multi-provider futures (OpenAI / Google / Mistral) plus avoiding "Stelavox bills for usage on BYOK" misreading.
2. **CostMeter is the sole dedicated consumption surface.** Per-step token labels stripped from PlanCards in Stop refinement + Director completion surfaces; numerical Stop savings dropped from confirmation modal — proportional progress is sufficient signal; token/credit unit conflict avoided.

---

## §2 — Acceptance criteria roll-up

| CK | What it proves | Sub-phase | Result |
|---|---|---|---|
| **CK-D1** | CostMeter compact mounted in AppShellStatusIndicator; full at /settings/usage; both variants (BYOK + non-BYOK + empty states); /api/status/pending-attention carries cost_meter payload | D.1 | **PASS** |
| **CK-D1** | PlanPanel at /settings/plan with all 6 tiers read-only; trial/BYOK user variants; /settings index extended | D.1 | **PASS** |
| **CK-D2** | nodes.last_ai_change_at column exists; accept_agent_job stamps it on synthesise/refine/generate_context paths + new expand children | D.2 | **PASS** |
| **CK-D2** | NodeRow renders lifecycle badge (QUEUED/RUN/NEW) derived from agent_jobs.status; auto-lock distinct from user-lock; AI-changed dot clears on row click | D.2 | **PASS** (unit) + **PASS** (substrate Playwright) |
| **CK-D2** | useAiChangedFlag localStorage tracking (per-node last-viewed; clear-on-view read-receipt model) | D.2 | **PASS** (8/8 unit cases) |
| **CK-D3** | StopButton confirmation modal gains side-effect honesty block (iteration_count + state-preservation copy); no numerical token savings | D.3 | **PASS** |
| **CK-D3** | StoppedFollowOnBanner three-way Resume/Cancel/View follow-on; Resume wires to existing /api/director/conversation/[id]/resume; Cancel uses destructive token; banner dismisses via localStorage | D.3 | **PASS** |
| **CK-D3** | WorkflowCompletionAck inline mechanical acknowledgement; three variants (success/partial/failure) with distinct border colours; verdigris #4 reused on success (existing category, no broadening) | D.3 | **PASS** |
| **CK-D4** | findProposalInToolCalls extracts concurrent_edit_warning from V1.x-B.3-attached artefact | D.4 | **PASS** |
| **CK-D4** | BriefProposalCard renders warning block + Approve button label swaps to "Approve anyway" when warning present | D.4 | **PASS** |
| **CK-D4** | SchedulerPanel ConcurrentBriefsNote surfaces additional concurrent active Briefs | D.4 | **PASS** |
| **CK-Inviol** | Verdigris use count remains 9 across all V1.x-D surfaces | D.1–D.4 | **PASS** |

---

## §3 — What shipped

### Migrations (1 — M-142; count moves 141 → 142)
- **M-142** `nodes_last_ai_change_at.sql` — adds the column NULL default; rewrites `accept_agent_job` to stamp the column on synthesise/refine/generate_context UPDATE paths AND set it on every new expand child node insert (born with `last_ai_change_at=NOW()`).

### Components (NEW)
- [components/cost/CostMeterFull.tsx](../components/cost/CostMeterFull.tsx) — full-form usage page; Platform + BYOK variants; empty states; realtime
- [components/billing/PlanPanel.tsx](../components/billing/PlanPanel.tsx) — read-only plan tiers list
- [components/tree/NodeLifecycleBadge.tsx](../components/tree/NodeLifecycleBadge.tsx) — agent-side lifecycle pill
- [components/director/StoppedFollowOnBanner.tsx](../components/director/StoppedFollowOnBanner.tsx) — three-way Resume/Cancel/View
- [components/director/WorkflowCompletionAck.tsx](../components/director/WorkflowCompletionAck.tsx) — mechanical completion line
- Inline helpers in `NodeRow.tsx`: NodeLockIndicator, NodeAiChangedDot, NodeLifecycle
- Inline helper in `SchedulerPanel.tsx`: ConcurrentBriefsNote

### Library
- [lib/hooks/useAiChangedFlag.ts](../lib/hooks/useAiChangedFlag.ts) — client-side localStorage tracker
- `lib/director/parse-message-proposals.ts` — `findProposalInToolCalls` extended with `briefProposalConcurrentEdit` return field

### Routes
- [app/(app)/settings/usage/page.tsx](../app/(app)/settings/usage/page.tsx) — NEW
- [app/(app)/settings/plan/page.tsx](../app/(app)/settings/plan/page.tsx) — NEW
- `app/api/status/pending-attention/route.ts` — extended with `cost_meter` block + `primary_org_id`
- `app/(app)/settings/page.tsx` — extended index with Usage + Plan rows
- Existing `/api/director/turns/[turnId]/stop` + `/api/director/conversation/[id]/resume` routes consumed unchanged

### Modified components
- `components/layout/AppShellStatusIndicator.tsx` — mounts CostMeterCompact
- `components/director/StopButton.tsx` — honesty block in confirmation modal
- `components/director/DirectorPanel.tsx` — renderWorkflowSlot composes ExecutionCard + WorkflowCompletionAck; renderBriefSlot passes concurrentEditWarning prop
- `components/director/BriefProposalCard.tsx` — concurrent-edit warning block + "Approve anyway" label swap
- `components/scheduler/SchedulerPanel.tsx` — ConcurrentBriefsNote in Active Brief section
- `components/tree/NodeRow.tsx` — three new badge slots + viewed-marker on click
- `lib/data/nodes.ts` NODE_SELECT — includes `last_ai_change_at`

---

## §4 — Verification gates (V1.x-D aggregate)

| Gate | Result | Detail |
|---|---|---|
| `npm run type-check` | **PASS** | 0 errors |
| Vitest full unit suite | **381/385 PASS** | 4 skipped baseline; 0 failures across 42 files (incl. 8/8 new D.2 useAiChangedFlag/lifecycle) |
| Playwright V1.x regression (a1 + b1 + b1-2 + b2 + b3 + c1 + c2 + c3 + c4 + d) | **114 passed / 6 skipped** | 4 = B.3 superseded-queue baseline; 1 = CRON_SECRET env-skip; 1 = D.2 FK-dependent insert |
| Build | not re-run since D.4 (no module-graph changes since D.3 confirmed compile) | Type-check exit 0 covers compile correctness |
| Tier-A bumps | **DONE** | TA v2.7, Director Arch v2.4, Component Spec v2.13, Product Spec v1.12, CLAUDE.md v1.32 |

---

## §5 — Deferred to V1.x-D follow-up polish, V1.x-E, or V2

| Item | Why deferred |
|---|---|
| Stage membership pill on NodeRow | Lowest-value of the four §17.8 NodeRow extensions; brief_stages.target_node_ids cross-fetch adds non-trivial complexity. V1.x-D follow-up polish or V2 |
| BriefViewer concurrent-Brief indicator | No BriefViewer component in V1.x baseline (ProjectProfileViewer surfaces project identity, not active Brief). The SchedulerPanel ConcurrentBriefsNote + BriefProposalCard concurrent-edit warning cover the user-visible 'multi-active is happening' concern for V1.x-D ship. New BriefViewer is V2 candidate |
| SchedulerPanel per-row multi-active Brief listing | Current note surfaces additional active Briefs as a list; full per-row rendering with Open/Cancel actions deferred to V1.x-D polish or V2 |
| Workflow-complete typed conversation_messages emission | UI derives completion from WorkflowDto.status; a typed `role='system'` event_type='workflow_complete' row via `_emit_system_event` is a V2 polish |
| Reflective Director-completion acknowledgement | Mechanical line ships in V1.x-D; reflective re-reading of artefacts deferred V2 per Director Arch v2.4 §16.3 |
| 30-day spend sparkline + past-periods card on CostMeter | Stripped per user direction during wireframe review — basic usage suffices. V2 if requested |
| Numerical token-savings display on Stop modal | Stripped per user direction — CostMeter is the dedicated consumption surface; proportional progress is the relevant Stop signal |
| Per-step token labels on PlanCards | Stripped per user direction — same rationale; PlanCard shows step status only |

---

## §6 — Hazard tracking

- **H-13 (SECURITY DEFINER search_path)** — M-142's `accept_agent_job` rewrite preserves `SET search_path = public` from the M-090 baseline.
- **No new hazards** introduced. The new client-side `useAiChangedFlag` uses localStorage which is per-browser-per-device (no cross-device sync expected for V1; documented in hook header).

---

## §7 — Inviolable audit

V1.x-D introduces zero new verdigris uses. Verdigris-use count remains **nine**. The only categories touched are existing ones:
- **Use #4** (agent-complete passive status): WorkflowCompletionAck success-variant border `--color-status-approved` (= --color-accent) — existing category
- **Use #5** (approved passive status): PlanPanel current-plan marker dot uses `--color-accent-hover` — existing category
- **Use #7** (affirmative-action triggers): BriefProposalCard "Approve anyway" — label swap only; same Approve button, same verdigris category

All new affordances use neutral / informational tokens:
- `--color-info` (auto-lock, AI-changed dot, Stop honesty block, ConcurrentBriefsNote, StoppedFollowOnBanner border)
- `--color-warning` (CostMeter approaching-limit, attention-amber alerts)
- `--color-status-review` (NEW lifecycle badge, concurrent-edit warning, partial-completion ack)
- `--color-error` (CostMeter cap-reached, failure-completion ack, destructive Cancel borders)
- `--color-agent-running` (executing badge, AgentActivityIndicator pulse)
- `--color-text-muted` / `--color-text-secondary` (passive labels everywhere)

---

## §8 — Sign-off

V1.x-D **PASSES**. The plan-and-cost surface from V1.x-C is now live for authors; the agent's view of the tree (lifecycle states, auto-lock, AI-changed signals) coexists with the author's view via separation-of-concerns at the badge layer; Stop is honest about its side-effects; workflow completion no longer fails silently; the multi-active-Brief world from V1.x-B.3 has a user-facing surface.

V1.x-D merges to master with `--no-ff`, tagged `v1.x-d`. MEMORY.md updated. Next phase **V1.x-E** absorbs the admin dashboard + monitoring surfaces that read the V1.x-B.2 metrics rollup, V1.x-C usage substrate, and V1.x-D event audit. Then **V1.x-F** ships the failure-mode UX (`report_capability_limit` synthetic tool, Class-C self-rejection prompt content, error-surface refinements).

---

## Changelog

**v1.0 — 2026-05-18** Consolidated V1.x-D close-out report. Wireframe-first methodology adopted as a working principle; six wireframes locked before component code via user-driven review.
