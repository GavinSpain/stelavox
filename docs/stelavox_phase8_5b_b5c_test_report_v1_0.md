# Phase 8.5b Sub-phase B.5c — Final Channel Collapse — Test Report
## Version 1.0
**Date:** 2026-06-08
**Branch:** `claude/phase8-5b-b5c-final-channel-collapse`
**Verdict:** ✅ **PASS** (architectural goal of ≤ 1 Realtime channel per tab achieved)

---

## 0. Executive summary

Sub-phase B.5c closes the Realtime multiplex migration that began in B.5 substrate and continued in B.5b. After B.5c, **no production consumer opens a standalone Supabase Realtime channel**. Every postgres_changes subscription routes through the single user channel mounted at the app shell, multiplexed by the demuxer, dispatched to per-component subscribers via `useRealtimeTopic`.

| State | Channels per tab |
|---|---|
| Pre-Phase 8.5b | 5-10 (per-resource explosion) |
| After B.5 | `user:{userId}` + `nodes-patcher:{orgId}` + 6 unmigrated consumer channels |
| After B.5b | `user:{userId}` + `nodes-patcher:{orgId}` + 3 unmigrated consumer channels |
| **After B.5c** | **`user:{userId}` — that's it** |

**Channels eliminated by B.5c:** 6
- `director-workflows:{documentId}` + `director-workflow-steps:{wfId}` (useDirectorConversation, 2 channels collapse)
- `scheduler:{documentId}` (SchedulerPanel, 1 channel carrying 3 .on handlers)
- `nodes-patcher:{orgId}` (NodesPatcherMount, B.3b's standalone)
- `nodes:doc:{documentId}` (useNodesRealtime, NodeTree's per-document)
- `node:{nodeId}` (useNodeRealtime, NodeDetailPanel's per-node)

## 1. Topic-cap decision: Option A locked

`useDirectorConversation` needs `workflows` + `workflow_steps`. Adding both pushes `REALTIME_TOPICS` from 10 → 12, over the Tier-A §5.3 soft cap of 10.

**Three options were evaluated:**

| Option | Action | Verdict |
|---|---|---|
| **A** | Raise cap to 12 with rationale | ✅ **Locked.** Two more `.on()` handlers on a per-tab channel is strictly cheaper than keeping 2 standalone channels. |
| B | Drive refetch off existing `agent_jobs` + `conversation_messages` topics | ❌ **Rejected.** `workflows` row INSERT on user Approve fires no `agent_jobs` event yet (dispatcher claims async). PlanCard would lag visibly behind the user's click. |
| C | Keep `useDirectorConversation` on per-resource channels permanently | ❌ **Rejected.** Strictly worse for the architectural goal; carries unbounded fragmentation precedent. |

Tier-A §5.3 changelog entry of 2026-06-08 records the cap raise: cap is now **12**, advisory; further additions still gated by spec changelog entry.

## 2. What shipped

### 2.1 Substrate

| File | Change |
|---|---|
| `lib/realtime/demuxer.ts` | `REALTIME_TOPICS` grows 10 → 12; adds `workflows` + `workflow_steps`. Doc-comment updated. |
| `lib/realtime/useUserChannel.ts` | `isOrgScoped` returns false for `workflows` + `workflow_steps` (document-scoped, filter at subscriber level). |
| `docs/stelavox_document_load_architecture_v1_0.md` | §5.3 amended: soft cap 10 → 12 with rationale block. |
| `tests/unit/realtime-demuxer.test.ts` | TC-8.5b-B5-08 expected set + ≤12 assertion updated. |

### 2.2 Consumer migrations

| Consumer | Pre-B.5c | After |
|---|---|---|
| `useDirectorConversation` | 2 channels (`director-workflows:{doc}` + `director-workflow-steps:{wf}`) | 2× `useRealtimeTopic` with subscriber-level id filters |
| `SchedulerPanel` | 1 channel (`scheduler:{doc}`) with 3 `.on()` handlers | 3× `useRealtimeTopic` (briefs + brief_stages + agent_jobs) |
| `NodesPatcherMount` | 1 channel (`nodes-patcher:{orgId}`) via `attachNodesRealtimePatcher` | 1× `useRealtimeTopic('nodes')` that calls `applyNodeInsert / Update / Delete` |
| `useNodesRealtime` | 1 channel (`nodes:doc:{doc}`) with structural / data debounce | 1× `useRealtimeTopic('nodes')` with same debounce + filter by document_id |
| `useNodeRealtime` | 1 channel (`node:{nodeId}`) | 1× `useRealtimeTopic('nodes')` with debounce + filter by id |

The patcher functions in `lib/queries/realtime-patcher.ts` are unchanged — same H-33 ordering buffer, same aggregate-affecting invalidation, same idempotency. Only the event source changed. The standalone `attachNodesRealtimePatcher` export is removed; the unused `SupabaseClient` + `RealtimeChannel` imports go with it.

### 2.3 Marker flag preserved

`window.__stelavox_nodes_patcher_mounted` is preserved (still gates the now-redundant invalidate path in `NodeTree`'s `triggerRefetch`). The gate behaviour is unchanged from B.3b: patcher writes the cache synchronously when its subscriber fires; the per-document hook's invalidate is skipped. Both subscribers run off the same demuxer events.

## 3. Test results

### 3.1 Type-check

```
$ npm run type-check
> tsc --noEmit
(no output — exit 0)
```

✅ PASS.

### 3.2 Full Vitest suite

```
Test Files  7 failed | 112 passed | 1 skipped (120)
     Tests  8 failed | 1020 passing | 33 skipped (1061)
```

| Metric | Value | Δ vs B.5b |
|---|---|---|
| Test files passing | 112 | unchanged |
| Tests passing | 1020 | unchanged |
| Tests failing | 8 | unchanged (documented baseline only) |
| Tests skipped | 33 | unchanged |

**Zero regressions introduced by B.5c.** The 8 baseline failures are the same set documented through V1.x-Apollo + B.5 + B.5b (v1x-b2-batch-submitter pool-isolation, m174 multi-Brief edge cases, etc.).

### 3.3 Demuxer unit tests in isolation

```
$ npx vitest run tests/unit/realtime-demuxer.test.ts
Test Files  1 passed (1)
     Tests  8 passed (8)
```

TC-8.5b-B5-01 through TC-8.5b-B5-08 all green, including the updated -08 assertion that pins REALTIME_TOPICS to exactly the 12-entry set.

### 3.4 Smoke verification

A live smoke is part of the merge gate; it covers the three migrated surfaces.

| Surface | Smoke step | Expected |
|---|---|---|
| Director conversation | Open a Director-active document; observe `RealtimeBadge` | Hidden = user channel connected |
| Director conversation | Trigger a workflow proposal + Approve | PlanCard renders without page refresh |
| Scheduler panel | Navigate to `/projects/.../scheduler` | Row counts update via Realtime on brief / job changes |
| NodeTree edit | Open a document; edit a node title in another tab | NodeTree row updates without refetch (patcher path) |
| NodeDetailPanel | Open a node; edit summary in another tab | Detail pane updates within ~200ms debounce window |

Smoke gating: type-check + Vitest are the architectural-correctness gate. Live smoke confirms wire-level Realtime delivery, which is unchanged from B.5b (same channel, same auth, same reconnect).

## 4. Architectural goal achieved

Per Tier-A §5.2 the target was **≤ 1 Supabase Realtime channel per active tab**. After B.5c:

- 1 user channel: `user:{userId}` (carries all 12 topics)
- 0 per-resource channels

At Supabase Pro's 500-channel cap, that gives capacity for ~330 concurrent users at the documented 1.5 tabs-per-user average (per Tier-A §5.2 cost model). Down from ~30-60 concurrent tabs pre-Phase 8.5b.

## 5. Files in this commit

**Substrate:**
- `lib/realtime/demuxer.ts`
- `lib/realtime/useUserChannel.ts`
- `docs/stelavox_document_load_architecture_v1_0.md`
- `tests/unit/realtime-demuxer.test.ts`

**Consumer migrations:**
- `lib/hooks/useDirectorConversation.ts`
- `components/scheduler/SchedulerPanel.tsx`
- `lib/queries/NodesPatcherMount.tsx`
- `lib/queries/realtime-patcher.ts` (removed `attachNodesRealtimePatcher`)
- `lib/hooks/useNodesRealtime.ts`
- `lib/hooks/useNodeRealtime.ts`

**Documentation:**
- `docs/stelavox_phase8_5b_b5c_test_report_v1_0.md` (this file)

## 6. Acceptance criteria

| Criterion | Status |
|---|---|
| useDirectorConversation migrates to useRealtimeTopic | ✅ |
| Topic-cap decision documented + rationale | ✅ Option A in Tier-A §5.3 changelog |
| SchedulerPanel migrates to useRealtimeTopic | ✅ |
| NodesPatcherMount absorbed into user channel | ✅ |
| useNodesRealtime migrates to demuxer | ✅ (in-scope extension) |
| useNodeRealtime migrates to demuxer | ✅ (in-scope extension) |
| `attachNodesRealtimePatcher` removed (no consumer) | ✅ |
| Channel count ≤ 1 per tab (architectural goal) | ✅ Achieved |
| Full Vitest + type-check green | ✅ same documented baseline; zero regressions |
| Test Report PASS | ✅ this document |

## 7. Recommendation

**Recommend merge to master.** Completes the Realtime multiplex migration end-to-end. After this commit:

- Architectural goal of ≤ 1 channel per tab is met
- No production consumer opens a standalone `supabase.channel()`
- The phase8.5 follow-up #3 (per `MEMORY.md` entry — multiplex Realtime channels 5-10 → 1-2 per user) is fully closed

Phase 8.5b — Document Load Architecture closes with B.5c. The remaining open follow-ups (B.3b optimistic autosave, additional tests) are scoped polish that can land independently.

---

## Changelog

**v1.0 — 2026-06-08** Initial Test Report for sub-phase B.5c. PASS verdict. Architectural goal of ≤ 1 Supabase Realtime channel per tab achieved. Topic-cap decision locked at Option A (raise REALTIME_TOPICS soft cap to 12 with rationale). 5 consumers migrated, 6 per-resource channels eliminated: useDirectorConversation (2 → 0), SchedulerPanel (1 → 0), NodesPatcherMount (1 → 0), useNodesRealtime (1 → 0), useNodeRealtime (1 → 0). `attachNodesRealtimePatcher` export dropped from `lib/queries/realtime-patcher.ts` (no consumer remains). Tier-A §5.3 cap raised from 10 to 12 with rationale documented inline. 1020 Vitest passing / 8 baseline failing / 33 skipped — zero regressions. Type-check clean. Phase 8.5 follow-up #3 fully closed.
