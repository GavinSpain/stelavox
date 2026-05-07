# Stelavox — Claude Code Project Context
## Version 1.12

> **Versioning note:** This file is versioned. The version lives here, not in the filename — the filename must remain `CLAUDE.md` for Claude Code to find it automatically. When this file changes, increment the version and add a changelog entry at the bottom. The source of record is `docs/CLAUDE_stelavox_project.md`; the deployed copy at the repository root must always match it. Commit both in the same commit.

## Project Overview

Stelavox is a hierarchical structured writing tool with AI agent assistance. Authors build a tree of nodes (Book → Act → Chapter → Scene → Beat) and AI agents operate at each layer to expand structure, synthesise prose, and refine content. The product is a web application built with Next.js 15, Supabase, and the Anthropic API.

## Session Start Checklist

Read these before writing any code in a new session:

1. `docs/stelavox_wireframe_errata_v1_0.md` — corrections to wireframes (read before any wireframe HTML)
2. The relevant spec section for today's task (see Spec Library Reference below)
3. `docs/stelavox_technical_architecture_v2_0.md` §5 — Known Hazards H-01 to H-15, if today's task touches the database, agents, or Director

---

## Spec Library Reference

All documents live in `/docs`. Before making any change, read the relevant document.

| Change type | Read first |
|---|---|
| Any UI change | `stelavox_component_specification_v2_8.md` |
| Layout, tokens, motion, accessibility | `stelavox_ui_design_specification_v1_0.md` |
| Colour, typography, brand rules | `stelavox_brand_identity_v2_0.md` |
| Database schema, RLS, migrations, agent system, Director, security | `stelavox_technical_architecture_v2_0.md` |
| Product features, user journeys, pricing, data model | `stelavox_product_specification_v1_6.md` |
| Agent system prompts | `stelavox_agent_profile_library_v1_0.md` (v1.1 changelog) |
| Any wireframe | `stelavox_wireframe_errata_v1_0.md` first, then the wireframe HTML |
| Environment setup, deployment | `stelavox_deployment_setup_v1_0.md` |
| Current phase tasks | Phase 5b verification-complete on local stack 2026-05-08 — Test Report v1.1 (`stelavox_phase5b_test_report_v1_1.md`) supersedes v1.0. T-17.1 cross-model J5 walkthrough complete (Haiku 4.5 / Sonnet 4.6 / Opus 4.7); T-17.2 adversarial walk on Haiku 10/10 PASS, zero compliances; T-17.3 prompt locked to V1 baseline. T-18.3 cloud smoke deferred to a follow-up session by user direction (Phase 5 cloud connectivity already proven; SU-47 wire-shape neutral). Three substrate fixes applied this session: SU-45 (`streamMessage` `conversation_id: null` → omit), SU-46 (Opus 4.7 temperature deprecation handled), SU-47 (executor refactored to Anthropic's standard messages-array tool-use protocol — transformative cross-model improvement). Director eval methodology v1.0 + j5-novel scenario corpus + automation pipeline (probe runner + comparison wrapper) + functional and Director-turn smokes added. Director architecture deep review queued post-V1 by user direction. Phase 1–5 broader regression: 429/430 PASS (1 pre-existing Character `role` enum drift unrelated, carry-forward). |

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

**Operational values:** Never hardcode token budgets, prices, model IDs, durations, or limits in TypeScript. All operational values live in the `platform_config` database table and are read via `getConfig(key)` from `lib/config/platform-config.ts`. See Technical Architecture v1.5 §3.7 for the complete key registry.

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

Read Technical Architecture v1.9 §5 for the full entries (H-01 to H-15). The most common during active build:

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
- **H-15** — Leaf-ness is a layer-stack property (`node.layer_index === max(layers[*].index)`), never inferred from child count — clients consume server-derived `is_leaf`

---

## Design Token Rules

- Use CSS custom properties from `styles/tokens.css` everywhere.
- Never hardcode hex values in component files. Always `var(--color-*)`.
- The one exception: `styles/tokens.css` itself, where values are defined.
- Active tab underline: `--color-text-primary` at 0.6 opacity — **not** `--color-accent`.
- PanelResizer dragging colour: `--color-border-strong` — **not** `--color-accent`.

---

## Critical Component Specifications

Before implementing or modifying these components, read the exact spec in `docs/stelavox_component_specification_v2_8.md`:

| Component | Spec | Key constraint |
|---|---|---|
| `NodeRow` | §4.2 | 36px height, 16px indent per depth level |
| `SummaryEditor` | §5.3 | Inter 400 13px — **never Lora**. No Link extension. |
| `NotesEditor` | §5.13 | Inter 400 13px — **never Lora**. Sibling of SummaryEditor; Link extension allowed (rationale in §5.13). |
| `ProseEditor` | §5.4 | Lora 400, 18px Focus Mode / 16px panel, 1.85 line-height. **Leaf-only mounting** — renders only when `node.is_leaf === true` (Component Spec v2.5 §5.4 / API Contract v1.1 §2.12 / TA v1.7 H-15) |
| `FocusModeButton` | §5.8 | Inter 400 11px. **Leaf-only mounting** (same rule) |
| `WordCount` | §5.7 | Opacity 0 while typing, 0.4 after 3s idle, 0.9 on hover. **Leaf-only mounting** (same rule as ProseEditor) |
| `ProseEditorCursor` | §5.5 | 2px verdigris (`--color-accent`), no blink while typing |
| `FocusMode` | §6.1 | 280ms expo-out (`--easing-default`), all elements simultaneous |
| `FocusBreadcrumb` | §6.2 | `pointer-events: none` always. Max opacity 0.2 — never higher |
| `AgentTab` | §5.9 | Active state: indeterminate sliding-stripe progress (no percentage); no token count during running. Complete state: `tokens: X in · Y out · Z total · cost $N · model M` summary. Accept button is verdigris use #7 — broadened in v2.8 to include PlanCard Approve under the same use |
| `DirectorPanel` | §7.1 | 580px preferred / 400px min. Mounts in right slot when ModeTabBar is on Director (G-12). ◆ icon is brand identity marker — explicitly NOT subject to nine-use rule |
| `PlanCard` | §7.6 | Always fully expanded — every step visible. Approve button label updates live on checkbox changes ("Approve All" / "Approve N of M"). Approve button background is verdigris use #7 (Component Spec v2.8 §1.4) |
| `ExecutionCard` | §7.7 | Per-step ◌/⟳/✓/✗ glyphs. Heartbeat indicator pulses `--color-agent-running` when fresh (<30s); muted-static when stalled (SU-42 — Component Spec v2.8) |
| `DirectorInput` | §7.9 | Auto-expand 1–5 rows. Enter sends; Shift+Enter newline. `@` opens NodePicker. Disabled-while-streaming: opacity 0.5 + pointer-events:none, placeholder swaps to "Director is working…" |
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

Examples: `stelavox_technical_architecture_v1_5.md`, `stelavox_brand_identity_v2_0.md`

Wireframes: `wireframe_[screen]_v[n].html`

Version bumps: minor for additions and corrections, major for structural changes.

---

## Changelog

**v1.12 — 2026-05-08** Phase 5b verification-complete absorption. The "Current phase tasks" row now flags Phase 5b verification-complete on local stack — Test Report v1.1 supersedes v1.0; T-17.1 cross-model J5 walkthrough done; T-17.2 adversarial 10/10; T-17.3 prompt locked; T-18.3 cloud smoke deferred to a follow-up session. Three new SU items raised and fixed in-session: **SU-45** — `streamMessage` client sent `conversation_id: null` for first messages, hitting 400 from the Zod schema that accepts string-or-omit; fixed by spreading the field conditionally in `lib/director/streamMessage.ts`. **SU-46** — Opus 4.7 (and later) deprecated the `temperature` parameter at the API level, returning 400 `temperature is deprecated for this model`; fixed in `lib/llm/providers/anthropic.ts` with a `modelAcceptsTemperature(modelId)` denylist matching `^claude-opus-4-([7-9]|\d{2,})`. **SU-47** — Director executor was flattening agentic-loop turns to a single user message containing custom XML (`<assistant_partial>`/`<assistant_tool_calls>`/`<tool_results>`) instead of using Anthropic's standard messages-array tool-use protocol; the legacy `buildInitialDynamic` and `buildToolUseContinuation` helpers had inline comments noting this was a "T-9 deferred" V1 simplification that never landed. Fixed by adding provider-neutral `AssembledMessage` / `AssembledContentBlock` types to `lib/llm/types.ts` and refactoring `lib/director/executor.ts` to maintain a real messages array across iterations (appending assistant messages with `text` + `tool_use` content blocks and user messages with `tool_result` content blocks each round). Measured impact: Sonnet 4.6 went from 0 workflows / 38 tool calls / $0.20 cost to consistent 4-step plans / 9 tool calls / $0.14 (input tokens -61%); all three models now identify L1-REPETITION-01 (chapter-opening mirror) and L3-ANTAGONIST-01 (Bracket underweight) — issues that NO model surfaced pre-fix. New deliverables this session: `docs/stelavox_director_eval_methodology_v1_0.md`, `fixtures/director-corpus/j5-novel/` (~7,400-word literary-noir Act 1 with 14 catalogued issues + 8 context nodes + probe registry + baselines ledger), `scripts/seed-director-fixture.ts` + `scripts/run-director-probe.ts` + `scripts/run-director-comparison.ts`, `tests/director/j5-fixture-smoke.spec.ts` + `tests/director/j5-director-turn.spec.ts`, `docs/stelavox_phase5b_test_report_v1_1.md`. Director architecture deep review queued post-V1 (project memory). TA v2.0 / Product Spec v1.6 / Component Spec v2.8 left at current versions for this commit — full Tier-A re-versioning (TA v2.1 / Product Spec v1.7 / CS v2.9) is a separate post-merge follow-up; the Test Report v1.1 carries the canonical record of SU-45/46/47 in the meantime. Five Inviolables unchanged.

**v1.11 — 2026-05-07** Phase 5b close-out absorption (substrate-merged; verification-pending). Spec Library Reference re-pointed at the three cross-cutting specs that bumped: `stelavox_technical_architecture_v2_0.md` (was v1_9 — major bump because Phase 5b is a substantial new subsystem: Director multi-step agentic workflow, 14 new API routes, 8 new components, 13-tool registry, recovery cron, heartbeat protocol), `stelavox_product_specification_v1_6.md` (was v1_5), `stelavox_component_specification_v2_8.md` (was v2_7). Same versions reflected in the Session Start Checklist (TA v2.0 §5) and the Critical Component Specifications table header. Four new rows added to the Critical Component Specifications table: `DirectorPanel` (§7.1 — 580/400 width, G-12 mount), `ExecutionCard` (§7.7 — heartbeat indicator SU-42), `DirectorInput` (§7.9), and the `PlanCard` row updated to v2.8's broadened verdigris use #7 framing. AgentTab row's verdigris-use note updated to reflect v2.8's broadening. The "Current phase tasks" row now flags Phase 5b substrate shipped 2026-05-07 (26/45 active local; 19 deferred pending live-LLM iteration on Haiku 4.5 + Vitest install) with verification-complete as the next-up Phase 5b session. Migration count moved 30 → 31 (Phase 5b added 031). The Hazards summary in this file is unchanged — Phase 5b's SU items SU-37 (absorbed in TA v2.0 §8.3), SU-38 (absorbed in CS v2.8 §1.4), SU-42 (absorbed in CS v2.8 §7.7), SU-43 (migration schema-gap discipline — TA v2.0 changelog), SU-44 (Vitest install — TA v2.0 changelog) are architectural absorptions or process amendments, not invariant-violating hazards. SU-39/40/41 (Vercel Node.js runtime + heartbeats + mid-turn resume) were already absorbed in the Phase 5b v1.1 Tier-B docs. Five Inviolables unchanged (verdigris use #7 broadened, not duplicated; the count remains nine).

**v1.10 — 2026-05-05** Phase 5 close-out absorption. Spec Library Reference re-pointed at the three cross-cutting specs that bumped: `stelavox_technical_architecture_v1_9.md` (was v1_8), `stelavox_product_specification_v1_5.md` (was v1_4), `stelavox_component_specification_v2_7.md` (was v2_6). Library doc reference added as a new row (it was previously implicit). Same versions reflected in the Session Start Checklist (TA v1.9 §5) and the Critical Component Specifications table header. New `AgentTab` row added to the Critical Component Specifications table — references §5.9 and pins the v2.7 active-state spec (indeterminate sliding-stripe progress; no token count during running; completion-only token + cost summary; Accept button is verdigris use #7). The "Current phase tasks" row now flags Phase 5 shipped 2026-05-05 (52/52 active local on Haiku 4.5 + 4/4 cloud smoke on Sonnet 4.6) with Phase 5b (Director) as the next-up Tier-B authoring target. Migration count moved 23 → 30 (Phase 5 added 025–030). The Hazards summary in this file is unchanged — Phase 5's SU items SU-30/31/32/35 are architectural absorptions or spec gaps, not invariant-violating hazards. Five Inviolables unchanged. SU-33 (~100 deferred Phase 5 Playwright cases), SU-24 (agent profile lifecycle V2), SU-25 (Short Story / Series profile coverage) remain queued — Phase 8 / V2 / V1.x candidates respectively. SU-23 (Phase 5b/5c slotting) absorbed in TA v1.9 §11. SU-36 (Test Plan §1.7 Haiku-everywhere alignment) is a follow-up amendment per `feedback_haiku_default.md` user-preference memory.

**v1.9 — 2026-05-04** Phase 4 close-out absorption. Spec Library Reference re-pointed at `stelavox_technical_architecture_v1_8.md` (was v1_7), `stelavox_product_specification_v1_4.md` (was v1_3), `stelavox_component_specification_v2_6.md` (was v2_5). The cross-cutting bumps land together because Phase 4's SU items SU-14..SU-22 split across all three specs: TA v1.8 documents new Migration 024 (`nodes.scope` conditional NOT NULL CHECK constraint promoting the API-layer rule into the database — SU-14); Product Spec v1.4 pins the V1 six-core context-type whitelist slugs in §4.7 (SU-16); Component Spec v2.6 adds the §9.1 Modal scrollable-body sub-rule (SU-19) and the §5.2 TabStrip Context badge spec (SU-20). Phase 2 API Contract gains a retroactive amendment row for the `/move` endpoint's context-source rejection (SU-17) without re-versioning. Migration count moves from 22 to 23 — the Hazards summary in this file does not change (no new H-NN hazards in Phase 4); H-15 still covers leaf-ness which is unchanged. The "Current phase tasks" row now flags Phase 4 shipped (87/87 active local + 4/4 cloud smoke) with Phase 5 (Agent System) as the next-up Tier-B authoring target. Five Inviolables unchanged. SU-15 (V2 metadata_schemas table), SU-21 (32 deferred Phase 4 test cases), and SU-22 (three pre-existing window.prompt sites) remain queued for V2 / Phase 8 absorption respectively. SU-18 (procedure-memory step) is a memory-file update.

**v1.8 — 2026-05-04** Spec Library Reference re-pointed at `stelavox_technical_architecture_v1_7.md` (was v1_6) and `stelavox_component_specification_v2_5.md` (was v2_4). The cross-cutting bumps land together because the Phase 3 v1.5 audit disclosure deferred Sentence Focus + the prose-editor three-dot menu + reduced-motion polish to Phase 8: Component Spec v2.5 carries the deferred banners on §6.4 / §6.5; TA v1.7 §11 Phase 8 row absorbs the work. Phase 3 verdict corrected from 102/102 to 98/98 active (4 cases formally deferred). Critical Component Specifications table reference for ProseEditor updated to v2.5 / v1.7. No new hazards, no Inviolable changes.

**v1.7 — 2026-05-04** Spec Library Reference re-pointed at `stelavox_component_specification_v2_4.md` (was v2_3). Component Spec v2.4 closes a specification gap in §6.1 FocusMode: the original text said *"full-screen overlay mounted above AppShell"* without specifying the React-mechanism. The implementation rendered FocusMode as a JSX descendant of NodeDetailPanel (which lives inside AppShell's `[data-shell="detail"]`), and the entry transition's `opacity: 0` + `transform: translateX(100%)` on the detail panel propagated to the FocusMode child — making the overlay invisible. v2.4 mandates `ReactDOM.createPortal(..., document.body)` so the overlay sits outside the AppShell's transformed subtree. Critical Component Specifications table reference for ProseEditor updated to v2.4. No new hazards, no Inviolable changes, no behaviour changes elsewhere.

**v1.6 — 2026-05-04** Spec Library Reference re-pointed at `stelavox_component_specification_v2_3.md` (was v2_2). Component Spec v2.3 corrects a long-standing specification error in §5.5 ProseEditorCursor: the example code animated `opacity` on the editor element, making the entire prose body fade in and out at the cursor-blink cadence (visible to authors as the *text* blinking). The §5.5 table description was always correct ("cursor blinks; text does not"); only the example code was wrong. v2.3's keyframe animates `caret-color` between verdigris and `transparent`, leaving editor opacity at 1 throughout. No new hazards, no Inviolable changes, no behaviour changes elsewhere.

**v1.5 — 2026-05-04** Post-Phase-3-merge corrective absorption. Spec Library Reference table re-pointed at the two cross-cutting specs that bumped: `stelavox_technical_architecture_v1_6.md` (was v1_5) and `stelavox_component_specification_v2_2.md` (was v2_1). Phase 3 docs (api contract, build checklist, test plan, test report) all bumped internally to v1.1; their filenames stay at the v1_0 form per the Phase 2 precedent. Session Start Checklist points at TA v1.6 §5 covering H-01..H-15 (was H-14). Critical Component Specifications table now annotates ProseEditor / FocusModeButton / WordCount as **leaf-only mounting** per Component Spec v2.2 §5.1; FocusModeButton added as a first-class row. Hazards summary gains **H-15** ("Leaf-ness is a layer-stack property, never inferred from child count — clients consume server-derived `is_leaf`"). Five Inviolables unchanged. Five Inviolables audit during the Phase 3 build flagged Component Spec §5.11's verdigris-tinted current-version star as a deviation from Inviolable #2's nine-uses enumeration; the star ships at `--color-text-primary` pending upstream resolution (SU-7).

**v1.4 — 2026-05-04** Phase 2 close-out absorption. Spec Library Reference table updated to point at the three bumped specs: `stelavox_technical_architecture_v1_5.md` (was v1_4), `stelavox_product_specification_v1_3.md` (was v1_2), `stelavox_component_specification_v2_1.md` (was v2_0). Same versions reflected in the Session Start Checklist, Document Naming Convention examples, and inline references throughout. Critical Component Specifications table: added a `NotesEditor` row pointing at the new Component Spec §5.13 — Notes is now first-class alongside Summary and Prose (Inter 13px; Link extension admitted; sibling of SummaryEditor; no shared base). The Five Inviolables and Hazards summary are unchanged — TA v1.5 added no new hazards (SU-4 added a cross-cutting API convention, not a hazard). All four SU items raised in the Phase 2 Build Checklist §6 are now resolved upstream of Phase 3 Tier-B drafting (SU-1 / SU-3 / SU-4 / SU-6 in TA v1.5; SU-2 in Product Spec v1.3; SU-5 in Component Spec v2.1).

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
