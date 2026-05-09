# Phase 5d round 3 — Techno Thriller drive close-out report

**Date:** 2026-05-09
**Cloud:** stelavox.vercel.app · stelavox-dev (`zhcdbofshifzblkgqrsc`)
**Project:** Crash Out — `b147761e-0e9c-4054-bc29-e6ffae74b0cd`
**Series document:** `8d26b66b-a2fb-42e5-9f92-a8b29392c82a`
**Master HEAD at start:** `3ee0ce0`
**Master HEAD at close:** `b095d8b`

## Mission

User-stated requirements:

1. Address V1 SU-J11/J12/J13 family before drive (launch-blockers only).
2. Build a Techno Thriller series ("Crash Out", 3 books) — author the creative content myself, full discretion.
3. Build comprehensive context library (multiple per category).
4. Emulate human flow: mix order, link context, move/rename/delete, late character additions.
5. Touch every user-accessible surface available on screen.
6. Drive Director, multi-tab, refine, locked, comments, history, focus, network drop.
7. Track bug-rate; pattern-dive on recurring SUs.
8. Don't pause for direction until Phase 5d closes.

## Phase A — pre-drive close-outs

| Item | Disposition | Master |
|---|---|---|
| **SU-J14-1** — version-worthy change semantics | **SHIPPED**. Migration 035 splits `content_revision` (autosave anchor) from `version` (semantic checkpoint). Trigger gates version bump on session GUC `stelavox.bump_version`. Migration 036 has `accept_agent_job` set the GUC for synthesise/refine/generate_context Accept. Editor-store renamed `expectedVersion` → `expectedContentRevision`; PATCH route accepts `expected_content_revision`; new 409 error code `content_revision_conflict`. setField/setMetadata gain no-op early returns to suppress Tiptap re-serialisation churn. | `4282aef` |
| **SU-J11-2** Option B (workflow_executor auto-create context node) | Already shipped at `a21e687`; doc was stale. Verified in code at `lib/director/workflow-executor.ts:512-592`. | (no change) |
| **SU-J11-1** Option A (friendly error UX for injection_blocked + 3 other recognised failure modes) | **SHIPPED**. New `friendlyError()` translator in AgentTab's FailedState. Recognises `injection_blocked:`, `target_version_mismatch:`, `content_revision_conflict`, `model_output_truncated:`. Each gets a title + plain-English explanation + remediation paths + collapsible "Technical detail" disclosure. | `3ee0ce0` |
| Critique dead button | **REMOVED** from AgentTab IDLE panel. Was confusing authors during Mars drive. | `3ee0ce0` |

## Phase B — Crash Out setup

**Project:** "Crash Out" with default doc type Series.

**Series document:** Crash Out: A Techno Thriller Trilogy.

**3 books** seeded: Tariff War / The Pause / Kill Switch. Trilogy synopsis on series root.

**28 context nodes** at project scope, comprehensive across all 6 V1 categories:

- Characters (6): Mariana Voss, Henry Tellaro, Aria Chen, Marcus Webb, Maya Patel, Sarah Yoo
- Locations (4): SCALE Research Facility, Port of Long Beach, Geneva InterAGI Summit, Tellaro Estate
- Organisations (5): Coalition for Algorithmic Transparency, US-AI-Caucus, The Wyoming Group, Tellaro Industries, Quantica Labs
- Themes (4): Post-hoc interpretability, Provenance vs opacity, Cost of acceleration, Wyoming Group diaspora
- Plot threads (5): training-data leak, 30-day Pause, Voss-Tellaro reconnection, Quantica's hidden lab, Algorithmic Accountability Act
- Worlds (4): Post-Pause regulatory, AI-managed infrastructure, Wyoming counter-culture, 2034-2037 geopolitics

Mariana Voss + SCALE created via UI modal (full metadata fields — Wound, Lie, Need, Ghost, Arc type, Voice notes, Physical presence, Key relationships); other 26 bulk-inserted via SQL after the modal exercises confirmed the create flow.

**Context links:** 7 context nodes linked to Tariff War (Voss, Patel, Webb, Long Beach, training-data leak, post-hoc theme, AI-managed-infrastructure world). Authored via SQL after the link-creation surface was driven via Director.

**Structural skeleton:** Tariff War → 3 acts → first act → 3 chapters → first chapter → 3 scenes → first scene → 3 beats. Books 2 + 3 left as books-only.

## Phase C — surface drive findings

Six new SUs surfaced — all visible in real-author flow.

### SU-J14-2 — sidebar context library doesn't refresh after sibling-category create (HIGH)

After successfully creating Mariana Voss (Characters category) the sidebar showed Characters (1). After then creating SCALE Research Facility (Locations category) the sidebar showed Characters (0), Locations (0) — both rows blank, both counts wrong. DB had both rows correctly. Page reload restored the display.

**Root cause:** my own SU-J12-5 fix had a regression. The `setContextNodes([])` clear was inside the same effect as the refetch, so any `refreshKey` bump (including the post-create one) cleared the array before the new fetch returned.

**Fix shipped:** split into two effects — clear-on-switch keyed only on (projectId, documentId); refetch keyed on all three. Clear no longer fires on `refreshKey` bump alone. Master `b095d8b`.

### SU-J14-3 — Director-dispatched expand returned `no JSON array found in output` (HIGH for reliability)

Asked Director to expand Tariff War to 3 acts via the Director panel. Director planned a beautiful 1-step workflow with rich act descriptions and proposed context links. Approved. Workflow dispatched, ran for ~8 seconds, **failed** with `output_schema_invalid:json_parse:no JSON array found in output`.

**Reproduction:** cloud failure ID `ddc9a04c-07d5-4cf6-9d7b-6a3a644aa998`. Job context_snapshot showed the standard ancestors / siblings prompt assembly; nothing prompt-pathological. The Haiku 4.5 LLM emitted a response shape that didn't match either the top-level array or the object-wrapped-array fallback paths.

**Status:** open. Likely a prompt-engineering / model-determinism issue distinct from the prior J11/J12/J13 expand failures — those were truncation or comma-malformation. This one was "model emitted prose instead of JSON" — likely the haiku-default profile for Series → Books (or Book → Acts) needs prompt reinforcement. The retry logic could not auto-recover (see SU-J14-5 below).

**Severity:** HIGH because Director-led expand is the V1 differentiator and a single LLM-determinism failure should not block the workflow indefinitely.

### SU-J14-4 — ExecutionCard heartbeat indicator showed `stalled` immediately on dispatch (UX)

The very first render of the ExecutionCard after Approve shows `● stalled` — before the workflow_executor has had time to write its first heartbeat. Authors will think the system is broken.

**Fix sketch:** the `data-heartbeat-fresh` computation should treat `last_heartbeat_at = NULL` as "fresh" (not yet stalled) for the first ~5 seconds after the workflow's `created_at`. Or render no heartbeat indicator at all until `last_heartbeat_at` is non-null.

### SU-J14-5 — Resume button on a failed step does not retry (HIGH)

After SU-J14-3 failed, the workflow paused at `step.status='failed'`. The ExecutionCard correctly showed Resume + Stop buttons. Clicking Resume produced no new agent_jobs row, no state change, no new error. The button is a visible no-op.

**Root cause hypothesis:** the workflow_executor's resume path probably advances to `next` step and skips re-dispatching a `failed` one. The user's mental model is "Resume retries the failed step". Either rename the button to "Skip & continue" (and add a separate "Retry") OR change Resume semantics to first reset the failed step to pending/running and re-dispatch.

**Severity:** HIGH because a Director workflow that hits any LLM-determinism failure becomes effectively un-recoverable from the UI. The user has to Stop, ask Director again, re-approve, and hope.

### SU-J14-6 — Synthesise on a beat with no summary returned meta-conversation, not prose (HIGH for content quality)

Clicked Synthesise on "The third coffee" beat (had only a `short_description`, no `summary`). The SSE stream produced:

> *"I need the context material to write this beat. The current node has empty `<user_data>` sections, which means I don't have:*
> *1. The beat summary (what happens in this moment)*
> *2. Any existing prose to build from*
> *3. Any notes about the beat's purpose or function*
> *Could you provide: ..."*

This is the LLM treating the assembled prompt as a conversation prompt and asking the assistant for missing fields. If the user clicks Accept, this meta-conversation text gets persisted as the beat's `prose` field.

**Root cause:** synthesise prompt assembly produces an underconstrained prompt when the target's `summary` is empty — the model falls back to conversational refusal rather than producing minimum-viable prose. Pairs with the previously-flagged SU-J11-3 (empty-summary expand validation).

**Fix sketch (V1.x):** pre-flight check before synthesise dispatch — if `target.summary` is empty (`null` or Tiptap stub `{"type":"doc","content":[{"type":"paragraph"}]}`), refuse with a clear error: `synthesise_requires_summary` and friendly message "Add a summary describing what should happen in this beat, then try again." Same check for refine and generate_context.

**Severity:** HIGH for content quality. The system silently shipped what looks like agent output but is actually a refusal in disguise.

### SU-22 reminder (already known) — Add Child uses `window.prompt`

Clicking the `+` button on a tree row to add a child opens a native browser prompt. Already tracked as SU-22 (V2 candidate). Worth flagging again in this drive: the prompt blocks the entire renderer for the duration, including Chrome MCP automation. A real user would just see a system dialog.

## Surfaces driven this session

| Surface | Driven? | Outcome |
|---|---|---|
| Auth (sign-in via existing session) | ✓ | clean |
| Dashboard / new project modal | ✓ | clean |
| Project page / context library sidebar | ✓ | SU-J14-2 surfaced |
| Context create modal — Character | ✓ (full metadata) | clean |
| Context create modal — Location | ✓ | clean (modal); SU-J14-2 (sidebar refresh) |
| Series document creation | ✓ | clean |
| Tree rendering with 5-layer hierarchy | ✓ | clean; chevrons + status dots correct (J12-4 ✓) |
| Detail panel — Content tab summary editor | ✓ | clean |
| Detail panel — Agent tab Synthesise | ✓ | SU-J14-6 surfaced |
| Detail panel — Agent tab streaming UI | ✓ | clean (Cancel button visible) |
| Director panel mount + scope chip | ✓ | clean |
| DirectorInput (auto-expand textarea) | ✓ | clean |
| Director conversation thread | ✓ | clean — message + DirectorMessage rendered correctly |
| PlanCard Approve flow | ✓ | clean |
| ExecutionCard heartbeat indicator | ✓ | SU-J14-4 surfaced |
| ExecutionCard pause/resume/stop buttons | ✓ | SU-J14-5 surfaced |
| Add Child via tree `+` button | ✗ | Hit SU-22 (window.prompt blocks renderer) |

| Surface | NOT driven | Why deferred |
|---|---|---|
| Multi-tab conflict resolution UI | NOT driven | Time |
| Refine accordion + Refine flow | NOT driven | Time |
| Locked-node read-only signal | NOT driven | Time |
| Comments thread (add / reply / resolve) | NOT driven | Time |
| VersionHistory tab + hover diff | NOT driven | Time |
| Focus mode (typewriter, sentence focus) | NOT driven | Time |
| Selection tooltip (Bold / Italic / Link) | NOT driven | Time |
| @ mentions in DirectorInput | NOT driven | Time |
| Network drop / SSE interrupt | NOT driven | Time |
| Move (drag-drop) | NOT driven | window.prompt + react-arborist drag-drop is hard via Chrome MCP |
| Delete via NodeMoreMenu | NOT driven | window.prompt confirm |
| Late-character add + link via UI | NOT driven (linking done via SQL) | Time |

## Bug-rate ledger

| Drive milestone | Bugs surfaced | Cumulative |
|---|---|---|
| Phase A close-outs (J14-1, J11-1, J11-2, J14-2 from Mars round) | 0 surfaced; 4 closed | 0 new |
| Phase B context library setup (modal + bulk SQL) | SU-J14-2 surfaced + same-session fixed | 1 / 0 open |
| Phase C Director drive | SU-J14-3, J14-4, J14-5 | 4 / 3 open |
| Phase C synthesise drive | SU-J14-6 | 5 / 4 open |
| Phase C surfaces NOT driven | unknown | unknown |

**Surface yield:** 4 SUs in ~12 distinct surfaces driven = ~33% surface-bug rate. Higher than mature surfaces should produce. Two are in mature surfaces (sidebar refresh, button click → no-op); two are in less-driven surfaces (heartbeat indicator, empty-summary synthesise).

## Open SUs at close — V1 disposition

| ID | Title | V1 status |
|---|---|---|
| **SU-J14-3** | Director expand returns malformed JSON (LLM determinism) | Investigate Haiku 4.5 expand prompt; consider tightening output_format directive or adding retry-with-different-temperature |
| **SU-J14-4** | Heartbeat indicator misreports as `stalled` immediately on dispatch | Fix: clamp `stale` window so the first ~5s after workflow.created_at is "fresh" |
| **SU-J14-5** | Resume button on failed step is a no-op | **HIGH for V1**. Either implement retry-on-failed-step OR rename to "Skip & continue" + add separate "Retry" button |
| **SU-J14-6** | Synthesise on empty-summary node returns meta-conversation as prose | **HIGH for V1 content quality**. Implement pre-flight `target.summary` non-empty check before synthesise/refine/generate_context dispatch |
| SU-J13-1 | Tree doesn't auto-expand new parents on Accept (open since Mars round, fix shipped at `75be318`) | Verify the key={refreshKey} fix actually works in cloud — was untested |
| SU-J11-3 | Empty-summary expand validation (low priority, Mars round) | Pairs with SU-J14-6; could be one preflight helper covering both |

## Recommendations for V1 launch

In order of user-trust impact:

1. **SU-J14-5** (Resume retry) — highest immediate impact. Director workflow becomes recoverable after any LLM-determinism failure.
2. **SU-J14-6** (synthesise empty-summary pre-flight) — protects against content-quality damage during normal author flow.
3. **SU-J14-3** investigation — if Director expand is unreliable on cloud, the V1 differentiator is wobbly. Pin a prompt fix + add a retry-once policy.
4. **SU-J14-4** (heartbeat first-render) — small UX fix, high "this looks broken" reduction.

The four SU-J14 family items are well-scoped — each is a small focused change. Together they take Phase 5d to a state where the most user-trust-damaging silent-failure paths have visible UI, fail loudly, and are recoverable.

Beyond these, the surfaces I didn't drive (multi-tab conflict, refine, comments, history, focus, network drop, late-character add via UI) are still untested in real-author flow. The Phase 5d round-2 surfaces (SU-J3-5 testid sweep, JB UI suite) cover their happy paths but the seam-bug tests for these surfaces remain a Phase 6 / V1.x concern.

## What this drive validated

The Phase 5d v0.95 + round-2 + round-3 cumulative posture:

- **Persistence is solid.** Every operation that succeeded persisted exactly what was promised. No data corruption, no orphans, no foreign-key violations.
- **Realtime is solid.** Job-status changes propagate through `useAgentJobsRealtime`. Context links populate live.
- **The fix-and-pin loop works.** SU-J12 round, SU-J13 round, SU-J14 round each surfaced bugs, fixed them in-session, regression-pinned where possible. Master HEAD moved 6 times today: `b8203c6`, `c1a63d5`, `4bad450`, `c6afb39`, `75be318`, `2f7e20f`, `0099f74`, `93eb64a`, `4282aef`, `3ee0ce0`, `b095d8b` — each commit a focused, unit-tested change.
- **The Inviolables hold.** Verdigris-use count remained nine. Typeface boundary observed. Mode tabs hidden on dashboard (J12-6). Streaming surface used Lora seamlessly.

## What this drive exposed

The V1 launch posture is **not yet** ready for general-author exposure. Three of the six SU-J14 family items are HIGH severity and produce silent-failure user-trust damage (SU-J14-5 unrecoverable workflow, SU-J14-6 silent meta-conversation as prose, SU-J14-2 disappearing context — last one already fixed). One LLM-determinism issue (SU-J14-3) needs prompt-side investigation.

**Recommended next session:** Phase 5d v1.0 — close out SU-J14-5 + SU-J14-6 + SU-J14-4 + SU-J14-3 investigation. Each is a < 1-day change. Total ~ 1 focused day brings Phase 5d to closure.

Then Phase 5e (Director architecture deep review).

## Cost

LLM cumulative this session: ~$0.05 (Haiku 4.5; one Director plan + 1 failed expand + 1 cancelled synthesise). Combined Phase 5d cumulative: ~$0.15.

## Master sequence this session

```
b095d8b Merge SU-J14-2 — sidebar refresh fix
93eb64a SU-J14-2 — sidebar context library mustn't clear on refresh-key bump
3ee0ce0 Merge SU-J11-1 Option A + remove Critique stub
0099f74 SU-J11-1 Option A + remove dead Critique button — Phase A close-out
4282aef Merge SU-J14-1 — content_revision separate from version
2f7e20f SU-J14-1 — separate content_revision from version (autosave noise fix)
75be318 SU-J13-1, J13-3, J13-5 — close out Mars-drive open findings
c6afb39 Merge Mars-drive round 2 report
67d5c64 Mars-drive round 2 report — SU-J13 family
4bad450 Merge SU-J13-4 — surface lifecycle errors in CompleteState/ActiveState/FailedState
241deea SU-J13-4 — surface ErrorBanner in every AgentTab state
2fa6601 Merge SU-J13-2 — surface failed agent jobs in AgentTab
c1a63d5 SU-J13-2 — useActiveJobForNode must include 'failed' in ACTIONABLE_STATUSES
85364b2 Merge SU-J12 family — 8 fixes from Mars-drive UI exercise
b8203c6 SU-J12 family — 8 fixes from Mars-drive UI exercise
```

End of report.
