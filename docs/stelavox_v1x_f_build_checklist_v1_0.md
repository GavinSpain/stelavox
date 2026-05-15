# Stelavox V1.x-F — Tier-B Build Checklist
## Failure-mode UX
## Version 1.0

> **Status: DRAFT.** Authored 2026-05-16 alongside B.3/C/D/E. The smallest of the 5 remaining phases. Locks the Director-knows-its-limits operating philosophy from V1.x-LB session memory.

---

## §1 — Scope and goals

V1.x-F closes the failure-mode UX loop. Three concerns:

1. **`report_capability_limit` synthetic Director tool** — a write-tool the Director can invoke when it detects the user's request exceeds its capability boundaries (e.g. "create scenes for chapters 1-50" when the per-iteration cap is 30). Returns a structured "I cannot do this in one go because X; here's the closest thing I can do" message that the user surfaces in conversation.
2. **Class-C self-rejection prompt content** — Director system prompt amendments so the model recognises capacity-limited situations + chooses `report_capability_limit` proactively rather than failing silently.
3. **Failure-state UI surfaces** — per-failure-class user-facing messages + recovery affordances. Class A retries (silent → progress dot during retry); Class B interrupted (Resume button — landed in V1.x-D); Class C capacity (informational toast); Class D validation (error banner with remediation guidance); Class E hard system (escalation prompt + admin-contact CTA).

### Sequencing

V1.x-F is **two sub-phases**:
- **F.1** — `report_capability_limit` tool + Director prompt amendment + tests (1 session)
- **F.2** — Failure-state UI surfaces + Tier-A consolidation + merge (1-2 sessions)

Estimated 2-3 sessions total — the smallest of the remaining phases.

---

## §2 — Migrations (~2, 147-148)

- **M-147 — `director_config_v1_9`** — Director system prompt v1.9 adds `report_capability_limit` tool to the registry (V1.10 — 19 tools = V1.9's 18 from B.3 + report_capability_limit) AND the prompt amendment teaching the model when to invoke it.
- **M-148 — `failure_taxonomy_user_messages`** table OR platform_config keys — per-failure-class default user-facing message templates (extracted to data so they can be tuned without redeploys).

---

## §3 — Library

- **NEW `lib/director/tools/reportCapabilityLimit.ts`** — write-tool implementation. Returns a `WriteToolResult` with `capability_limit_artefact: { detected_limit: 'per_iteration_cap'|'token_budget'|'tool_count', suggested_alternative: string, reason: string }`. Propose-only per H-08; the user "approves" by reading + reformulating.
- **NEW `lib/director/parse-message-proposals.ts` extension** — recognise `<capability_limit_proposal>` in iteration-runner end-of-turn parsing.
- **NEW `lib/ui/failure-messages.ts`** — typed lookup for per-class user message + remediation guidance.

---

## §4 — UI

- **NEW `components/director/CapabilityLimitCard.tsx`** — renders in conversation thread when iteration emits `capability_limit_artefact`. Shows the limit + suggested alternative; single "Adjust request" button (text-only, not verdigris — this is informational not an action).
- **NEW `components/feedback/FailureToast.tsx`** — surfaces Class A retries + Class C capacity messages as toasts (existing `lib/feedback/Toast` pattern).
- **NEW `components/feedback/FailureBanner.tsx`** — for Class D + Class E surfaces (in-page banner).

---

## §5 — Tests

- 6 unit tests on the report_capability_limit tool definition + executor
- 4 Playwright integration on each failure-class UI surface

---

## §6 — Acceptance + Sign-off

CK-1..CK-6 covering each tool/UI surface. Test Report PASS; Tier-A bumps (TA v2.8 → v2.9; Director Architecture v2.4 → v2.5; Component Spec v2.15 → v2.16; CLAUDE.md → v1.34); merge with `--no-ff` + tag `v1.x-f`.

---

## Changelog

**v1.0 — 2026-05-16** Initial draft authored alongside B.3/C/D/E.
