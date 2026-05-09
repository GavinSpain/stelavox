# SU-J14-1 — Version-worthy change semantics

**Status:** in flight 2026-05-09
**Source:** user statement during Phase 5d round-3 planning. "The author will not want to go through hundreds of versions of a node that only differ by one character or even worse if it's none. There needs to be a change of substance. I'm thinking of a change that occurred by an agent, or a significant change from the Author."

## Problem

Migration 023's `bump_node_version_on_content_change` trigger fires on every UPDATE that changes summary / prose / notes / metadata. The autosave path in `lib/stores/editor-store.ts` PATCHes whenever the editor-store's `dirty` flag is set, which happens on every Tiptap `onUpdate` event. This produces a new `version` per pause-and-resume, per typo correction, per cursor reposition that triggers a re-serialization.

Round-2 Mars-drive observed Red Soil's `version` going 1 → 2 with `last_modified_by = 'user'` despite no editing — most likely a Tiptap on-mount normalization producing a "no-op" PATCH that the trigger still saw as `IS DISTINCT FROM`. The version-history surface then accumulates noise; the agent_jobs concurrency invariant trips on autosave-driven bumps that don't reflect meaningful change.

## Contract — what counts as a "version"

A new `version` represents a meaningful checkpoint in the author's intent. The contract:

1. **Agent Accept** of `synthesise`, `refine`, or `generate_context` → bumps `version`.
2. **Explicit user "Save as version"** UI action → bumps `version`. *(V1.x — deferred from V1; the data model supports it.)*
3. **Autosave** → does **NOT** bump version. The author can write a paragraph, pause to think, walk away, return, edit again — none of those create new versions.

A new `content_revision` is the always-current durability anchor:

1. **Any** content-changing UPDATE bumps `content_revision`. This is what autosave concurrency compares against (no two clients can save over each other, even within the same `version`).
2. The editor-store's conflict UI (Keep Mine / Accept Theirs) uses `content_revision`, not `version`.

## Schema change

Migration 035 adds:

```sql
ALTER TABLE nodes ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
```

The migration backfills `content_revision = version` for existing rows so the two start in sync.

The trigger is rewritten to:

```sql
CREATE OR REPLACE FUNCTION bump_node_version_on_content_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_should_bump_version BOOLEAN := COALESCE(
    current_setting('stelavox.bump_version', true)::boolean, FALSE
  );
BEGIN
  IF NEW.summary  IS DISTINCT FROM OLD.summary
     OR NEW.prose IS DISTINCT FROM OLD.prose
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    -- Always bump content_revision on content change.
    NEW.content_revision := OLD.content_revision + 1;
    -- version only bumps when the caller opts in via the session var.
    IF v_should_bump_version THEN
      NEW.version := OLD.version + 1;
    ELSE
      NEW.version := OLD.version;
    END IF;
  ELSE
    NEW.content_revision := OLD.content_revision;
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END;
$$;
```

Callers that want to bump version do:

```sql
SET LOCAL stelavox.bump_version = 'true';
UPDATE nodes SET ... WHERE id = ...;
```

The session var defaults to false (unset), so any UPDATE that doesn't explicitly opt in skips the version bump. Autosave PATCH from the API route does NOT set this var → version stays. `accept_agent_job` RPC sets this var before its UPDATE on synthesise/refine/generate_context → version bumps.

## API change

`PATCH /api/nodes/[id]` accepts a new `expected_content_revision` field for autosave concurrency. The body shape:

```jsonc
{
  "summary": "...",          // content fields
  "prose": "...",
  "notes": "...",
  "metadata": { ... },
  "expected_content_revision": 7    // for autosave concurrency
  // expected_version is still accepted for backwards compat — used for
  // operations that read version (mostly agent dispatch routes)
}
```

The PATCH compares `expected_content_revision` against the current row's `content_revision`. On mismatch → 409 with body
`{ error: "content_revision_mismatch", current: N, expected: M }`. The editor-store conflict UI maps this to its existing 409 path.

If the body provides both `expected_version` and `expected_content_revision`, both must match (defensive — caller bug).

## Editor-store change

`expectedVersion` field renamed conceptually to `expectedContentRevision` (the persisted-state anchor). PATCH body sends `expected_content_revision`. Conflict UI compares revisions, not versions.

The `version` field is still tracked locally so the VersionHistory surface and agent dispatch can use it.

## Migration plan for existing data

`ALTER TABLE nodes ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0`. A second statement back-fills:

```sql
UPDATE nodes SET content_revision = version;
```

This makes `content_revision >= version` always (the data invariant: every version bump implies a content_revision bump, but not vice versa).

## Behaviour summary

| Action | content_revision | version |
|---|---|---|
| Autosave (any content typed) | +1 per change | — |
| Autosave (no actual change — Tiptap no-op) | — | — |
| Rename / status change / lock toggle | — | — |
| Agent Accept (synthesise / refine / generate_context) | +1 | +1 |
| Agent Accept (expand) | — (children inserted, target unchanged) | — |
| Future: user "Save as version" | +1 | +1 |

## Test coverage

Unit + integration:
- `tests/unit/version-trigger.test.ts` (new) — round-trip the trigger semantics: content change without session var bumps content_revision only; with session var bumps both; rename UPDATEs bump neither.
- `tests/api/autosave-no-version-bump.spec.ts` (new) — drive PATCH /api/nodes/[id] with summary changes, observe `version` stable while `content_revision` advances.
- Update existing TC-A-46 (rename + summary in one PATCH bumps version exactly once) — now bumps content_revision but NOT version; rename remains a no-op.

## Why not "smart" thresholds

The user mentioned "significant change from the author" with the spirit being "not pause-and-resume." A character-count threshold or idle-time heuristic could approximate this client-side, but:

- Heuristics produce surprises ("why didn't this save as a version?")
- The cleanest contract for V1 is: agent Accept + explicit user action. Both are intentional.
- A "Save as version" button gives the author exact control. V1.x can layer time-based suggestions ("you've made significant changes since the last version — save now?") on top of the same data model.

This SU ships the data model and the V1 implementation. The user-facing "Save as version" button is V1.x.
