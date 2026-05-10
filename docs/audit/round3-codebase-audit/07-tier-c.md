# Tier C — `lib/hooks/`, `lib/context/`, `lib/utils.ts`

**Files in scope:** 9 (hooks×4, context×4, utils×1) — ~857 lines

**Note:** `lib/export/` was in the original Tier-C scope but the directory does not exist — export/render code hasn't shipped yet (V2 work per CLAUDE.md). Removed from scope.

**Spec lens applied:** TA v2.2 §10.3 (real-time tables), H-05 (real-time subscription cleanup), Phase 4/5/5b API contract real-time sections, Product Spec §4.7 (V1 context types), agent profile library §2.12–§2.17 (metadata field shapes).

---

## `lib/hooks/`

### F-201 — `useAgentJobsRealtime` has no error handler on the WebSocket subscription
**Severity:** **HIGH**   **Confidence:** likely   **Category:** silent-failure
**Location:** `lib/hooks/useAgentJobsRealtime.ts:112–126`
`.subscribe()` returns a channel without an error callback. If the WebSocket connection fails (network drop, Vercel WS limit), the subscription drops silently. UI shows no progress on jobs because no events arrive. **Same shape as F-92** — silent transport failures.
**Recommended fix shape:** wire the `subscribe((status, err) => {...})` callback; on `CHANNEL_ERROR` or `TIMED_OUT`, retry with backoff or surface a "live updates unavailable" banner.

### F-202 — initial-load `.limit(100)` over 24h drops older jobs silently
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/hooks/useAgentJobsRealtime.ts:99–108`
For a heavy-use org (>100 jobs/24h), the oldest are dropped from the initial load. UI then doesn't show them until a real-time event fires (which it won't for completed/dismissed older jobs). Workflow history surfaces stale-looking gaps.

### F-203 — `payload.new as AgentJob` unsafe cast hides migration drift
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/hooks/useAgentJobsRealtime.ts:122`
If migrations add/rename columns, `payload.new` shape changes; the cast hides the mismatch. Same shape as F-90/F-91 (manual row types in route-helpers).

### F-204 — `useDirectorConversation` fires two refetches per workflow event with no debounce
**Severity:** **HIGH**   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/hooks/useDirectorConversation.ts:190–238`
Two real-time subscriptions (`workflows` and `workflow_steps`) both call `refresh()` independently. A 30-step workflow firing 30 step transitions + 2 status updates → ~32 full GET round-trips to `/api/documents/[id]/conversation` (each one with `cache: 'no-store'`). Combined with the JS-side sort on listBackLinks (F-165) and similar patterns, the Director conversation surface is noisy on long workflows. No debounce.
**Recommended fix shape:** unify both subscriptions into one channel with a single 200ms debounced `refresh`. Same pattern as `useNodesRealtime`.

### F-205 — no real-time on `conversation_messages`; multi-tab user sees stale Director thread
**Severity:** MEDIUM   **Confidence:** certain   **Category:** wrong-semantics
**Location:** `lib/hooks/useDirectorConversation.ts:22–26`
Comment justifies: SSE is the source of truth for the active turn; optimistic local for the user's own messages. **But:** if Tab A writes a message via SSE, Tab B (same conversation, different tab) has no signal. Tab B's thread stays stale until manual refresh. Same multi-tab shape as the Step 2 hardening test surfaced for nodes — but here unaddressed. Mars-series user actually drives multi-tab so this is not theoretical.
**Recommended fix shape:** subscribe to conversation_messages real-time for cross-tab; dedupe against optimistic locals via message id.

### F-206 — `WorkflowDto.description: string` non-nullable in TS but DB column is nullable
**Severity:** LOW   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/hooks/useDirectorConversation.ts:83`
DB allows null per migrations; DTO says non-null. The route's response shape squashes null to `''` at runtime per `route-helpers.ts:formatWorkflowResponse`. Defensive — but the type is a lie. Same shape as F-90.

### F-207 — `_removed` lint warning still in source (pre-existing)
**Severity:** LOW   **Confidence:** certain   **Category:** dead-code
**Location:** `lib/hooks/useAgentJobsRealtime.ts:69`
Already flagged in round-3 lint; left as pre-existing per *"don't refactor adjacent code"*. Catalogued here for completeness.

### F-208 — `useNodeRealtime` and `useNodesRealtime` follow H-05 cleanly
**Confidence:** certain   **Category:** positive
Both hooks correctly tear down the channel on unmount; debounce sibling events into a single refetch. Auditing clean. Catalogued as a positive finding alongside F-P1.

---

## `lib/context/`

### F-209 — `metadata-schemas.ts` has no version stamp; will silently drift from agent_profile_library
**Severity:** MEDIUM   **Confidence:** certain   **Category:** silent-failure
**Location:** `lib/context/metadata-schemas.ts:42–187`
The schemas match agent profile library §2.12–§2.17. If the library is bumped (a field renamed, a new field added, an option added to a select), this file drifts silently. The form renders the old schema; agent-emitted metadata with new keys lands as un-rendered "free-form" entries. **Two sources of truth — agent profile library (the prompts) and this schema (the form).**
**Recommended fix shape:** generate this file from the agent profile library, OR add a runtime check that asserts emitted metadata keys match the schema (with a console.warn on drift).

### F-210 — `metadata-schemas.ts` field-key drift caught by the F-27 audit
**Severity:** see F-27
**Location:** cross-reference
**Cross-tier:** F-27 (`generate-context.ts` schema admits any object) compounds with F-209 — the emitted metadata can have any shape, and the form's view depends on this static schema staying in sync.

### F-211 — `CONTEXT_NODE_TYPES_V1` enum well-isolated; positive
**Confidence:** certain   **Category:** positive
**Location:** `lib/context/types.ts:17–24`
Single source of truth, exported as `as const`, type-narrowed via `typeof`. Used consistently across schemas (Director schemas, validation, this file). Catalogued as positive — the kind of pattern F-19/F-81/F-116 should follow.

### F-212 — `metadata-schemas.ts` cites stale spec versions
**Severity:** LOW   **Confidence:** certain   **Category:** spec-drift
**Location:** `lib/context/metadata-schemas.ts:3–8`

---

## `lib/utils.ts`

Trivial — `cn` className helper. No findings.

---

## Tier C summary

| Severity | Count |
|---|---|
| HIGH | **2** (F-201, F-204) |
| MEDIUM | 4 |
| LOW | 4 |
| **Total** | **10** |

Plus 2 positive findings (F-208 hooks H-05 compliance, F-211 single-source-of-truth context types).

### Themes that recur (laddering up to existing clusters)

1. **Silent transport-failure swallow on real-time WebSocket (F-201).** Same shape as F-92 (streamMessage), F-94 (tail buffer), F-139 (streamSynthesise), F-170 (autosave network). Now visible at the realtime-subscribe layer too.

2. **Multi-tab gap (F-205).** Same family as round-3's Step 2 (conflict UI) — but for Director conversation messages, the gap is unaddressed. The Step 2 test exists for nodes; Director is the next obvious surface to test multi-tab on.

3. **Two-source-of-truth (F-209).** agent_profile_library §2.12–§2.17 and lib/context/metadata-schemas.ts must stay in sync. Same shape as F-19, F-81, F-90, F-91, F-116, F-141 — now 7 instances across the codebase.

4. **Manual TS row types vs DB nullability (F-206).** Same shape as F-90.

### What the spec lens caught

- **F-204 (no debounce on workflow + workflow_steps refetch).** Spec doesn't mandate debouncing but TA §10.3 implies efficient real-time consumption ("subscribers receive change events"). 30+ refetches per workflow is an obvious anti-pattern when one debounced refetch would suffice.
- **F-209 (metadata schema drift).** Agent profile library §2.12–§2.17 IS the spec for emitted shapes; the form schema must match. Spec-divergence by build-time omission.

---

*Tier C audit complete. **Stopping here per checkpoint policy.** Continue to Tier D (`components/`) on your go. Components are UI; expected to surface fewer silent-failure findings (UI bugs are usually visible) but more spec-divergence on the Five Inviolables and Component Spec compliance.*
