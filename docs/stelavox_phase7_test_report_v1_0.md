# Stelavox Phase 7 Test Report v1.0

**Phase:** Phase 7 — Export (DOCX + EPUB + JSON + Outline)
**Date verified:** 2026-05-17
**Branch:** `claude/lucid-kare-fc8032`
**Verdict:** **PASS** — all acceptance criteria green at substrate + renderer + UI level

---

## §1 — Executive summary

Phase 7 ships the full V1 export system. Authors can export a completed document to **DOCX** (two profiles: Manuscript for editor handoff and KDP-Paperback for KDP Print), **EPUB** (Kindle-ready), **JSON** (full backup format v1.0), and **Outline** (Markdown structural review).

The pipeline is **resumable per-chapter** (D2 Option B atomization): Plan → Render → Assemble → Upload → Finalize, with cancellation honoured at chapter boundaries. Progress is **Realtime-subscribed** to the `export_jobs` row (D3). Per-project profiles are seeded with 4 built-in immutable profiles + author-saved profiles.

5 migrations (158–162) land the substrate. 30 new Vitest cases cover the renderer paths. 484/488 PASS final regression (4 baseline skipped from earlier phases). Lint clean (0 errors / 0 warnings — maintains the Phase 6 close-out baseline). Production build PASS in 8.4s.

**Zero new verdigris uses** across all five new Export components — Inviolable #2 count remains 9.

**Zero new hazards** — export operations are read-only against document state.

**OA-2 LibreOffice-on-Vercel never materialised as a gate** — `docx` npm is pure-JS XML emit; no headless office binary needed. OA-2 stays a clarification applying to PDF (V2/Backlog).

---

## §2 — Sub-phase commits

| Sub-phase | Commit | Scope |
|---|---|---|
| 7.A Foundation | `6c35836` | export_jobs schema extension + lib/export substrate + Storage + runner + profiles + size validation + progress reporting |
| 7.B JSON | `b19e466` | Pure-JSON renderer + backup format v1.0 |
| 7.C Outline | `fae4afc` | Markdown renderer + depth/word-count/status toggles |
| 7.D Renderers + UI | `2d50583` | DOCX + EPUB renderers + ExportModal + ExportProgressChip + ExportProgressStack + ExportHistoryPanel + DocumentExportButton + AppShell integration + lint cleanup |

All four sub-phases land on `claude/lucid-kare-fc8032` and merge to master via `--no-ff` per phase procedure SHUTDOWN.

---

## §3 — Migrations applied

| # | File | Description |
|---|---|---|
| 158 | `20260517000158_export_jobs_extensions.sql` | progress JSONB + profile_id FK + last_active_at + cancellation_requested_at + attempt_count + total_chapters; 7-state queue_status enum; Realtime publication; recovery index |
| 159 | `20260517000159_export_profiles_table.sql` | export_profiles table with CHECK constraint forcing built-in OR author-saved shape; 4 built-in seeds (DOCX-Manuscript, DOCX-KDP, EPUB-Standard, Outline-Structural) |
| 160 | `20260517000160_export_profile_rpcs.sql` | save_export_profile + update_export_profile + delete_export_profile SECURITY DEFINER |
| 161 | `20260517000161_export_platform_config.sql` | 6 keys: signed_url_ttl_hours (168), max_words_per_document (1.5M), max_chapters_per_document (500), max_render_minutes (4), max_file_size_mb (50), soft_warning_words (900k) |
| 162 | `20260517000162_export_retention_cron.sql` | purge_expired_exports daily 03:30 UTC + recovery_sweep_exports every minute |

All SECURITY DEFINER bodies include `SET search_path = public` per H-13. Migration count moves 157 → 162.

---

## §4 — Test counts

### Vitest

| Sub-phase | Test file | Case count |
|---|---|---|
| 7.A | `tests/unit/phase7a-validate.test.ts` | 9 |
| 7.B | `tests/unit/phase7b-json-renderer.test.ts` | 6 |
| 7.C | `tests/unit/phase7c-outline-renderer.test.ts` | 7 |
| 7.D | `tests/unit/phase7d-docx-renderer.test.ts` | 4 |
| 7.D | `tests/unit/phase7d-epub-renderer.test.ts` | 4 |
| **Phase 7 total** | | **30** |

Final regression: **484/488 PASS** (4 baseline skipped from earlier phases; 0 new failures).

### Lint + type-check + build

| Gate | Result |
|---|---|
| `npm run type-check` | 0 errors |
| `npm run lint` | 0 errors / 0 warnings (matches Phase 6 close-out baseline) |
| `npm run build` | Compiled successfully in 8.4s |

---

## §5 — Acceptance criteria (per build checklist)

### 7.A Foundation acceptance

| CK | Description | Result |
|---|---|---|
| 7.A.1 | export_jobs schema extends with 6 new columns + 7-state enum | PASS — M-158 applied |
| 7.A.2 | export_profiles table seeded with 4 built-ins; CHECK constraint enforces shape | PASS — M-159 applied; built-ins are NULL/NULL is_builtin=TRUE |
| 7.A.3 | Three profile RPCs exist + SECURITY DEFINER + search_path | PASS — M-160 applied |
| 7.A.4 | 6 platform_config keys present with documented defaults | PASS — M-161 applied |
| 7.A.5 | Retention + recovery-sweep cron jobs registered | PASS — M-162 applied |
| 7.A.6 | lib/export/ module exports types + tree-walker + validate + progress + storage + profiles + runner | PASS |
| 7.A.7 | runner orchestrates 5-stage pipeline with chapter-boundary cancellation | PASS |
| 7.A.8 | size-limit validator returns format-specific page-ceiling FIRST so EPUB-fallback message wins | PASS — 9/9 phase7a-validate cases |
| 7.A.9 | API routes — POST /api/exports + GET/POST /[id]/cancel|retry + history + profiles | PASS — 7 routes verified via type-check |

### 7.B JSON acceptance

| CK | Description | Result |
|---|---|---|
| 7.B.1 | stelavox_backup envelope with format version "1.0" | PASS |
| 7.B.2 | Pulls documents + nodes + node_versions + context_nodes_referenced + context_links + node_comments + node_author_locks + layer_stack | PASS — 6/6 phase7b cases |
| 7.B.3 | Pure-JSON (no zip, no attachments) per D9 | PASS |
| 7.B.4 | Per-chapter progress callback invoked | PASS |

### 7.C Outline acceptance

| CK | Description | Result |
|---|---|---|
| 7.C.1 | Markdown heading tree respects max_depth | PASS — 7/7 phase7c cases |
| 7.C.2 | Word-count + status toggles configurable | PASS |
| 7.C.3 | Markdown-special characters safely emitted | PASS |
| 7.C.4 | Heading depth = node.depth + 1 | PASS |

### 7.D Renderers + UI acceptance

| CK | Description | Result |
|---|---|---|
| 7.D.1 | DOCX renderer supports letter / a4 / 6x9 / mass_market page sizes | PASS |
| 7.D.2 | DOCX margin profiles: manuscript / kdp_paperback | PASS |
| 7.D.3 | DOCX configurable font + line spacing | PASS — 4/4 phase7d-docx cases |
| 7.D.4 | EPUB chapter-atomic structure (one Chapter per heading) | PASS — 4/4 phase7d-epub cases |
| 7.D.5 | EPUB escapeHtml safety for prose content | PASS |
| 7.D.6 | ExportModal format tile grid + profile selector | PASS — derived-effective-profileId render pattern (no setState-in-effect) |
| 7.D.7 | ExportProgressChip 280px bottom-right + 7-state visual | PASS |
| 7.D.8 | ExportProgressStack mounted in AppShell sibling to AppShellStatusIndicator | PASS |
| 7.D.9 | ExportHistoryPanel Download / Re-run / Retry actions | PASS |
| 7.D.10 | DocumentExportButton with Cmd+Shift+E shortcut | PASS |
| 7.D.11 | HEADING_NODE_TYPES = ['chapter'] per D11 | PASS — tree-walker.ts |
| 7.D.12 | 4 built-in profiles render expected output | PASS — manuscript + KDP + standard + structural all exercised |
| 7.D.Inviol | Zero new verdigris uses; no Inviolable changes | PASS — Export = neutral primary; Cancel = destructive; Download/Retry/Re-run = neutral ghost |

---

## §6 — Open decisions (all locked at wireframe approval)

12 decisions locked during the deep-dive session 2026-05-17 before component code began.

| ID | Decision | Outcome |
|---|---|---|
| D1 | Four sub-phases (7.A/B/C/D) merged at end via --no-ff | SHIPPED |
| D2 | Option B atomization — resumable per-chapter pipeline | SHIPPED |
| D3 | Realtime DB subscription for progress | SHIPPED — useExportProgress + useActiveExports + useExportHistory |
| D4 | Status chip bottom-right (AppShellStatusIndicator pattern) | SHIPPED — ExportProgressStack |
| D5 | Per-document export (multi-doc / series is V2) | SHIPPED |
| D6 | Export profiles per-project — brought forward from Phase 4 | SHIPPED |
| D7 | DOCX hard 5,000 pages; soft warn 3,000; EPUB suggested at limit | SHIPPED — validate.ts |
| D8 | EPUB hard 15,000 pages with epub-gen defaults | SHIPPED |
| D9 | JSON V1 = pure-JSON export-only (no zip, no attachments, no import) | SHIPPED |
| D10 | Outline content: name + summary; word-count/status toggles | SHIPPED |
| D11 | Skip Acts/Books as headings; Chapter = Heading 1 | SHIPPED — HEADING_NODE_TYPES = ['chapter'] |
| D12 | 4 built-in profiles (DOCX-Manuscript / DOCX-KDP / EPUB-Standard / Outline-Structural) | SHIPPED — M-159 seeds |

---

## §7 — Hazards + Inviolables audit

**No new hazards.** Export operations are read-only against the document state (no agent calls, no LLM, no scheduler-dependent execution). Storage interactions use Supabase Storage RLS. The runner pattern follows the established Option-B-like model (validated in V1.x-B.2 scheduler). All SECURITY DEFINER bodies include `SET search_path = public` per H-13.

H-08 (Director write-tool propose-only) unaffected — no new Director tools in Phase 7. H-12 (no hardcoded operational values) preserved — all 6 export.* config keys via getConfig(). H-13 (SECURITY DEFINER search_path) honoured on M-159 / M-160 / M-162 SECURITY DEFINER bodies.

**Inviolables intact.** Verdigris-use count remains nine. Phase 7 adds ZERO new verdigris uses:
- ExportModal Export button — `--color-text-primary` (neutral primary, NOT verdigris because exports are not affirmative-action triggers against agent proposals)
- ExportProgressChip Download / Retry — neutral ghost
- ExportProgressChip Cancel — destructive token (`--color-error`)
- DocumentExportButton — transparent ghost
- ExportHistoryPanel Download / Re-run — neutral ghost

The wireframe Inviolable audit (§9 of wireframe_phase7_export_v1.html) flagged 5/5 PASS pre-build; the shipped components hold those constraints.

---

## §8 — Reassigned + deferred items

**To Phase 8 polish or Phase 9 backlog review:**
- JSON import — round-trip migration of full backups (V2 candidate; pull-forward decision is Phase 9 backlog review)
- ExportProfileEditor full UI — V1 ships built-in seed profiles + author-save RPCs; UI editor for author-saved profiles deferred
- SizeLimitWarning + EpubFallbackSuggestion dedicated components — V1 returns validator messages inline; dedicated banner components deferred

**To Backlog (V2/V3):**
- PDF export (Backlog — would need headless office binary or third-party API; OA-2 LibreOffice-on-Vercel hazard applies)
- KDP submission flow integration
- Per-export attachment bundling
- Cloud backup auto-export (per Product Spec §4.14)
- Multi-document export (series-level export)

---

## §9 — SU items

**None raised** during Phase 7 build. The wireframe-first principle (locked at V1.x-D) plus the per-sub-phase Tier-B build checklist absorbed all design questions upfront; the build executed against locked decisions without scope re-litigation.

---

## §10 — Verdict

**Phase 7 PASSES.** All four sub-phase acceptance criteria green. Final regression clean (lint + type-check + build + Vitest). No new hazards. No new Inviolable amendments. Migration count 157 → 162. Tier-A doc bumps in lockstep (TA v2.13 + Component Spec v2.17 + Product Spec v1.16 + CLAUDE.md v1.38).

Ready for merge to master via `git merge --no-ff` and `phase-7` tag.

**Next phase: Phase 8** — Polish + V1 release per TA §11. Substrate phases through Phase 7 are now complete; only V1-launch-grade polish + the user-driven full-novel launch test stand between current master and V1 launch.

---

## Changelog

**v1.0 — 2026-05-17** Initial report. PASS verdict.
