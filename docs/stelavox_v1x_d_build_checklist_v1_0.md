# Stelavox V1.x-D — Tier-B Build Checklist
## UI surfaces polish + lock + status state machine
## Version 1.0

> **Status: DRAFT.** Authored 2026-05-16 alongside B.3/C/E/F. UI design decisions in this phase normally need user input — flagged inline.

---

## §1 — Scope and goals

V1.x-D consolidates the UI surfaces deferred from V1.x-B + B.1.x + B.2 plus the lock + status state machine that's been queued since Phase 6 deferral. Six grouped concerns:

1. **AppShellStatusIndicator polish** — V1.x-B.1.1 shipped substrate; B.2 added Director iteration counters but the popover surface needs tightening.
2. **NodeRow / NodeStatusBadge AI-changed flag** — when an agent_job completed an edit on a node since user last viewed, NodeRow shows a subtle marker.
3. **SchedulerPanel Stop control per row** — V1.x-B.2.1 deferred this. Add Stop button to each in-flight workflow row.
4. **Director "Was interrupted; resume?" UI** — V1.x-B.2.1 ships console message; D.4 adds the actual UI surface.
5. **Lock + status state machine** — Phase 6 deferral (per CLAUDE.md project structure section). Node-level lock display + agent-job status badge transitions.
6. **VersionHistory restore** — Phase 6 deferral. Browse + hover-diff already shipped Phase 3; restore action lands here.

### Sequencing

V1.x-D internal sub-phases:
- **D.1** — Status indicator + AI-changed flag (1 session)
- **D.2** — Scheduler panel Stop + Director resume UI (1 session)
- **D.3** — Lock + status state machine (1-2 sessions)
- **D.4** — VersionHistory restore (1 session)
- **D.5** — Tier-A consolidation + Test Report + merge (1 session)

Estimated 4-6 sessions total.

### USER INPUT NEEDED

UX design choices that should be reviewed pre-execution:
- AI-changed flag visual treatment (dot? underline? icon?)
- Resume-Director CTA copy + placement
- VersionHistory restore confirmation flow (one-click vs preview-then-confirm)
- Lock-acquired vs lock-released animation timing

---

## §2 — Migrations (3-5, 139-143)

- **M-139 — `nodes_last_agent_modified_at`**: column for the AI-changed flag — set by accept_agent_job when an agent edit applies; cleared when user views the node (via /api/nodes/[id]/mark-viewed).
- **M-140 — `node_view_state` table** OR `agent_jobs.user_viewed_at` (decision point — D.1 chooses): per-user-per-node "last viewed" timestamp so the AI-changed flag is per-user not per-node.
- **M-141 — `agent_jobs_status_machine_v2_for_locks`**: status transitions augmented to surface lock-acquired-by-agent intermediate state distinguishable from lock-acquired-by-user.
- **M-142 — `node_versions_restore_rpc`**: `restore_node_version(p_node_id UUID, p_version_id UUID) RETURNS JSONB` SECURITY DEFINER — atomically rolls back node content + bumps version.
- **M-143 — `platform_config_d_keys`**: any new operational tunables (e.g., `ui.ai_changed_dot_decay_days` for auto-dismissing stale flags).

---

## §3 — Library

- **NEW `lib/ui/aiChangedFlag.ts`** — derives flag state from agent_jobs.completed_at + node_view_state.last_viewed_at
- **NEW `lib/director/resumeFlow.ts`** — surfaces interrupted Director turns to the user (calls `findInterruptedTurn` from V1.x-B.1.1; renders a banner)
- **NEW `lib/nodes/restore.ts`** — wraps the restore RPC; integrates with VersionHistory client-side state
- **MODIFY `lib/scheduler/dispatcher.ts` ?** — only if the lock+status state machine reveals dispatcher-side changes (likely not; the state machine is largely UI-side)

---

## §4 — UI

- **MODIFY `components/layout/AppShellStatusIndicator.tsx`** — popover refinements (group by Brief; show per-job ETA when known); attention-amber dot for any pending Director attention regardless of source
- **MODIFY `components/tree/NodeRow.tsx`** — render AI-changed dot when `aiChangedFlag()` returns true; clear on click
- **MODIFY `components/tree/NodeStatusBadge.tsx`** — new `agent-completed-unviewed` state + token (subtle verdigris dot? — REQUIRES INVIOLABLE AUDIT; if it becomes a 10th use we need explicit broadening)
- **MODIFY `components/scheduler/SchedulerPanel.tsx`** — Stop control per in-flight row (uses generic `/api/scheduler/stop` already shipped V1.x-B.2.1); cascade preview tooltip
- **NEW `components/director/InterruptedTurnBanner.tsx`** — mounts in DirectorPanel when most-recent assistant message has `turn_state='interrupted'` AND no later user message; "Director was interrupted. Resume?" with single Resume button (verdigris use #7 family)
- **MODIFY `components/detail/VersionHistory.tsx`** — Restore action per version row; confirmation modal; calls `lib/nodes/restore.ts`
- **MODIFY `components/detail/AgentTab.tsx`** — explicit lock-acquired-by-agent surface during agent runs (vs user-edit lock)

---

## §5 — API routes

- **NEW `POST /api/nodes/[id]/mark-viewed`** — sets node_view_state for the current user
- **NEW `POST /api/nodes/[id]/restore-version`** — calls restore_node_version RPC
- **MODIFY `POST /api/director/conversation/[id]/resume`** — already exists from V1.x-B.2; D.2 confirms the Resume CTA invokes it correctly + adds error-state UI for resume failures

---

## §6 — Tests

- 8 unit tests on `lib/ui/aiChangedFlag.ts` + `lib/director/resumeFlow.ts` + `lib/nodes/restore.ts` (state-derivation logic)
- 12 Playwright integration: AI-changed dot appears + clears; Stop control per row cascades; Interrupted banner appears for interrupted turn; Restore action rolls back content; lock-acquired-by-agent badge transitions

---

## §7 — Acceptance criteria

| CK | What | Method |
|---|---|---|
| CK-1 | AI-changed flag appears after agent_job completion | integration |
| CK-2 | AI-changed flag clears on user view | integration |
| CK-3 | Stop per row cascades correctly | Playwright |
| CK-4 | Interrupted-turn banner appears when assistant message is interrupted | Playwright |
| CK-5 | Resume action invokes /api/director/conversation/[id]/resume | Playwright |
| CK-6 | restore_node_version RPC rolls back atomically | unit + integration |
| CK-7 | VersionHistory Restore UI calls the RPC | Playwright |
| CK-8 | Lock-acquired-by-agent badge transitions correctly | Playwright |
| CK-9 | All gates green; V1.x-C regression intact | CI |
| CK-Inviol | Verdigris-use count audited (NodeStatusBadge agent-completed-unviewed dot is the highest-risk addition; needs explicit handling) | grep + design review |

---

## §8 — Sign-off

V1.x-D PASSES when CK-1..CK-9 + CK-Inviol all green, gates pass, Test Report PASS, Tier-A docs bumped (TA v2.6 → v2.7; Component Spec v2.13 → v2.14; CLAUDE.md → v1.32), merged to master with `--no-ff` + tag `v1.x-d`, MEMORY.md updated.

---

## Changelog

**v1.0 — 2026-05-16** Initial draft authored alongside B.3/C/E/F.
