# Phase 0 — Apollo-Grade State Machine Foundation
## Implementation Design v1.0 — 2026-05-22

> Implements the architectural changes locked in
> `stelavox_brief_orchestration_v1_0.md` v1.1 + Apollo-grade decision
> 2026-05-22. Single `state` column per entity. DB-enforced transitions
> via BEFORE UPDATE triggers consulting a canonical `allowed_transitions`
> table. Two-table split for agent_jobs / director_iterations.
>
> **Status:** IMPLEMENTATION DESIGN. Locks the specific state names,
> the complete transition catalogue, and the migration sequence.
> Implementation follows.

---

## 1. State values per entity

Each entity gets ONE `state` column. The current `status` and (where
present) `queue_status` columns are deprecated; they will be dropped
in Phase 0.D after writers are migrated.

### briefs.state

| Value | Meaning |
|---|---|
| `active` | Approved and operationally in flight. ≤1 per document. |
| `completed` | All stages terminal-success. |
| `cancelled` | User or cascade-cancelled. |

3 states.

### brief_stages.state

| Value | Meaning |
|---|---|
| `planned` | Initial; no workflow attached. |
| `planning` | Director invoked to plan the workflow. |
| `ready` | Workflow attached; running or pending dispatch. |
| `completed` | Workflow ran to terminal-success. |
| `cancelled` | Cascade-cancelled. |
| `failed` | Planning retries exhausted OR workflow terminally failed. |

6 states.

### workflows.state

| Value | Meaning |
|---|---|
| `draft` | Director emitted; awaiting approval. |
| `approved` | Approval applied; ready for advanceWorkflow. |
| `running` | At least one step has dispatched. |
| `paused` | Any step failed OR budget exceeded. |
| `completed` | All steps terminal-success. |
| `cancelled` | Cancelled. |

6 states.

### workflow_steps.state

| Value | Meaning |
|---|---|
| `pending` | INSERTed; awaiting dispatch. |
| `running` | agent_job_id assigned; in flight. |
| `completed` | Linked agent_job accepted or completed. |
| `failed` | Linked agent_job failed/cancelled/dismissed. |
| `skipped` | Stop request skipped. |
| `removed` | User deselected at approve time. |

6 states.

### agent_jobs.state (worker jobs ONLY post-split)

| Value | Meaning |
|---|---|
| `queued` | INSERTed; waiting for dispatch. |
| `dispatched` | Dispatcher claimed; runner about to start. |
| `running` | Runner actively executing. |
| `awaiting_accept` | Work done; awaiting user Accept (replaces `completed/completed` tuple). |
| `accepted` | User Accepted (or auto-Accept); applied to nodes. |
| `dismissed` | User Dismissed. |
| `failed` | Errored. |
| `crashed` | Sweep-detected stale heartbeat. |
| `cancelled` | User/system cancelled. |

9 states. (Note: `completed` is RENAMED to `awaiting_accept` to make the
"needs user action" semantic explicit.)

### director_iterations.state (NEW TABLE, split from agent_jobs)

| Value | Meaning |
|---|---|
| `queued` | INSERTed; waiting for dispatch. |
| `dispatched` | Dispatcher claimed. |
| `running` | Iteration LLM call in flight. |
| `completed` | Iteration terminal-success (may chain to next). |
| `failed` | Errored. |
| `crashed` | Sweep-detected stale heartbeat. |
| `cancelled` | User/system cancelled. |

7 states. (No `awaiting_accept` — iterations don't need user Accept.)

### director_turns.state

| Value | Meaning |
|---|---|
| `in_progress` | Director iterating. ≤1 per conversation. |
| `completed` | All iterations terminal-success. |
| `failed` | Any iteration crashed/failed OR expected-output missing. |
| `cancelled` | User Stop. |

4 states.

---

## 2. The complete allowed_transitions catalogue

Total: **48 transitions** across all entities. This is the canonical
source of truth. The DB trigger refuses any UPDATE not in this list.

### briefs (3 transitions)

| from | to | event |
|---|---|---|
| active | completed | propagate_brief_completion |
| active | cancelled | cancel_brief |

INSERT initial state: `active` (via accept_brief CHECK).

### brief_stages (13 transitions)

| from | to | event |
|---|---|---|
| planned | planning | evaluate_ready_stage_triggers |
| planned | ready | attach_workflow (workflow-bound path) |
| planning | ready | attach_workflow (after propose_workflow) |
| planning | planned | planning_failed_retry |
| planning | failed | planning_failed_terminal |
| ready | completed | complete_brief_stage_workflow |
| ready | failed | workflow_terminal_failure |
| planned | cancelled | cancel_brief |
| planning | cancelled | cancel_brief |
| ready | cancelled | cancel_brief |
| failed | planned | admin_retry_failed_stage |

INSERT initial state: `planned` (via accept_brief CHECK).

### workflows (10 transitions)

| from | to | event |
|---|---|---|
| draft | approved | approve_workflow |
| draft | cancelled | cancel |
| approved | running | dispatch_first |
| approved | cancelled | cancel |
| running | completed | all_steps_terminal_success |
| running | paused | step_failed_or_budget |
| running | cancelled | cancel |
| paused | running | resume |
| paused | cancelled | cancel |

INSERT initial state: `draft` OR `approved` (brief approve route inserts approved directly).

### workflow_steps (8 transitions)

| from | to | event |
|---|---|---|
| pending | running | dispatch |
| pending | skipped | stop_request_or_cascade |
| pending | removed | user_deselect |
| running | completed | job_terminal_success |
| running | failed | job_terminal_failure |
| running | skipped | cascade_cancel |

INSERT initial state: `pending`.

### agent_jobs (14 transitions, worker jobs only)

| from | to | event |
|---|---|---|
| queued | dispatched | dispatcher_cas_claim |
| queued | running | runner_start_bypass |
| queued | cancelled | cancel_or_cascade |
| dispatched | running | persist_running_start |
| dispatched | cancelled | cancel_mid_dispatch |
| dispatched | crashed | heartbeat_stale_or_stuck_claim |
| running | awaiting_accept | llm_ok |
| running | failed | llm_fail |
| running | cancelled | cancel_mid_run |
| running | crashed | heartbeat_stale |
| awaiting_accept | accepted | author_accept |
| awaiting_accept | dismissed | author_dismiss |
| awaiting_accept | cancelled | cancel |

INSERT initial state: `queued`.

### director_iterations (11 transitions, post-split)

| from | to | event |
|---|---|---|
| queued | dispatched | dispatcher_cas_claim |
| queued | cancelled | cancel_or_cascade |
| dispatched | running | iteration_start |
| dispatched | cancelled | cancel_mid_dispatch |
| dispatched | crashed | heartbeat_stale_or_stuck_claim |
| running | completed | iteration_ok |
| running | failed | iteration_error_or_expected_output_missing |
| running | cancelled | cancel_mid_run |
| running | crashed | heartbeat_stale |

INSERT initial state: `queued`.

### director_turns (3 transitions)

| from | to | event |
|---|---|---|
| in_progress | completed | mark_turn_completed |
| in_progress | failed | mark_turn_failed |
| in_progress | cancelled | mark_turn_cancelled |

INSERT initial state: `in_progress`.

---

## 3. Schema for `allowed_transitions` and enforcement

```sql
CREATE TABLE public.allowed_transitions (
  entity_name TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  event_name TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (entity_name, from_state, to_state)
);

-- Read-only at runtime; populated via migrations only.
REVOKE ALL ON TABLE allowed_transitions FROM PUBLIC;
GRANT SELECT ON TABLE allowed_transitions TO PUBLIC;

CREATE FUNCTION enforce_legal_transition()
RETURNS TRIGGER
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
BEGIN
  IF OLD.state IS DISTINCT FROM NEW.state THEN
    IF NOT EXISTS (
      SELECT 1 FROM allowed_transitions
      WHERE entity_name = TG_TABLE_NAME
        AND from_state  = OLD.state
        AND to_state    = NEW.state
    ) THEN
      RAISE EXCEPTION 'illegal_transition: %.% cannot move from % to %',
        TG_TABLE_NAME, NEW.id, OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Applied per entity:
CREATE TRIGGER trg_<entity>_enforce_transition
  BEFORE UPDATE OF state ON <entity>
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();
```

---

## 4. Coexistence strategy during migration

We use the expand/contract pattern. Phases:

**0.A.1** — Create `allowed_transitions` table + seed all transitions.
**0.A.2 .. 0.A.7** — One migration per entity. Each:
1. ADD COLUMN state TEXT (NULL allowed initially).
2. Backfill from current status / queue_status columns.
3. ALTER COLUMN state SET NOT NULL + add CHECK constraint matching the
   state set.
4. Add `enforce_legal_transition` trigger.
5. **Add `auto_derive_state` trigger (BEFORE INSERT OR UPDATE)** — if
   the writer didn't set NEW.state explicitly, derive it from the
   existing columns. This keeps legacy writers working while migration
   proceeds. Once all writers are migrated (Phase 0.B), this trigger is
   dropped along with the old columns.

After Phase 0.A, the new column is the source of truth at the DB level.
Application code still writes status / queue_status; the auto-derive
trigger sets state to match. The enforce trigger refuses any UPDATE that
would put state into an illegal transition.

**0.B** — TS state-machine module per entity. Migrate every writer to
call the module instead of writing status / queue_status directly. The
module writes `state` directly.

**0.C** — Split agent_jobs → agent_jobs (worker) + director_iterations.

**0.D** — Drop auto-derive trigger, drop status / queue_status columns,
clean up references.

---

## 5. Migration sequence

| Migration | Scope |
|---|---|
| **M-191** | `allowed_transitions` table + `enforce_legal_transition()` function + seed all 48 transitions. |
| **M-192** | `briefs.state` column + backfill + triggers. |
| **M-193** | `brief_stages.state` column + backfill + triggers. |
| **M-194** | `workflows.state` column + backfill + triggers. |
| **M-195** | `workflow_steps.state` column + backfill + triggers. |
| **M-196** | `agent_jobs.state` column + backfill + triggers. |
| **M-197** | `director_turns.state` column + backfill + triggers. |

That's 7 migrations for Phase 0.A. Each is small, focused, rollback-safe.

Phase 0.B is code edits to `lib/orchestration/` (new directory) — no
migrations.

Phase 0.C is the split:
- **M-198** Create `director_iterations` table.
- **M-199** Copy `agent_jobs WHERE operation_type='director_iteration'` rows into the new table.
- **M-200** Update foreign-key references (`director_turns.parent_iteration_id` etc.).
- Code migration to read from the new table.

Phase 0.D cleanup:
- **M-201** Drop status / queue_status / auto-derive trigger.

Total: ~11 migrations for Phase 0.

---

## 6. Backfill mapping per entity

How existing rows map to the new `state` value.

### briefs
- `status='active'` → `state='active'`
- `status='completed'` → `state='completed'`
- `status='cancelled'` → `state='cancelled'`
- Any dead values (`'planned'`, `'queued'`) → confirmed unused by query; backfill error if found.

### brief_stages
- `status='planned' AND workflow_id IS NULL AND prompt IS NULL` → `state='planned'` (legacy null-source rows; will be cleaned)
- `status='planned' AND workflow_id IS NOT NULL` → `state='ready'` (workflow already attached)
- `status='planned' AND workflow_id IS NULL AND prompt IS NOT NULL` → `state='planned'`
- `status='planning'` → `state='planning'`
- `status='completed'` → `state='completed'`
- `status='cancelled'` → `state='cancelled'`
- Dead values (`'approved'`, `'scheduled'`) → confirmed unused; backfill error if found.

### workflows
- 1:1 mapping. Same values.

### workflow_steps
- 1:1 mapping. Same values.

### agent_jobs
- `(status='pending', queue_status='queued')` → `state='queued'`
- `(status='pending', queue_status='dispatched')` → `state='dispatched'` (transient)
- `(status='running', queue_status='dispatched' OR 'running')` → `state='running'`
- `(status='completed', queue_status='completed')` → `state='awaiting_accept'`
- `(status='accepted', queue_status='completed')` → `state='accepted'`
- `(status='dismissed', queue_status='completed')` → `state='dismissed'`
- `(status='failed', queue_status='failed')` → `state='failed'`
- `(status='failed', queue_status='crashed')` → `state='crashed'`
- `(status='cancelled', queue_status='cancelled')` → `state='cancelled'`
- Any other combination → backfill error; investigate.

### director_turns
- 1:1 mapping. Same values.

---

## 7. Verification plan

After each migration:
1. `SELECT entity_name, COUNT(*) FROM <entity> WHERE state IS NULL` — must be 0.
2. `SELECT * FROM audit_orchestration_state()` (created in Phase 2) — must be empty.
3. Run unit + Playwright suites — must remain green.

After Phase 0.A complete (M-191 .. M-197):
4. Hand-test: create brief, run stage, cancel mid-flight — verify state column tracks correctly via auto-derive.
5. Hand-test: attempt illegal transition via direct SQL — verify trigger refuses.

---

## 8. Rollback strategy

Each migration is rollback-safe:
- New columns can be DROPPED.
- New triggers can be DROPPED.
- New tables can be DROPPED.

No existing column is touched in Phase 0.A.

If a migration fails part-way through, the failed migration is reverted
(its content is wrapped in BEGIN; ... COMMIT; in the migration script,
so partial failure is impossible).

---

## 9. Implementation begins

Starting with M-191. Order strictly as listed in §5.
