# DR-042 — Export Format Lineup Rework · Tier-B Design Note v1.0

**Status:** design, pre-build. Wireframe: `docs/wireframes/wireframe_export_format_lineup_v1.html`.
**Source decision:** V1 Deliverables Register v3.4 (DR-042 rescope, DR-036 re-home), locked 2026-06-13.
**Build phase:** Phase 10 (export-hardening pass). Wireframe-first — this note + the wireframe are reviewed before any component code.

---

## 1. Goal

Make per-book the primary export model for publishing formats, give every author a guaranteed open-format escape hatch, and remove the JSON half-feature. Net: every produced file is bounded by a single book, so the export size/limit problem dissolves by construction rather than by config tuning.

## 2. Locked lineup

| Format | Scope | Role | Disable-able? |
|---|---|---|---|
| **DOCX** | per-book | publishing (editors, KDP print) | yes (hard page limit) |
| **EPUB** | per-book | publishing (e-readers, KDP) | yes (hard page limit, ~3× DOCX) |
| **Markdown manuscript** (NEW) | whole-document | own-your-data / walk-away backstop | **never** — always available |
| **Outline** | whole-document | structural snapshot | no (effectively unbounded) |
| ~~JSON~~ | — | **CUT** → DR-036 (export+import together) | removed from modal + renderer |

## 3. New mechanisms

### 3.1 Subtree-scoped walk
- New nullable column **`export_jobs.root_node_id UUID`** (null = whole document = today's behavior; a Book node id = that book's subtree). Migration: add column, no backfill.
- `lib/export/tree-walker.ts` `walkDocument(...)` gains an optional `rootNodeId`. It already loads all structural nodes for the document and tracks a parent map; add: when `rootNodeId` is set, include a node only if its ancestor chain reaches `rootNodeId` (reuse the existing `ancestorSkipped` traversal, inverted to "ancestor-included"). The Book node becomes the output root.
- `lib/export/json.ts` is **deleted** (see §3.4); `lib/export/outline.ts` does its own walk — give it the same optional `rootNodeId` only if D2 lands per-book outline (default: Outline stays whole-document, no change).

### 3.2 N-job creation (per-book publishing export)
- `POST /api/exports` accepts an optional `book_node_ids: string[]`. When present (DOCX/EPUB + Series), it creates **one `export_jobs` row per id**, each with `root_node_id = <id>`, and returns `{ export_job_ids: string[] }`. When absent, single whole-document job as today (`{ export_job_id }`).
- Each job runs the existing runner unchanged except the walk is subtree-scoped. Progress/cancel/retry/history/signed-URL all reuse Phase 7 + 9.E machinery. `ExportProgressStack` already renders multiple concurrent jobs.
- Filename: `{Series} — {NN} {Book Title}.{ext}` (zero-padded ordinal from the Book node's `order`). Derived at job-creation time and stored on the job so the renderer/upload path uses it verbatim.

### 3.3 Markdown manuscript renderer (NEW)
- `lib/export/markdown.ts` — walk the document (whole-doc), emit headings by layer (`#` Book / `##` Act / `###` Chapter / `####` Scene) + each leaf's **final prose only** (Tiptap → plain markdown paragraphs; reuse the prose-text extraction already used by DOCX). **No version history, no node ids, no metadata.** A built-in `Markdown-Manuscript` profile seeds alongside the existing four (migration in the same batch).
- Bounded by construction (~6 bytes/word); no pagination, memory, or upload concerns.

### 3.4 JSON removal
- Delete `lib/export/json.ts`, the JSON format tile in `ExportModal`, the `json` arm of the runner's format switch, and the JSON built-in profile seed (migration: delete the seed row; leave the `export_jobs.format` CHECK permissive or drop `'json'` from it — confirm no historical rows block the constraint change; if they do, keep the value in the CHECK but remove the UI/renderer).
- This deletes the latent silent-truncation bug (unpaginated `node_versions` read) with it — nothing to fix, the code is gone.

### 3.5 Runtime no-silent-failure (all formats)
- `setProgressFailed` already records a message; route the chip's display of it through the 9.E `classifyFailure` / `FailureBanner` presentation so export failures read consistently with the rest of the app (reason + recovery path), not raw `error_message`.
- If a render fails for a hard, format-specific reason (page limit), the modal drops that format for that document/book on next open (the pre-flight should catch it first; this is the backstop).

### 3.6 Pre-flight (lightweight, now mostly a safety net)
- The modal already can fetch per-document word/chapter counts (`get_document_rollup`); for a Series it has per-book counts (shown in the picker). Use them to disable a publishing tile (or grey a book row) that would hard-fail, with the reason inline. Soft-warn-but-allow for large-but-renderable. Markdown/Outline never disable. The server gate in `validate.ts` stays as defence-in-depth.

## 4. Picker trigger (Decision D1 — confirm)
Show the book picker when **the document has > 1 node at the Book layer** AND the chosen format is per-book (DOCX/EPUB). This follows real structure (covers both the "Series" layer-stack and a Novel doc with multiple Book siblings) rather than keying on `document_type`. Recommended over a strict `document_type = 'series'` check.

## 5. Out of scope / re-homed
- **JSON export + import** → DR-036 (V2+/Backlog), designed together with a versioned backup contract, never the export half alone.
- Per-book **Outline/Markdown** → not in this rework; they stay whole-document (tiny). Revisit only if a real need appears.
- `ExportProfileEditor` UI (DR-041) — separate, unchanged.

## 6. Verification plan
- Subtree walk: unit test that `walkDocument(rootNodeId)` emits only the book's subtree (and the whole doc when null).
- N-job creation: integration test that a Series + 2 book ids creates 2 jobs with correct `root_node_id` + filenames.
- Markdown renderer: unit test (headings by layer; prose only; no ids/history; empty-children safe).
- JSON removal: assert the tile/renderer/route arm are gone; no remaining import of `json.ts`.
- Failure routing: a forced hard-limit render surfaces a classified reason in the chip.
- **Build with a real oversized/series fixture** (register's "verify legibility in the modal" note) — confirm the picker, filename preview, and per-book jobs read correctly end-to-end.

## 7. Decisions — all locked 2026-06-14
- **D1 — picker trigger: LOCKED → node-count.** Show the picker when the document has > 1 node at the Book layer (covers the "Series" stack and a Novel doc with multiple Book siblings); not keyed on `document_type`.
- **D2 — Markdown placement: LOCKED → its own tile.** A distinct format tile, not an "include prose" toggle on Outline.
- **D3 — Series quick-export default: LOCKED → Markdown (whole series).** Quick-export on a Series document produces the always-available Markdown manuscript rather than opening the picker.

No open decisions remain. Wireframe approved 2026-06-14; this note is build-ready for the Phase 10 export pass.

---
**Changelog**
**v1.1 — 2026-06-14** D1/D2/D3 locked at the recommended options; wireframe approved. Note is build-ready.
**v1.0 — 2026-06-13** Initial design note. Accompanies `wireframe_export_format_lineup_v1.html`. Captures the locked DR-042 lineup + three open build-kickoff decisions.
