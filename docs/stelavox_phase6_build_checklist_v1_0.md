# Stelavox Phase 6 Build Checklist v1.0

**Phase:** Phase 6 — Locking + Workflow (Author Lock + Status reduction + Lock Enforcement Consolidation + Version Restore)
**Date kickoff:** 2026-05-17
**Branch:** `claude/lucid-kare-fc8032` (existing worktree)
**Wireframe:** [wireframe_phase6_lock_status_restore_v1.html](wireframes/wireframe_phase6_lock_status_restore_v1.html) — approved 2026-05-17

**Sub-phasing (Shape B locked at kickoff):** three sub-phases on one branch, merged to master via `--no-ff` at end.

- **6.A Foundation** — status migration + unified write-gate RPC + drop ancestor cascade + agent-in-flight enforcement + NodeLockIndicator extraction. Internal substrate.
- **6.B Author Lock** — node_author_locks table + Lock UI + LockReasonModal + LockConflictModal + BulkUnlockConfirmModal + force-unlock surface. User-visible.
- **6.C Restore** — restore_node_version RPC + VersionHistory restore action + RestoreConfirmModal + disabled states + 409 UX. User-visible.

**Migration count expected:** 148 → ~155 (7 migrations across the three sub-phases).

---

## §1 — Locked decisions (no re-litigation during build)

11 decisions locked during the deep-dive session 2026-05-17. Wireframe Annex captures them; quick reference here:

| ID | Decision |
|---|---|
| D1 | Three categories, three vocabularies. Only Category 1 (Author Lock) uses "lock" in UI. Categories 2/3 use their own language. |
| D2 | Per-node locks, no implicit cascade. Bulk creates N independent records with shared `bulk_operation_id`. |
| D3 | Lock proposal does conflict check. Fails with options on pending jobs. No proceed-anyway. |
| D4 | Lock reason optional with platform_config-driven suggestions. |
| D5 | Force-unlock available to org owners. Recorded in audit_log. |
| D6 | Auto-lock on `status='completed'` is indefinite. Also serves as review-needed backlog signal. |
| D7 | Status reduces to 2 values (`draft` + `approved`). Bidirectional free flips. No audit on status changes. |
| D8 | Restore is additive and content-only. Preserves history. |
| D9 | Restore button uses destructive token + confirmation modal. NOT verdigris. |
| D10 | Restore returns 409 on version conflict. No proceed-anyway. |
| D11 | Unified write-gate RPC `check_node_writable`. `ancestorChainLocked` drops everywhere. |

---

## §2 — Existing DB state audit (run 2026-05-17)

```
nodes by status: 326 draft, 0 in_review, 0 approved, 0 locked
nodes by locked: 325 false, 1 true (test lock)
active node_locks: 0
```

**Migration implication:** trivial. Migrate the 1 locked node to `node_author_locks` during 6.B. No `in_review`/`locked` status rows to handle.

---

## §3 — Sub-phase 6.A Foundation

### M-149 — `status_enum_reduction.sql`
- UPDATE nodes SET status='draft' WHERE status='in_review' (defensive — audit shows 0 rows, but cloud may differ at deploy)
- UPDATE nodes SET status='approved' WHERE status='locked' (same)
- ALTER TABLE nodes DROP CONSTRAINT nodes_status_check
- ALTER TABLE nodes ADD CONSTRAINT nodes_status_check CHECK (status IN ('draft','approved'))

### M-150 — `check_node_writable_rpc.sql`
- CREATE FUNCTION `check_node_writable(p_node_id UUID, p_requesting_user_id UUID) RETURNS TABLE(writable BOOLEAN, blocker TEXT, blocker_details JSONB)`
  - Reads `nodes.locked` (will move to `node_author_locks` in 6.B; rewrite at that point)
  - Reads `node_locks` where user_id != p_requesting_user_id AND expires_at > NOW()
  - Reads `agent_jobs` where target = p_node_id AND (queue_status IN ('queued','dispatched','running') OR status = 'completed')
  - Returns first blocker found, in order: author_locked → node_in_use → node_in_progress
  - SET search_path = public per H-13
- CREATE INDEX `idx_agent_jobs_active_targets` ON agent_jobs(target_node_id, queue_status) WHERE queue_status IN ('queued','dispatched','running')
- CREATE INDEX `idx_agent_jobs_completed_pending` ON agent_jobs(target_node_id, status) WHERE status = 'completed'
- GRANT EXECUTE check_node_writable TO authenticated

### Library changes

- `lib/locking/checkWritable.ts` — TS wrapper calling the RPC
- `lib/locking/types.ts` — `WriteGateResult` discriminated union
- `lib/api/errors.ts` — add HTTP 423 constant + `nodeInUse()` + `nodeInProgress()` error helpers

### Write-endpoint refactor (drop ancestorChainLocked, route via RPC)

Files to refactor:
- `app/api/nodes/[nodeId]/route.ts` PATCH + DELETE
- `app/api/nodes/[nodeId]/move/route.ts`
- `app/api/nodes/[nodeId]/context-links/route.ts` (POST)
- `app/api/nodes/[nodeId]/context-links/[contextNodeId]/route.ts` (DELETE)
- `app/api/documents/[documentId]/nodes/route.ts` (POST — add-child checks parent.locked only, no ancestor walk)
- `app/api/agent/expand/route.ts`
- `app/api/agent/refine/route.ts`
- `app/api/agent/synthesise/route.ts`
- `app/api/agent/synthesise/stream/route.ts`
- `app/api/agent/generate-context/route.ts`

### move_node RPC update

- Edit `move_node` SQL (M-021 successor migration) — replace cascade ancestor-walk logic with per-node checks: node.locked + old_parent.locked + new_parent.locked. No ancestor walk.

### UI surfaces touched

- `components/tree/NodeRow.tsx` — extract inline NodeLockIndicator into separate file
- `components/tree/NodeLockIndicator.tsx` (NEW) — three sub-states for Agent In-Flight
- `components/tree/NodeStatusBadge.tsx` — 4→2 state colour table
- `components/tree/NodeMoreMenu.tsx` — reduce status pills 4→2
- `lib/hooks/useAgentJobsRealtime.ts` — refresh `useActiveJobForNode` predicate to use queue_status (V1.x-B.2-aware) + add lifecycle sub-state helper

### Tests

- `tests/unit/phase6a-check-node-writable.test.ts` (Vitest) — RPC predicate variations
- `tests/phase6a/foundation.spec.ts` (Playwright) — write-gate enforcement end-to-end on each blocker class
- Update existing tests that asserted ancestorChainLocked behaviour to match per-node semantics

### 6.A acceptance

- Type-check 0 errors
- All existing tests pass after refactor (status enum / cascade-removal updates)
- New tests for 6.A pass

---

## §4 — Sub-phase 6.B Author Lock

### M-151 — `node_author_locks_table.sql`
- CREATE TABLE node_author_locks (node_id PK FK, organisation_id, locked_by_user_id FK auth.users, locked_at TIMESTAMPTZ, lock_reason TEXT, bulk_operation_id UUID NULL)
- RLS policy: org members can read; write via SECURITY DEFINER RPCs only
- Backfill from any nodes.locked=TRUE rows (audit found 1)

### M-152 — `author_lock_rpcs.sql`
- `apply_author_lock(p_node_id, p_reason)` SECURITY DEFINER — INSERT row; returns lock id
- `release_author_lock(p_node_id)` SECURITY DEFINER — DELETE row; allowed by locked_by_user_id OR org owner
- `apply_author_lock_bulk(p_node_id, p_reason, p_descendant_ids[])` SECURITY DEFINER — atomic INSERT N rows with shared bulk_operation_id
- `release_bulk_operation(p_bulk_operation_id)` SECURITY DEFINER — DELETE all rows in group
- `force_unlock(p_node_id, p_reason)` SECURITY DEFINER — admin-only DELETE; INSERT audit_log row
- `propose_author_lock_conflicts(p_node_ids[])` SECURITY DEFINER — read-only conflict check returning JSONB list of conflicting jobs
- All include `SET search_path = public`
- Update `check_node_writable` (from 6.A) to read `node_author_locks` instead of `nodes.locked`

### M-153 — `drop_nodes_locked_columns.sql`
- ALTER TABLE nodes DROP COLUMN locked
- ALTER TABLE nodes DROP COLUMN lock_reason
- ALTER TABLE nodes DROP COLUMN locked_at
- ALTER TABLE nodes DROP COLUMN locked_version

### M-154 — `platform_config_locking_keys.sql`
- INSERT platform_config: `locking.reason_suggestions` (text array, default `["Approved final draft", "Saving for revision", "Do not modify", "Reviewer copy"]`)

### Library

- `lib/locking/applyAuthorLock.ts` — wraps apply_author_lock RPC
- `lib/locking/releaseAuthorLock.ts` — wraps release_author_lock RPC
- `lib/locking/bulkLock.ts` — wraps apply_author_lock_bulk + release_bulk_operation
- `lib/locking/forceUnlock.ts` — wraps force_unlock RPC
- `lib/locking/proposeLock.ts` — wraps propose_author_lock_conflicts RPC

### API routes (new)

- `POST /api/nodes/[id]/lock` — body `{ reason?, with_descendants?, descendant_ids? }` — proposes lock; returns 200 on success or 423 with conflict detail
- `DELETE /api/nodes/[id]/lock` — single unlock
- `DELETE /api/nodes/[id]/lock/bulk-operation/[bulkOpId]` — release whole bulk group
- `POST /api/admin/nodes/[id]/force-unlock` — admin-only; body `{ reason? }`; writes audit_log
- `GET /api/admin/locks` — admin-only; lists all locked nodes in org

### UI components

- `LockReasonModal.tsx` (NEW) — reason input + suggestions + with-descendants toggle + Lock button (neutral primary)
- `LockConflictModal.tsx` (NEW) — conflict list + cancel-request/open-scheduler buttons
- `BulkUnlockConfirmModal.tsx` (NEW) — preview tree + single unlock-all button
- `ForceUnlockConfirmModal.tsx` (NEW) — admin-only; warning + audit-log notice
- `AdminLockListPanel.tsx` (NEW) — settings page mounted at `/settings/locks`
- `app/(app)/settings/locks/page.tsx` (NEW) — route; admin-only; calls GET /api/admin/locks

### UI extensions

- `NodeMoreMenu.tsx` — add Lock/Unlock affordance with ⌘L shortcut; dim mutating actions on locked nodes
- `NodeLockIndicator.tsx` — finalise three sub-state visuals (per wireframe §01)
- `NodeRow.tsx` — wire Lock keyboard shortcut at row level

### Tests

- `tests/unit/phase6b-author-lock.test.ts` — RPC behaviours + bulk operation grouping
- `tests/phase6b/lock-flow.spec.ts` (Playwright) — end-to-end lock + unlock + conflict path

### 6.B acceptance

- Type-check 0 errors
- All Phase 6.A tests still pass
- New 6.B tests pass
- Visual sanity: screenshot at least one lock-flow page for Read-back verification

---

## §5 — Sub-phase 6.C Restore

### M-155 — `restore_node_version_rpc.sql`
- `restore_node_version(p_node_id UUID, p_target_version INT, p_expected_version INT) RETURNS JSONB` SECURITY DEFINER
  - Step 1: read current row; if expected_version != current.version → return `{ ok: false, error: 'version_conflict', current_version }`
  - Step 2: call check_node_writable(p_node_id, auth.uid()); if not writable → return `{ ok: false, error: blocker, details }`
  - Step 3: read target version row from node_versions
  - Step 4: bump version + content_revision (set GUC `stelavox.bump_version='true'` then UPDATE — mirrors accept_agent_job pattern from M-090)
  - Step 5: UPDATE nodes SET summary=X, prose=X, notes=X, metadata=X, version=v+1, content_revision=c+1, last_modified_by=...
  - Step 6: INSERT node_versions row with content of step 5 (will fire from trigger) + change_reason=`restore_from_v{p_target_version}`
  - Step 7: return `{ ok: true, new_version }`
- SET search_path = public

### Library

- `lib/versioning/restore.ts` — wraps restore_node_version RPC

### API route (new)

- `POST /api/nodes/[id]/versions/[v]/restore` — body `{ expected_version }` — calls RPC; maps errors to 423/409/200

### UI components

- `RestoreConfirmModal.tsx` (NEW) — destructive Restore-to-vN button + explanatory copy
- `VersionConflictModal.tsx` (NEW) — 409 conflict UX with Refresh history button

### UI extensions

- `VersionHistory.tsx` — wire Restore button on hover (destructive token); render disabled state with tooltip when node not writable; render "restored from vN" annotation on current row when change_reason matches pattern; ensure star uses `--color-text-primary` (SU-7 closure)

### Tests

- `tests/unit/phase6c-restore.test.ts` — RPC happy path + version conflict + blocker paths
- `tests/phase6c/restore-flow.spec.ts` (Playwright) — end-to-end restore + 409 + disabled states

### 6.C acceptance

- Type-check 0 errors
- All Phase 6.A + 6.B tests still pass
- New 6.C tests pass
- Visual sanity: screenshot VersionHistory restore-button-state for Read-back verification

---

## §6 — Close-out

### Tier-A doc bumps

- **TA v2.11 → v2.12** — §3.5 migration count 148→~155; §3.6 schema (node_author_locks NEW, nodes.status enum reduced, nodes.locked* columns dropped, check_node_writable + restore_node_version + author_lock RPCs); §11 Phase 6 row checkpoint MET
- **Component Spec v2.15 → v2.16** — §4.2 NodeRow lock vocabulary update; §4.3 NodeStatusBadge 2-state; §5.11 VersionHistory restore section reworked; §17 EXTENDED with Phase 6 components (LockReasonModal, LockConflictModal, BulkUnlockConfirmModal, ForceUnlockConfirmModal, RestoreConfirmModal, VersionConflictModal, AdminLockListPanel, NodeLockIndicator three sub-states); SU-7 closure note for star de-verdigrise
- **Product Spec v1.14 → v1.15** — §4.11 lock feature ships; §4.12 restore action ships; §4 status simplification
- **CLAUDE.md v1.36 → v1.37** — Phase 6 SHIPPED entry with full detail

### Test Report

- `docs/stelavox_phase6_test_report_v1_0.md` — PASS verdict; per-sub-phase test counts; CK acceptance criteria; SU items raised/closed; hazards (none expected)

### Memory

- `project_phase6_shipped.md` — current-state pointer for next session

### Final regression

- type-check 0 errors
- `npm test` (Vitest) — all passing
- Playwright phase6a + phase6b + phase6c + V1.x regression — all passing (allowed: pre-existing flakes documented in V1.x-F Test Report §4)

### Merge

- Squash sub-phase commits as appropriate (or keep them as a chain)
- Merge `claude/lucid-kare-fc8032` to master via `git merge --no-ff`
- Tag `phase-6` (or similar)

---

## §7 — Hazards + Inviolables

**No new hazards expected.** All existing hazards (H-08 propose-only, H-09 BYOK isolation, H-12 platform_config, H-13 search_path on SECURITY DEFINER, H-17 reservation TTL) preserved. The unified write-gate RPC consolidates lock checks into one place — reduces hazard surface, doesn't add to it.

**Inviolables intact.** Zero new verdigris uses. Verdigris-use count remains 9. SU-7 (current-version star) explicitly de-verdigrised in Component Spec v2.16. All five Inviolables PASS per wireframe audit table.
