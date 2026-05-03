# Stelavox — Claude Code Project Context
## Version 1.3

> **Versioning note:** This file is versioned. The version lives here, not in the filename — the filename must remain `CLAUDE.md` for Claude Code to find it automatically. When this file changes, increment the version and add a changelog entry at the bottom. The source of record is `docs/CLAUDE_stelavox_project.md`; the deployed copy at the repository root must always match it. Commit both in the same commit.

## Project Overview

Stelavox is a hierarchical structured writing tool with AI agent assistance. Authors build a tree of nodes (Book → Act → Chapter → Scene → Beat) and AI agents operate at each layer to expand structure, synthesise prose, and refine content. The product is a web application built with Next.js 15, Supabase, and the Anthropic API.

## Session Start Checklist

Read these before writing any code in a new session:

1. `docs/stelavox_wireframe_errata_v1_0.md` — corrections to wireframes (read before any wireframe HTML)
2. The relevant spec section for today's task (see Spec Library Reference below)
3. `docs/stelavox_technical_architecture_v1_4.md` §5 — Known Hazards H-01 to H-14, if today's task touches the database, agents, or Director

---

## Spec Library Reference

All documents live in `/docs`. Before making any change, read the relevant document.

| Change type | Read first |
|---|---|
| Any UI change | `stelavox_component_specification_v2_0.md` |
| Layout, tokens, motion, accessibility | `stelavox_ui_design_specification_v1_0.md` |
| Colour, typography, brand rules | `stelavox_brand_identity_v2_0.md` |
| Database schema, RLS, migrations, agent system, Director, security | `stelavox_technical_architecture_v1_4.md` |
| Product features, user journeys, pricing, data model | `stelavox_product_specification_v1_2.md` |
| Any wireframe | `stelavox_wireframe_errata_v1_0.md` first, then the wireframe HTML |
| Environment setup, deployment | `stelavox_deployment_setup_v1_0.md` |
| Current phase tasks | `stelavox_phase2_build_checklist_v1_0.md` (v1.1 amendment landed mid-Phase-2) |

---

## Development Environment

```
npm run dev          Start development server — http://localhost:3000
npm run build        Production build (run before committing)
npm run lint         ESLint check
npm run type-check   TypeScript type checking
supabase start       Start local Supabase stack (Phase A — Docker Desktop required)
supabase db push     Apply pending migrations to linked project
supabase db reset    Drop and rebuild local database (Phase A only)
supabase db execute --file supabase/seed.sql    Load seed data
supabase gen types typescript --linked > lib/types/database.ts
```

Local URLs: app at `http://localhost:3000`, Studio at `http://localhost:54323` (Phase A only).

Environment file: `.env.local` at repository root. Never committed. See `Deployment & Setup Guide v1.0 §6` for all required variables.

---

## Technology Stack

- Next.js 15 (App Router) + TypeScript
- Supabase — PostgreSQL, Auth, Real-time, Storage, Edge Functions
- Vercel — hosting and deployment
- Tailwind CSS + shadcn/ui
- Tiptap — rich text editors (`SummaryEditor` and `ProseEditor` — separate components with different typefaces)
- react-arborist — node tree with drag-and-drop
- Drizzle ORM — type-safe database queries
- Anthropic native SDK + Vercel AI SDK — always through `lib/llm/` abstraction layer

---

## Project Structure

```
app/
  (auth)/                    Login, signup, email verification pages
  (app)/                     Authenticated app routes
    dashboard/               Project list / home screen
    projects/[projectId]/
      documents/[documentId]/  Document editor (Edit / Director / Focus Mode)
  api/                       API routes — thin auth + validation, delegate to lib/
components/
  brand/           Wordmark, AppIcon — ONLY components using Cinzel or Cormorant Garamond
  layout/          AppShell, Header, Sidebar, ModeTabBar, PanelResizer
  nav/             HeaderBreadcrumb, CommandPalette
  tree/            NodeTree, NodeRow, NodeStatusBadge, AgentActivityIndicator,
                   WorkflowStepIndicator, WordCountBar, LayerDivider
  detail/          NodeDetailPanel, TabStrip, SummaryEditor, ProseEditor,
                   ProseEditorCursor, SelectionTooltip, WordCount, AgentTab,
                   CommentThread, VersionHistory, ContextLinker, MobileNotesSection
  focus/           FocusMode, FocusBreadcrumb, FocusEscHint, TypewriterContainer,
                   SentenceFocus
  director/        DirectorPanel, ConversationThread, UserMessage, DirectorMessage,
                   ThinkingIndicator, PlanCard, ExecutionCard, ResearchCard,
                   DirectorInput
  feedback/        Toast, ToastManager, ProgressBar
  overlay/         Modal, Dropdown, Tooltip
  scheduler/       ScheduleButton, SchedulePicker, ScheduledJobsList
lib/
  config/
    platform-config.ts   getConfig() — reads platform_config table
  llm/
    factory.ts           getProvider() — platform vs BYOK routing
    token-budget.ts      checkTokenBudget() — runs in API route before job creation
    providers/           anthropic.ts (native SDK), vercel.ts (Vercel AI SDK)
  supabase/              client.ts, server.ts, middleware.ts
  security/              injection-scanner.ts, tool-validator.ts, canary.ts
  director/              executor.ts, workflow-executor.ts, tool-definitions.ts
  export/                docx-renderer.ts, epub-renderer.ts
  types/
    database.ts          Generated by Supabase — NEVER edit by hand
styles/
  tokens.css             ALL design tokens — every --color-*, --duration-*, --easing-*
supabase/
  migrations/            SQL files 001-012 — applied in order
  seed.sql               agent_profiles, director_configs, platform_config defaults
```

---

## Architecture Rules

**LLM calls:** Never call the Anthropic SDK or Vercel AI SDK directly from a component or API route. Always use `getProvider()` from `lib/llm/factory.ts`.

**Operational values:** Never hardcode token budgets, prices, model IDs, durations, or limits in TypeScript. All operational values live in the `platform_config` database table and are read via `getConfig(key)` from `lib/config/platform-config.ts`. See Technical Architecture v1.4 §3.7 for the complete key registry.

**Token budget gate:** Always call `checkTokenBudget()` before creating an agent job record. The gate runs in the API route. If the budget check fails, no job record is created. See H-07.

**User content in prompts:** All user-authored content must be escaped with `escapeXml()` and wrapped in `<user_data>` XML tags before reaching any LLM prompt. See Technical Architecture §4.2.

**Canary token:** `injectCanary()` must be called on every system prompt. `scanForCanaryLeak()` must be called on every model response before use. See Technical Architecture §4.4.

**RLS:** API routes never filter by `user_id` directly. They rely on RLS at the database level. Always use the server Supabase client (not the anon client) in API routes.

**Migrations only:** Never modify the database via the Supabase Studio SQL editor. Write a numbered migration file. After every migration, regenerate types: `supabase gen types typescript --linked > lib/types/database.ts`. Never edit `lib/types/database.ts` by hand.

**Director write tools:** Write tools in the Director agentic loop produce `WorkflowStepProposal` objects — they never execute database writes inside the loop. Execution happens only after the author approves the plan. See H-08.

---

## The Five Inviolables

These cannot be overridden by any design decision. A violation is always wrong.

**1. Prose surface is lowest-noise surface.**
`ProseEditor` and `FocusMode` backgrounds are always `--color-bg-base` (#0d1014 dark / #f2ede4 light). Never lighter. Never elevated.

**2. Verdigris appears in exactly nine places.**
`--color-accent` (#3d7858 dark / #254a38 light) appears only in:
1. Wordmark lozenge (`<Wordmark>`)
2. Wordmark rule (`<Wordmark>`)
3. Prose cursor (`<ProseEditor>` / `<FocusMode>`) — `caret-color: var(--color-accent)`
4. Agent-complete status badge (`<NodeStatusBadge>`)
5. Approved status badge (`<NodeStatusBadge>`)
6. Word count at target (`<WordCount>`)
7. Accept button background in Agent Tab
8. Primary plan CTA on trial expiry modal (`<TrialExpiryModal>`)
9. Active node left border in tree (`<NodeRow>`) — 2px left border
Search for `--color-accent`, `#3d7858`, and `#254a38` before any new use. Every match must be one of these nine.

**3. Cinzel appears only in the wordmark.**
Only in `components/brand/Wordmark.tsx` and the S in `components/brand/AppIcon.tsx`. Never elsewhere.

**4. The typeface boundary is absolute.**
`SummaryEditor` uses Inter only. `ProseEditor` uses Lora only. No Inter in the prose editor. No Lora in structural panels or Director messages. The typeface transition is the mode signal.

**5. The prose editor has no visible toolbar.**
Formatting via keyboard shortcuts and `SelectionTooltip` only (Bold · Italic · Link). No toolbar at rest. No heading controls. No visible formatting chrome.

---

## Known Hazards (summary)

Read Technical Architecture v1.4 §5 for the full entries (H-01 to H-14). The most common during active build:

- **H-01** — Use `.maybeSingle()` not `.single()` when zero rows is a valid result
- **H-02** — RLS policies on `organisation_members` must not query `organisation_members`
- **H-03** — Organisation + membership creation must be a single atomic transaction
- **H-04** — Node reordering must update all affected siblings in one transaction
- **H-05** — Always clean up Supabase real-time subscriptions on component unmount
- **H-06** — Extract plain text from Tiptap JSON before including in any LLM prompt
- **H-07** — Token budget gate runs in the API route, before the agent job record is created
- **H-08** — Director write tools never execute inside the agentic loop
- **H-09** — BYOK API key retrieval only in Edge Function memory, never in API routes
- **H-10** — Regenerate `lib/types/database.ts` after every migration, never edit by hand
- **H-11** — Scheduler uses `FOR UPDATE SKIP LOCKED` to prevent duplicate job execution
- **H-12** — No hardcoded operational values in TypeScript — all values via `getConfig()`
- **H-13** — `SECURITY DEFINER` functions must declare `SET search_path = public`
- **H-14** — `documents ↔ layer_stacks` insert order: stack first (NULL doc_id), then document, then UPDATE

---

## Design Token Rules

- Use CSS custom properties from `styles/tokens.css` everywhere.
- Never hardcode hex values in component files. Always `var(--color-*)`.
- The one exception: `styles/tokens.css` itself, where values are defined.
- Active tab underline: `--color-text-primary` at 0.6 opacity — **not** `--color-accent`.
- PanelResizer dragging colour: `--color-border-strong` — **not** `--color-accent`.

---

## Critical Component Specifications

Before implementing or modifying these components, read the exact spec in `docs/stelavox_component_specification_v2_0.md`:

| Component | Spec | Key constraint |
|---|---|---|
| `NodeRow` | §4.2 | 36px height, 16px indent per depth level |
| `SummaryEditor` | §5.3 | Inter 400 13px — **never Lora** |
| `ProseEditor` | §5.4 | Lora 400, 18px Focus Mode / 16px panel, 1.85 line-height |
| `ProseEditorCursor` | §5.5 | 2px verdigris (`--color-accent`), no blink while typing |
| `WordCount` | §5.7 | Opacity 0 while typing, 0.4 after 3s idle, 0.9 on hover |
| `FocusMode` | §6.1 | 280ms expo-out (`--easing-default`), all elements simultaneous |
| `FocusBreadcrumb` | §6.2 | `pointer-events: none` always. Max opacity 0.2 — never higher |
| `PlanCard` | §7.6 | Always fully expanded. Approve button label updates live on checkbox changes |
| `TabStrip` active indicator | §5.2 | `--color-text-primary` at 0.6 opacity — **not** `--color-accent` |
| `PanelResizer` dragging | §2.4 | `--color-border-strong` — **not** `--color-accent` |

---

## Git Workflow

```
main                   ← production (auto-deploys to Vercel on push)
  └── feature/[name]   ← all feature work
  └── fix/[name]       ← bug fixes
```

- Branch from `main` for every change
- Commit messages: imperative mood, under 72 chars ("Add NodeRow hover actions")
- Run `npm run build` before merging — catches TypeScript errors
- Merge to `main` only when the phase checkpoint passes and the Test Report is clean
- Pushing any branch triggers a Vercel preview deployment (Phase B/C)

---

## Document Naming Convention

```
stelavox_[topic]_v[major]_[minor].md
```

Examples: `stelavox_technical_architecture_v1_4.md`, `stelavox_brand_identity_v2_0.md`

Wireframes: `wireframe_[screen]_v[n].html`

Version bumps: minor for additions and corrections, major for structural changes.

---

## Changelog

**v1.3 — 2026-05-04** Updated Spec Library Reference "Current phase tasks" row from the stale `stelavox_phase1_build_checklist_v1.0.md` (Phase 1 reference + v1.0 typo for v1_0) to `stelavox_phase2_build_checklist_v1_0.md`. Build Checklist v1.1 amendment landed mid-Phase-2 (commit `b6e0d05` on master) — corrected §3.2 layout architecture from a 280-grid-with-tree-inside-sidebar arrangement to the spec-canonical 220/flex/380 three-panel structure per Brand Identity §8.2 / Component Spec §2.1. Phase 2 now shipped; Phase 2 Test Report v1.0 records 270/270 Playwright PASS, 136/136 Test Plan cases verified, and PHASE 2 PASSES verdict.

**v1.2 — 2026-05-03** Bumped Technical Architecture reference from v1.3 to v1.4 across the Session Start Checklist, Spec Library Reference table, document-naming examples, and Known Hazards section. Hazards summary expanded from H-01..H-12 to H-01..H-14 (H-13 SECURITY DEFINER search_path; H-14 documents/layer_stacks insert ordering).

**v1.1 — 2026-05-02** Updated Spec Library Reference table and all internal references from `stelavox_technical_architecture_v1_2.md` to `stelavox_technical_architecture_v1_3.md` following the v1.3 correction of the Docker/development-environment specification error.

**v1.0 — 2026-05-01** Initial version. Produced as part of the Stelavox specification refresh (AI-Native Project Specification Standard v1.1 compliance pass). Contains: project overview, session start checklist, spec library reference, development environment, technology stack, project structure, architecture rules, the Five Inviolables, known hazards summary (H-01 to H-12), design token rules, critical component specifications table, git workflow, and document naming convention.

**When to bump this file:**
- New Inviolable added → bump minor, update Five Inviolables section
- New hazard added to Technical Architecture → bump minor, add one-line summary to Known Hazards
- New component with critical constraints → bump minor, add row to Critical Component Specifications table
- Spec document changes version → bump minor, update Spec Library Reference table
- Build phase advances → bump minor, update Session Start Checklist
- Structural reorganisation of this file → bump major
