# Phase 5d round 3 — Techno Thriller drive bug log

**Cloud:** stelavox.vercel.app · stelavox-dev (`zhcdbofshifzblkgqrsc`)
**Project:** Crash Out (`b147761e-0e9c-4054-bc29-e6ffae74b0cd`)
**Pre-drive master:** `3ee0ce0` (Phase A close-out: SU-J14-1 + SU-J11-1 Option A + Critique removal)

## Bug-rate ledger

| Operation | Result | SU |
|---|---|---|
| Sign in / open dashboard | ✓ | — |
| Open new-project modal | ✓ | — |
| Create project (Crash Out, series) | ✓ | — |
| Click into project | ✓ | — |
| Click "Create new character" | ✓ | — |
| Submit Mariana Voss with full metadata | ✓ | — |
| Click "Create new location" | ✓ | — |
| Submit SCALE Research Facility | ✓ persisted in DB; sidebar count not updated | **SU-J14-2** |

## SU-J14-2 — Sidebar context library doesn't refresh after sibling-category create

**Reproduction:**
1. Project page open with Characters expanded.
2. Click "Create new character", fill form, submit. Sidebar shows Characters (1), Mariana Voss listed. ✓
3. Click "Create new location", fill form, submit. Sidebar shows Characters (0) — **the previously-created character disappeared from the visible list AND the count reverted to 0**. Locations (0) — the just-created location is also missing.
4. Reload the page. Both rows reappear with correct counts.

**Database state:** both nodes exist (verified via `SELECT * FROM nodes WHERE project_id = '...'`).

**Root cause hypothesis:** the `bumpRefresh()` from ContextCreateModal's onCreated triggers a refetch in the sidebar, but the refetch may be racing with the modal's close/state-cleanup. The fetched response replaces the local `contextNodes` array, but if the response arrived before the just-created row had committed (or before the bumpRefresh propagation), the array could be empty momentarily.

OR: my SU-J12-5 fix (clear `contextNodes` at the start of each effect run) clears the list and the new fetch hasn't completed yet, but since `refreshKey` bump runs the effect synchronously, the cleared state is what gets rendered.

**Severity:** high — author creates context, sees it disappear, loses trust.

**Fix sketch:** don't clear `contextNodes` on `refreshKey` change (only on `projectId` / `documentId` change). Move the empty-on-entry to a separate effect keyed only on the project/doc switch.

## Author-flow pattern

I'm building the techno thriller "Crash Out" — a 3-book series (Tariff War / The Pause / Kill Switch) with ~28 context nodes. Mid-flow I'll mix the order: add some context first, then the doc, then more context, then linking, then expansion. Acting as the author.
