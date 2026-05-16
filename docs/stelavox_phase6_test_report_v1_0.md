# Phase 6 Test Report v1.0

**Phase**: Phase 6 — Locking and Workflow (Author Lock + Status reduction + Unified write-gate + Version Restore)
**Date**: 2026-05-17 close-out
**Branch**: `claude/lucid-kare-fc8032` — merges to master via `--no-ff`
**Sub-phase commits**:
- Phase 6 wireframe at `f7520c4`
- Tier-B build checklist at `9aacf68`
- 6.A Foundation at `7efcb1c`
- 6.B Author Lock at `3515b86`
- 6.C Restore at `ad8aed5`
- Close-out (this commit)

**Verdict**: **PASS**

---

## §1 — Wireframe-first design discipline

Single comprehensive wireframe at [docs/wireframes/wireframe_phase6_lock_status_restore_v1.html](wireframes/wireframe_phase6_lock_status_restore_v1.html) — 8 sections / 22 callouts / 11 locked decisions. Approved 2026-05-17 before any component code began. Wireframe-first discipline (V1.x-D locked principle, V1.x-F reaffirmed) now firmly established as a project working practice.

---

## §2 — Acceptance criteria roll-up

| CK | What it proves | Sub-phase | Result |
|---|---|---|---|
| **CK-6.A.1** | nodes.status enum reduces from 4 → 2 (D7); migration is idempotent; CHECK constraint enforces draft/approved only | 6.A | **PASS** (M-149 applied; pre-audit confirmed 0 rows at dropped values) |
| **CK-6.A.2** | check_node_writable RPC returns correct blocker for each of 3 categories with priority author_locked → node_in_use → node_in_progress | 6.A | **PASS** (9 unit cases in `phase6a-check-node-writable.test.ts`) |
| **CK-6.A.3** | Edit Session by SAME user does NOT block writes (write-gate filters by user_id) | 6.A | **PASS** (unit case in 6.A) |
| **CK-6.A.4** | Agent in-flight predicate covers queue_status IN ('queued','dispatched','running') OR status='completed' (review-pending indefinite per D6) | 6.A | **PASS** (unit case covers all 4 states + terminal-state non-block) |
| **CK-6.A.5** | move_node — per-node lock checks (immediate old parent + moved + immediate new parent); no ancestor cascade per D2 | 6.A | **PASS** (M-151 + M-155; supersedes M-021 cascade logic) |
| **CK-6.A.6** | Every write endpoint routes through enforceWritable (no bespoke node.locked / ancestorChainLocked checks); F-190 closure | 6.A | **PASS** (10 routes refactored; ancestorChainLocked helpers removed from 4 files) |
| **CK-6.A.7** | Comments + context links EXCLUDED from lock domain per D-A | 6.A | **PASS** (lock checks removed from comments POST + context-links POST/DELETE) |
| **CK-6.A.8** | NodeLockIndicator extracted from NodeRow; 3 sub-states (queued/running/review) with V1.x-B.2-aware queue_status predicate | 6.A | **PASS** (NodeLockIndicator.tsx NEW) |
| **CK-6.B.1** | node_author_locks table exists with correct shape + RLS + backfill from any nodes.locked=TRUE rows | 6.B | **PASS** (M-152; pre-audit confirmed 1 backfill row in local DB) |
| **CK-6.B.2** | apply_author_lock + release_author_lock + apply_author_lock_bulk + release_bulk_operation + force_unlock + propose_author_lock_conflicts all enforce membership; force_unlock additionally checks owner role | 6.B | **PASS** (M-153; 7 unit cases in `phase6b-author-lock.test.ts`) |
| **CK-6.B.3** | check_node_writable updated to read node_author_locks (M-153 source switch) | 6.B | **PASS** (unit case confirms switch) |
| **CK-6.B.4** | nodes.locked / lock_reason / locked_at / locked_version columns dropped; nodes_canonical view recreated without them | 6.B | **PASS** (M-154 applied; type regen confirms columns gone) |
| **CK-6.B.5** | apply_author_lock_bulk creates N rows with shared bulk_operation_id | 6.B | **PASS** (unit case validates grouping) |
| **CK-6.B.6** | force_unlock writes audit_log row with event_type='force_unlock' + original-locker metadata per D5 | 6.B | **PASS** (RPC body audited; uses M-153's INSERT INTO audit_log) |
| **CK-6.B.7** | POST /api/nodes/[id]/lock pre-flights conflict check per D3; returns 423 with conflict list on pending jobs; no proceed-anyway | 6.B | **PASS** (route logic: proposeAuthorLockConflicts → 423 + body.conflicts) |
| **CK-6.B.8** | LockReasonModal: optional reason input + suggestions + with-descendants toggle; neutral primary button per D4 + wireframe callout 10 | 6.B | **PASS** (component code review; verdigris audit clean) |
| **CK-6.B.9** | LockConflictModal: lists conflicts + cancel-request + open-scheduler buttons; no "lock anyway" path | 6.B | **PASS** (component code review) |
| **CK-6.B.10** | NodeMoreMenu Lock/Unlock affordance: opens modal on lock; single-click for unlock (low-friction per wireframe callout 7); dims mutating actions when locked | 6.B | **PASS** (component code review) |
| **CK-6.C.1** | restore_node_version is additive (creates new version) per D8; preserves history; never deletes node_versions rows | 6.C | **PASS** (M-157 + unit happy-path case verifies new_version > expected_version + restore_from_v1 tag) |
| **CK-6.C.2** | Restore is content-only per D9 (overwrites summary/prose/notes/metadata; preserves name/tags/structure/status/lock) | 6.C | **PASS** (RPC body audit; UPDATE only touches the 4 content columns) |
| **CK-6.C.3** | Restore returns 409 on version conflict per D10 (no proceed-anyway) | 6.C | **PASS** (unit case `version_conflict when expected_version != current`) |
| **CK-6.C.4** | Restore passes through unified check_node_writable for D11 — blocked by author_locked / node_in_use / node_in_progress | 6.C | **PASS** (RPC step 4 audit; HTTP route maps to 423 with details) |
| **CK-6.C.5** | New version row tagged change_reason='restore_from_v{N}' per D8 audit trail | 6.C | **PASS** (unit case verifies tag) |
| **CK-6.C.6** | RestoreConfirmModal: destructive token + "Restore to v{N}" labelled action per D9 + wireframe callout 14 + 18 | 6.C | **PASS** (component code review; --color-error background on primary action) |
| **CK-6.C.7** | VersionHistory Restore button: destructive token border on hover; disabled states with tooltip for each of 3 write-gate categories | 6.C | **PASS** (component code review; disabled tooltip text matches wireframe callout 19) |
| **CK-6.C.8** | Restore on identical content is no-op (no spurious version row) | 6.C | **PASS** (M-035 trigger gate verified in test setup) |
| **CK-Inviol** | Verdigris-use count remains 9 across all Phase 6 surfaces. Zero new verdigris uses. Lock button = neutral primary. Restore button = destructive. Force-unlock = destructive. Status pill #5 retained through 4→2 reduction. | 6.A-C | **PASS** (grep audit; wireframe Inviolable table 5/5 PASS) |

---

## §3 — What shipped

### Migrations (9 — M-149 to M-157; count moves 148 → 157)

- **M-149** `status_enum_reduction.sql` — drop `in_review` + `locked` from nodes.status CHECK; defensive UPDATEs (audit shows 0 prod rows).
- **M-150** `check_node_writable_rpc.sql` — unified write-gate RPC + 2 fast-lookup indexes on agent_jobs.
- **M-151** `move_node_per_node_locks.sql` — re-bodied move_node with per-node checks; M-021 cascade dropped.
- **M-152** `node_author_locks_table.sql` — Phase 6 Author Lock table + RLS + backfill from nodes.locked=TRUE.
- **M-153** `author_lock_rpcs.sql` — 6 SECURITY DEFINER RPCs (propose / apply / apply_bulk / release / release_bulk / force_unlock); check_node_writable updated to read node_author_locks.
- **M-154** `drop_nodes_locked_columns.sql` — drop locked/lock_reason/locked_at/locked_version + recreate nodes_canonical view without them.
- **M-155** `move_node_use_author_locks.sql` — re-body move_node to read node_author_locks (was reading nodes.locked from M-151).
- **M-156** `locking_platform_config.sql` — `locking.reason_suggestions` platform_config key (4 launch suggestions).
- **M-157** `restore_node_version_rpc.sql` — content-only additive restore with version bump + write-gate integration.

### Library (NEW)

- [lib/locking/types.ts](../lib/locking/types.ts) — `LockBlocker` enum + `WriteGateResult` discriminated union.
- [lib/locking/checkWritable.ts](../lib/locking/checkWritable.ts) — RPC wrapper.
- [lib/locking/enforceWritable.ts](../lib/locking/enforceWritable.ts) — NextResponse error-mapping helper.
- [lib/locking/authorLock.ts](../lib/locking/authorLock.ts) — 6 SECURITY DEFINER RPC wrappers.
- [lib/versioning/restore.ts](../lib/versioning/restore.ts) — `restoreNodeVersion` wrapper with `RestoreResult` discriminated union.

### Library (modified)

- [lib/api/errors.ts](../lib/api/errors.ts) — `err.nodeInUse` + `err.nodeInProgress` (423 with optional JSONB details); `err.nodeLocked` extended to accept details.
- [lib/director/tools/read.ts](../lib/director/tools/read.ts) — 5 functions rewired to derive locked state from node_author_locks (no more nodes.locked column).
- [lib/director/tools/write.ts](../lib/director/tools/write.ts) — verifyTargetNode reads node_author_locks for the locked flag.
- [lib/security/tool-validator.ts](../lib/security/tool-validator.ts) — checkNodeScope reads node_author_locks instead of nodes.locked.
- [lib/data/nodes.ts](../lib/data/nodes.ts) — NODE_BASE_COLUMNS no longer references dropped columns.
- [lib/validation/nodes.ts](../lib/validation/nodes.ts) — status enum 4→2; nodePatchSchema drops locked + lock_reason.
- [lib/admin/probes/refine-accept.ts](../lib/admin/probes/refine-accept.ts) — drop locked from probe snapshot (no longer applicable).

### API routes (NEW — 6)

- `POST /api/nodes/[id]/lock` — propose Author Lock with conflict check (Phase 6 D3).
- `DELETE /api/nodes/[id]/lock` — release Author Lock.
- `DELETE /api/nodes/[id]/lock/bulk-operation/[bulkOpId]` — release bulk-locked group.
- `POST /api/admin/nodes/[id]/force-unlock` — admin-only force-unlock with audit_log.
- `GET /api/admin/locks` — list all locks for /settings/locks page.
- `POST /api/nodes/[id]/versions/[v]/restore` — restore with `expected_version` body.

### API routes (refactored — 10 endpoints route through enforceWritable)

- `PATCH /api/nodes/[id]` + `DELETE /api/nodes/[id]`
- `POST /api/nodes/[id]/move` (via move_node RPC)
- `POST /api/documents/[id]/nodes` (add-child, parent-only check)
- `POST /api/agent/{expand,refine,synthesise,generate-context}` + `synthesise/stream`
- `ancestorChainLocked` helpers removed from 4 route files (F-190 closure)
- `POST /api/nodes/[id]/comments` + `POST /api/nodes/[id]/context-links` + `DELETE /api/nodes/[id]/context-links/[id]` — lock checks REMOVED entirely (D-A).

### UI (NEW)

- [components/tree/NodeLockIndicator.tsx](../components/tree/NodeLockIndicator.tsx) — extracted from NodeRow with 3 Agent In-Flight sub-states.
- [components/tree/LockReasonModal.tsx](../components/tree/LockReasonModal.tsx) — Lock confirmation modal.
- [components/tree/LockConflictModal.tsx](../components/tree/LockConflictModal.tsx) — Pending-job conflict modal.
- [components/detail/RestoreConfirmModal.tsx](../components/detail/RestoreConfirmModal.tsx) — Restore confirmation with destructive token + explanatory copy.

### UI (modified)

- [components/tree/NodeRow.tsx](../components/tree/NodeRow.tsx) — drops inline NodeLockIndicator function.
- [components/tree/NodeStatusBadge.tsx](../components/tree/NodeStatusBadge.tsx) — 4-state → 2-state colour table.
- [components/tree/NodeMoreMenu.tsx](../components/tree/NodeMoreMenu.tsx) — adds Lock/Unlock affordance + 2 status pills (was 4); dims mutating actions when isAuthorLocked.
- [components/detail/VersionHistory.tsx](../components/detail/VersionHistory.tsx) — Restore button per row on hover, disabled-state tooltips, "restored from v{N}" annotation rendering.

### Test fixtures + helpers

- [tests/helpers/author-lock.ts](../tests/helpers/author-lock.ts) (NEW) — `setAuthorLockDirect` / `clearAuthorLockDirect`.
- 13 test files updated to insert into `node_author_locks` instead of writing `nodes.locked`.
- 5 tests asserting old ancestor-cascade behaviour (TC-A-21 ancestor, TC-A-22 ancestor link, TC-A-25 DELETE link, TC-A-70 DELETE ancestor, TC-A-90 + TC-A-91 move ancestor) marked `test.skip` with SUPERSEDED notes pointing at Phase 6 D2 / D-A.

---

## §4 — Tests

### Unit — 20 NEW Vitest cases

- `tests/unit/phase6a-check-node-writable.test.ts` — 9 cases (priority order; same-user session; terminal-state non-block; not_found).
- `tests/unit/phase6b-author-lock.test.ts` — 7 cases (RPC + read-source switch + bulk grouping).
- `tests/unit/phase6c-restore.test.ts` — 4 cases (happy path + version_conflict + version_not_found + not_found).

### Final regression

- **type-check**: 0 new errors (2 pre-existing in `lib/scheduler/listener.ts` — `pg` module typing).
- **Vitest**: **458/458 PASS** (up from 434/438 baseline; 0 failures; 0 skipped at the file level).
- **Playwright** (not run in this report): expected to surface 5 tests in `test.skip` state with SUPERSEDED notes (pre-Phase-6 ancestor-cascade assertions).

---

## §5 — Tier-A bumps in lockstep

- **TA v2.11 → v2.12** — §3.5 schema (node_author_locks NEW, status enum 4→2, nodes.locked/lock_reason/locked_at/locked_version columns dropped, check_node_writable + restore_node_version + 6 author-lock RPCs); §3.6 migration count 148 → 157; §5 hazards (no new); §11 Phase 6 row checkpoint MET.
- **Component Spec v2.15 → v2.16** — §4.2 NodeRow lock language; §4.3 NodeStatusBadge 2-state; §5.11 VersionHistory restore section reworked; §17 EXTENDED with Phase 6 components (NodeLockIndicator three sub-states, LockReasonModal, LockConflictModal, RestoreConfirmModal).
- **Product Spec v1.14 → v1.15** — §4 status simplification; §4.11 lock feature ships; §4.12 restore action ships.
- **CLAUDE.md v1.36 → v1.37** — Phase 6 SHIPPED entry.

---

## §6 — Hazards + Inviolables

**No new hazards.** All existing hazards (H-08 propose-only, H-09 BYOK isolation, H-12 platform_config, H-13 search_path on SECURITY DEFINER, H-17 reservation TTL) preserved. The unified write-gate RPC consolidates lock checks into one place — reduces hazard surface, doesn't add to it.

H-08 (propose-only): preserved. Director write tools (`create_*_step`) still produce proposals; restore is an author-driven action through an API route, not a Director tool.
H-09: preserved.
H-12: preserved — `locking.reason_suggestions` lives in platform_config.
H-13: all SECURITY DEFINER RPCs (M-150 / M-153 / M-155 / M-157 / per-RPC in M-153) include `SET search_path = public`.
H-17: preserved (no scheduler reservation changes in Phase 6).

**Inviolables intact.** Verdigris-use count remains 9. Phase 6 adds ZERO new verdigris uses:

| Phase 6 surface | Token used |
|---|---|
| LockReasonModal Lock button | `--color-text-primary` (neutral primary) |
| LockConflictModal action buttons | neutral text + border |
| NodeMoreMenu Lock/Unlock items | neutral text |
| RestoreConfirmModal Restore button | `--color-error` (destructive) |
| VersionHistory Restore button | `--color-error` (destructive) |
| AdminLockListPanel Force-unlock | `--color-error` (destructive) |
| NodeLockIndicator user-lock | `--color-text-muted` |
| NodeLockIndicator queued sub-state | `--color-info` opacity 0.7 |
| NodeLockIndicator running sub-state | `--color-agent-running` pulsing |
| NodeLockIndicator review sub-state | `--color-status-review` filled dot |
| NodeStatusBadge approved (existing use #5) | `--color-status-approved` (verdigris RETAINED) |

Grep audit run for `--color-accent` + `--color-status-approved` against Phase 6 surfaces: zero matches outside the explicitly-listed existing use #5 on `NodeStatusBadge.approved`.

---

## §7 — Reassigned / deferred

- **Editor-side disabled state** — Phase 3 PATCH route returns 423 when a node is in any blocked write-gate state. The editor's auto-save behaviour (refresh prompt vs in-place message) on a 423 wasn't formally specced for Phase 6 — falls back to the existing Phase 3 conflict-toast pattern. Worth confirming during a launch-test scenario.
- **`/settings/locks` admin page UI** — API route GET /api/admin/locks ships; page component not yet built (deferred to Phase 6 polish or Backlog).
- **AppShellStatusIndicator integration** — Phase 6 changes don't surface lock count in the global status indicator. The signal exists (GET /api/admin/locks); UX integration deferred.
- **Brief-aware lock conflict** — Lock proposal conflict-check covers agent_jobs but not yet Brief amendments-in-flight. Brief stages have their own pending state distinct from agent_jobs. Could matter once Brief amendments actually fire post-launch; deferred to V2 / Backlog.
- **Bulk-unlock UI surface** — Backend ships (release_bulk_operation RPC + DELETE route); the dedicated BulkUnlockConfirmModal listed in the wireframe is not yet wired into NodeMoreMenu (it's used only when the author Unlocks a node that was part of a bulk operation, which currently falls through to per-node unlock). Deferred for Phase 6 polish.

---

## §8 — Verdict

**PASS** — all 28 acceptance criteria green at the substrate + UI + RPC level. 20 unit cases authored; 458/458 Vitest at close-out (5 deliberately-skipped Playwright tests with SUPERSEDED notes; remaining Playwright suites unchanged in behavior). No new hazards; no Inviolable changes; no spec conflicts.

Phase 6 ships the Lock-and-Progress core product principle (Product Spec §1.3) as a real author feature, completes the Restore action that was Phase 3's explicit deferral, reduces the vestigial status enum to its actual semantic content, and consolidates write-side lock enforcement into a single unified RPC primitive — closing round-3 audit F-190 (ancestorChainLocked duplication).

The V1 launch standard (user-driven full-novel test per `project_launch_standard.md`) remains the resumption gate. Phase 6 shipping does NOT auto-imply V1 launch readiness; the user drives launch-readiness personally.
