# Phase 8.5b Sub-phase B.7 — Bundle Slim + Pre-Push Gate — Test Report
## Version 1.0
**Date:** 2026-06-08
**Branch:** `claude/phase8-5b-b7-bundle-slim`
**Verdict:** ✅ **PASS** (four parts shipped; pre-push gate live; bundles measured against tightened budgets)

---

## 0. Executive summary

Sub-phase B.7 ships the bundle-discipline foundation laid out in Tier-A §7 + §8: server-only library quarantine, dynamic imports for route-conditional UI, Lucide audit, and a Husky pre-push budget gate. The slim work + the gate land together so future pushes can't silently regress the bundle past today's baseline.

**Headline result:** the four parts all shipped; the gate is live; full Vitest sweep stays green (1031 passing / 8 baseline failing — zero regressions). The §8 aspirational targets are not yet hit; the gate budgets are set to current measured + headroom so it functions as a regression guard, with the aspirational targets retained as the long-term goal documented in §8.

## 1. The four parts

### Part 1 — `docx` + `epub-gen-memory` quarantined as server-only

`lib/export/docx.ts` and `lib/export/epub.ts` statically import `docx` and `epub-gen-memory` respectively. Phase 8.5 baseline measured a ~41 KB gzipped chunk containing these libraries leaking into client routes.

**Fix:** `next.config.ts` `serverExternalPackages` extended to:

```ts
serverExternalPackages: [
  "@anthropic-ai/sdk",
  "docx",
  "epub-gen-memory",
],
```

**Verification:** `lib/export/*` modules are imported only from `/api/exports/*` server routes (audited via grep). After the config change, both packages are excluded from client bundling and resolved at runtime from `node_modules` in the server process.

### Part 2 — Dynamic imports for route-conditional UI

| Component | Mount site | New import |
|---|---|---|
| `DirectorPanel` | `app/(app)/projects/.../documents/.../_DocumentClient.tsx` | `dynamic(() => import('@/components/director/DirectorPanel').then((m) => m.DirectorPanel), { ssr: false })` |
| `FocusMode` | `components/detail/NodeDetailPanel.tsx` | `nextDynamic(() => import('@/components/focus/FocusMode').then((m) => m.FocusMode), { ssr: false })` |
| `ExportModal` | `components/export/DocumentExportButton.tsx` | `dynamic(() => import('./ExportModal').then((m) => m.ExportModal), { ssr: false })` |

`SchedulerPanel` was a candidate but its only mount site is `/scheduler/page.tsx` — Next.js already gives that page a dedicated route chunk, so dynamic-importing inside the route adds indirection without bundle benefit. Skipped intentionally; documented here so the decision is on record.

The `ExportModal` mount also wraps the modal JSX in `{open ? <ExportModal ... /> : null}` so the dynamic chunk only fetches the first time the user opens the dialog, not on the document page's initial render.

### Part 3 — Lucide icon audit

Searched the codebase for `import \* as ... from 'lucide-react'` patterns (namespace imports prevent tree-shaking). **No matches found.** All 9 files importing from `lucide-react` already use named imports.

Audit table:

| File | Pattern |
|---|---|
| `components/ui/select.tsx` | `import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"` |
| `components/ui/dropdown-menu.tsx` | `import { ChevronRightIcon, CheckIcon } from "lucide-react"` |
| `components/ui/dialog.tsx` | `import { XIcon } from "lucide-react"` |
| `components/ui/command.tsx` | `import { SearchIcon, CheckIcon } from "lucide-react"` |
| `components/detail/NodePicker.tsx` | `import { Check } from 'lucide-react'` |
| `components/detail/NodeDetailPanel.tsx` | `import { Trash2 } from 'lucide-react'` |
| `components/detail/ContextLinker.tsx` | `import { ExternalLink, X } from 'lucide-react'` |
| `components/layout/SidebarContextSection.tsx` | `import { type LucideIcon, ChevronDown, ChevronRight, Plus } from 'lucide-react'` |
| `lib/context/icons.ts` | `import { Building2, GitBranch, Globe, MapPin, Sparkles, User, type LucideIcon } from 'lucide-react'` |

No-op work item in code, but the audit is documented so the convention is on record.

### Part 4 — Husky pre-push budget gate

| Piece | What it does |
|---|---|
| `husky@^9.1.7` (dev dep) | Installed via `npm install --save-dev husky` |
| `prepare` npm script | Runs `husky` on install — sets up `.husky/_/` runtime so hooks fire |
| `.husky/pre-push` | Single-line shell hook: `npm run check-bundle-budget` |
| `scripts/check-bundle-budget.ts` | The check itself (see below) |
| `check-bundle-budget` npm script | `tsx scripts/check-bundle-budget.ts` |

The pre-commit hook that `husky init` creates by default was removed — the gate runs at push time, not commit time, per Tier-A §7.1 ("fires before code leaves the developer's machine").

**The check script logic:**

1. Runs `next build` (FORCE_COLOR=0, NEXT_TELEMETRY_DISABLED=1 for reproducibility)
2. Reads `.next/build-manifest.json` → `rootMainFiles` (chunks loaded on every route)
3. For each watched route, reads `.next/server/app/<route>/page_client-reference-manifest.js`, parses the embedded `globalThis.__RSC_MANIFEST` JSON literal, extracts the `clientModules[*].chunks` union
4. Resolves chunk paths to files in `.next/static/chunks/`, gzip-compresses each (`zlib.gzipSync({ level: 9 })`), sums per route
5. Compares against per-route budget; exits 1 if any exceed

Methodology approximates Next.js's internal "First Load JS" calculation but is computed from the manifest files independently — survives format changes between Next.js versions. A `--skip-build` flag lets the script re-run against the existing `.next/` for faster iteration.

## 2. Bundle measurements (post-B.7)

Measured via `scripts/check-bundle-budget.ts` against the production build:

| Route | Chunks | First Load JS (gzip) | Gate budget | Status |
|---|---|---|---|---|
| `/dashboard` | 13 | **301.1 KB** | 320 KB | ✓ |
| `/projects/[p]/documents/[d]` | 15 | **481.2 KB** | 500 KB | ✓ |

**The §8 aspirational targets are not hit.** The Tier-A spec calls 200 KB for `/dashboard` and 350 KB for the document route as the long-term goal. Today's measured numbers are 100-130 KB over those.

Gap explanation (now documented in Tier-A §8 v1.2 status block):

- **Tiptap + ProseMirror** (~264 KB gzipped) — the rich-text editor stack. Unavoidable on document mode, load-once-per-session. The biggest single chunk. Future tightening: tree-shake Tiptap extensions, audit which marks/nodes are actually used.
- **TanStack + React + Next.js runtime** (~100 KB) — framework foundation, shared across every route.
- **shadcn / Base UI primitives + small per-route component code** — accumulates across components; harder to slim without targeted audits.

The gate budgets are set to current measured + ~15-20 KB headroom so the gate fires on regression — *not* on existing baseline. The aspirational §8 numbers stay as the long-term goal. Tightening the gate is a follow-up; bumping requires an explicit changelog entry.

## 3. Test results

### 3.1 Bundle-budget gate end-to-end

```
$ npm run check-bundle-budget --skip-build

─── Bundle-budget check ──────────────────────────────────────────────

  ✓ /dashboard — 301.1 kB / 320.0 kB budget (13 chunks)
  ✓ /projects/[projectId]/documents/[documentId] — 481.2 kB / 500.0 kB budget (15 chunks)

Bundle-budget check passed.
```

✅ PASS.

### 3.2 Type-check

```
$ npm run type-check
> tsc --noEmit
(no output — exit 0)
```

✅ PASS.

### 3.3 Full Vitest suite

| Metric | Value | Δ vs B.1b |
|---|---|---|
| Test files passing | 114 | unchanged |
| Tests passing | 1031 | unchanged |
| Tests failing | 8 | unchanged (documented baseline only) |
| Tests skipped | 33 | unchanged |

**Zero regressions introduced by B.7.** The three dynamic-import conversions don't break any tests because the SSR-shape and runtime-shape of the components are unchanged — `next/dynamic` is a transparent code-splitting wrapper.

### 3.4 Production build

`next build` exits cleanly. All routes compile. No new TypeScript errors, no new bundle-analyzer warnings.

## 4. Files in this commit

**Configuration:**
- `next.config.ts` — `serverExternalPackages` extended with `docx` + `epub-gen-memory`
- `package.json` — `husky` dev dep + `prepare: husky` + `check-bundle-budget` script
- `.husky/pre-push` — new hook running the budget check
- `.husky/_/` — husky runtime (auto-managed by husky)

**Component dynamic imports:**
- `app/(app)/projects/[projectId]/documents/[documentId]/_DocumentClient.tsx`
- `components/detail/NodeDetailPanel.tsx`
- `components/export/DocumentExportButton.tsx`

**New:**
- `scripts/check-bundle-budget.ts` — the gate's check script
- `docs/stelavox_phase8_5b_b7_test_report_v1_0.md` (this file)

**Modified (spec):**
- `docs/stelavox_document_load_architecture_v1_0.md` — §8 budgets table gains a B.7 status block with measured vs gate-budget vs aspirational targets

## 5. Acceptance criteria

| Criterion | Status |
|---|---|
| docx + epub-gen-memory moved to serverExternalPackages | ✅ |
| DirectorPanel dynamic-imported | ✅ |
| FocusMode dynamic-imported | ✅ |
| ExportModal dynamic-imported (gated on `open === true`) | ✅ |
| Lucide audit (no namespace imports) | ✅ verified clean |
| Husky pre-push hook installed | ✅ |
| Bundle-budget check script functional | ✅ measures + reports + exits non-zero on regression |
| Gate passes on current baseline | ✅ 301 / 320 KB and 481 / 500 KB |
| §8 spec updated with B.7 measured-vs-aspirational status | ✅ |
| Type-check + full Vitest green | ✅ same documented baseline; zero regressions |
| Test Report PASS | ✅ this document |

## 6. Risks + future work

| Risk | Mitigation |
|---|---|
| Developer accidentally pushes a regression | Pre-push gate fires; `git push --no-verify` for emergency, documented as developer responsibility |
| Husky hooks not installing on team checkout | `prepare: husky` script in package.json runs on `npm install` |
| Next.js version bump changes manifest format | Script reads structured JSON from manifests; chunk paths are stable across versions; if breakage occurs, the script reports "could not parse" and exits 2 (warns developer; doesn't block silently) |
| Bundle gradually creeps to gate budget | Acceptable trade-off — gate prevents sudden regressions, not gradual creep. Periodic tightening is future work. |
| Document route dynamic-imports lazy-load Director on mode-tab click | First-time Director switch incurs a fetch + parse for the chunk. Acceptable: trade ~500ms one-time cost for ~50 KB off the document-route first-load. The brief loading state is acceptable UX. |

**Future tightening candidates (post-B.7, not in scope):**
- Tree-shake Tiptap extensions (verify all marks/nodes shipped are actually used)
- Audit shadcn primitives — only some `@/components/ui/*` are used; codebase may ship unused ones
- Split TanStack Devtools out of production bundle (verify `import.meta.env.MODE === 'development'` gate is effective)
- Per-route bundle-analyzer HTML output as a `npm run analyze` convenience script

## 7. Recommendation

**Recommend merge to master.** B.7 closes the Phase 8.5b bundle-discipline scope. The Husky gate goes live on this push; subsequent pushes will exercise it. The aspirational §8 budgets remain the long-term goal, but the post-B.7 baseline + gate are an honest substrate that prevents regression.

Phase 8.5b — Document Load Architecture is fully shipped after this merge. Sub-phases B.1, B.1b, B.2, B.3, B.3b, B.4, B.5, B.5b, B.5c, B.6, B.7 are all merged. Remaining open items (B.3 follow-ups for optimistic autosave, additional Playwright cases) are scoped polish that can land independently.

---

## Changelog

**v1.0 — 2026-06-08** Initial Test Report for sub-phase B.7 (bundle slim + pre-push gate). PASS verdict. Four parts shipped: (1) `docx` + `epub-gen-memory` added to `next.config.ts` `serverExternalPackages` so the Phase 8.5 ~41 KB client leak can't recur; (2) `DirectorPanel`, `FocusMode`, `ExportModal` converted to `next/dynamic` with `ssr: false` so document-route bundles don't ship them eagerly (ExportModal mount additionally gated on `open === true` so the chunk is fetched lazily on first dialog open); (3) Lucide namespace-import audit — all 9 importing files already use named imports, no work needed; (4) Husky 9.1.7 installed + `.husky/pre-push` hook + `scripts/check-bundle-budget.ts` + `check-bundle-budget` npm script. Pre-push gate live; reads `.next/build-manifest.json` + per-route `page_client-reference-manifest.js`, computes gzipped First Load JS per route, compares against gate budgets (`/dashboard` ≤ 320 KB, document route ≤ 500 KB), exits non-zero on regression. Tier-A §8 updated with measured-vs-aspirational status (current 301 KB / 481 KB vs §8 targets 200 KB / 350 KB); gate budgets set as regression guards above current baseline; aspirational §8 numbers retained as long-term goal. Full Vitest sweep: 1031 passing / 8 baseline failing / 33 skipped — zero regressions. Type-check clean. Production build succeeds. Phase 8.5b — Document Load Architecture closes with this merge.
