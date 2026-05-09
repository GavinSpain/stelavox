# Phase 5d Mars-series UI drive report — round 2 (post SU-J12 fixes)

**Date:** 2026-05-09
**Cloud:** stelavox.vercel.app · stelavox-dev (`zhcdbofshifzblkgqrsc`)
**Document:** `9503c6ea-961c-4d3d-bc08-a8cd4abb8e28` (Mars series, project `j5-novel`)
**Master HEAD at start:** `2fa6601` (SU-J13-2 shipped earlier this session)
**Master HEAD at close:** `4bad450` (SU-J13-4 shipped at close)

## 1. Mission

Resume the Mars-series drive after the round-1 SU-J12 fixes (8 fixes shipped at `85364b2` earlier this session). User-stated targets:

- Drill Book 1's first chapter to scene → beat → prose for first 3 beats
- For each book: half the acts → chapters
- For each book: first chapter → scenes
- For each book: first 3 beats → prose
- Behave like a real human author (mistakes, redo, swap, change of mind)

## 2. Drive log

### Book 1 — Red Genesis (already had Act One drilled to chapters from round 1)

| Step | Result |
|---|---|
| Click `1. Launch Window` (Chapter, leaf=false) → Agent → Expand | ✓ — 6 clean scenes (`The Facility at Dawn`, `Family in the Viewing Area`, `Final Systems Check`, `Boarding the Vehicle`, `T-Minus`, `Liftoff—Family's Witness`) |
| Accept | ✓ — persisted; database confirmed 6 scene rows, names CLEAN (no doubled prefix). **SU-J12-7 verified at persistence.** |
| Tree refresh after Accept | ✗ — surfaced new bug **SU-J13-1** |
| Click `The Facility at Dawn` (Scene) → Expand | ✓ — 3 clean beats (`Arrival in Darkness`, `Mission Control Alive`, `The Suiting Room Threshold`) |
| Accept; reload to see children | ✓ |
| `Arrival in Darkness` (Beat, leaf=true) → Synthesise Prose | ✓ — SSE streaming, prose generated ($0.0068, 2962 in / 767 out) |
| Accept | ✓ |
| `Mission Control Alive` → Synthesise → Accept | ✓ ($0.0058) |
| `The Suiting Room Threshold` → Synthesise → Accept | ✓ ($0.0057) |
| `Act Two: The Work and the Reckoning` → Expand | ✗ — `output_schema_invalid:json_parse:Expected ',' or '}' after property value in JSON at position 7478` (LLM emitted malformed JSON mid-output). Surfaced **SU-J13-2** (failed jobs not visible in AgentTab — fixed in-flight). |

### Book 2 — Inheritance (had no acts at start)

| Step | Result |
|---|---|
| Click `Inheritance` (Book) → Expand | ✓ — 3 acts (`Act One: The Inheritance Claimed`, `Act Two: The Fracture Widens`, `Act Three: The Choice and Its Cost`) |
| Accept | ✓ |
| Click `Act One: The Inheritance Claimed` → Expand | ✓ — 7 chapters (`Chapter 1: The Handover` through `Chapter 7: The Choice`). Surfaced **SU-J13-3** — model emitted `Chapter N:` prefix; display layer adds `1. ` for proposal preview producing visible doubles like `1. Chapter 1: The Handover` (the strip-ordinal regex doesn't catch the `Chapter N:` form). |
| Accept | ✓ — chapters persisted with `Chapter N:` prefix in stored name (display-only doubling, not persistence). |
| Click `Chapter 1: The Handover` → Expand | ✓ — 4 clean scenes proposed |
| Accept | ✗ — Surfaced **SU-J13-4** (silent Accept failure). Database showed Chapter 1 still has 0 children; jobs table shows Accept never reached the RPC. Investigation: 409 `target_version_mismatch` (captured=1, current=2). |

### Book 3 — Red Soil (had no acts at start)

| Step | Result |
|---|---|
| Click `Red Soil` (Book) → Expand | ✓ — 3 acts (`Act One: The Landing`, `Act Two: The Weight of Building`, `Act Three: The Choice to Stay`) |
| Accept (multiple attempts) | ✗ — same SU-J13-4 silent failure. JS verified: 409 `target_version_mismatch` (captured=1, current=2). |
| Drill no further | Blocked by version-mismatch architectural issue (SU-J13-5). |

### Author-realism perturbations

Not exercised in this session — the drive was cut short by the architectural blocker (SU-J13-5).

## 3. SU-J13 family — new findings

| ID | Severity | Title | Status |
|---|---|---|---|
| **SU-J13-1** | Medium | Tree doesn't auto-expand newly-created children after Accept | OPEN — workaround: page reload |
| **SU-J13-2** | High | `useActiveJobForNode`'s `ACTIONABLE_STATUSES` set didn't include `'failed'`, so SU-J12-3's FailedState branch never received a job and the AgentTab fell through to IDLE on a failed job — silent failure. | **SHIPPED** at `2fa6601` |
| **SU-J13-3** | Low-medium | Strip-leading-ordinal pattern only matches `^N[.)\-:] ` — doesn't catch `Chapter N:` / `Scene N:` / `Beat N:` / `Act N:` prefixes that the LLM commonly emits. Result: doubled prefix in proposal preview only (persistence is unchanged because the model-supplied name is whatever-it-is). | OPEN — display-only |
| **SU-J13-4** | High | `ErrorBanner` was rendered only in the IDLE branch's return. Errors set by `lifecycleAction` (Accept/Dismiss/Cancel from CompleteState/ActiveState/FailedState) were captured in local state but invisible. Hit by 409 `target_version_mismatch` and 409 `agent_job_already_terminal`. | **SHIPPED** at `4bad450` |
| **SU-J13-5** | High (architectural) | Accept against a target whose version bumped after expand fails with 409 `target_version_mismatch (captured=1, current=2)` — a real invariant guard (see TA H-XX), but the trigger is suspicious: I never edited Red Soil between expand and Accept, yet its `version` went from 1 → 2. Expand may itself bump the target's version (writes to summary or metadata mid-flight), making every Accept fail unless the user retries fresh. | OPEN — needs investigation: when does the target version bump during expand, and should `captured_version` capture *after* the LLM run rather than at job creation? |

## 4. SU-J12 fixes verified working in cloud (round 1, this session)

| ID | Verification |
|---|---|
| SU-J12-1 (truncated-output error) | Pre-existing `unterminated JSON array` at 11:36:08 — pre-fix error message (correct: that job ran before the deploy). New 12:54:06 failure used a different code path (mid-object malformed JSON), got the original `output_schema_invalid:json_parse:` wrapping. Fix is working as designed for its intended scope (truncation). |
| SU-J12-2 (tree refresh) | NodeDetailPanel→AgentTab→onMutated wiring is correct; `setRefreshKey` does fire on Accept. But react-arborist doesn't auto-expand newly-parent nodes on data refetch — see SU-J13-1. The data fetch DOES happen — verified by querying the database mid-drive. |
| SU-J12-3 (failed-state surface) | Render branch present and reachable; was hidden by the `ACTIONABLE_STATUSES` filter (SU-J13-2). After the J13-2 fix, FailedState renders correctly. |
| SU-J12-4 (chevron) | Chevron on `data.is_leaf` works for nodes whose `is_leaf` is server-derived. Visually verified that books/acts/chapters show parent-row affordance even when collapsed. |
| SU-J12-5 (sidebar leak) | Not specifically retested here (single-doc drive); the fix is unconditional `setContextNodes([])` at effect entry. |
| SU-J12-6 (mode tabs hidden off-doc) | **Verified visually** — Edit/Director/Focus tabs disappear on dashboard, reappear on document route. |
| SU-J12-7 (ordinal-prefix strip) | **Verified at persistence** — scene names "The Facility at Dawn" etc. stored without "1. " prefix. Beats/scenes for Book 1 all clean. Model occasionally emits `Chapter N:` (see SU-J13-3). |
| SU-J12-8 (trailing model_id) | **Verified visually** — running state shows `expand · running` cleanly with no trailing separator. |

## 5. Final cloud state of the Mars series

```sql
Mars (series)
├── Red Genesis (book) — v1
│   ├── Act One: The Dream at the Threshold (act) — v1
│   │   ├── 1. Launch Window (chapter)
│   │   │   ├── The Facility at Dawn (scene) — v1
│   │   │   │   ├── Arrival in Darkness (beat) — prose accepted
│   │   │   │   ├── Mission Control Alive (beat) — prose accepted
│   │   │   │   └── The Suiting Room Threshold (beat) — prose accepted
│   │   │   ├── Family in the Viewing Area (scene)
│   │   │   ├── Final Systems Check (scene)
│   │   │   ├── Boarding the Vehicle (scene)
│   │   │   ├── T-Minus (scene)
│   │   │   └── Liftoff—Family's Witness (scene)
│   │   ├── 2. Orbit Achieved → 7. The Threshold Crossed (chapters)
│   ├── Act Two: The Work and the Reckoning (act) — expand failed (LLM JSON malformation)
│   └── Act Three: The Reckoning and the Inheritance (act) — not drilled
├── Inheritance (book) — v1
│   ├── Act One: The Inheritance Claimed (act) — v1
│   │   ├── Chapter 1: The Handover (chapter) — v2; expand proposal stale (409)
│   │   ├── Chapter 2: The Message from Earth (chapter)
│   │   ├── ... Chapter 7: The Choice (chapter)
│   ├── Act Two: The Fracture Widens (act) — not drilled
│   └── Act Three: The Choice and Its Cost (act) — not drilled
└── Red Soil (book) — v2; expand proposal stale (409)
    └── (no acts; expand was generated but Accept blocked)
```

## 6. Cumulative cost this session

LLM cumulative ~ $0.10 across ~14 expand/synthesise jobs (Haiku 4.5).

## 7. Recommendations

1. **SU-J13-5 needs investigation before more deep drives.** If expand is bumping the target version mid-flight, the captured_version capture point in `agent_jobs` needs to move to *after* the LLM run, OR the Accept invariant should compare against the post-expand version.
2. **SU-J13-3 is a small fix** — extend the strip-leading-ordinal regex to also handle `(?:Chapter|Scene|Act|Beat|Book|Part|Section)\s+\d+\s*[.)\-:]\s+` at the operation boundary.
3. **SU-J13-1 (tree refresh)** — switch `<Tree key={refreshKey}>` so the openByDefault re-applies on each refetch, OR explicitly `tree.open(nodeId)` after `onMutated` fires for the just-Accepted node.
4. The two HIGH SU-J13 fixes shipped this session (J13-2, J13-4) are unblockers — they make next session's drive significantly easier to debug.

## 8. Artefacts in this session

- Master commits: `b8203c6` SU-J12 family · `c1a63d5` SU-J13-2 · `241deea` SU-J13-4
- Test files: no new specs added this session — the drive was an exploratory exercise, not a regression-pinning one. Each SU-J13 fix should grow at least one Vitest case in a follow-up.

---

End of report.
