# Stelavox Phase 7 Build Checklist v1.0

**Phase:** Phase 7 — Export (DOCX + EPUB + JSON + Outline)
**Date kickoff:** 2026-05-17
**Branch:** `claude/lucid-kare-fc8032` (existing worktree, continued from Phase 6)
**Wireframe:** [wireframe_phase7_export_v1.html](wireframes/wireframe_phase7_export_v1.html) — approved 2026-05-17

**Sub-phasing (locked at kickoff):** four sub-phases on one branch, merged to master via `--no-ff` at end of 7.D.

- **7.A Foundation** — substrate (schema, runner, storage, profiles, validation, progress UI substrate)
- **7.B JSON** — pure-JSON renderer
- **7.C Outline** — Markdown renderer
- **7.D Renderers** — DOCX + EPUB renderers + full UI

**Migration count expected:** 157 → ~162.

---

## §1 — Locked decisions (no re-litigation during build)

12 decisions locked during deep-dive session 2026-05-17. Wireframe captures them. Quick reference:

| ID | Decision |
|---|---|
| D1 | Four sub-phases (7.A/B/C/D) merged at end via --no-ff |
| D2 | Option B atomization — resumable per-chapter pipeline |
| D3 | Realtime DB subscription for progress |
| D4 | Status chip bottom-right (AppShellStatusIndicator pattern) |
| D5 | Per-document export (multi-doc / series is V2) |
| D6 | Export profiles per-project — brought forward from Phase 4 |
| D7 | DOCX hard 5,000 pages; soft warn 3,000; EPUB suggested at limit |
| D8 | EPUB hard 15,000 pages with epub-gen defaults |
| D9 | JSON V1 = pure-JSON export-only (no zip, no attachments, no import) |
| D10 | Outline content: name + summary; word-count/status toggles |
| D11 | Skip Acts/Books as headings; Chapter = Heading 1 |
| D12 | 4 built-in profiles (DOCX-Manuscript / DOCX-KDP / EPUB-Standard / Outline-Structural) |

---

## §2 — Sub-phase 7.A Foundation

### Migrations

**M-158 `export_jobs_extensions.sql`**
- ALTER TABLE export_jobs ADD COLUMN progress JSONB NOT NULL DEFAULT '{}'::jsonb
- ALTER TABLE export_jobs ADD COLUMN profile_id UUID (FK to export_profiles, ON DELETE SET NULL — nullable so historical rows survive profile deletion)
- ALTER TABLE export_jobs ADD COLUMN last_active_at TIMESTAMPTZ
- ALTER TABLE export_jobs ADD COLUMN cancellation_requested_at TIMESTAMPTZ
- ALTER TABLE export_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1
- ALTER TABLE export_jobs ADD COLUMN total_chapters INTEGER (computed at plan stage)
- Extend status CHECK to include 'queued', 'planning', 'rendering', 'assembling', 'uploading', 'cancelled', 'cancellation_requested'
- Add idx_export_jobs_active_runner partial index on (status, last_active_at) WHERE status IN ('queued','planning','rendering','assembling','uploading')
- Realtime publication

**M-159 `export_profiles_table.sql`**
- CREATE TABLE export_profiles (id PK, organisation_id FK, project_id UUID NULL — NULL for built-in, name TEXT, format TEXT CHECK in formats, config JSONB, is_builtin BOOLEAN, created_by_user_id UUID NULL, created_at, updated_at)
- RLS: org members read; insert/update/delete via SECURITY DEFINER RPCs only for author-saved; built-in immutable
- 4 built-in profile seed rows: DOCX-Manuscript, DOCX-KDP, EPUB-Standard, Outline-Structural (organisation_id=NULL, project_id=NULL, is_builtin=TRUE)

**M-160 `export_profile_rpcs.sql`**
- save_export_profile(p_project_id, p_name, p_format, p_config) SECURITY DEFINER — author insert; membership check
- update_export_profile(p_id, p_name, p_config) — locker membership check; refuses if is_builtin=TRUE
- delete_export_profile(p_id) — same checks
- All include SET search_path = public

**M-161 `export_platform_config_keys.sql`**
- export.signed_url_ttl_hours (default 168 = 7 days)
- export.max_words_per_document (default 1,500,000 — ~5,000 pages DOCX)
- export.max_chapters_per_document (default 500)
- export.max_render_minutes (default 4)
- export.max_file_size_mb (default 50)
- export.soft_warning_words (default 900,000 — ~3,000 pages)

**M-162 `export_retention_cron.sql`**
- purge_expired_exports() SECURITY DEFINER — daily 03:30 UTC pg_cron — DELETE export_jobs WHERE signed_url_expires_at < NOW() AND status='completed'; also remove from Supabase Storage
- recovery_sweep_exports() SECURITY DEFINER — every 60 seconds pg_cron — mark export_jobs.status='failed' with error_message='runner_timeout' where status IN ('rendering','assembling','uploading') AND last_active_at < NOW() - INTERVAL '5 minutes'

### Library (lib/export/)

- `types.ts` — ContentBlock interface (TA §9.1); ExportFormat enum ('docx'|'epub'|'json'|'outline'); ProfileConfig type per format; ProgressShape type
- `tree-walker.ts` — `walkDocument(documentId)` returns `ContentBlock[]`; respects export_include / export_page_break_before / export_heading_override; handles layer-skipping (Acts/Books default-skip per D11)
- `runner.ts` — main entry point `runExportJob(exportJobId)`; phased pipeline (plan → render → assemble → upload → finalize); cancellation check between stages; updates progress JSONB at each stage; idempotent / resumable across function-call boundaries
- `storage.ts` — Supabase Storage helpers (`uploadExportFile`, `generateSignedUrl`, `deleteExportFile`)
- `validate.ts` — pre-validation: count chapters, estimate output size, check against platform_config limits; returns validation result
- `progress.ts` — helpers for updating export_jobs.progress JSONB safely
- `profiles.ts` — wrapper functions for save_export_profile, update_export_profile, delete_export_profile RPCs; getBuiltinProfiles helper

### API routes (NEW)

- `POST /api/exports` — body { document_id, format, profile_id?, config? }; INSERT row at status='queued'; waitUntil(runExportJob); return 202 with export_job id
- `GET /api/exports/[id]` — read status (RLS-gated; client subscribes via Realtime instead)
- `POST /api/exports/[id]/cancel` — UPDATE status='cancellation_requested'
- `POST /api/exports/[id]/retry` — INSERT new export_jobs row with same config; attempt_count from prior row + 1
- `GET /api/documents/[id]/exports` — list export history for document
- `GET /api/projects/[id]/export-profiles` — list profiles for project
- `POST /api/projects/[id]/export-profiles` — create new (calls save RPC)
- `PATCH /api/export-profiles/[id]` — update (calls update RPC)
- `DELETE /api/export-profiles/[id]` — delete (calls delete RPC)

### UI substrate (lib/hooks)

- `useExportProgress.ts` — Realtime hook subscribed to export_jobs row by id; returns current progress
- `useExportHistory.ts` — Realtime hook subscribed to export_jobs for a document_id
- `useExportProfiles.ts` — Realtime hook subscribed to export_profiles for a project_id

### Tests

- `tests/unit/phase7a-tree-walker.test.ts` — tree walk respects per-node flags; layer-skip behaviour; empty-document handling
- `tests/unit/phase7a-validate.test.ts` — size limit thresholds; warning vs fail boundaries
- `tests/unit/phase7a-runner-state.test.ts` — phased pipeline state transitions; cancellation; resumption
- `tests/unit/phase7a-profiles.test.ts` — RPC happy paths + is_builtin rejection
- `tests/phase7a/foundation.spec.ts` (Playwright) — end-to-end with stub renderer

### 7.A acceptance

- Type-check 0 errors
- All existing tests pass after schema extension
- New 7.A tests pass
- export_jobs Realtime publication confirmed
- Manual test: trigger fake export, see chip appear and progress through states

---

## §3 — Sub-phase 7.B JSON

### Library

- `lib/export/json.ts` — `renderJson(documentId)`: full-fidelity backup format
  - Reads documents row + layer_stack
  - Reads ALL nodes + node_versions for the document (full version history per D9)
  - Reads context_nodes_referenced (deduplicated)
  - Reads context_links
  - Reads node_comments
  - Reads node_author_locks for this document
  - Excludes: agent_jobs, conversation_messages, briefs, brief_stages, node_locks (Edit Sessions), Stelavox-internal state
  - Emits as `{ "stelavox_backup": { version: "1.0", created_at, organisation_id, document_id, document_name }, "document": {...}, "layer_stack": {...}, "nodes": [...], "node_versions": [...], "context_nodes_referenced": [...], "context_links": [...], "node_comments": [...], "node_author_locks": [...] }`
  - JSON.stringify with 2-space indent
  - NO attachments per D9 — exclude attachments_manifest entirely from format version 1.0

### Tests

- `tests/unit/phase7b-json-renderer.test.ts` — happy path produces parseable JSON; expected top-level keys; node_versions count matches; exclusions verified
- `tests/phase7b/json-export.spec.ts` (Playwright) — end-to-end on Shadow Protocol baseline

### 7.B acceptance

- 0 new typecheck errors
- All 7.A tests still pass
- New 7.B tests pass
- Round-trip-shape: JSON.parse(output) returns expected structure

---

## §4 — Sub-phase 7.C Outline

### Library

- `lib/export/outline.ts` — `renderOutline(documentId, config)`: Markdown structural summary
  - Reads document tree (already walked by 7.A's tree-walker)
  - For each node: heading depth = node.depth + 1 (Book = #, Act = ##, Chapter = ###, ...)
  - Summary as blockquote (`> {summary text}`)
  - Empty-summary nodes: heading only, no blockquote
  - Empty-name AND empty-summary: skip entirely
  - Config-driven:
    - `max_depth: number | null` (default: null = unlimited)
    - `include_word_count_target: boolean` (default: false) — appends `[target: N words]` after heading
    - `include_status: boolean` (default: false) — prefixes `[✓]` for approved
  - NEVER includes: prose, notes, context links, comments, metadata, agent_instruction

### Tests

- `tests/unit/phase7c-outline-renderer.test.ts` — heading depth mapping; blockquote rendering; empty-node handling; config toggles; depth limit
- `tests/phase7c/outline-export.spec.ts` (Playwright) — Shadow Protocol baseline

### 7.C acceptance

- 0 new typecheck errors
- All 7.A + 7.B tests still pass
- New 7.C tests pass

---

## §5 — Sub-phase 7.D Renderers

### Migrations

**M-163 `export_builtin_profiles_v2.sql`** (refines M-159's seeds with the real format-specific config from §02 / §03 of wireframe; allows the seed JSON to be finalised after format specs are concrete)

### Library

- `lib/export/docx.ts` — `renderDocx(documentId, config, onChapterRendered)`:
  - Uses `docx` npm package (Document, Paragraph, Heading, PageBreak, etc.)
  - Builds in chunks: per-chapter render → accumulate Paragraph objects → final Document() build
  - Honours config: page size, margins, font, line spacing, scene separator, chapter heading style, page-break-before, front matter, page numbers, blind mode, TOC
  - Honours per-node flags: export_include, export_heading_override, export_page_break_before
  - Calls onChapterRendered(chapterIndex, chapterName) callback per chapter (for progress)
  - Layer mapping per D11: Chapter = Heading 1; Acts/Books skipped; Scenes/Beats separated by config.scene_separator

- `lib/export/epub.ts` — `renderEpub(documentId, config, onChapterRendered)`:
  - Uses `epub-gen` npm package (or compatible like `epub-gen-memory` for buffer-based output)
  - Per-chapter XHTML generation, accumulated into chapters array
  - Final epub-gen `Epub.promise` build
  - Honours config: body font, paragraph indent, scene separator, chapter style, metadata (title, author, ISBN, description)
  - Per-chapter callback for progress

### Built-in profile seeds (M-163 config JSON)

- **DOCX — Manuscript (editor handoff)**
  ```json
  { "page_size": "letter", "margins": "manuscript", "font": "cambria_12",
    "line_spacing": "double", "scene_separator": "* * *",
    "chapter_heading": "centred_numbered", "page_break_per_chapter": true,
    "include_front_matter": true, "page_numbers": true, "blind_mode": false,
    "include_toc": false }
  ```

- **DOCX — Kindle / KDP (paperback)**
  ```json
  { "page_size": "6x9", "margins": "kdp_paperback", "font": "times_12",
    "line_spacing": "single", "scene_separator": "* * *",
    "chapter_heading": "centred_numbered", "page_break_per_chapter": true,
    "include_front_matter": true, "page_numbers": false, "blind_mode": false,
    "include_toc": false, "first_line_indent_inches": 0.3,
    "paragraph_spacing_pt": 0 }
  ```

- **EPUB — Standard e-reader (Kindle/Kobo/Apple)**
  ```json
  { "body_font": "reader_default", "paragraph_indent": "first_line",
    "scene_separator": "* * *", "chapter_heading": "centred_numbered",
    "include_cover": false }
  ```

- **Outline — Structural overview** (already from M-159; verified)
  ```json
  { "max_depth": null, "include_word_count_target": false,
    "include_status": false }
  ```

### Components (NEW)

- `components/export/ExportModal.tsx` — primary trigger surface (wireframe §01)
  - 4 format tiles
  - Profile selector dropdown
  - Expanding settings panel based on selected format
  - Export button (neutral primary)
  - "+ Save current settings as new profile..." flow
  - "⚙ Manage profiles..." → opens ExportProfileEditor

- `components/export/ExportProgressChip.tsx` — bottom-right status surface (wireframe §05)
  - Subscribes to export_jobs via useExportProgress
  - Renders 6 states (queued / rendering / assembling / ready / failed / cancelled)
  - Cancel button (destructive) when running
  - Download / Retry / Dismiss buttons per state
  - Multi-export stacking

- `components/export/ExportProgressStack.tsx` — container that mounts at AppShellStatusIndicator position; subscribes to in-flight export_jobs for current user; renders one ExportProgressChip per active export

- `components/export/ExportHistoryPanel.tsx` — per-document export history (wireframe §07)
  - Subscribes via useExportHistory
  - Per-row: format icon + profile name + timestamp + status + action (Download / Re-run / Retry)
  - Mounts from "View past exports" link in export modal, or from document settings

- `components/export/ExportProfileEditor.tsx` — manage profiles per project (wireframe §08)
  - Built-in profiles read-only; author-saved editable + deletable
  - "+ New profile" affordance
  - Edit dialog reuses format settings panel

- `components/export/SizeLimitWarning.tsx` — soft warning at 3,000+ pages
- `components/export/EpubFallbackSuggestion.tsx` — hard fail at DOCX limit with EPUB switch button
- `components/export/DocxSettingsPanel.tsx` — DOCX-specific settings (wireframe §02)
- `components/export/EpubSettingsPanel.tsx` — EPUB-specific settings (wireframe §03)
- `components/export/OutlineSettingsPanel.tsx` — Outline-specific settings (wireframe §04)

### Components (modified)

- `components/layout/AppShellStatusIndicator.tsx` (V1.x-B.1.1) — extend to mount ExportProgressStack alongside the existing Director/scheduler indicators
- Document toolbar (where it lives currently) — add Export button that opens ExportModal

### Tests

- `tests/unit/phase7d-docx-renderer.test.ts` — DOCX output structure; config honoured; layer-skipping
- `tests/unit/phase7d-epub-renderer.test.ts` — EPUB validates against epub-validation; config honoured
- `tests/phase7d/export-flow.spec.ts` (Playwright) — end-to-end: trigger modal → select format + profile → export → see progress → download
- `tests/phase7d/profile-editor.spec.ts` (Playwright) — create + edit + delete profile flow
- `tests/phase7d/size-limit.spec.ts` (Playwright) — soft warning + hard fail + EPUB fallback paths

### 7.D acceptance

- 0 new typecheck errors
- All 7.A + 7.B + 7.C tests still pass
- New 7.D tests pass
- Manual smoke: real DOCX export of Shadow Protocol; real EPUB export of Shadow Protocol; visual check both files in Word + an EPUB reader (or KDP preview tool if available)

---

## §6 — Close-out

### Tier-A doc bumps

- **TA v2.12 → v2.13** — §3.5 migration count 157→~162; §3.6 schema (export_profiles + export_jobs extensions); §3.7.4 6 new platform_config keys; §9 Export Pipeline updated for Option B atomization + Realtime progress; §11 Phase 7 row checkpoint MET
- **Component Spec v2.16 → v2.17** — NEW Export* components (Modal, ProgressChip, ProgressStack, HistoryPanel, ProfileEditor, SizeLimitWarning, EpubFallbackSuggestion, format-specific settings panels)
- **Product Spec v1.15 → v1.16** — §4.13 Export System updated (DOCX + EPUB + JSON + Outline V1 with profiles; PDF/Markdown/KDP-as-separate stays V2/V4; §4.14 cloud backup stays V2)
- **CLAUDE.md v1.37 → v1.38** — Phase 7 SHIPPED entry with full detail

### Test Report

- `docs/stelavox_phase7_test_report_v1_0.md` — PASS verdict; per-sub-phase test counts; CK acceptance criteria; SU items raised/closed; hazards (none expected); EPUB / DOCX file manual-smoke results

### Memory

- `project_phase7_shipped.md` — current-state pointer for next session (Phase 8)

### Final regression

- type-check 0 errors
- `npm run test:unit` — all passing
- `npm run lint` — 0 errors, 0 warnings (maintain Phase 6 close-out baseline)
- `npm run build` — Compiled successfully
- Playwright phase7a + phase7b + phase7c + phase7d + V1.x regression — all passing

### Merge

- Merge `claude/lucid-kare-fc8032` to master via `git merge --no-ff`
- Tag `phase-7`

---

## §7 — Hazards + Inviolables

**No new hazards expected.** Export operations are read-only against the document state (no agent calls, no LLM, no scheduler-dependent execution). Storage interactions use Supabase Storage which has its own RLS. The runner pattern follows the established Option-B-like model (validated in V1.x-B.2 scheduler). All SECURITY DEFINER bodies include `SET search_path = public` per H-13.

**Inviolables intact.** Zero new verdigris uses per wireframe Inviolable audit (5/5 PASS). Export modal primary action, status chip Download/Retry, profile-editor Save — all use `--color-text-primary` neutral primary. Cancel + Delete use destructive token. Verdigris-use count remains 9.
