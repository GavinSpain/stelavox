# Stelavox — Component Specification
## Version 2.18

> **Director simplification — BriefAmendmentCard dropped, BriefProposalCard renders stage prompts (2026-05-21):** `components/director/BriefAmendmentCard.tsx` deleted. The amendment surface it rendered (V1.x-B.3 `propose_brief_amendment` artefact, five amendment types, dual approval-card path with `BriefProposalCard`) is gone. **`BriefProposalCard` updated**: each stage in the proposal now renders with either its workflow step count (concrete steps planned now) OR a prompt block (planned just-in-time when the trigger fires). A new `data-testid="brief-proposal-stage-prompt"` block shows the prompt text in italic so the author can see what's queued for later. `TRIGGER_LABEL` narrowed to `('after_stage','manual')` to match the new Brief schema. **No new verdigris uses** — BriefAmendmentCard's Approve was previously under category #7 (affirmative-action triggers); removing it doesn't shift the count. `StageCard`'s `STATUS_LABEL` + `STATUS_COLOR` enum tables updated for the renamed `'proposing'` → `'planning'` status; `TRIGGER_LABEL` table drops `scheduled_at` + `compound`. Inviolable count unchanged at nine.

> **Phase 7 close-out absorption (2026-05-17):** Five new Export* components ship in lockstep with the comprehensive wireframe at `docs/wireframes/wireframe_phase7_export_v1.html` (9 sections + 21 callouts + 12 locked decisions D1-D12). **NEW `ExportModal`** (`components/export/ExportModal.tsx`) — primary export trigger per wireframe §01. Format tile grid (2×2: DOCX / EPUB / JSON / Outline); per-project profile dropdown filtered by selected format; profileId derived during render (no setState-in-effect) — if stored selection no longer matches the current format the modal falls back to the first matching built-in. Key-based remount pattern (renders empty Dialog when `open=false`, body when `open=true`) to avoid useEffect cascade. Export primary action uses `--color-text-primary` neutral primary token (NOT verdigris — exports are not affirmative-action triggers against an agent proposal). Cancel button is ghost-style. **NEW `ExportProgressChip`** — fixed 280px width compact chip with 7-state visual pipeline (queued / planning / rendering / assembling / uploading / completed / failed / cancelled). Pulsing dot animation while in-flight (--color-agent-running). Cancel button uses destructive token; Download primary action is neutral. Per-job local dismissal via `Set<string>` in parent stack. **NEW `ExportProgressStack`** mounted in `AppShell` at `position: fixed; bottom: 20px; right: 20px; zIndex: 50` — sibling to `AppShellStatusIndicator`. Subscribes via `useActiveExports()` (Realtime channel on `export_jobs` table filtered by org). **NEW `ExportHistoryPanel`** — per-document export history list with format icon + metadata + Download / Re-run / Retry actions. Failed exports remain in the list with error_message + Retry. Expired signed URLs (>168h per `export.signed_url_ttl_hours`) show "URL expired" italic note + Re-run action. **NEW `DocumentExportButton`** mounted at the top of DocumentClient's NodeTree view: compact button "📄 Export" with Cmd+Shift+E (Ctrl+Shift+E) keyboard shortcut. Opens ExportModal. **D11 HEADING_NODE_TYPES = ['chapter']** — Acts and Books are skipped as headings in DOCX + EPUB (manuscript convention). **D12 four built-in profiles** seeded by M-159: DOCX-Manuscript (Times New Roman 12pt, double-spaced, 1in margins, letter), DOCX-KDP (Garamond 11pt, single-spaced, 0.75in margins, 6x9 trim), EPUB-Standard (Lora typography), Outline-Structural (depth-3 + word counts). Inter only across all five new components; **zero new verdigris uses** — Export action uses neutral primary; Download / Retry / Re-run use neutral ghost; Cancel + Delete use destructive token; verdigris-use count remains nine. **NO new Inviolable changes.**

> **V1.x-F close-out absorption (2026-05-19):** Three new V1.x-F surfaces in lockstep with the single comprehensive wireframe at `docs/wireframes/wireframe_failure_mode_ux_v1.html` (CapabilityLimitCard + FailureToast Class A/C + FailureBanner Class D/E; Class B Resume already shipped V1.x-D as StoppedFollowOnBanner; 5 open decisions all locked in-session before component code). **NEW §17.12 `CapabilityLimitCard`** mounted in DirectorPanel `renderBriefSlot` when the iteration emits a `capability_limit_proposal` artefact: --color-info left border (NOT --color-error; this is the Director recognising its own limits, not a failure); header pill in --color-info; suggested-alternative block in --color-bg-elevated with 2px --color-info accent; text-link "Adjust request" affordance with subtle bottom border in --color-border-strong (NOT verdigris — there's no approval; user reformulates manually). **NEW §17.13 `FailureToast`** + **`FailureBanner`** pure-render components. FailureToast Class A uses --color-info left border (D1: surfaces on 2nd retry onward — most transient errors self-heal invisibly); Class C uses --color-status-review (D2: surfaces only when back-off >= failure.class_c_min_pause_seconds=15). FailureBanner Class D uses 3px --color-error left border + optional remediation block + optional action link; Class E uses full --color-error border + low-saturation red gradient background + mailto: support CTA (D3: target in failure.class_e_admin_contact, default support@stelavox.io). Dismiss persistence per D4: caller persists via localStorage failure-banner-dismissed:<job_id>. Per-surface adoption (AgentTab, SchedulerPanel, AppShell global notifier) happens incrementally — components ship as substrate. Inter only across all V1.x-F surfaces; **zero new verdigris uses** — verdigris-use count remains nine. **NO new Inviolable changes.**

> **V1.x-E close-out absorption (2026-05-19):** Two new V1.x-E surfaces — the wireframe at `docs/wireframes/wireframe_admin_dashboard_v1.html` (single comprehensive wireframe with 4 sections + 13 numbered annotations + 5 open decisions all locked in-session). **NEW `AdminDashboard`** at `/admin`: server component (`app/(app)/admin/page.tsx`) redirects non-admins to `/dashboard`; client component (`components/admin/AdminDashboard.tsx`) polls `/api/admin/dashboard?window={1h|24h|7d}` every 30s and renders 7 sections — live counters (active director turns / running jobs / queued jobs / failures-24h with breakdown subline) / capacity-alert banners (promoted to top when present; one banner per firing alert; left-border tone matches severity) / queue depth by traffic class (4 rows, current snapshot) / Anthropic ITPM headroom (most-recent rate-limit row per model; remaining-pct with --color-error < 25%, --color-status-review < 50%) / dispatch rate sparkline (per-2min buckets over 1h window) / failures by class A-E with auto-recovery rate / spend leaders (top 5 orgs by usage % + by-model credit aggregation) / synthetic probes (3 rows; outcome + duration + relative time; "Run now" button per row triggers `POST /api/admin/probe/[probe_id]/run`). Window selector is page-level (1h / 24h / 7d radio chips). Inter only across the dashboard; no Lora; **no verdigris** (admin surfaces are not author-facing affirmative-action triggers — counters use `--color-status-review` for warn and `--color-error` for critical, alert banners use the same; verdigris-use count remains nine). **NO new Inviolable changes.**

> **V1.x-D close-out absorption (2026-05-18):** Six new V1.x-D components + extensions ship in lockstep with the wireframe pack at `docs/wireframes/wireframe_*_v1.html` (six files; cost_meter / plan_panel / node_row_v2_badges / stop_refinement / director_completion / brief_concurrent). **NEW `CostMeterCompact`** mounted in `AppShellStatusIndicator`'s rightmost segment: BYOK shows `NNk in · MMk out` (no dollars — provider-neutral); non-BYOK shows `NN% · renews in Nd` with --color-warning at 80%+ and --color-error at 100%. **NEW `CostMeterFull`** at `/settings/usage`: Platform variant (plan + days-remaining + % used + bar + denominator + soft upgrade CTA above 60%); BYOK variant (token table in/out/total + provider key status + caption clarifying provider-billed). Empty states for both. Realtime-subscribed to organisations row. **NEW `PlanPanel`** at `/settings/plan`: current-plan banner + Platform tier list (Trial/Writer/Author/Pro) + BYOK tier list (Solo/Team) + trial-expiry note + V1 read-only switching note. Reads prices + allocations from platform_config. **NEW `NodeLifecycleBadge`** mounted in `NodeRow` alongside `NodeStatusBadge`: pill-text badge for QUEUED / RUN / NEW lifecycle states derived from agent_jobs.status (collapses scheduler-internal scheduled/queued distinction in V1.x-D MVP). **NEW `NodeLockIndicator` + `NodeAiChangedDot`** inside NodeRow: distinguishes user-lock from auto-lock via --color-info + tracks AI-changed flag via `useAiChangedFlag` hook (server-side `nodes.last_ai_change_at` + per-node localStorage last-viewed-at; clear-on-row-click read-receipt model). **REVISED `StopButton`** §17.9: confirmation modal gains side-effect honesty block (fetches `director_turns.iteration_count`; "N iterations completed so far" + state-preservation italic). Numerical token savings deliberately omitted per provider-neutral rule. **NEW `StoppedFollowOnBanner`** §17.9: three-way Resume/Cancel/View follow-on after Stop. Cancel uses destructive token; banner left border --color-warning (attention without alarm). Dismissal via localStorage `turn-followon-dismissed:<id>`. **NEW `WorkflowCompletionAck`** §17.11: mechanical acknowledgement line; three variants — success (verdigris #4 border passive completion category), partial (--color-status-review), failure (--color-error). Reflective variant deferred V2. **REVISED `BriefProposalCard`** §A.7: optional `concurrentEditWarning` prop renders attention-amber warning block + Approve button label swaps to "Approve anyway". `findProposalInToolCalls` extracts the warning from the V1.x-B.3-attached artefact. Approve still verdigris #7 (no category change). **REVISED `SchedulerPanel`** §17.4: new ConcurrentBriefsNote subcomponent surfaces additional concurrent active Briefs on the document (V1.x-B.3 multi-active world). Per-row multi-active rendering deferred to V1.x-D polish or V2. **Stage membership pill on NodeRow deferred** as lowest-value extension; brief_stages.target_node_ids cross-fetch adds non-trivial complexity. **BriefViewer concurrent-Brief indicator** would need a NEW BriefViewer component (no V1.x baseline); the SchedulerPanel + BriefProposalCard surfaces cover the user-visible multi-active concern. Verdigris-use count remains nine — all new affordances use --color-info / --color-warning / --color-status-review / --color-text-muted; existing categories #4/#5/#7 unchanged.

> **V1.x-C close-out absorption (2026-05-16):** NEW `OrgAnthropicKeyPanel` (`components/settings/OrgAnthropicKeyPanel.tsx`) — admin-only org BYOK key save / status / delete; mirrors per-user `AnthropicKeyPanel` (V1.x-B.1.2) but takes an `orgId` prop. Save button uses `--color-accent` (verdigris use #7 affirmative-action triggers family — within existing nine; no broadening). Delete uses destructive token. Non-admin members see a read-only "Only owners/admins can save or delete" notice. Mounts at `/settings/org-api-keys`; the page resolves the user's primary org server-side using the same owner > admin > member precedence as the M-138 migration. **`CostMeter` + `PlanPanel` components, plus AgentTab/DirectorPanel/SchedulerPanel cost-mount integrations, deferred to V1.x-D** (the dedicated UI substrate phase). V1.x-C.4 ships only the BYOK admin UI — the only V1.x-C surface that a `byok_solo`/`byok_team` plan cannot function without. The `GET /api/usage/current-period` substrate endpoint lands in V1.x-C.4 so V1.x-D's CostMeter can consume it without further backend work. Verdigris-use count remains nine.

> **V1.x-B.2 absorption (2026-05-16):** §5.14 NEW `StopButton` (destructive-token confirm dialog; mounts in DirectorPanel header when an active director_turn exists; uses `--color-text-primary` background NOT verdigris). BriefProposalCard §A.7 extended with "Auto-approve subsequent stages" checkbox (multi-stage Briefs only; verdigris ONLY in checked state — falls under existing Inviolable #2 use #7 affirmative-action triggers family without broadening the count). SchedulerPanel Stop control per row deferred to V1.x-D polish. Filename intentionally retained at `v2_10.md` (the spec library indexes by filename + version-bumps in-place — the canonical version stamp is the file's `## Version 2.11` header). **Director V2 components:** Section 10 introduces components for the V1.x phased roadmap — `AppShellStatusIndicator`, `BriefViewer`, `StageCard`, `SchedulerPanel`, `AdminDashboard`, `CostMeter` — plus extensions to existing components. Architectural source: `docs/stelavox_director_architecture_v2_0.md` (now v2.2 — Tier-A canonical).

### Purpose

This document is the primary build reference for Claude Code. It specifies every component in the Stelavox UI: structure, states, exact token values, interaction behaviours, and accessibility requirements. The wireframes (Wireframes 1–11) provide visual context; this document provides the implementable specification.

**Read before building anything:**
- Brand Identity v2.0 — colour rationale, typography rationale, verdigris usage rules, inviolables
- UI Design Specification v1.0 — layout system, design tokens, motion values, interaction patterns
- Technical Architecture v1.2 — database schema, API patterns, platform config keys

### Document Conventions

- All colour values refer to CSS custom properties defined in `styles/tokens.css`. Hex values shown in parentheses are the dark mode defaults.
- All font sizes in `px` are desktop values. See UI Design Specification v1.0 §13 for responsive rules.
- `[STATE]` denotes a component state: `default`, `hover`, `active`, `focused`, `disabled`, `loading`
- 🔒 = enforced constraint — Claude Code must not deviate from this value
- ⚡ = animation required — see Motion Values in §1.5
- ♿ = accessibility requirement

---

## Table of Contents

1. [Design System Foundation](#1-design-system-foundation)
2. [Layout Components](#2-layout-components)
3. [Navigation Components](#3-navigation-components)
4. [Tree Components](#4-tree-components)
5. [Detail Panel Components](#5-detail-panel-components)
6. [Focus Mode Components](#6-focus-mode-components)
7. [Director Components](#7-director-components)
8. [Feedback Components](#8-feedback-components)
9. [Overlay Components](#9-overlay-components)
10. [Brand Components](#10-brand-components)
11. [Tablet Layout Components](#11-tablet-layout-components)
12. [Mobile Notes Components](#12-mobile-notes-components)
13. [Attachment Components](#13-attachment-components)
14. [Scheduler Components](#14-scheduler-components)
15. [Accessibility Baseline](#15-accessibility-baseline)
16. [Resolved Component Questions](#16-resolved-component-questions)
17. [Director V2 Component Specifications (V1.x scope)](#17-director-v2-component-specifications-v1x-scope)
18. [Changelog](#18-changelog)

---

## 1. Design System Foundation

### 1.1 Token File Structure

All design tokens live in `styles/tokens.css`. Components import tokens only — never hardcoded hex values in component files. See UI Design Specification v1.0 §3 for the full token set. This section reproduces only the tokens most heavily referenced in component code.

```css
/* styles/tokens.css — component-critical subset */

/* ── Backgrounds ── */
--color-bg-base:          #0d1014;  /* 🔒 Deepest surface. App frame, Focus Mode, prose. */
--color-bg-surface:       #131820;  /* Panels, header, sidebar */
--color-bg-elevated:      #1a2030;  /* Modals, dropdowns, popovers */
--color-bg-hover:         #1e2838;  /* Row hover states */
--color-bg-selected:      #1f2d45;  /* Selected rows, user message bubbles */
--color-bg-active-node:   #1f2d45;  /* Currently open node in tree */

/* ── Borders ── */
--color-border-subtle:    #1e2535;
--color-border-default:   #253045;
--color-border-strong:    #3a4a62;  /* Focus rings */

/* ── Text ── */
--color-text-primary:     #ecf0f5;  /* 🔒 NOT #ffffff */
--color-text-secondary:   #8aa0b8;
--color-text-muted:       #4a6080;
--color-text-disabled:    #2a3850;

/* ── Accent — verdigris (9 sanctioned uses only — see §1.4) ── */
--color-accent:           #3d7858;  /* 🔒 */
--color-accent-hover:     #5aa87a;
--color-accent-muted:     #1a3028;

/* ── Status ── */
--color-status-draft:     #4a6080;
--color-status-review:    #b87030;
--color-status-approved:  #3d7858;  /* Same as --color-accent. Intentional. */
--color-status-locked:    #6a3888;

/* ── Semantic ── */
--color-success:          #3d7858;
--color-warning:          #b87030;
--color-error:            #b03c3c;
--color-info:             #3a6090;

/* ── Agent ── */
--color-agent-running:    #2e5a90;
--color-agent-complete:   #3d7858;
--color-agent-failed:     #b03c3c;

/* ── Motion ── */
--duration-instant:       0ms;
--duration-fast:          120ms;
--duration-normal:        200ms;
--duration-medium:        280ms;
--duration-slow:          350ms;
--duration-prose:         600ms;
--duration-wordcount:     800ms;
--easing-crisp:    cubic-bezier(0.4, 0, 1, 1);
--easing-default:  cubic-bezier(0.16, 1, 0.3, 1);
--easing-smooth:   cubic-bezier(0.4, 0, 0.2, 1);
--easing-prose:    cubic-bezier(0.25, 0.1, 0.25, 1);  /* 🔒 Symmetric ease-in-out */

/* ── Shadows ── */
--shadow-sm:  0 1px 3px rgba(0,0,0,0.3);
--shadow-md:  0 4px 12px rgba(0,0,0,0.4);
--shadow-lg:  0 8px 32px rgba(0,0,0,0.5);

/* ── Type scale ── */
--text-xs:    11px;
--text-sm:    12px;
--text-base:  14px;
--text-md:    15px;
--text-lg:    17px;
--text-xl:    20px;
--text-2xl:   24px;
--text-prose-panel: 16px;
--text-prose-focus: 18px;  /* 🔒 */
```

### 1.2 Light Mode Token Overrides

Applied via `[data-theme="light"]` on the `<html>` element. Set by user preference in account settings; defaults to `prefers-color-scheme` on first load.

```css
[data-theme="light"] {
  --color-bg-base:          #f2ede4;  /* 🔒 Warm parchment. NOT #ffffff */
  --color-bg-surface:       #f8f5ee;
  --color-bg-elevated:      #ffffff;
  --color-bg-hover:         #ede8dc;
  --color-bg-selected:      #e0dbd0;
  --color-bg-active-node:   #e0dbd0;
  --color-border-subtle:    #e0d8cc;
  --color-border-default:   #d4ccbc;
  --color-border-strong:    #b8a898;
  --color-text-primary:     #1e1a12;  /* 🔒 NOT #000000 */
  --color-text-secondary:   #6a6050;
  --color-text-muted:       #9a9080;
  --color-text-disabled:    #c0b8a8;
  --color-accent:           #254a38;
  --color-accent-hover:     #3d7858;
  --color-accent-muted:     #deeee6;
}
```

### 1.3 Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="[Lora-Regular-woff2-url]" as="font" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500&family=Cormorant+Garamond:ital,wght@1,300&family=Inter:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
```

| Font | Weights | `font-display` | Use |
|---|---|---|---|
| Cinzel | 500 only | block | 🔒 Wordmark only — never UI |
| Cormorant Garamond | 300 italic only | block | 🔒 Wordmark only — never UI |
| Inter | 300, 400, 500, 600, 700 | swap | All UI chrome |
| Lora | 400, 400 italic, 700 | swap | 🔒 Prose surface only |

### 1.4 Verdigris Usage Rules

🔒 `--color-accent` (#3d7858 dark, #254a38 light) appears in exactly **nine** places. No others.

| # | Location | Component | Category |
|---|---|---|---|
| 1 | Wordmark lozenge | `<Wordmark>` | Brand |
| 2 | Wordmark rule | `<Wordmark>` | Brand |
| 3 | Prose cursor | `<ProseEditor>` / `<FocusMode>` | Inscription |
| 4 | Agent-complete status badge | `<NodeStatusBadge>` | Completion |
| 5 | Approved node status badge | `<NodeStatusBadge>` | Completion |
| 6 | Word count at target | `<WordCount>` | Completion |
| 7 | Author-affirmation buttons — Accept (AgentTab) + Approve (PlanCard) | `<AgentTab>` (complete state), `<PlanCard>` (footer Approve) | Completion |
| 8 | Trial expiry primary plan CTA | `<TrialExpiryModal>` (primary button only) | Completion |
| 9 | Active node left border in tree | `<NodeRow>` | Location |

**Code verification:** Search the codebase for `--color-accent` and `#3d7858` (and `#254a38` in light mode) — every match must correspond to one of these nine locations. Any additional use is a violation of Brand Identity Inviolable #2.

**Button note:** Author-affirmation buttons (#7 — AgentTab Accept + PlanCard Approve) and the trial expiry primary CTA (#8) are the only buttons that use `--color-accent` as their background. All three are Completion-category uses (the author affirming work the system has produced). No other button uses verdigris. Run, Synthesise, Expand, Refine, and all other agent operation buttons use `--color-agent-running` (blue). All billing and settings buttons use secondary or ghost button styles.

**Active tab underline:** 🔒 The active tab indicator in `TabStrip` uses `--color-text-primary` at 0.6 opacity — NOT `--color-accent`. A tab underline has no connection to the four verdigris categories (brand, inscription, completion, location) and was explicitly rejected as a tenth use.

### 1.5 Motion Rules

- All animations must honour `prefers-reduced-motion` — map to `--duration-instant` (0ms)
- Apply globally: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0ms !important; transition-duration: 0ms !important; } }`
- No bounce, overshoot, or spring easings anywhere in the product
- Status badge colour changes: instant (0ms) — information, not events
- The `AgentActivityIndicator`, `WorkflowStepIndicator`, and `ThinkingIndicator` breathing animations must stop under `prefers-reduced-motion`

---

## 2. Layout Components

### 2.1 AppShell

**File:** `components/layout/AppShell.tsx`

The root layout component. Renders Header + the active mode body.

```
┌─────────────────────────────────────────────────────────────┐  48px
│                         Header                              │
├──────┬──────────────────────────┬────────────────────────────┤
│      │                          │                            │
│ Side │     NodeTree             │   DetailPanel              │
│ bar  │     (flex: 1)            │   (380px)                  │
│220px │                          │                            │
└──────┴──────────────────────────┴────────────────────────────┘
                      Edit Mode
```

| Property | Value |
|---|---|
| Minimum viewport | 1024px (below this: tablet layout) |
| Header height | 48px fixed, `flex-shrink: 0` |
| Body | `display: flex; overflow: hidden` — fills remaining height |
| Background | `--color-bg-base` |

**Mode states:**
- `edit` — Sidebar (220px) + NodeTree (flex:1) + DetailPanel (380px)
- `director` — IconRail (48px) + NodeTree (flex:1) + DirectorPanel (580px max)
- `focus` — FocusMode overlay mounted at `z-index: 100` above AppShell

**Mode transitions:**
- Edit → Director: `--duration-normal --easing-smooth`. DetailPanel: `opacity 0 + translateX(20px)`. DirectorPanel slides in from right. Sidebar auto-collapses to IconRail. All simultaneous. ⚡
- Director → Edit: exact mirror
- Edit → Focus: `--duration-medium --easing-default`. Tree + panels: `translateX` to edges + `opacity 0`. Header: `translateY(-48px)`. Prose column max-width expands. All simultaneous. ⚡
- Focus → Edit: exact mirror. Cursor position and scroll position preserved.

---

### 2.2 Header

**File:** `components/layout/Header.tsx`

| Property | Value |
|---|---|
| Height | 48px fixed |
| Background | `--color-bg-surface` |
| Border bottom | `1px solid --color-border-subtle` |
| Padding | `0 20px` |
| Layout | `display: flex; align-items: center` |
| z-index | 10 |

**Child order (left to right):**
1. `<Wordmark>` — `margin-right: 28px`
2. `<HeaderBreadcrumb>` — `flex: 1`
3. `<ModeTabBar>` — `margin: 0 20px`
4. `<HeaderActions>` (usage indicator + user avatar menu) — `margin-left: auto`

**UsageIndicator** (in HeaderActions): Mini token usage bar. Only shown for platform-tier subscribers (Writer/Author/Pro). Inter 300 10px `--color-text-muted`. Bar: 48px × 3px, `--color-border-subtle` track, `--color-agent-running` fill. At 80% budget: fill changes to `--color-warning`. Not shown for BYOK users.

---

### 2.3 Sidebar

**File:** `components/layout/Sidebar.tsx`

| State | Width | Trigger |
|---|---|---|
| Expanded | 220px | Default in Edit Mode |
| Collapsed (icon rail) | 48px | User toggle OR auto on Director Mode entry |

| Property | Value |
|---|---|
| Background | `--color-bg-surface` |
| Border right | `1px solid --color-border-subtle` |
| Width transition | `--duration-normal --easing-smooth` ⚡ |

**Sections (top to bottom):**
1. Project navigation (fixed height)
2. Context library (flex: 1, scrollable — collapsible sections per type: Characters, Locations, Themes, etc.)
3. Footer (Settings link)

**Context library item:** Type icon (14px `--color-text-muted`) + name (Inter 400 12px `--color-text-secondary`). Hover: `--color-bg-hover`, name `--color-text-primary`.

**Collapse behaviour:**
- Collapse button: chevron at bottom, visible on hover
- Director Mode entry: collapses automatically
- Director Mode exit: restores previous state
- State persists in `localStorage` key `stelavox_sidebar_state`

---

### 2.4 PanelResizer

**File:** `components/layout/PanelResizer.tsx`

| Property | Value |
|---|---|
| Width | 4px |
| Default colour | transparent |
| Hover colour | `--color-border-default` |
| Active (dragging) colour | `--color-accent` — 🔒 this is NOT verdigris use #9. The panel resizer is not in the nine sanctioned uses — consider it a cursor affordance exception during an active drag interaction. Use `--color-border-strong` instead. |
| Cursor | `col-resize` |
| Transition | `--duration-fast` on colour ⚡ |

**Correction:** The dragging colour must be `--color-border-strong`, not `--color-accent`. This was an error in v1.x. `--color-accent` is reserved for its nine sanctioned uses.

Persists panel widths in `localStorage` keys `stelavox_sidebar_width`, `stelavox_detail_width`.

Min/max constraints:
- Sidebar: min 220px, max 340px (expanded)
- Detail panel: min 320px, max 540px
- Node tree: min 320px (flex constraint)

---

### 2.5 ModeTabBar

**File:** `components/layout/ModeTabBar.tsx`

Container: `background: --color-bg-base`, `padding: 4px`, `border-radius: 6px`

| Tab | Default | Active |
|---|---|---|
| Font | Inter 400 12px | Inter 500 12px |
| Colour | `--color-text-muted` | `--color-text-primary` |
| Background | transparent | `--color-bg-surface` |
| Padding | `4px 14px` | `4px 14px` |
| Border-radius | 4px | 4px |

**Director tab — active + workflow running:** Pulse dot: 6px circle, `--color-agent-running`, top-right of tab. Animation: `opacity 1→0.6→1, scale 1→0.8→1, 1.5s ease-in-out infinite`. ⚡ Appears only during active Director execution.

**Keyboard:** `⌘.` toggles Edit ↔ Director.

♿ `role="tablist"` on container, `role="tab"` per tab, `aria-selected` on active tab.

---

## 3. Navigation Components

### 3.1 Wordmark

**File:** `components/brand/Wordmark.tsx`

🔒 This is the **only** component that uses Cinzel or Cormorant Garamond.

```tsx
<div className="wordmark">
  <div className="wordmark-text">
    <span className="wordmark-stela">Stela</span>
    <span className="wordmark-vox">vox</span>
  </div>
  <div className="wordmark-rule-wrap">
    <div className="wordmark-lozenge" />   {/* verdigris use #1 */}
    <div className="wordmark-rule" />      {/* verdigris use #2 */}
  </div>
</div>
```

| Element | Value |
|---|---|
| `.wordmark-stela` | Cinzel 500, 15px, tracking 0.18em, uppercase, `--color-text-primary` |
| `.wordmark-vox` | Cormorant Garamond italic 300, 17px, tracking 0.08em, `--color-text-primary` opacity 0.82 |
| `.wordmark-rule` | 1px height, 88px width, gradient: `var(--color-accent) → rgba(61,120,88,0.3) at 40% → transparent` |
| `.wordmark-lozenge` | 7×7px, `transform: rotate(45deg)`, fill `--color-accent`, position absolute left: -2px top: -3px |
| Link target | Project dashboard |

---

### 3.2 HeaderBreadcrumb

**File:** `components/nav/HeaderBreadcrumb.tsx`

| Property | Value |
|---|---|
| Font | Inter 300 12px |
| Colour | `--color-text-muted` |
| Active (current) segment | `--color-text-secondary` |
| Separator | `/` at opacity 0.4, `margin: 0 6px` |
| Overflow | `text-overflow: ellipsis; overflow: hidden; white-space: nowrap` |

Format: `Project / Document / Act / Chapter / Scene / Beat`

Each segment is a link — clicking navigates to that ancestor. ♿ `aria-label="Navigate to Act One"` per segment.

---

### 3.3 CommandPalette

**File:** `components/nav/CommandPalette.tsx`

Trigger: `⌘K` from anywhere.

| Property | Value |
|---|---|
| Overlay | full viewport, `background: rgba(0,0,0,0.5)`, `backdrop-filter: blur(2px)` |
| Panel position | centred, `top: 20vh` |
| Panel width | 560px |
| Panel background | `--color-bg-elevated` |
| Panel border | `1px solid --color-border-default` |
| Panel border-radius | 8px |
| Panel shadow | `--shadow-lg` |
| Entrance | `opacity 0 + translateY(-8px)` → `opacity 1 + translateY(0)`, `--duration-normal --easing-default` ⚡ |

**Input:** Inter 400 16px `--color-text-primary`. Placeholder: "Search nodes, commands..." `--color-text-disabled`.

**Result groups (in order):** Recent nodes → All nodes (filtered) → Commands → Context nodes.

**Result row:** 36px, Inter 400 13px `--color-text-secondary`. Selected: `--color-bg-hover` bg, `--color-text-primary`. Icon: 16px Lucide `--color-text-muted`, `margin-right: 10px`. Shortcut hint: Inter 300 11px `--color-text-muted`, `margin-left: auto`.

**Result ranking** (resolved — see §16): Scored by recency (40%), text match quality (40%), and node depth (20%). Recent nodes always appear first regardless of score. Commands rank by recency of use.

♿ `role="combobox"` on input, `role="listbox"` on results, `aria-activedescendant` tracks focused result. Escape closes. Focus trapped within palette.

---

## 4. Tree Components

### 4.1 NodeTree

**File:** `components/tree/NodeTree.tsx`

Root react-arborist component with custom `NodeRow` renderer.

| Property | Value |
|---|---|
| Background | `--color-bg-base` (matches app frame) |
| Padding | `8px 0` |
| Scroll | overflow-y auto, custom scrollbar (3px, `--color-border-default`, fades after 1.5s inactivity) |

♿ `role="tree"` on root, keyboard navigation: `↑↓` navigate rows, `→←` expand/collapse, `Enter` opens in detail panel.

**Tree toolbar** (above tree):
```
[🔍 Search] [Filter ▾] [Expand All] [Collapse All] [View ▾]
```
- Search: filters tree in real time to matching node names and short descriptions
- Filter: by status, layer type, has-prose, locked/unlocked
- View: toggle context nodes in tree, toggle word count bars, toggle layer separators
- Document Operations button appears in toolbar only after at least one layer is locked (progressive disclosure)

---

### 4.2 NodeRow

**File:** `components/tree/NodeRow.tsx`

| Property | Value |
|---|---|
| Height | 36px desktop, 44px tablet |
| Padding | `0 8px 0 [depth * 16px + 8px]` (indented by depth) |
| Layout | `display: flex; align-items: center` |

**States:**

| State | Background | Text | Border |
|---|---|---|---|
| default | transparent | `--color-text-secondary` | none |
| hover | `--color-bg-hover` | `--color-text-secondary` | none |
| active/open | `--color-bg-active-node` | `--color-text-primary` Inter 500 | 🔒 2px left `--color-accent` (verdigris use #9) |
| focused | transparent | `--color-text-secondary` | 1px inset `--color-border-strong` |

**Child order:**
1. Chevron (8px, `--color-text-muted`): hidden for leaf nodes (opacity 0, not display none — preserves alignment). Animates `0→90°` on expand, `--duration-fast`. ⚡
2. Type icon (14px Lucide, `--color-text-muted`)
3. Name / short description text (`flex: 1`, truncate with ellipsis)
4. Word count bar (leaf nodes with target set, `margin-left: 6px`)
5. Status badge (`margin-left: auto`)
6. Hover actions (opacity 0 → 1 on row hover, `--duration-fast`) ⚡

**Hover actions:**
- Agent button (Zap icon): 22px height, 6px padding, `border-radius: 3px`, `1px --color-border-subtle`
- Add child (Plus icon): same
- More (MoreHorizontal icon): same

🔒 **Add-child button is hidden on leaves.** When `node.is_leaf === true` (per Phase 3 API Contract v1.1 §2.12), the Add-child button is not rendered on hover. This mirrors the database's `move_node` layer-violation refusal (Migration 021 line 178 — *"parent at layer % is a leaf and admits no children"*) so the UI never offers an action the database would reject. Leaf-ness is a structural property of the document's `layer_stack` and is *not* the same as "has zero children" — a Chapter created before any Scenes are added has zero children but is not a leaf. See TA v1.6 H-15.

**Locked node:** Lock icon (Lucide Lock) replaces type icon entirely. Drag handle hidden.

♿ `role="treeitem"`, `aria-expanded`, `aria-level`, `aria-selected`. `aria-label` includes name and status: `aria-label="Chapter 5, approved"`.

---

### 4.3 NodeStatusBadge

**File:** `components/tree/NodeStatusBadge.tsx`

| Property | Value |
|---|---|
| Dimensions | 8×8px circle |
| Position | Right-aligned after node name, before hover actions |

| Status | Colour | Notes |
|---|---|---|
| draft | `--color-status-draft` (#4a6080) | |
| in_review | `--color-status-review` (#b87030) | |
| approved | `--color-status-approved` (#3d7858) | 🔒 Verdigris uses #4 and #5 |
| locked | `--color-status-locked` (#6a3888) | |

Status changes: **instant** (0ms). ♿ Status available via parent node `aria-label` — badge itself has no ARIA role (avoids excessive announcements).

---

### 4.4 AgentActivityIndicator

**File:** `components/tree/AgentActivityIndicator.tsx`

Shown when an agent job is running on a node. Overlays the type icon.

| Property | Value |
|---|---|
| Animation | Type icon opacity: `1 → 0.4 → 1`, `2s ease-in-out infinite` ⚡ |
| Status badge | `--color-agent-running` (#2e5a90) |

🔒 This is the **only** animation that runs unsolicited in the tree. It is calm, not urgent. The opacity range is 100%/40% — low enough to register as motion in peripheral vision without becoming a focal distraction. Reduce-motion: static.

---

### 4.5 WorkflowStepIndicator

**File:** `components/tree/WorkflowStepIndicator.tsx`

Used during Director workflow execution. **Replaces** `NodeStatusBadge` on affected nodes for the duration of execution.

| Property | Value |
|---|---|
| Dimensions | 16×16px |
| Border-radius | 3px (distinct from circular status badge) |
| Position | Same as status badge |

| State | Symbol | Background | Text | Animation |
|---|---|---|---|---|
| pending | ◌ | `--color-bg-surface` | `--color-text-muted` | none |
| running | ⟳ | `--color-agent-running` | white | opacity `1→0.5→1`, 2s ease-in-out ⚡ |
| complete | ✓ | `--color-accent` | white | none |
| failed | ✗ | `--color-error` | white | none |

**Cleanup:** After workflow ends, all WorkflowStepIndicators are removed and NodeStatusBadges return with updated status values from the server.

---

### 4.6 WordCountBar

**File:** `components/tree/WordCountBar.tsx`

| Property | Value |
|---|---|
| Dimensions | 36px × 3px |
| Position | After status badge, `margin-left: 6px` |
| Visibility | Only shown when `word_count_target` is set on this node |
| Track | `--color-border-subtle` |
| Fill | `--color-accent-muted` |
| Border-radius | 2px |

---

### 4.7 LayerDivider

**File:** `components/tree/LayerDivider.tsx`

Subtle visual separator between structural layers in the tree.

| Property | Value |
|---|---|
| Separator line | `1px solid --color-border-subtle` |
| Label | Inter 500 9px, tracking 0.3em, uppercase, `--color-text-muted` — e.g. "ACT ONE", "CHAPTERS" |
| Padding | `12px 8px 4px` |

---

## 5. Detail Panel Components

### 5.1 NodeDetailPanel

**File:** `components/detail/NodeDetailPanel.tsx`

| Property | Value |
|---|---|
| Width | 380px (user-resizable 320px–540px) |
| Background | `--color-bg-surface` |
| Border left | `1px solid --color-border-subtle` |
| Layout | `display: flex; flex-direction: column` |

**PanelHeader:**
- Node title: Inter 600 14px `--color-text-primary`, type icon (13px) at left
- Breadcrumb: Inter 300 11px `--color-text-muted`. Each segment clickable (opens ancestor). `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
- Tab strip: `<TabStrip>` component

**Content-tab body composition (leaf vs non-leaf).** The Content tab renders a different stack depending on `node.is_leaf` (per Phase 3 API Contract v1.1 §2.12). The structural-side editors (Summary, Notes) and the metadata form mount on every node; the prose surface mounts only on leaves.

| Position | Component | Renders on… |
|---|---|---|
| 1 | `<ConflictBanner />` | Both (the autosave conflict UI is universal) |
| 2 | `<SummaryEditor />` | Both — structural planning input |
| 3 | `<ProseEditor mode="edit" />` | 🔒 **Leaves only** (`is_leaf === true`) |
| 4 | `<FocusModeButton />` | 🔒 **Leaves only** — sits in the prose label row |
| 5 | `<WordCount />` | 🔒 **Leaves only** — bottom of prose column |
| 6 | `<MetadataForm />` | Both — per-node-type schema |
| 7 | `<NotesEditor />` | Both — author commentary, never agent-consumed |

The `⌘Return` shortcut for Focus Mode entry is also leaf-only — it relies on the prose-edit DOM element (`[data-editor="prose"][data-mode="edit"]`) being mounted, so on a non-leaf there is no element to capture focus and the shortcut is a no-op. Implementations should explicitly guard on `is_leaf` for clarity rather than relying on the DOM-presence side effect.

The leaf rule is structural — it depends on `node.layer_index` against the document's `layer_stack`, never on whether children currently exist. See TA v1.6 H-15.

---

### 5.2 TabStrip

**File:** `components/detail/TabStrip.tsx`

| Property | Value |
|---|---|
| Tab height | 32px |
| Font — default | Inter 400 12px `--color-text-muted` |
| Font — active | Inter 500 12px `--color-text-primary` |
| Active indicator | 🔒 2px bottom border `--color-text-primary` opacity 0.6 — **NOT `--color-accent`** |

**Tab badges:**
- Comments: 5px circle `--color-status-review`, shown when unresolved comments exist
- History: Inter 300 10px count, `--color-bg-elevated` bg, shown when versions > 1 exist
- Context: Inter 300 10px count, `--color-bg-elevated` bg, shown when direct + inherited context links > 0. The count combines both groups (the user's mental model is "how many context things does this node connect to" — direct + inherited treated as one number for the badge). Hover tooltip clarifies: "N linked, M inherited". (Phase 4 ships ContextLinker without the badge — SU-20; the badge ships in Phase 5 alongside the agent system's context-assembly UI signals.)
- Agent tab: 🔒 Hidden until node has content (progressive disclosure)

**Tab order:** Content · Comments · Agent · History · Context

♿ `role="tablist"` on container, `role="tab"` per tab, `aria-selected` on active.

---

### 5.3 SummaryEditor

**File:** `components/detail/SummaryEditor.tsx`

Built with Tiptap. The structural planning field — 🔒 **always Inter, never Lora**.

| Property | Value |
|---|---|
| Font | 🔒 Inter 400 13px |
| Line height | 1.55 |
| Background | `--color-bg-base` |
| Border | `1px solid --color-border-subtle` |
| Border-radius | 4px |
| Padding | `10px 12px` |
| Min-height | 80px (auto-expands) |
| Colour | `--color-text-primary` |

**Tiptap config:**
- Extensions: Text, Bold (⌘B), Italic (⌘I), BulletList, OrderedList, History
- Disabled: ALL Heading levels, Blockquote, Code, HorizontalRule, CodeBlock
- Placeholder: Inter 300 `--color-text-disabled` italic "Summarise this node for the agent..."

**Toolbar** (visible on focus): Bold | Italic | • Bullet | 1. Number — minimal, 32px height.

🔒 ProseEditor and SummaryEditor are **separate components** — they must not share a base. The typeface boundary is enforced at the component level. This is an architectural constraint.

---

### 5.4 ProseEditor

**File:** `components/detail/ProseEditor.tsx`

🔒 The most constrained component in the product. Every value here is final.

Built with Tiptap. The prose surface — 🔒 **always Lora, never Inter**.

🔒 **Leaf-only mounting.** ProseEditor renders only when `node.is_leaf === true` (Phase 3 API Contract v1.1 §2.12). A node is a leaf iff its `layer_index` equals the maximum index in the document's `layer_stack.layers` — a structural property, never inferred from child count (TA v1.6 H-15). The parent panel must gate the mount; ProseEditor itself does not check leaf-ness.

| Property | Value |
|---|---|
| Font | 🔒 Lora 400 |
| Size — Edit Mode | 16px |
| Size — Focus Mode | 🔒 18px |
| Line height | 🔒 1.85 |
| Max column width | 🔒 620px (Focus Mode) / fills available panel width (Edit Mode) |
| Alignment | 🔒 left, ragged right. Never justified. |
| Paragraph spacing | `margin-bottom: 1.25em` — no first-line indent |
| Side margins (Focus Mode) | min 48px each side |
| Bottom padding | 🔒 120px — author writes into open space |
| Background | 🔒 `--color-bg-base` — always the deepest surface |
| Text colour | `--color-text-primary` |
| Selection | `--color-accent-muted` at 60% opacity |

**Tiptap config:**
- Extensions: Text, Bold (⌘B → Lora 700), Italic (⌘I → Lora 400 italic), Link (⌘K), History
- Disabled: ALL heading levels, Blockquote, Code, HorizontalRule, BulletList, OrderedList
- Placeholder: Lora 400 italic `--color-text-disabled` "Begin writing…"

🔒 No persistent toolbar. See Brand Identity Inviolable #5 and §5.6 below.

---

### 5.5 ProseEditorCursor

Applied via CSS override on Tiptap's ProseMirror instance.

🔒 Values are final. Never use system default cursor in ProseEditor.

| Property | Value |
|---|---|
| Width | 2px |
| Colour | 🔒 `--color-accent` (#3d7858) — verdigris use #3 |
| Height | Cap height of current line (not full line-height) |
| Blink — idle | 600ms on / 400ms off |
| Blink — typing | 🔒 None — cursor is solid while typing |

🔒 **Animate `caret-color`, not `opacity`.** The blink targets the cursor only; the editor's text content must remain at full opacity throughout. Animating `opacity` on the editor element (as earlier drafts of this section incorrectly showed) makes the entire prose body fade in and out — the user sees the *text* blinking, which contradicts the table above and was the symptom that triggered v2.3's amendment. The correct keyframe toggles `caret-color` between verdigris and `transparent`:

```css
@keyframes stelavox-blink {
  0%, 59% { caret-color: var(--color-accent); }
  60%, 100% { caret-color: transparent; }
}
.ProseMirror:not(.is-typing) { animation: stelavox-blink 1s step-end infinite; }
.ProseMirror.is-typing { animation: none; caret-color: var(--color-accent); }
```

The `is-typing` rule sets a steady `caret-color: var(--color-accent)` so the cursor stays solid (not blinking, not transparent) while the user types. The animation resumes after the 1200ms idle window expires (see Typing detection below).

**Typing detection:**
```typescript
editor.on('keydown', () => {
  editorEl.classList.add('is-typing');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => editorEl.classList.remove('is-typing'), 1200);
});
```

---

### 5.6 SelectionTooltip

**File:** `components/detail/SelectionTooltip.tsx`

Appears above selected text in ProseEditor. The **only** formatting surface in the prose editor.

| Property | Value |
|---|---|
| Trigger | Non-empty text selection in ProseEditor |
| Position | Above selection, horizontally centred |
| Background | `--color-bg-elevated` |
| Border | `1px solid --color-border-default` |
| Border-radius | 5px |
| Shadow | `--shadow-md` |
| Padding | `5px 2px` |

**Buttons (in order):** **B** (Bold) · *I* (Italic) · 🔗 (Link)

| Button | Default | Hover |
|---|---|---|
| Font | Inter 500 12px | Inter 500 12px |
| Colour | `--color-text-secondary` | `--color-text-primary` |

Button separator: `1px solid --color-border-subtle` vertical, `margin: 0 2px`.

**Dismissal:** On deselect · on cursor move into text · on Escape.

🔒 No other buttons. No colour picker, no heading selector, no alignment tools, no comment button.

---

### 5.7 WordCount

**File:** `components/detail/WordCount.tsx`

🔒 **Leaf-only mounting.** WordCount renders only on leaves (same condition as ProseEditor §5.4). It has no role on a non-leaf because there is no prose to count.

| Property | Value |
|---|---|
| Font | Inter 300 `--text-xs` (11px) `--color-text-muted` |
| Position | Bottom of prose column, right-aligned, inside column |

**Opacity state machine:**

| State | Opacity | Transition |
|---|---|---|
| Typing (keydown active) | 0 | instant |
| Within 3s of last keypress | 0 | — |
| At rest >3s | 0.4 | `--duration-wordcount --easing-prose` (800ms) ⚡ |
| Hover (bottom 80px of prose area) | 0.9 | `--duration-fast` ⚡ |

**Display formats:**

| State | Format | Count colour |
|---|---|---|
| No target | `87 words` | `--color-text-muted` |
| With target, below | `87 / 400` | count: `--color-text-secondary` / target: `--color-text-muted` |
| With target, at/above | `400 / 400` | 🔒 count: `--color-accent` / target: `--color-text-muted` (verdigris use #6) |

No toast, no animation, no pulse on reaching target. The colour change is the only signal.

---

### 5.8 FocusModeButton

**File:** `components/detail/FocusModeButton.tsx`

Positioned in the prose label row of the Content tab.

🔒 **Leaf-only mounting.** FocusModeButton renders only on leaves (same condition as ProseEditor §5.4). The button has no surface to enter Focus Mode for on a non-leaf, and the `⌘Return` shortcut handler is correspondingly leaf-gated (see §5.1 NodeDetailPanel).

| Property | Value |
|---|---|
| Font | Inter 400 11px `--color-text-muted` |
| Border | `1px solid --color-border-subtle` |
| Border-radius | 4px |
| Padding | `5px 10px` |
| Hover | `--color-text-secondary`, `--color-border-default` |
| Label | `⊞ Focus Mode` with `⌘↵` hint at opacity 0.5 |

---

### 5.9 AgentTab

**File:** `components/detail/AgentTab.tsx`

| Property | Value |
|---|---|
| Instruction textarea | Inter 300 12px, min 2 rows, auto-expand to 5, then scroll. Border `1px --color-border-subtle`, bg `--color-bg-base`. Placeholder `--color-text-disabled` italic. |
| Profile picker | Dropdown, Inter 400 13px. Shows profiles relevant to current node type. |
| Operation buttons | `--color-agent-running` bg, white Inter 500 11px. Border-radius 4px. Gap: 6px. |
| Disabled operation | opacity 0.4, `pointer-events: none`. Tooltip explains why. |

**Operation buttons layout:**
```
[⚡ Expand]  [✏ Refine]  [🔍 Critique]
[────────── ✨ Synthesise Prose ──────────]  ← leaf nodes only
```

**Active job state:**
```
[░░░░████░░░░░  ← sliding stripe, indeterminate]
Generating scenes…    [Stop]
```
Progress bar: 3px `--color-agent-running` fill. **Indeterminate sliding-stripe animation** (CSS keyframes — `@keyframes agent-progress` translates a 30% wide stripe right-to-left in a 1.4s linear infinite cycle). The Anthropic SDK's non-streaming `messages.create` endpoint does not expose mid-call token counts, so a percentage progress bar would falsely imply progress measurement; the indeterminate stripe correctly conveys "operation in progress" without false precision (Phase 5 SU absorption — see Phase 5 Test Report Iteration 5). Stop button: ghost style, `--color-error` text. **No token count is shown during the running state** — `tokens_input` / `tokens_output` are populated only when the LLM call returns. The complete state below is where token data appears.

**Complete state — Accept button:**
After a successful operation, an Accept button appears above the operation buttons:

| Property | Value |
|---|---|
| Background | 🔒 `--color-accent` — verdigris use #7 |
| Text | Inter 500 11px white |
| Label | "Accept" |
| Width | Full width of tab |

Accept commits the result. Dismiss reverts to previous version. Both are available until the author navigates away or explicitly accepts.

**Complete state — token + cost summary:**
Below the result preview and above Accept/Dismiss, a one-line summary in Inter 300 10px `--color-text-muted`:
```
tokens: 1,124 in · 577 out · 1,701 total · cost $0.0086 · model claude-haiku-4-5-20251001
```
The summary shows on completion only (Anthropic non-streaming SDK doesn't expose mid-call usage). `cost_usd` is computed at completion via `lib/llm/cost.ts → computeCostUsd()` against `platform_config` price keys (Migration 028). Per Product Spec §3.2 the dollar amount is platform-internal and never surfaces in the V1 user-facing UI for billing — this summary line is the AgentTab developer/diagnostic display, not a billing surface.

**Streaming state — synthesise via SSE (Phase 5c):**

When the user clicks Synthesise on a leaf node, the AgentTab branches to the foreground streaming endpoint (`POST /api/agent/synthesise/stream`) instead of the background-job path. The Active state's indeterminate sliding stripe is replaced for this single operation by a typewriter prose surface. Other operations (expand, refine, generate-context) keep the indeterminate-stripe Active state.

| Property | Value |
|---|---|
| Surface container | Full Tab height, padding `var(--space-5)`, flex column with `gap: var(--space-3)`. |
| Status row (top) | Inter 300 10px `--color-text-muted` "connecting…" or "streaming…" on the left; Cancel button (no border, `--color-error` text, Inter 11px) on the right. |
| Prose surface | `font-family: var(--font-lora), Lora, serif`; `font-size: 15px`; `font-weight: 400`; `line-height: 1.7`; `color: var(--color-text-primary)`; `white-space: pre-wrap`; `word-break: break-word`; `padding: var(--space-4)`; `border: 1px solid --color-border-subtle`; `border-radius: 4px`; `background: --color-bg-base`; `max-height: 60vh`; `overflow-y: auto`. The typeface deliberately matches ProseEditor so the end-of-stream transition to the Tiptap-rendered CompleteState is visually seamless. |
| Cursor | **No cursor element rendered.** Inviolable #2 reserves verdigris (`--color-accent`) for nine enumerated places; "prose cursor" use #3 specifically scopes to ProseEditor and FocusMode. The streaming surface does not extend that use. The arrival of streamed text is itself the typewriter feel; no separate cursor needed. |
| Cancel handling | Cancel button calls `AbortController.abort()` on the in-flight `fetch`. The route handler propagates the abort to the upstream Anthropic SDK stream and `runAgentJobInline`'s finally block flips the agent_jobs row to `status='cancelled'`, `error_message='client_disconnect'`. |
| State transition on completion | On the SSE `agent_job_complete` event, the local `streamingStatus` clears to `'idle'`. The realtime hook's `activeJob` (subscribed to the agent_jobs row) takes over rendering as the existing CompleteState (Accept/Dismiss). |
| State transition on cancel/error | The streaming surface unmounts; the AgentTab returns to IDLE (which now shows an error banner if applicable). |
| Workflow-dispatched synthesise | Unaffected — runs through the existing background path and surfaces in the workflow's ExecutionCard (not the AgentTab). The streaming surface is exclusively for user-clicked synthesise on a leaf node. |
| State reset on node change | `NodeDetailPanel` passes `key={nodeId}` to AgentTab so React unmounts + remounts on node change. Streaming accumulator + `AbortController` are part of the component's local state and are cleared automatically. |

**Test data hooks:** the prose surface carries `data-testid="synthesise-streaming-surface"` for the Phase 5c functional smoke (`tests/agent/synthesise-stream-smoke.spec.ts`).

---

### 5.10 CommentThread

**File:** `components/detail/CommentThread.tsx`

Each comment is a card. Human comments show initials avatar. Agent comments show the ◆ icon + profile name.

| Property | Value |
|---|---|
| Comment card border | `1px solid --color-border-subtle` |
| Comment card bg | `--color-bg-base` |
| Comment card padding | `10px 12px` |
| Border-radius | 4px |
| Comment type label | Inter 500 9px tracking 0.2em uppercase, colour matches type (instruction: `--color-info`; critique: `--color-warning`; approval: `--color-success`) |
| Content font | Inter 400 12px `--color-text-secondary` line-height 1.55 |
| Meta (author, time) | Inter 300 10px `--color-text-muted` |
| Resolve button | Inter 400 10px `--color-text-muted`, no border, hover `--color-text-secondary` |
| Resolved comments | Collapsed behind "Show [N] resolved" toggle. `opacity: 0.5` when shown. |

**New comment form:**
- Type dropdown (Instruction / Question / Note / Critique / Approval)
- Textarea: Inter 300 12px, min 2 rows, auto-expand
- [Add] button: secondary style

---

### 5.11 VersionHistory

**File:** `components/detail/VersionHistory.tsx`

| Property | Value |
|---|---|
| Row height | auto (2 rows) |
| Row 1 | Version number (Inter 600 11px) + timestamp (Inter 300 10px `--color-text-muted`) + author |
| Row 2 | Change description (Inter 300 11px `--color-text-muted`) |
| Current version | Star ★ `--color-accent`-tinted, no Restore button |
| Restore button | Inter 300 10px, `1px --color-border-subtle`, appears on hover |
| Hover preview | Tooltip (max 320px) showing diff — added text underlined, removed text strikethrough |
| Load more | "Show [N] more versions…" link below the initial 7 shown |

Restoring creates a new version — does not delete history.

🔒 **Phase 3 vs Phase 6 split.** Per `stelavox_technical_architecture_v1_5.md` §11 and `stelavox_product_specification_v1_3.md` §4.12, the **list, the current-version star, the hover diff tooltip, and the "Show N more" pagination ship in Phase 3** (the Tier-A "browseable" checkpoint). The **Restore button — and all of its lock-aware semantics — ship in Phase 6** alongside the broader status / lock state machine. Phase 3 implementations MUST NOT render the Restore button. The "Restore button" row above is the canonical spec for Phase 6's later implementation; documenting it here keeps the Phase 6 contract stable.

---

### 5.12 ContextLinker

**File:** `components/detail/ContextLinker.tsx`

**Linked context section:**
- Each linked node: type icon + name + [Open] button. `--color-bg-base` bg, `1px --color-border-subtle` border, 4px radius.
- [+ Link context node]: opens `NodePicker` filtered to context nodes.

**Inherited from ancestors:**
- Collapsible (collapsed by default)
- Shows count badge: "Inherited from ancestors (4)"
- When expanded: same item style but at 0.7 opacity with "inherited" pill label

---

### 5.13 NotesEditor

**File:** `components/detail/NotesEditor.tsx`

Built with Tiptap. The author's private scratchpad on a node — a place for half-formed ideas, reminders, and side observations that are *not* part of the document's prose and *not* part of the structural Summary that the agent system reads. Persists to `nodes.notes` (Migration 004). Sibling to `SummaryEditor` (§5.3) — same architectural shape, different intent.

🔒 **Always Inter, never Lora.** Notes are author commentary, not prose. They sit on the structural side of the typeface boundary established by Brand Identity v2.0 §6.4 and Inviolable #4. No part of `NotesEditor` may render in a serif typeface.

| Property | Value |
|---|---|
| Font | 🔒 Inter 400 13px |
| Line height | 1.55 |
| Background | `--color-bg-base` |
| Border | `1px solid --color-border-subtle` |
| Border-radius | 4px |
| Padding | `10px 12px` |
| Min-height | 100px (auto-expands) |
| Max-height | 400px (then scrolls — notes can grow long without dominating the panel) |
| Colour | `--color-text-primary` |

**Tiptap config:**
- Extensions: Text, Bold (⌘B), Italic (⌘I), BulletList, OrderedList, History, Link (⌘K — for jotting reference URLs)
- Disabled: ALL Heading levels, Blockquote, Code, HorizontalRule, CodeBlock
- Placeholder: Inter 300 `--color-text-disabled` italic "Notes to yourself about this node…"

**Toolbar** (visible on focus): Bold | Italic | • Bullet | 1. Number | 🔗 Link — minimal, 32px height. Same toolbar shape as `SummaryEditor` plus Link.

**Why Link is admitted here but not in SummaryEditor:** Notes commonly contain reference URLs (research links, Wikipedia entries, named character images). Summary is consumed by the agent system as planning input — links would need to be stripped before LLM inclusion (per H-06) and add no signal. Notes are not consumed by the agent system; the link extension is safe.

**Persistence and autosave:** NotesEditor participates in the same auto-save state machine as SummaryEditor and ProseEditor — debounced PATCH to `/api/nodes/[id]` after 1.5 seconds of inactivity (per Technical Architecture v1.5 §2.7); all three editors share one debounce window per node, so one PATCH writes all changed content fields. See Phase 3 API Contract §3 for the optimistic-concurrency detail. Tiptap JSON is the storage shape; Tiptap's `generateText` extracts plain text per H-06 if the value is ever included in a prompt (it is not in V1 — the agent system reads `summary` and `prose` only).

🔒 NotesEditor and SummaryEditor are **separate components** — they must not share a Tiptap instance or extension list. Each is a thin wrapper around its own `useEditor()` so the typeface boundary, the toolbar shape, and the extension allowlist are enforced at the component level. (Same architectural rule as the SummaryEditor / ProseEditor split in §5.3.)

---

## 6. Focus Mode Components

### 6.1 FocusMode

**File:** `components/focus/FocusMode.tsx`

Full-screen overlay mounted above AppShell.

🔒 **Render via portal to `document.body`.** FocusMode MUST render through `ReactDOM.createPortal(<FocusMode … />, document.body)` rather than as a JSX descendant of the AppShell. The reason: AppShell's `[data-shell="detail"]` element receives `opacity: 0` and `transform: translateX(100%)` while `body.focus-mode-active` is set (the simultaneous-transition mechanism in §6.1's entry choreography). CSS `opacity` and `transform` propagate from the parent to every descendant — including any fixed-position child — so a FocusMode rendered as a JSX descendant of the detail panel inherits opacity 0 and the parent's translate, making the overlay either invisible or off-screen. A portal places the FocusMode DOM node directly under `<body>`, outside the AppShell's transformed subtree, so the overlay receives only the body-class transition rules intended for it.

🔒 **Leaf-only entry.** Focus Mode can only be entered for a node where `node.is_leaf === true`. The entry shortcut `⌘Return` is wired only on leaves; the `<FocusModeButton>` is leaf-only (§5.8). This is consistent with ProseEditor's leaf-only mounting (§5.4) — Focus Mode is the prose surface at full viewport. Sibling navigation inside Focus Mode (`⌘←` / `⌘→`) only crosses sibling leaves at the same layer; the navigation never lands on a non-leaf.

| Property | Value |
|---|---|
| Position | fixed, inset: 0, z-index: 100 |
| Background | 🔒 `--color-bg-base` (#0d1014) — full viewport |
| Entry shortcut | `⌘Return` from Edit Mode prose field (leaf nodes only) |
| Exit shortcut | `Escape` or `⌘Return` |

**Contents (z-order top to bottom):**
1. `<FocusBreadcrumb>` — top centre
2. `<ProseEditor>` — centred column, 620px max-width, 18px Lora, typewriter positioning
3. `<FocusWordCount>` — bottom of prose column
4. `<FocusEscHint>` — bottom right

**Entry/exit transition:**
```
Enter (280ms --easing-default):
  Tree       → translateX(-100%) + opacity 0
  Panels     → translateX(100%) + opacity 0
  Header     → translateY(-48px) + opacity 0
  ProseColumn → max-width expands from panel width to 620px
  All simultaneous.

Exit (280ms --easing-default): exact mirror.
Cursor position preserved. Scroll position preserved.
```
⚡ Honour `prefers-reduced-motion` → 0ms.

**Node navigation in Focus Mode:** `⌘←` / `⌘→` moves to previous/next sibling at the same layer. Transition: prose fades out (150ms), breadcrumb updates, prose fades in (150ms).

---

### 6.2 FocusBreadcrumb

**File:** `components/focus/FocusBreadcrumb.tsx`

| Property | Value |
|---|---|
| Font | Inter 200 11px tracking 0.04em `--color-text-muted` |
| Position | absolute top: 20px, centred, full width, `text-align: center` |
| pointer-events | 🔒 **none — always**. Not clickable in Focus Mode. |
| Format | `Document · Layer · Layer · Current` |
| Separator | `·` (middot) at opacity 0.4 |

**Opacity state machine:**

| Trigger | Opacity | Transition |
|---|---|---|
| Typing | 0 | instant |
| At rest >3s | 0.2 | 800ms `--easing-prose` ⚡ |
| Mouse movement | 0.2 | 800ms `--easing-prose` ⚡ |
| Maximum | 🔒 0.2 | Never higher |

♿ `aria-hidden="true"` — decorative location text, not navigation.

---

### 6.3 FocusEscHint

**File:** `components/focus/FocusEscHint.tsx`

| Property | Value |
|---|---|
| Font | Inter 300 10px tracking 0.12em `--color-text-disabled` |
| Position | Bottom-right of viewport, inside prose column right edge |
| Text | `Esc to exit` |
| Entry opacity | 0.3 |
| Fade out | After 5000ms → opacity 0, `--duration-slow` ⚡ |
| Returns | 🔒 Never. No hover behaviour after fade. |

---

### 6.4 TypewriterContainer

**File:** `components/focus/TypewriterContainer.tsx`

Keeps the active line at 42% of viewport height.

| Property | Value |
|---|---|
| Active line position | `window.innerHeight * 0.42` |
| Tolerance | ±2px before triggering scroll adjustment |
| Scroll behaviour | `scroll-behavior: smooth` |
| Default — Focus Mode | **On** |
| Default — Edit Mode | **Off** (opt-in via three-dot menu in panel header — *toggle ships in Phase 8 alongside SentenceFocus per TA v1.7 §11*) |
| Persistence | `localStorage` key `stelavox_typewriter_enabled` |

On `⌘←/⌘→` navigation: scroll resets to top of new node content; typewriter positioning activates on first keypress.

---

### 6.5 SentenceFocus

**File:** `components/focus/SentenceFocus.tsx`

> ⚠️ **Phase 3 deferred — full implementation lands in Phase 8 (Polish).** The Phase 3 build shipped a CSS-only stub: the file installs the opacity rules but does not segment text, does not wrap sentences in `[data-sentence]` elements, and the toggle host (the three-dot menu in the prose editor panel header) was never built. The behaviour described below remains the contract for Phase 8 — not a redesign, just a deferral of *when* it ships. See TA v1.7 §11 Phase 8 row, Phase 3 Test Plan v1.2 §10 "Deferred to Phase 8", and Phase 3 Test Report v1.5 SU-13.

| Property | Value |
|---|---|
| Default | Off (opt-in) |
| Toggle location | Three-dot menu in prose editor panel header *(Phase 8)* |
| Persistence | `localStorage` key `stelavox_sentence_focus_enabled` |

**Opacity levels (all locked):**

| Target | Opacity |
|---|---|
| Active sentence (cursor within) | 1.0 |
| Adjacent sentences (±1) | 0.85 |
| All other text | 🔒 0.55 minimum |
| Transition on cursor move | 200ms `--easing-prose` ⚡ |

🔒 0.55 is the minimum opacity for non-adjacent text. Below this value, text reads as disabled or deleted rather than backgrounded.

**During selection:** All text returns to 1.0 opacity. Resumes on deselect.

**Sentence detection** (resolved — see §16): Use the `Intl.Segmenter` API with `granularity: "sentence"` where available (Chrome 87+, Firefox 125+, Safari 16.4+). Fallback: period/exclamation/question mark followed by whitespace or end of paragraph, with abbreviation handling (Dr., Mr., Mrs., etc. — do not split on these). Do not use an external sentence segmentation library. `Intl.Segmenter` provides sufficient accuracy for this use case without a dependency.

---

## 7. Director Components

### 7.1 DirectorPanel

**File:** `components/director/DirectorPanel.tsx`

| Property | Value |
|---|---|
| Width | 580px (max 55% of viewport) |
| Min-width | 400px |
| Background | `--color-bg-surface` |
| Layout | `display: flex; flex-direction: column` |

🔒 The node tree must never be compressed below 300px width. Enforce with `min-width: 300px` on the tree panel container.

**DirectorHeader:**
- Title: `◆ The Director` — Inter 600 13px; ◆ in `--color-accent` (this is a brand component identity marker, part of the Director's typographic signature — not subject to the nine-use rule which applies to UI surface elements)
- Document tag: Inter 300 10px, `--color-bg-base` bg, `1px --color-border-subtle`, 3px border-radius
- History button: Inter 300 11px `--color-text-muted`, `1px --color-border-subtle`

♿ `role="complementary"` `aria-label="Director"`.

---

### 7.2 ConversationThread

**File:** `components/director/ConversationThread.tsx`

Scrollable message list. Flex column, grows from bottom. New messages at bottom.

Auto-scrolls to bottom on new message unless the author has manually scrolled up. In that case, a "Jump to latest" button appears at the bottom edge:
- Inter 400 11px `--color-text-muted`, `--color-bg-elevated` bg, `1px --color-border-default`, border-radius 12px, shadow-sm
- Clicking scrolls to bottom and hides the button

---

### 7.3 UserMessage

**File:** `components/director/UserMessage.tsx`

| Property | Value |
|---|---|
| Alignment | Right |
| Max-width | 78% of panel |
| Background | 🔒 `--color-bg-selected` (#1f2d45). **Never `--color-accent-muted`** |
| Border-radius | `8px 8px 2px 8px` |
| Padding | `10px 14px` |
| Font | 🔒 Inter 400 12px `--color-text-primary` |
| Meta (time) | Inter 300 10px `--color-text-muted`, right-aligned, `margin-top: 5px` |

---

### 7.4 DirectorMessage

**File:** `components/director/DirectorMessage.tsx`

| Property | Value |
|---|---|
| Alignment | Left |
| Max-width | 90% of panel |
| Background | None |
| Font | 🔒 Inter 400 12px `--color-text-secondary`. Line-height 1.6. |
| Header | `◆` + "Director" Inter 500 10px tracking 0.1em uppercase `--color-text-muted` + timestamp |
| Bold within text | Inter 500 `--color-text-primary` |
| Streaming text | Appears word by word as the Director streams. No animation on the text itself — it simply appears. |

🔒 The Director speaks in Inter. Never Lora. The Director is structural, not prose.

---

### 7.5 ThinkingIndicator

**File:** `components/director/ThinkingIndicator.tsx`

Shown while Director is processing. Removed when response begins streaming.

| Property | Value |
|---|---|
| Layout | `◆` icon + italic text label + three animated dots |
| Font | Inter 300 12px italic `--color-text-muted` |
| Dot size | 5px circles `--color-text-muted` |
| Dot animation | opacity `0.3→1→0.3`, 1.2s ease-in-out infinite, staggered 0.2s per dot ⚡ |

Reduce-motion: static dots, no animation.

---

### 7.6 PlanCard

**File:** `components/director/PlanCard.tsx`

The most important trust-building component in the product. Nothing executes until the author approves.

| Property | Value |
|---|---|
| Border | `1px solid --color-border-default` |
| Border-radius | 6px |
| Background | `--color-bg-surface` |
| Display | 🔒 Always fully expanded — all steps visible at all times |

**Header:**
- Background: `--color-bg-base`
- Title: Inter 600 12px `--color-text-primary`
- Meta (step count, estimated time): Inter 300 10px `--color-text-muted`, right-aligned

**Step row:** Always visible (no expand-on-click). Min-height 44px (auto-expands for long descriptions). Padding `8px 14px`. Border-bottom `1px solid --color-border-subtle`.

**Step checkbox:**
- 14×14px, `1px solid --color-border-default`, border-radius 2px
- Checked: `--color-accent` bg + border, white ✓ at 9px
- Unchecked: white ✓ hidden
- Toggling a checkbox **immediately** updates the Approve button label

**Step deselected state:** Entire row at opacity 0.55. Title and description `--color-text-muted`.

**Step text:** Title (Inter 500 11px `--color-text-primary`) + description (Inter 300 11px `--color-text-secondary`) + target node link + estimated duration (Inter 300 10px `--color-text-muted`).

**Step remove button:** × icon, `--color-text-muted`, `margin-left: auto`. Removes the step from the plan (sets `status: removed`). Immediately updates Approve button label. Cannot be undone within the PlanCard (author must dismiss and re-request the plan if they remove a step in error).

**Lock warning row** (if locked nodes are in scope):
- Background: `rgba(184,112,48,0.08)`
- Border-top: `1px solid rgba(184,112,48,0.2)`
- Text: `--color-status-review`, Inter 300 11px, ⚠ icon

**Footer:**
- Background: `--color-bg-base`
- Border-top: `1px solid --color-border-subtle`
- Approve button: 🔒 `--color-accent` bg, white Inter 500 11px. Label: "Approve All" (all checked) | "Approve [N] of [Total]" (some unchecked) — updates live on each checkbox change
- Edit Steps: `1px --color-border-subtle` border, Inter 400 11px `--color-text-secondary` — expands the selected step for instruction editing
- Cancel (✕): no border, Inter 300 11px `--color-text-muted`, `margin-left: auto`

🔒 Nothing executes until Approve is clicked. The PlanCard is the plan-approval gate.

---

### 7.7 ExecutionCard

**File:** `components/director/ExecutionCard.tsx`

Replaces PlanCard after approval. Shows live step progress.

| Step state | Icon | Row bg | Text | Animation |
|---|---|---|---|---|
| pending | ◌ | — | `--color-text-disabled` | none |
| running | ⟳ | `rgba(46,90,144,0.05)` | `--color-text-primary` fw500 | opacity `1→0.5→1`, 2s ⚡ |
| complete | ✓ | — | `--color-text-muted` | none |
| failed | ✗ | — | `--color-text-primary` | none |

**Footer:** Progress text "Step 2 of 4" (left) + Pause + Stop buttons (right). Stop: `--color-error` text and border, Inter 400 10px.

**Heartbeat indicator (SU-42 — Phase 5b absorbed).** A small liveness pulse adjacent to the card title, visible whenever `workflow.status === 'running'`. The dot reads from `workflows.last_heartbeat_at` (real-time-subscribed via the `workflow-steps-${workflowId}` channel) and the corresponding `agent_jobs.last_heartbeat_at` of the currently-running step.

| Heartbeat state | Dot colour | Animation | Label |
|---|---|---|---|
| fresh — `last_heartbeat_at < 30s ago` | `--color-agent-running` | opacity `1 → 0.6 → 1`, scale `1 → 0.85 → 1`, 1.5s ease-in-out infinite ⚡ | `live` (Inter 300 10px `--color-text-muted`) |
| stalled — `last_heartbeat_at >= 30s ago` | `--color-text-muted` | none | `stalled` |

Reduced-motion preference collapses the pulse to a static dot. The transition fresh ↔ stalled is driven by a 1.5s client-side tick comparing the cached `last_heartbeat_at` to `Date.now()`; once stalled, the recovery cron at `/api/cron/director-recovery` (60s) is the backstop that marks orphaned `running` agent jobs as `failed` and the workflow as `paused`.

After all steps resolve: ExecutionCard is replaced by a Director summary message. WorkflowStepIndicators in tree return to standard NodeStatusBadges.

---

### 7.8 ResearchCard

**File:** `components/director/ResearchCard.tsx`

Research results land as proposals. Nothing is created until approved. (V2 feature — spec documented now for V2 build.)

**Source conflict UI** (resolved — see §16): When sources conflict on a factual claim, the conflicting claim is shown inline below the finding it affects:

```
Finding item (normal)
  ⚠ Source conflict: [Source A] states X; [Source B] states Y.
    Resolve before approving this finding.
```

Background on conflict row: `rgba(184,112,48,0.06)`. Text: `--color-status-review` Inter 300 10px. Approve All button is **disabled** when any unresolved source conflict exists — the author must dismiss the conflicting finding(s) individually before approving the rest. This prevents unverified conflicting information from entering the document.

---

### 7.9 DirectorInput

**File:** `components/director/DirectorInput.tsx`

| Property | Value |
|---|---|
| Textarea | Inter 300 12px, auto-expand 1–5 rows then scroll |
| Background | `--color-bg-base` |
| Border | `1px solid --color-border-subtle` |
| Border-radius | 5px |
| Placeholder | Inter 300 `--color-text-disabled` "Message the Director... (@ to reference a node)" |
| Send: `Enter` | Sends message |
| New line: `Shift+Enter` | Inserts newline |
| Send button | 32×32px, `--color-accent` bg, white ↑ icon, border-radius 5px |

**@ mention:** `@` keypress opens `NodePicker` (searchable, current document nodes). Selected node renders as pill in textarea: `--color-bg-elevated` bg, `1px --color-border-default`, node type icon + name.

**Quick action chips:**
- Inter 400 10px `--color-text-muted`, `1px --color-border-subtle`, `border-radius: 12px`
- Hover: `--color-border-default`, `--color-text-secondary`
- Clicking inserts text into textarea (author edits before sending)
- Context-aware: change based on conversation state

**Disabled state (during execution):** Textarea + send button at 0.5 opacity, `pointer-events: none`. Placeholder: "Director is working..."

---

## 8. Feedback Components

### 8.1 Toast

**File:** `components/feedback/Toast.tsx`
**File:** `components/feedback/ToastManager.tsx` (singleton, mounts at app root)

| Property | Value |
|---|---|
| Position | fixed, bottom-right: `right: 24px; bottom: 24px` |
| Width | 320px |
| Background | `--color-bg-elevated` |
| Border | `1px solid --color-border-default` |
| Border-radius | 6px |
| Shadow | `--shadow-md` |
| Max toasts visible | 3 (oldest dismisses when 4th appears) |
| Stack direction | Upward (newest at bottom) |
| Gap | 8px |

**Entry:** `translateX(24px) + opacity 0` → `translateX(0) + opacity 1`, `--duration-normal --easing-default` ⚡
**Exit:** `opacity 0 + translateX(24px)`, `--duration-normal --easing-crisp` ⚡
**Auto-dismiss:** 4000ms.

**Anatomy:**
```
[3px left accent] [icon 16px] [title Inter 500 12px] [× dismiss 14px]
                              [body  Inter 300 11px --color-text-secondary]
```

**Variants:**

| Variant | Accent colour | Icon | `role` |
|---|---|---|---|
| success | `--color-accent` | ✓ | `status` |
| error | `--color-error` | ✗ | `alert` |
| warning | `--color-warning` | ⚠ | `alert` |
| info | `--color-info` | ⓘ | `status` |

**Copy standards** (from Brand Identity v2.0 §10.3):
- Success: "Chapter 5 refined. Previous version saved in history." — not "Done!"
- Error: "Synthesis failed. The API returned an error. Your content is unchanged." — not "Something went wrong."
- Warning: "Chapter 7 is locked. It was not included in the plan." — not "Oops!"

♿ `aria-live="polite"` on the ToastManager container.

---

### 8.2 ProgressBar

**File:** `components/feedback/ProgressBar.tsx`

| Property | Value |
|---|---|
| Height | 3px |
| Track | `--color-border-subtle` |
| Fill | `--color-agent-running` (while running) / `--color-accent` (complete) |
| Border-radius | 2px |
| Fill width transition | smooth as progress updates, `--duration-fast --easing-smooth` ⚡ |

---

## 9. Overlay Components

### 9.1 Modal

**File:** `components/overlay/Modal.tsx`

| Property | Value |
|---|---|
| Backdrop | `rgba(0,0,0,0.5)`, `backdrop-filter: blur(2px)` |
| Panel | `--color-bg-elevated`, `1px solid --color-border-default`, border-radius 8px |
| Panel width | 480px (default) / 640px (large) |
| Shadow | `--shadow-lg` |
| Entry | `opacity 0 + scale(0.96)` → `opacity 1 + scale(1)`, `--duration-slow --easing-default` ⚡ |
| Exit | `opacity 0 + scale(0.96)`, `--duration-normal --easing-crisp` ⚡ |

**Header:** Inter 600 16px `--color-text-primary`, padding `20px 24px 16px`. Close ×: `--color-text-muted`.
**Body:** Inter 400 14px `--color-text-secondary`, line-height 1.6, padding `0 24px 20px`.
**Footer:** padding `16px 24px`, border-top `1px solid --color-border-subtle`, right-aligned buttons.

🔒 **Scrollable body when content overflows.** Modals hosting dynamic schema-driven forms (e.g., the Phase 4 `ContextCreateModal` with the per-context-type metadata fields) MUST render with `maxHeight: 85vh` on the panel and `overflowY: auto; minHeight: 0` on the inner content / form. Without this rule, a long form's submit button can fall outside the viewport on smaller test browsers (typically 720p) and the user has no way to reach it. This was Phase 4 SU-19 — discovered when TC-U-05 timed out clicking a Create button reported as "outside of the viewport." The header stays fixed at the top via flex column layout. Static-content modals (Lock layer / Delete node / Unsaved changes) are short enough that the rule is permissive but harmless.

**Standard modal copy:**

| Modal | Title | Body | Primary button |
|---|---|---|---|
| Lock layer | "Lock [Layer] layer?" | "Individual nodes can be unlocked later." | "Lock" |
| Delete node | "Delete [name]?" | "This cannot be undone. [N] child nodes will also be deleted." | "Delete" (error style) |
| Unsaved changes | "Leave without saving?" | "Your changes to [node name] will be lost." | "Save and leave" |

♿ `role="dialog"`, `aria-modal="true"`, `aria-labelledby` points to header ID. Focus trapped. Escape closes. Focus returns to trigger on close.

---

### 9.2 Dropdown

**File:** `components/overlay/Dropdown.tsx`

| Property | Value |
|---|---|
| Background | `--color-bg-elevated` |
| Border | `1px solid --color-border-default` |
| Border-radius | 6px |
| Shadow | `--shadow-md` |
| Padding | `4px 0` |
| Min-width | 160px |
| Entry | `opacity 0 + translateY(-4px)` → `opacity 1`, `--duration-fast --easing-default` ⚡ |

**Item:** 32px height, `0 12px` padding, Inter 400 13px `--color-text-secondary`. Hover: `--color-bg-hover`, `--color-text-primary`. Destructive: `--color-error` text. Separator: `1px --color-border-subtle`, `margin: 4px 0`. Icon: 14px Lucide `--color-text-muted`, `margin-right: 8px`.

♿ `role="menu"`, `role="menuitem"`, `↑↓` keyboard navigation, `Enter` selects, `Escape` closes.

---

### 9.3 Tooltip

**File:** `components/overlay/Tooltip.tsx`

| Property | Value |
|---|---|
| Background | `--color-bg-elevated` |
| Border | `1px solid --color-border-subtle` |
| Border-radius | 4px |
| Padding | `4px 8px` |
| Font | Inter 300 11px `--color-text-secondary` |
| Max-width | 200px |
| Delay | 600ms hover before appearing |
| Entry | opacity 0 → 1, `--duration-fast` ⚡ |

Shown on icon-only buttons. Not shown on buttons with visible text labels.

---

## 10. Brand Components

### 10.1 AppIcon

**File:** `components/brand/AppIcon.tsx`

The app icon for use at 32px and 24px sizes (browser tab, bookmarks, home screen).

| Property | Value |
|---|---|
| Background | Radial gradient: `#1a2535` at centre → `#0a0e14` at edges, rounded-square |
| Letter | Capital **S** from Cinzel, centred |
| Lozenge | 5px verdigris lozenge at base of S |

At 24px: the lozenge becomes a colour point rather than a distinct shape. Acceptable — the accent is present.

---

## 11. Tablet Layout Components

### 11.1 Responsive Breakpoints

Apply via CSS media queries. No new components required — existing components adapt via CSS.

| Property | Desktop (≥1024px) | Tablet (768–1023px) |
|---|---|---|
| Sidebar width | 220px (or 48px collapsed) | 48px auto-collapsed |
| Tree panel min-width | 320px | 260px |
| Detail panel min-width | 320px | 280px |
| Node row height | 36px | 44px (touch targets) |
| Focus Mode prose max-width | 620px | 🔒 560px |

```css
@media (max-width: 1024px) {
  .sidebar { width: 48px; min-width: 48px; }
  .sidebar .sidebar-label,
  .sidebar .sidebar-item-text { display: none; }
  .tree-panel { min-width: 260px; }
  .detail-panel { min-width: 280px; }
  .node-row { height: 44px; }
  .focus-mode-prose-column { max-width: 560px; }
}
```

### 11.2 Touch Considerations

- Minimum touch target: 44px (iOS HIG / Android Material)
- Drag handles replaced by long-press (500ms) to initiate drag
- Hover-only actions available via long-press or ⋯ more menu
- No swipe gestures in V2 — tap and scroll only

---

## 12. Mobile Notes Components

### 12.1 MobileNotesSection

**File:** `components/detail/MobileNotesSection.tsx`

Read-only log of phone-captured notes. Shown in the Content tab.

| Property | Value |
|---|---|
| Position | Below Notes field in Content tab |
| Visibility | Always shown when `mobile_notes.length > 0`. Empty state otherwise. |
| Header | "Mobile Notes" + count (Inter 500 9px tracking 0.3em uppercase `--color-text-muted`) + collapse toggle |
| Collapsible | Yes — `useState`, persists in `sessionStorage` key `stelavox_mobile_notes_[nodeId]_expanded` |
| Max height | 300px with `overflow-y: auto` |
| Background | `--color-bg-base` |

**Entry (each note):**
- Header: timestamp (date-fns `formatRelative`) + device_type + input_method — Inter 300 10px `--color-text-muted`
- Body: Inter 300 12px `--color-text-secondary` line-height 1.6
- Separator: `1px solid --color-border-subtle`

**Empty state:** "Notes added on your phone will appear here." Inter 300 12px `--color-text-muted`, centred.

---

## 13. Attachment Components

### 13.1 AttachmentsTab

**File:** `components/detail/AttachmentsTab.tsx`

**V1 behaviour:** Tab hidden from strip when `attachment_count === 0` (always in V1 since no upload UI exists). The database table and storage bucket are set up in Phase 1.

**V2 specification:**

| Property | Value |
|---|---|
| Tab visible when | `node.attachment_count > 0` OR always with empty state |
| Attachment item | File icon (by type) + file name + file size + download + delete |
| File icon | PDF: red document · Image: thumbnail preview · Text: document |
| Upload button | "Attach file" — triggers file picker. PDF, images, text. Max from `platform_config` key `limits.attachment_max_file_size_bytes` |
| Download | Generates signed URL from Supabase Storage (1-hour expiry) |
| Max per node | From `platform_config` key `limits.attachment_max_per_node` |

---

## 14. Scheduler Components

### 14.1 ScheduleButton

**File:** `components/scheduler/ScheduleButton.tsx`

Split-button replacing the single "Run Now" button in AgentTab and document operations.

| Property | Value |
|---|---|
| Left side | "Run Now" — same behaviour as current run button |
| Right side | Chevron ▾ opens SchedulePicker |
| Left flex | `flex: 1` |
| Right width | 32px |
| Divider | `1px solid --color-border-subtle` between sides |
| Background | `--color-agent-running` for agent operations |
| Disabled | Both sides disabled together when node is locked or budget exhausted |

---

### 14.2 SchedulePicker

**File:** `components/scheduler/SchedulePicker.tsx`

Dropdown opened by the split-button chevron.

| Property | Value |
|---|---|
| Width | 280px |
| Background | `--color-bg-elevated`, `1px --color-border-default`, border-radius 6px, `--shadow-lg` |
| Section: Quick presets | "Tonight 11pm" · "Tomorrow 9am" · "Every Sunday 10pm" — Inter 400 12px |
| Section: Custom time | Date-time picker, Inter 400 12px inputs |
| Section: Recurrence | Toggle "Repeat" → cron preset (Daily / Weekly / Monthly / Custom) |
| Timezone note | "Times shown in [user timezone]" — Inter 300 10px `--color-text-muted` |
| Schedule button | "Schedule" — `--color-agent-running` bg, full width |
| Cancel | Ghost style, `--color-text-muted` |

---

### 14.3 ScheduledJobsList

**File:** `components/scheduler/ScheduledJobsList.tsx`

Shown in Organisation Settings.

| Property | Value |
|---|---|
| Job item | Two-row auto-height |
| Row 1 | Job name (Inter 500 12px) + job type badge + status badge |
| Row 2 | Document name + next run (relative) + recurrence description — Inter 300 11px `--color-text-muted` |
| Status badges | pending: `--color-text-muted` · running: `--color-agent-running` · complete: `--color-accent` · failed: `--color-error` |
| Cancel button | Inter 300 11px, `1px --color-border-subtle`, right-aligned |
| Empty state | "No scheduled jobs. Use the Schedule button on any agent operation to set one up." |

---

## 15. Accessibility Baseline

### 15.1 Contrast Requirements

All text must meet WCAG 2.1 AA minimum at minimum. Prose text meets AAA.

| Pairing | Ratio | Level |
|---|---|---|
| `--color-text-primary` on `--color-bg-base` | 14.8:1 | AAA |
| `--color-text-secondary` on `--color-bg-surface` | ~5.2:1 | AA |
| `--color-text-muted` on `--color-bg-base` | ~3.1:1 | AA large text only — use at 14px+ only |
| `--color-accent` on `--color-bg-base` | ~4.8:1 | AA |

Verify all light mode pairings against WCAG 2.1 AA before each phase ships.

### 15.2 Focus Management

- All interactive elements: `outline: 2px solid var(--color-border-strong); outline-offset: 2px` on `:focus-visible`
- Remove for mouse-only: `:focus:not(:focus-visible) { outline: none; }`
- Focus rings visible in both dark and light mode
- Tab order follows visual reading order
- Focus trapped within modals and command palette
- Focus returns to trigger element when overlays close

### 15.3 ARIA Landmarks

```html
<header role="banner">
<nav role="navigation" aria-label="Project navigation">
<main role="main">
<aside role="complementary" aria-label="Node detail">
<aside role="complementary" aria-label="Director">
```

### 15.4 Component ARIA Summary

| Component | Key requirements |
|---|---|
| NodeTree | `role="tree"`, `role="treeitem"`, `aria-expanded`, `aria-level`, `aria-selected`. Node `aria-label` includes name and status. |
| NodeStatusBadge | Not announced on change — available via parent `aria-label`. |
| ModeTabBar | `role="tablist"`, `role="tab"`, `aria-selected`. |
| Modal | `role="dialog"`, `aria-modal`, `aria-labelledby`. Focus trapped. Escape closes. |
| ToastManager | `aria-live="polite"`. Toast: `role="status"` (info/success) or `role="alert"` (warning/error). |
| Dropdown | `role="menu"`, `role="menuitem"`. |
| CommandPalette | `role="combobox"`, `role="listbox"`, `aria-activedescendant`. |
| ProseEditor | `aria-label="Prose content"`, `aria-multiline="true"`. |
| SummaryEditor | `aria-label="Node summary"`. |
| FocusBreadcrumb | `aria-hidden="true"`. |
| DirectorPanel | `role="complementary"`, `aria-label="Director"`. |

### 15.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0ms !important;
  }
}
```

---

## 16. Resolved Component Questions

All open questions from Component Spec v1.4 are resolved. There are currently no open questions.

| # | Question | Resolution |
|---|---|---|
| CQ-1 | Sentence segmentation library | Use `Intl.Segmenter` API with `granularity: "sentence"`. No external library. Fallback: punctuation heuristic with abbreviation handling. See §6.5. |
| CQ-2 | CommandPalette result ranking | Scored: recency 40% + text match quality 40% + node depth 20%. Recent nodes always first. Commands rank by recency of use. See §3.3. |
| CQ-3 | ResearchCard source conflict UI | Conflicting claim shown inline below the affected finding. Approve All disabled until conflicts are individually dismissed. See §7.8. |
| CQ-4 | Tablet-specific column widths | Focus Mode: 560px at ≤1024px. Edit Mode detail panel fills available width (panel narrower on tablet). Resolved in Brand Identity v2.0 §7.9 and UI Design Spec v1.0 §4.4. |
| CQ-5 | Plan card step interaction (expand-on-click vs always-expanded) | 🔒 Always expanded. Steps are always visible — the author is approving a consequential plan and must see all steps without any interaction. See §7.6. |
| CQ-6 | PanelResizer dragging colour | Corrected from `--color-accent` to `--color-border-strong`. `--color-accent` is reserved for its nine sanctioned uses. See §2.4. |

---

## 17. Director V2 Component Specifications (V1.x scope)

The Director Architecture V2 design (`docs/stelavox_director_architecture_v2_0.md`) introduces new components plus extensions to existing components. They are delivered across the V1.x phased roadmap. Sections 1–16 above describe the components present in V1; this section captures the V1.x additions and extensions.

### 17.1 `AppShellStatusIndicator` (V1.x-D)

**Location:** Persistent in the AppShell, visible from every screen (Edit / Director / Focus / dashboard / scheduler). Bottom-right corner by default; positioned so it does not collide with the Director Panel when open. Non-blocking — never overlays user content.

**Surface content (in order):**

1. **Director state badge.** `idle` / `thinking` / `awaiting approval` (with conversation-context badge if there is a draft workflow pending user approval).
2. **Scheduler state counters.** Compact "N running · M queued · K parked" line with small icons per state.
3. **Cost meter.**
   - Non-BYOK: percentage bar (0–100%) + reset countdown text ("renews in 14d").
   - BYOK: tokens used (input/output/total compact display) + dollar cost.
4. **Alert dot.** Visible when any Class B/D/E failure (per `docs/stelavox_director_architecture_v2_0.md` §10) is awaiting user action.

**Inviolable discipline:** colours follow design tokens; no verdigris use here (not one of the nine sanctioned categories — Inviolable #2 unchanged).

**Interaction:**

- Click Director state → routes to Director tab.
- Click scheduler counter → routes to SchedulerPanel (§17.4).
- Click cost meter → routes to billing-detail screen.
- Click alert dot → routes to the relevant failure surface.

**Realtime:** subscribed to the Director-sessions registry and the scheduler queue (substrates delivered in V1.x-E).

**Test data hooks:**
- `data-testid="app-shell-status-indicator"` on the container.
- `data-testid="director-state-badge"` with `data-state` attribute (`idle`/`thinking`/`awaiting-approval`).
- `data-testid="scheduler-counters"` with `data-running`/`data-queued`/`data-parked` numeric attributes.
- `data-testid="cost-meter"` with `data-user-type` (`byok`/`platform`).
- `data-testid="alert-dot"` when alert present.

### 17.2 `BriefViewer` (V1.x-A)

**Location:** Mounts in the project header area. Read-only view of the active Brief for the current document. One Brief per document.

**Surface content:**

1. **Goal text** — the user's vision statement in their own words. Inter 400 14px, multi-line, truncates at 4 lines with "show more" affordance.
2. **Stage progress** — ordered list of `StageCard` components (§17.3). Current stage highlighted.
3. **Preferences** — structured display of voice, constraints, named decisions. Inter 400 12px label / 13px value pattern.
4. **Recent amendments** — a small log showing the last 5 approved amendments with timestamps. Inter 300 11px `--color-text-muted`.

**Inviolable discipline:** Inter typography only (structural panel). No prose-editor styling. No verdigris use.

**Interaction:**

- Each StageCard click expands stage detail.
- Preference rows are read-only in V1.x-A; editing happens only via Director-proposed amendments.

### 17.3 `StageCard` (V1.x-A)

**Location:** Nested in `BriefViewer` and in `SchedulerPanel` (§17.4). One per Stage.

**Surface content:**

1. Stage order, title, description.
2. Status badge — `planned` / `proposing` / `proposed` / `approved` / `scheduled` / `running` / `completed` / `cancelled` / `skipped`. Colours follow tokens; no verdigris use.
3. Trigger type indicator — `after-stage` / `scheduled` / `manual` / `compound`. Small icon + tooltip.
4. If `running`: linked workflow with per-step progress.
5. If `proposed`: linked workflow proposal with `Approve` button (verdigris use #7 — affirmative-action triggers).
6. If `completed`: completion timestamp + workflow outcome summary.

### 17.4 `SchedulerPanel` (V1.x-D)

**Location:** Routable view. Accessible from `AppShellStatusIndicator` click-through and from main navigation.

**Surface content:**

- **Brief → Stage → Workflow → Step hierarchy** as a tree.
- Each level shows status and offers level-appropriate actions:
  - **Step** — view detail; Cancel (single step).
  - **Workflow** — Stop / Cancel / view detail.
  - **Stage** — Cancel (with cascade confirmation: "this will cancel N pending workflows; M completed steps will remain").
  - **Brief** — Cancel project (with full cascade confirmation).
- Queue position estimates for parked / scheduled items.
- Current global load indicator.
- Top-up CTA when relevant (non-BYOK users).

### 17.5 `AdminDashboard` (V1.x-E)

**Location:** Admin-only route. Not accessible to regular users (RLS enforced).

**Surface content:**

1. **Live registry** — active Director sessions, workflows, agent_jobs broken down by user, traffic class, and status.
2. **Per-class queue depth and throughput.**
3. **Anthropic header headroom** — RPM, ITPM, OTPM, concurrent-connections, with utilisation percentages.
4. **Failure rate by class** (§10 of Director Architecture v2) — Class A through E.
5. **Cost spend rates** — per user, per org, per model, time-series.
6. **Capacity-planning signals** — sustained-utilisation alerts.
7. **Synthetic probe history** — pass/fail trends.

**Inviolable discipline:** internal tooling; brand identity discipline applies (Cinzel still wordmark-only).

### 17.6 `CostMeter` (V1.x-C)

**Location:** Embedded compact form in `AppShellStatusIndicator` (§17.1); full form at the billing-detail route.

**Compact form per user type:**

| User type | Display |
|---|---|
| BYOK | Tokens in/out/total · $X.XX |
| Non-BYOK | NN% · renews in Nd |

**Full form per user type:**

| User type | Display |
|---|---|
| BYOK | Session + project breakdown · per-model split · 30-day history |
| Non-BYOK | Allocation usage breakdown · top-up CTA · period history |

**Updates** in real-time via Supabase Realtime subscription on `agent_jobs` and `conversation_messages` token + `cost_credits` columns.

### 17.7 `PlanCard` extensions (V1.x-D)

The existing `PlanCard` component (§7.6) gains four V2 affordances:

1. **Cost-estimate line** at the top: "Estimated cost: ~12% of your monthly allowance" (non-BYOK) or "Estimated cost: $X.XX / ~Y tokens" (BYOK).
2. **Over-budget warning banner** when the forward estimate exceeds remaining headroom: pre-emptive prompt to top up or trim before approval.
3. **`batched_24h` toggle** — "Save 50% — deliver within 24 hours" toggle that switches the workflow's execution intent to the Anthropic Batch API path.
4. **Simplified primary action** — single prominent **Approve** button. The per-step approval checkboxes from v2.8 become a secondary affordance behind a "modify" link, surfaced only when the user wants per-step control (iPhone-simplicity per Director Architecture v2 §1.4).

Inviolable use #7 (verdigris affirmative-action triggers) continues to apply to the Approve button. The "modify" link uses `--color-text-secondary`, no verdigris.

### 17.8 Tree-level lock and state badges (V1.x-D)

Extensions to existing `NodeRow` (§4.2) and `NodeStatusBadge` (§4.4):

1. **Auto-lock icon** — shown when a node is locked because it is in an approved or scheduled workflow. Tooltip: "Locked — scheduled for AI work at [time]". Distinct visual from the existing user-initiated lock icon.
2. **Lifecycle status badge** — extends the existing `NodeStatusBadge` to cover new states: `scheduled`, `queued`, `executing`, `completed` (just finished, awaiting author review). Existing `agent-running` and `agent-complete` states retained. Verdigris use #4 (agent-complete) and #5 (approved) retained as-is.
3. **AI-changed flag** — small marker (dot or icon) indicating AI has changed the node's content since the author last viewed it. Cleared when the author opens the node. Uses `--color-info` or similar neutral attention colour; no verdigris.
4. **Optional Stage membership indicator** — small badge showing which Brief Stage the node belongs to, for navigation. Optional UI; can be hidden by user preference.

### 17.9 Stop button refinement (V1.x-D)

The mid-turn Stop button (replacing prior Cancel) shows side-effect honesty messages in a confirmation dialog before halting:

- "Stopping now saves an estimated X tokens / $Y."
- "N of M steps complete. Stop will keep these and pause the rest."

After Stop, a follow-on UI surfaces three options: **Resume** (continues from persisted state), **Cancel** (mark cancelled; abandon remaining work), **View what was done** (browse the partial output).

### 17.10 Conversation Clear button (V1.x-A)

New affordance in the `DirectorPanel` header (§7.1).

**Confirmation dialog:** *"Clearing will discard recent conversation but keep your project Brief and document. Continue?"*

Low-risk action because the Brief carries the durable load.

### 17.11 Director completion acknowledgement (V1.x-D)

When a workflow completes, the Director surfaces a mechanical acknowledgement line in the conversation thread: *"Workflow complete: 12 of 12 steps succeeded."*

The `PlanCard` persists, marked as complete. No silent finishes — this is the closure of the "silent completion" gap identified in the deep-dive.

Reflective acknowledgement (Director re-reads artefacts and offers observation) is deferred to V2.

---

## 18. Changelog

**v2.10 — 2026-05-12** Director Architecture V2 deep-dive absorption. **New §17** documents the V1.x component layer: six new components (`AppShellStatusIndicator`, `BriefViewer`, `StageCard`, `SchedulerPanel`, `AdminDashboard`, `CostMeter`) and five extensions to existing components (`PlanCard` simplification + cost-estimate + `batched_24h` toggle + over-budget warning, `NodeRow`/`NodeStatusBadge` auto-lock + lifecycle states + AI-changed flag, Stop-button refinement with Resume/Cancel/View follow-on, `DirectorPanel` Conversation Clear button, conversation-thread Director completion acknowledgement). Changelog section number moves from §17 to §18 to accommodate the new §17. No Inviolables changed; verdigris use #7 (affirmative-action triggers) extends to the simplified `PlanCard` Approve and stays within the existing four-element family — no new use category introduced. Architectural source: `docs/stelavox_director_architecture_v2_0.md` §15 (UX surfaces). Session record: `docs/sessions/director_v2_deep_dive_session_record_2026-05-11.md`. Five Inviolables unchanged; verdigris-use count remains nine.

**v2.9 — 2026-05-08** Phase 5c close-out absorption — synthesise streaming surface in `§5.9 AgentTab`. New "Streaming state — synthesise via SSE (Phase 5c)" subsection added between the existing "Complete state — token + cost summary" subsection and the §5.10 divider. Specifies the typewriter prose surface that replaces the indeterminate sliding stripe for synthesise specifically (other operations keep the existing Active state). Lora 15px / 1.7 line-height matches ProseEditor for seamless end-of-stream transition. **Verdigris discipline:** the streaming surface introduces no new verdigris use — Inviolable #2 reserves verdigris for nine enumerated places, "prose cursor" use #3 specifically scopes to ProseEditor / FocusMode, and the streaming surface deliberately does not extend that use (no cursor element rendered; the arrival of streamed text is itself the typewriter feel). Cancel button calls `AbortController.abort()` which propagates to the route handler, the upstream Anthropic SDK stream, and `runAgentJobInline`'s finally block (flips agent_jobs to `cancelled` / `client_disconnect`). On `agent_job_complete`, the streaming surface yields to the existing CompleteState (Accept/Dismiss) via the realtime hook's `activeJob`. State reset on node change is via `key={nodeId}` on AgentTab from `NodeDetailPanel` (React-canonical pattern; avoids React 19 strict-mode lint rules against ref-access-during-render). Test data hook: `data-testid="synthesise-streaming-surface"` on the prose container. No other section changes; §5.10 onwards carry forward from v2.8 unchanged. Verdigris-use count remains nine.

**v2.8 — 2026-05-07** Phase 5b close-out absorption (substrate-merged; verification-pending). Two amendments. **§1.4** verdigris use #7 broadened from "Accept button in Agent Tab" to "Author-affirmation buttons — Accept (AgentTab) + Approve (PlanCard)" so PlanCard's Approve verdigris is folded into the existing Completion-category use rather than creating a tenth use (SU-38 — Phase 5b absorbed; the alternative — adding PlanCard Approve as use #10 — was rejected because the two buttons share a single UX function: author-affirmation of agent-produced work). The button-note paragraph below the table updated accordingly. **§7.7** ExecutionCard gains a "Heartbeat indicator" subsection covering the green-dot-pulse-while-running / muted-static-when-stalled liveness signal driven by `workflow.last_heartbeat_at` + `agent_jobs.last_heartbeat_at` (SU-42 — Phase 5b absorbed; the indicator was implemented in T-15 against the v1.1 SU-42 placeholder and is now formally specced). The dot uses `--color-agent-running` (blue), not verdigris — it is a system-state signal, not a completion signal. Reduced-motion preference collapses the pulse. Recovery cron at `/api/cron/director-recovery` (60s) is the backstop. Five Inviolables unchanged; the verdigris-use count remains nine (#7 broadened, not duplicated). All other sections (§2.5 ModeTabBar, §7.1–7.6 + 7.8–7.9, §8 Feedback, §9 Overlay, §15 Accessibility) carry forward unchanged.

**v2.7 — 2026-05-05** Phase 5 close-out absorption — §5.9 AgentTab active-state spec. Two changes to the active-job-state block: (a) the progress bar is now an **indeterminate sliding-stripe** CSS animation (was a percentage-fill bar). The Anthropic SDK's non-streaming `messages.create` call doesn't expose mid-call token usage, so percentage progress would falsely imply progress measurement. The indeterminate stripe correctly conveys "in progress" without false precision. Discovered during T-15 manual UI testing (Phase 5 Test Report Iteration 5) when the user reported the progress bar appearing stuck at ~70%. (b) **No token count is shown during the running state** — `tokens_input` / `tokens_output` are populated only on completion. The complete state gains a one-line summary in Inter 300 10px `--color-text-muted`: `tokens: X in · Y out · Z total · cost $N · model M`. This summary is platform-internal (Product Spec §3.2 — billing surface uses allocation percentage, not dollars; the AgentTab summary is a developer/diagnostic display). No Inviolable changes — Accept button remains verdigris use #7. No other component changes; the §5.10 CommentThread + §5.13 Notes Editor + §5.4 ProseEditor specs are unchanged.

**v2.6 — 2026-05-04** Phase 4 close-out absorption — SU-19 + SU-20. **§9.1 Modal** gains a 🔒 "Scrollable body when content overflows" sub-rule mandating `maxHeight: 85vh` + `overflowY: auto; minHeight: 0` for modals hosting dynamic schema-driven forms (e.g., the Phase 4 `ContextCreateModal` with the per-context-type metadata fields). The rule was discovered when Phase 4 TC-U-05 timed out clicking a `Create` button reported as "outside of the viewport" on a 720p test browser. **§5.2 TabStrip** gains a Context badge row — Inter 300 10px count of direct + inherited context links, hover tooltip splits the totals. Phase 4 ships ContextLinker without the badge (deferred to Phase 5 alongside agent-context-assembly UI signals). No token changes. No Inviolable changes. No new components.

**v2.5 — 2026-05-04** §6.5 SentenceFocus marked Phase-8-deferred via a leading banner. The behaviour spec is unchanged; only the *delivery phase* moves. The Phase 3 implementation shipped a CSS-only stub — the toggle host (three-dot menu) was never built and the segmentation logic was never written. §6.4 TypewriterContainer's "Edit-Mode toggle via three-dot menu" path is similarly noted as Phase-8 work since it shares the toggle host. Phase 8's scope is amended in TA v1.7 §11 to absorb both. No tokens, no Inviolables, no other components touched.

**v2.4 — 2026-05-04** Specification gap correction in §6.1 FocusMode. The earlier text described FocusMode as a *"full-screen overlay mounted above AppShell"* without specifying the React mechanism. The implementation rendered FocusMode as a JSX descendant of `NodeDetailPanel`, which is itself rendered into AppShell's right slot — i.e. inside `[data-shell="detail"]`. The Focus Mode entry transition (§6.1) then sets `opacity: 0` and `transform: translateX(100%)` on `[data-shell="detail"]` to slide it off-screen, but CSS opacity and transform propagate to descendants — including any fixed-position child — so the FocusMode overlay inherited opacity 0 and the parent's translate and never became visible. The user-visible symptom: full Focus Mode entry produces a blank screen. v2.4 amends §6.1 with a 🔒 rule mandating that FocusMode render via `ReactDOM.createPortal(..., document.body)` so the overlay sits outside the AppShell's transformed subtree. No behavioural change to the entry/exit choreography itself, no new tokens, no Inviolable changes.

**v2.3 — 2026-05-04** Specification error correction in §5.5 ProseEditorCursor. The original example code animated `opacity` on the `.ProseMirror` element, which caused the entire prose body to fade in and out at the 600/400ms blink cadence — visible to authors as the *text* blinking. The §5.5 table description was correct from v2.0 onward ("cursor blinks; editor text does not"); only the example code was wrong. Replaced the keyframe to animate `caret-color` between `var(--color-accent)` and `transparent`, leaving editor opacity at 1 throughout. Added a 🔒 explanatory note alongside the corrected code so this can't be re-introduced. The same misimplementation also caused Focus Mode to appear blank for 400ms of every second on still observation. No other changes — no new components, no token changes, no Inviolable changes, no behaviour change for the cursor itself (still 600ms on / 400ms off when idle, solid while typing).

**v2.2 — 2026-05-04** Post-Phase-3-merge corrective: leaf-aware UI gating. Five sections amended. **§4.2 NodeRow:** the `+ Add child` hover button is hidden when `node.is_leaf === true` so the UI mirrors the database's `move_node` layer-violation refusal (Migration 021). **§5.1 NodeDetailPanel:** the Content-tab body composition now spells out which components mount on every node (ConflictBanner, SummaryEditor, MetadataForm, NotesEditor) versus leaves only (ProseEditor, FocusModeButton, WordCount); the `⌘Return` shortcut is correspondingly leaf-gated. **§5.4 ProseEditor / §5.7 WordCount / §5.8 FocusModeButton:** added a 🔒 leaf-only mounting note pointing to the Phase 3 API Contract v1.1 §2.12 `is_leaf` field and TA v1.6 H-15. **§6.1 FocusMode:** clarified that entry is leaf-only — the entry shortcut is wired only on leaves and sibling navigation never lands on a non-leaf. The structural-leaf rule (`node.layer_index === max(layer_stack.layers[*].index)`) is the single source of truth. No new components, no token changes, no Inviolable changes.

**v2.1 — 2026-05-04** Phase 2 close-out absorption + Phase 3 prep. Two changes, both in section 5 (Detail Panel Components). **SU-5 (NotesEditor):** added a new **§5.13 NotesEditor** — Tiptap, Inter 400 13px, sibling to `SummaryEditor` (§5.3), bound to `nodes.notes`. The Notes tab existed as a placeholder in Phase 2's TabStrip but had no component-level spec; this section closes that gap. The architectural rule that NotesEditor and SummaryEditor are separate components (no shared base) is documented. The Link extension is admitted in NotesEditor (and forbidden in SummaryEditor) — rationale recorded. Autosave participation in the Phase 3 1.5s-debounce state machine is referenced. **§5.11 VersionHistory clarification:** added a Phase 3 vs Phase 6 split note. The list, current-version star, hover diff tooltip, and "Show N more" pagination ship in Phase 3 (per Technical Architecture v1.5 §11 — "browseable" checkpoint). The Restore button and all of its lock-aware semantics ship in Phase 6. Phase 3 implementations MUST NOT render the Restore button. The existing "Restore button" row remains as the canonical Phase 6 spec to keep the Phase 6 contract stable. No other components changed.

**v2.0 — 2026-05-01** Restructured to comply with the AI-Native Project Specification Standard v1.1. Derived from `stelavox_component_spec_v1_4.md`. Changes from v1.4: (a) Resolved all four previously-open questions (CQ-1 through CQ-4) with recommendations; added CQ-5 (plan card) and CQ-6 (panel resizer colour) as additional resolved questions — see §16. (b) Updated `--easing-prose` from `cubic-bezier(0.25, 0, 0.5, 1)` to `cubic-bezier(0.25, 0.1, 0.25, 1)` per Brand Identity v2.0 §9.2 — the locked symmetric ease-in-out. (c) Updated verdigris use count from seven to nine per Brand Identity v2.0 §5 — uses #7 (Accept button) and #8 (trial expiry CTA) already existed in v1.4 and are carried forward; all nine uses are documented in §1.4. (d) Corrected `PanelResizer` active/dragging colour from `--color-accent` to `--color-border-strong` — this was an inadvertent violation of the nine sanctioned uses rule. (e) Added §16 Resolved Component Questions section. (f) Updated all companion document references to current versions (Brand Identity v2.0, UI Design Spec v1.0, Tech Arch v1.2, Product Spec v1.2). All component specifications from v1.4 are preserved and carried forward unchanged unless noted above.

**v1.0 — v1.4 history:** See source document `stelavox_component_spec_v1_4.md` Change Control section for the full v1.x changelog. Key milestones: v1.0 initial document post-wireframes; v1.1 Accept button as eighth verdigris use; v1.2 trial expiry CTA as ninth verdigris use; v1.3 tablet layout, mobile notes, attachments; v1.4 scheduler UI components.
