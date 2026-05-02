# Stelavox — UI Design Specification
## Version 1.0

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Mode Architecture](#2-mode-architecture)
3. [Design Tokens](#3-design-tokens)
4. [Layout Grid and Spacing System](#4-layout-grid-and-spacing-system)
5. [Page Templates](#5-page-templates)
6. [Motion and Transition Language](#6-motion-and-transition-language)
7. [System-Level Interaction Patterns](#7-system-level-interaction-patterns)
8. [Notification System](#8-notification-system)
9. [Accessibility Rules](#9-accessibility-rules)
10. [Empty, Loading, and Error States](#10-empty-loading-and-error-states)
11. [Component Inventory](#11-component-inventory)
12. [Key User Journeys](#12-key-user-journeys)
13. [Responsive Behaviour](#13-responsive-behaviour)
14. [Locked Decisions](#14-locked-decisions)
15. [Open Design Questions](#15-open-design-questions)
16. [Changelog](#16-changelog)

---

## 1. Design Philosophy

### 1.1 The Governing Principle

The tool must disappear when the author is writing.

This is not a stylistic preference — it is a functional requirement. Stelavox is a professional creative environment. When an author is synthesising prose for a beat, every pixel of UI chrome competes with the sentence forming in their head. The interface must earn its visibility at every moment. If a UI element does not serve the author's current task, it should be hidden, collapsed, or simply absent.

This principle has a corollary: *when the author needs the structure, it must be instantly, frictionlessly accessible.* The tool disappearing does not mean the structure disappearing — it means the structure waiting, ready, one deliberate gesture away.

### 1.2 Four Tensions the UI Must Navigate

**Structure vs. Flow.** The hierarchical node tree is the product's architectural soul. But when writing prose, the tree is noise. The resolution is mode architecture: different cognitive states have genuinely different interfaces, not the same interface with things greyed out.

**Power vs. Approachability.** Stelavox's full feature set is genuinely complex. A first-time user must reach a working document within five minutes. The governing principle is progressive disclosure: complexity reveals itself as the user seeks it, never before.

**AI vs. Author.** The author is always in control. Agents propose, authors approve, agents execute. The interface makes this power relationship unmistakably clear at every step. The plan-approval interaction is the product's primary trust-building mechanism.

**Efficiency vs. Focus.** Keyboard-first power users and mouse-first users both exist in the audience. Every significant action has a keyboard shortcut. No significant action *requires* one.

### 1.3 Design Precedents

**Scrivener** — the structural organisation benchmark. The three-panel layout (Binder / Editor / Inspector) sets the user's mental model. Weakness: too much visible chrome, steep learning curve.

**iA Writer / Ulysses** — the focused prose writing benchmark. The "tool disappears" principle at its best. Typewriter scrolling, font choice, focus mode — all benchmarks for the prose state.

**Linear** — the benchmark for hierarchy-dense professional tools with clean minimal aesthetics. Deep tree navigation without visual chaos. The design language Stelavox aspires to.

**Cursor** — the benchmark for agentic AI in a structured work environment. Plan-then-execute, visible agent progress, the separation of work surface from AI assistant panel — direct templates for Director Mode.

---

## 2. Mode Architecture

Stelavox operates in three distinct modes. Each is a genuinely different interface state — not the same layout with elements hidden. The current mode is always unambiguous.

### 2.1 Edit Mode

**What it is:** The primary production environment. Used for building and managing document structure, editing node content, triggering individual agent operations, managing context nodes, and reviewing agent output.

**When it is used:** The majority of session time — typically 70–80% of active use.

**Layout:** Three-panel horizontal layout.
- Left: Navigation sidebar (project navigation + context node library)
- Centre: Node tree (the document's hierarchical structure)
- Right: Node detail panel (content editing + agent controls + comments + history)

**Mode indicator:** "Edit" tab in the header `ModeTabBar`, visually active.

### 2.2 Focus Mode

**What it is:** A full-screen prose writing environment. All structure, navigation, and controls are hidden. The author sees only the current node's prose field, a minimal fading breadcrumb, a minimal word count, and an exit hint.

**When it is used:** During prose synthesis, revision at leaf nodes, and sustained writing sessions.

**Entry:** `⌘Return` from a prose field in Edit Mode. **Exit:** `Escape` or `⌘Return`.

**Layout:** Centred prose column on `--color-bg-base`. Nothing else is visible.

### 2.3 Director Mode

**What it is:** The conversational orchestration environment. The author describes goals; the Director produces plans; the author approves; the Director executes.

**When it is used:** For complex multi-step operations, cross-document analysis, structural revision, and situations where the author wants a collaborator to reason about the problem before acting.

**Layout:** Two-panel layout.
- Left: Node tree (always visible — the author can see what the Director is referencing)
- Right: Director panel (conversation thread + plan proposals + execution progress)

The navigation sidebar collapses to an icon rail automatically when Director Mode is entered.

**Mode indicator:** "Director" tab in the header, visually active. A pulse indicator when a workflow is executing.

### 2.4 Mode Transitions

Mode transitions are animated. The author always sees where they came from and where they are going in the same continuous motion. Nothing teleports.

| Transition | Duration | Easing | Behaviour |
|---|---|---|---|
| Edit → Focus | 280ms | `--easing-default` | Tree + panels contract to horizontal edges (translateX) + fade. Header slides up (translateY(-48px)). Prose column expands. All simultaneous. |
| Focus → Edit | 280ms | `--easing-default` | Exact mirror. Cursor position and scroll position restored. |
| Edit → Director | 200ms | `--easing-smooth` | Detail panel dissolves (opacity 0 + translateX(20px)). Director panel slides in from right. Sidebar collapses to icon rail. All simultaneous. |
| Director → Edit | 200ms | `--easing-smooth` | Exact mirror. Sidebar restores to its pre-Director state. |

**State persistence:** The selected node in Edit Mode, the conversation thread in Director Mode, and the cursor position in Focus Mode all persist across transitions.

**Reduced motion:** All transitions map to `--duration-instant` (0ms) when `prefers-reduced-motion` is set.

**Keyboard shortcuts:**
- `⌘.` toggles Edit ↔ Director
- `⌘Return` enters Focus Mode (from Edit Mode prose field)
- `Escape` exits Focus Mode

---

## 3. Design Tokens

All design values are CSS custom properties. Components reference tokens only — never hardcoded hex values in component files. The token file is `styles/tokens.css`.

### 3.1 Colour Tokens — Dark Mode (Primary)

The full rationale for these values is in Brand Identity v2.0 §4. Key principle: `#000000` is not used as a background and `#ffffff` is not used as text — halation research shows the maximum 21:1 contrast causes reading fatigue for the estimated 47% of users with astigmatism. All values are calibrated for sustained reading sessions.

```css
/* ── Backgrounds ── */
--color-bg-base:          #0d1014;  /* 🔒 Deepest surface. App frame, Focus Mode, prose. */
--color-bg-surface:       #131820;  /* Panels, header, sidebar */
--color-bg-elevated:      #1a2030;  /* Modals, dropdowns, popovers */
--color-bg-hover:         #1e2838;  /* Row hover states */
--color-bg-selected:      #1f2d45;  /* Selected rows, user message bubbles */
--color-bg-active-node:   #1f2d45;  /* Currently open node in tree */

/* ── Borders ── */
--color-border-subtle:    #1e2535;  /* Panel dividers, quiet field borders */
--color-border-default:   #253045;  /* Standard borders */
--color-border-strong:    #3a4a62;  /* Focus rings, emphasis borders */

/* ── Text ── */
--color-text-primary:     #ecf0f5;  /* 🔒 Main text. ~14.8:1 on bg-base. NOT #ffffff */
--color-text-secondary:   #8aa0b8;  /* Labels, metadata, helper text */
--color-text-muted:       #4a6080;  /* Placeholder, secondary labels */
--color-text-disabled:    #2a3850;  /* Disabled states */

/* ── Accent — verdigris (9 sanctioned uses only) ── */
--color-accent:           #3d7858;  /* 🔒 See Brand Identity §5 and §12 */
--color-accent-hover:     #5aa87a;
--color-accent-muted:     #1a3028;  /* Selection bg, subtle fills */

/* ── Status ── */
--color-status-draft:     #4a6080;
--color-status-review:    #b87030;
--color-status-approved:  #3d7858;  /* 🔒 Same as --color-accent. Intentional — approved = completion. */
--color-status-locked:    #6a3888;

/* ── Semantic ── */
--color-success:          #3d7858;
--color-warning:          #b87030;
--color-error:            #b03c3c;
--color-info:             #3a6090;

/* ── Agent operations ── */
--color-agent-running:    #2e5a90;
--color-agent-complete:   #3d7858;
--color-agent-failed:     #b03c3c;
```

### 3.2 Colour Tokens — Light Mode

Applied via `[data-theme="light"]` on the `<html>` element. The same halation principle applies — warm parchment base, not pure white.

```css
[data-theme="light"] {
  --color-bg-base:          #f2ede4;  /* 🔒 Warm parchment. NOT #ffffff */
  --color-bg-surface:       #f8f5ee;
  --color-bg-elevated:      #ffffff;  /* True white only at highest elevation */
  --color-bg-hover:         #ede8dc;
  --color-bg-selected:      #e0dbd0;
  --color-bg-active-node:   #e0dbd0;
  --color-border-subtle:    #e0d8cc;
  --color-border-default:   #d4ccbc;
  --color-border-strong:    #b8a898;
  --color-text-primary:     #1e1a12;  /* 🔒 Warm dark ink. NOT #000000 */
  --color-text-secondary:   #6a6050;
  --color-text-muted:       #9a9080;
  --color-text-disabled:    #c0b8a8;
  --color-accent:           #254a38;
  --color-accent-hover:     #3d7858;
  --color-accent-muted:     #deeee6;
  /* Status and agent colours remain the same as dark mode */
}
```

### 3.3 Mode Switching

The user sets their dark/light preference in **account settings only** — not in the header or any visible chrome. The setting is not surfaced unless the user seeks it. The system default respects `prefers-color-scheme` at first launch; the user's explicit choice persists thereafter via `localStorage` key `stelavox_theme`.

Automatic sunrise/sunset switching is available as an opt-in within account settings (off by default). When enabled, the transition is a 2-minute opacity fade centred on the local sunrise/sunset moment — imperceptible during active writing. See Brand Identity v2.0 §4.5.

### 3.4 Typography Tokens

Three typefaces, three roles, no exceptions. See Brand Identity v2.0 §6 for the full rationale.

| Font | Weights loaded | `font-display` | Role |
|---|---|---|---|
| Cinzel | 500 only | block | 🔒 Wordmark only. Never in product UI. |
| Cormorant Garamond | 300 italic only | block | 🔒 Wordmark only. Never in product UI. |
| Inter | 300, 400, 500, 600, 700 | swap | All UI chrome — every label, button, panel, comment |
| Lora | 400, 400 italic, 700 | swap | 🔒 Prose surface only — ProseEditor and Focus Mode |

**Type scale:**

```css
--text-xs:   11px;   /* Inter 400, tracking +0.01em — timestamps, version numbers */
--text-sm:   12px;   /* Inter 400, tracking 0       — secondary labels, helper text */
--text-base: 14px;   /* Inter 400, tracking -0.01em  — body text, node content */
--text-md:   15px;   /* Inter 500, tracking -0.01em  — comfortable panel reading */
--text-lg:   17px;   /* Inter 600, tracking -0.02em  — panel headings, section titles */
--text-xl:   20px;   /* Inter 600, tracking -0.02em  — modal titles */
--text-2xl:  24px;   /* Inter 700, tracking -0.03em  — page-level headings */

/* Prose surface — Lora only */
--text-prose-panel: 16px;   /* ProseEditor in Edit Mode detail panel */
--text-prose-focus: 18px;   /* 🔒 ProseEditor in Focus Mode */
```

**Prose surface specifications** (all values locked — see Brand Identity v2.0 §7):

```css
font-family:      Lora, serif;
font-size:        18px (Focus Mode), 16px (Edit Mode panel);
line-height:      1.85;
max-width:        620px;          /* 66 characters at 18px Lora — Bringhurst's ideal */
text-align:       left;           /* 🔒 Never justified */
margin-bottom:    1.25em;         /* Paragraph spacing. No first-line indent. */
padding-bottom:   120px;          /* 🔒 Author writes into open space */
caret-color:      var(--color-accent);   /* 🔒 Verdigris — sanctioned use #3 */
```

### 3.5 Spacing Tokens

4px base unit. All spacing values are multiples of 4.

```css
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
```

### 3.6 Elevation and Shadow Tokens

Used sparingly — only where genuine elevation separation aids comprehension.

```css
--shadow-sm:  0 1px 3px rgba(0,0,0,0.3);    /* Subtle hover lift */
--shadow-md:  0 4px 12px rgba(0,0,0,0.4);   /* Dropdowns, popovers */
--shadow-lg:  0 8px 32px rgba(0,0,0,0.5);   /* Modals, large overlays */
```

In light mode, reduce all shadow opacities by ~30%.

### 3.7 Border Radius Tokens

```css
--radius-sm:   4px;     /* Small elements: badges, tags, inputs */
--radius-md:   8px;     /* Standard elements: cards, panels, dropdowns */
--radius-lg:   12px;    /* Large elements: modals, large cards */
--radius-full: 9999px;  /* Pills, avatars */
```

### 3.8 Icon System

Lucide React is the icon library. Every layer type and context node type has an assigned icon from Lucide. Icons are never used as decoration — every icon communicates a specific type or state.

**Layer type icons:**

| Layer | Icon | Context type | Icon |
|---|---|---|---|
| book | BookOpen | character | User |
| act | Layers | location | MapPin |
| chapter | FileText | organisation | Building |
| scene | Film | theme | Sparkles |
| beat | Zap | world | Globe |
| locked (any) | Lock | evidence | Quote |

**State icons:**

| State | Icon |
|---|---|
| agent running | breathing animation on type icon (no separate icon) |
| workflow pending | ◌ |
| workflow running | ⟳ (breathing animation) |
| workflow complete | ✓ |
| workflow failed | ✗ |

**Sizing:** 14px for tree rows and panel labels. 16px for button icons. 20px for modal and section headers. 12px for badge contexts.

**Colour:** Always `--color-text-muted` at default. `--color-text-secondary` on hover. `--color-text-primary` when active or selected. Never uses `--color-accent` (verdigris is reserved for its nine sanctioned uses — icons are not among them).

### 3.9 Verdigris Sanctioned Uses

`--color-accent` (#3d7858 dark, #254a38 light) appears in exactly nine places. The complete list with component references:

| # | Location | Component | Category |
|---|---|---|---|
| 1 | Wordmark lozenge | `<Wordmark>` | Brand |
| 2 | Wordmark rule | `<Wordmark>` | Brand |
| 3 | Prose cursor | `<ProseEditor>` / `<FocusMode>` | Inscription |
| 4 | Agent-complete status badge | `<NodeStatusBadge>` | Completion |
| 5 | Approved node status badge | `<NodeStatusBadge>` | Completion |
| 6 | Word count at target | `<WordCount>` | Completion |
| 7 | Accept button background in Agent Tab | `<AgentTab>` (complete state) | Completion |
| 8 | Primary plan CTA on trial expiry modal | `<TrialExpiryModal>` | Completion |
| 9 | Active node left border in tree (2px) | `<NodeRow>` | Location |

**Code verification:** Search the codebase for `--color-accent` and `#3d7858` — every match must correspond to one of these nine locations. See Brand Identity v2.0 §5 for the three-test gate before any proposed tenth use.

---

## 4. Layout Grid and Spacing System

### 4.1 Breakpoints

```css
--breakpoint-sm:   640px;   /* Small tablet / landscape phone */
--breakpoint-md:  1024px;   /* Tablet (iPad standard) */
--breakpoint-lg:  1280px;   /* Small desktop / large tablet landscape */
--breakpoint-xl:  1440px;   /* Comfortable desktop */
--breakpoint-2xl: 1920px;   /* Large desktop */
```

### 4.2 Column Grid Per Breakpoint

The application does not use a traditional column grid for its main layout — it uses a fixed-panel flex layout. The column grid applies within content areas such as the project dashboard, settings pages, and marketing pages.

| Breakpoint | Columns | Gutter | Content max-width |
|---|---|---|---|
| ≥1920px (`2xl`) | 16 | 24px | 1440px centred |
| ≥1440px (`xl`) | 12 | 24px | 1280px |
| ≥1280px (`lg`) | 12 | 20px | Full width |
| ≥1024px (`md`) | 8 | 16px | Full width |
| ≥640px (`sm`) | 4 | 12px | Full width |
| <640px | 2 | 12px | Full width |

### 4.3 Application Shell Panel Widths

The application shell uses a fixed-panel flex layout within the viewport, not the column grid.

| Panel | Desktop default | Min | Max | Resize |
|---|---|---|---|---|
| Sidebar (expanded) | 220px | 220px | 340px | User drag |
| Sidebar (icon rail) | 48px | 48px | 48px | Fixed |
| Node tree | flex: 1 | 320px | — | Fills remainder |
| Detail panel | 380px | 320px | 540px | User drag |
| Director panel | 580px | 400px | 55% viewport | Fixed |

Panel widths persist in `localStorage` keys `stelavox_sidebar_width` and `stelavox_detail_width`.

### 4.4 Prose Column Dimensions

The prose column dimensions are the most precisely specified layout values in the product, derived from typographic research. See Brand Identity v2.0 §7 for full rationale.

| Context | Max-width | Side margins | Bottom padding |
|---|---|---|---|
| Focus Mode (desktop) | 620px | 48px minimum | 120px |
| Focus Mode (tablet ≤1024px) | 560px | 32px minimum | 120px |
| Edit Mode (detail panel) | Fills panel width | 16px | 40px |

### 4.5 Header and Chrome Heights

| Element | Height |
|---|---|
| Header | 48px fixed |
| Tab strip (detail panel) | 32px fixed |
| Tree toolbar | 36px fixed |
| Node row (desktop) | 36px |
| Node row (tablet) | 44px (touch target compliance) |

### 4.6 Touch Targets

Minimum interactive element size: 44×44px (iOS HIG / Android Material Design standard). Applies on all tablet and touch surfaces. On desktop, minimum is 28×28px for icon buttons.

---

## 5. Page Templates

### 5.1 Template 1 — Project Dashboard

The first screen after login. Uses the 12-column content grid at ≥1280px, narrows to 8 columns on tablet.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Wordmark]                                     [+ New Project]  │  ← 48px header
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Good evening, James.                                           │  ← greeting
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ The Veil         │  │ PhD Research     │  │ + New        │  │  ← project cards (3-col)
│  │ Chronicles       │  │ 2025             │  │ Project      │  │
│  │ 3 documents      │  │ 2 documents      │  │              │  │
│  │ Novel · Active   │  │ Academic · Active│  │              │  │
│  │ Edited 2h ago    │  │ Edited yesterday │  │              │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                 │
│  Recent documents                                               │  ← secondary section
│  ─────────────────────────────────────────────────────────────  │
│  📖 The Iron Veil · Book 1                  Edited 2 hours ago  │
│  📄 Methodology Chapter                     Edited yesterday    │
│  📖 The Silver Chain · Book 2               Edited 3 days ago   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Greeting:** Inter 400 20px `--color-text-primary`. Time-based (morning / afternoon / evening).
**Project card:** `--color-bg-surface`, `1px --color-border-subtle`, `--radius-md`, 180px height. Hover: `--color-bg-hover`, `--shadow-sm`.
**Recent document row:** 40px height, Inter 400 13px, hover: `--color-bg-hover`.
**Empty state (no projects):** "Create your first project to begin." + [New Project] button.

### 5.2 Template 2 — Edit Mode (Primary)

The three-panel application shell. Used ~70–80% of session time.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Wordmark] [Project/Document breadcrumb]  [Edit|Director] [User]│  ← Header 48px
├──────────┬──────────────────────────────┬───────────────────────┤
│          │ [🔍 Search] [Filter▾] [View▾] │  [Node Name]         │
│ SIDEBAR  ├──────────────────────────────┤  [Breadcrumb]        │
│          │                              │  [Content|Comments|  │
│ Projects │  NODE TREE                   │   Agent|History|     │
│ ──────── │                              │   Context]           │
│ Context  │  ▼ Book: The Iron Veil       │                      │
│ Library  │    ▼ Act One                 │  [Tab content]       │
│          │      ▼ Chapter 1             │                      │
│ ──────── │        ▷ Scene 1             │                      │
│ Settings │        ▷ Scene 2             │                      │
│          │      ▷ Chapter 2             │                      │
│ 220px    │      flex: 1                 │  380px               │
└──────────┴──────────────────────────────┴───────────────────────┘
```

### 5.3 Template 3 — Director Mode

Two-panel layout. Sidebar collapses to icon rail. Tree remains full width.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Wordmark] [breadcrumb]          [Edit|Director●] [User]        │  ← Header 48px
├────┬────────────────────────────┬────────────────────────────────┤
│    │                            │ ◆ The Director  [History▾]   │
│ 🔒 │  NODE TREE                 ├────────────────────────────────┤
│ 48 │                            │ CONVERSATION THREAD            │
│ px │  ▼ Book: The Iron Veil     │ (scrollable)                  │
│    │    ▼ Act One               │                               │
│    │      ▼ Chapter 3 [⟳]       │ [Plan card or messages]       │
│    │        ▷ Scene 1 [◌]       │                               │
│    │        ▷ Scene 2 [⟳]       ├────────────────────────────────┤
│    │      ▷ Chapter 4 [◌]       │ [message input]    [Send ↑]   │
│    │  flex: 1                   │ 580px (max 55vw)              │
└────┴────────────────────────────┴────────────────────────────────┘
```

### 5.4 Template 4 — Focus Mode

Full viewport. No panels. No header. No chrome.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│              The Iron Veil · Act One · Chapter 5 · Beat 3       │  ← breadcrumb (fades)
│                                                                 │
│                                                                 │
│         The letter was not where she had left it.               │
│                                                                 │
│         Elena moved through the archive's back                  │
│         corridor slowly, more slowly than was                   │  ← 620px max-width
│         necessary, her fingers trailing the shelf               │    Lora 18px
│         spines without reading them.                            │    Line-height 1.85
│                                                                 │
│                                                                 │
│                                                                 │
│                          342 / 400 words                        │  ← word count (fades)
│                                                           Esc ↩ │  ← exit hint (fades)
└─────────────────────────────────────────────────────────────────┘
```

Background: `--color-bg-base` (#0d1014). Nothing else visible after inactivity fades.

### 5.5 Template 5 — Settings Pages

Standard two-column layout: left navigation rail (200px), right content area.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Wordmark]  [Project breadcrumb]              [Back to document] │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│  General             │  [Section heading]                       │
│  Members             │                                          │
│  Billing          ←  │  [Form fields / tables / content]        │
│  API Key             │                                          │
│  Security            │                                          │
│  Appearance          │                                          │
│                      │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

Settings navigation items: Inter 400 13px `--color-text-secondary`. Active: Inter 500 `--color-text-primary`, `--color-bg-active-node` bg. No verdigris on active nav items (see Inviolable #2 in Brand Identity §12).

### 5.6 Template 6 — Onboarding

Minimal. Two screens: signup, then document setup.

**Screen 1 — Signup:**
Centred card (480px), `--color-bg-surface`, on `--color-bg-base`. Wordmark at top. Email + password fields. "Sign up with Google" secondary option. Link to login.

**Screen 2 — First document setup:**
After signup, a single question: "What are you writing?" with three cards: Novel / Academic paper / Professional document. Selection sets the default template. No other required fields. The user lands in an empty Edit Mode document immediately after.

**Progressive disclosure:** The user's first view in the product contains: empty node tree, empty detail panel, one `[+ Add root node]` button, one tooltip. Nothing else.

---

## 6. Motion and Transition Language

All motion values are defined as CSS custom properties in `styles/tokens.css`. No hardcoded durations or easings in component files.

### 6.1 Duration Tokens

```css
--duration-instant:   0ms;    /* prefers-reduced-motion target */
--duration-fast:      120ms;  /* Hover states, focus rings, badge colour changes */
--duration-normal:    200ms;  /* Panel switches, dropdown appearance */
--duration-medium:    280ms;  /* Mode transitions (Edit ↔ Focus, Edit ↔ Director) */
--duration-slow:      350ms;  /* Modal entrance */
--duration-prose:     600ms;  /* Sentence focus fade — calm, not snappy */
--duration-wordcount: 800ms;  /* Word count fade-in — gentle return */
```

### 6.2 Easing Tokens

```css
--easing-crisp:   cubic-bezier(0.4, 0, 1, 1);          /* Out — panels snapping into place */
--easing-default: cubic-bezier(0.16, 1, 0.3, 1);        /* Expo out — mode transitions */
--easing-smooth:  cubic-bezier(0.4, 0, 0.2, 1);         /* Standard ease — most UI */
--easing-prose:   cubic-bezier(0.25, 0.1, 0.25, 1);     /* 🔒 Symmetric ease-in-out — prose fades */
```

Note: `--easing-prose` is a symmetric ease-in-out. It is deliberately different from `--easing-default` and `--easing-smooth` — prose fades (sentence focus, word count) are meant to be gradual and imperceptible, not snappy. The symmetric curve ensures neither the start nor the end of the fade feels abrupt.

### 6.3 Reduced Motion

All animations must honour `prefers-reduced-motion`. Apply globally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0ms !important;
  }
}
```

The breathing animations on `AgentActivityIndicator`, `WorkflowStepIndicator`, and `ThinkingIndicator` must all stop under `prefers-reduced-motion`.

### 6.4 Motion Rules

- No bounce, overshoot, or spring easings anywhere in the product
- Status badge colour changes: instant (0ms) — information, not events
- No loading animations designed to be aesthetically pleasing — they communicate state, not personality
- Maximum animation duration: 350ms (modal entrance). Most transitions are 200ms or below.
- Prose-specific fades (sentence focus, word count) are longer (600–800ms) because they must be imperceptible, not noticed

### 6.5 Specific Animation Catalogue

| Element | Animation | Duration | Easing | Notes |
|---|---|---|---|---|
| Mode Enter Focus | Tree/panels → edges, prose expands, header slides up | 280ms | `--easing-default` | All simultaneous |
| Mode Exit Focus | Exact mirror | 280ms | `--easing-default` | |
| Mode Enter Director | Detail dissolves + translateX(20px), Director slides in | 200ms | `--easing-smooth` | |
| Mode Exit Director | Exact mirror | 200ms | `--easing-smooth` | |
| Sidebar collapse/expand | Width transition | 200ms | `--easing-smooth` | |
| Modal entrance | opacity 0 + scale(0.96) → 1 | 350ms | `--easing-default` | |
| Modal exit | opacity 0 + scale(0.96) | 200ms | `--easing-crisp` | |
| Dropdown entrance | opacity 0 + translateY(-4px) → 0 | 120ms | `--easing-default` | |
| Toast entrance | translateX(24px) + opacity 0 → 0 | 200ms | `--easing-default` | |
| Toast exit | opacity 0 + translateX(24px) | 200ms | `--easing-crisp` | |
| Command palette entrance | opacity 0 + translateY(-8px) → 0 | 200ms | `--easing-default` | |
| Tree chevron rotation | 0° → 90° on expand | 120ms | `--easing-crisp` | |
| Agent activity (tree icon) | opacity 1→0.4→1 (breathing) | 2s | ease-in-out infinite | Only unsolicited animation in tree |
| Director thinking dots | opacity 0.3→1→0.3, staggered | 1.2s | ease-in-out infinite | Stagger 0.2s per dot |
| Sentence focus shift | opacity transition on all paragraphs | 200ms | `--easing-prose` | On cursor move to new sentence |
| Word count fade-in | opacity 0 → 0.4 | 800ms | `--easing-prose` | After 3s typing pause |
| FocusBreadcrumb fade | opacity change | 800ms | `--easing-prose` | On inactivity / mouse movement |
| Workflow execution (plan → running) | Step indicators animate in | 120ms | `--easing-smooth` | |

---

## 7. System-Level Interaction Patterns

These patterns define how interactive elements behave at the system level. Individual components inherit these patterns — they are not re-specified per component.

### 7.1 Element States

Every interactive element must implement all applicable states from this set. Component files must not define state colours inline — all states use the token values below.

| State | Background | Text | Border | Notes |
|---|---|---|---|---|
| Default | transparent or `--color-bg-surface` | `--color-text-secondary` | `--color-border-subtle` | Resting state |
| Hover | `--color-bg-hover` | `--color-text-primary` | `--color-border-default` | 120ms transition |
| Active (pressed) | `--color-bg-selected` | `--color-text-primary` | `--color-border-default` | Instant |
| Focused | Unchanged | Unchanged | 2px `--color-border-strong` (focus ring) | See §7.2 |
| Selected / Active item | `--color-bg-active-node` | `--color-text-primary` Inter 500 | 2px left `--color-accent` (tree only) | Persistent selection |
| Disabled | Unchanged | `--color-text-disabled` | `--color-border-subtle` opacity 0.5 | `pointer-events: none` |
| Loading | Unchanged | `--color-text-muted` | Unchanged | Spinner replaces icon |
| Error | `rgba(176,60,60,0.08)` | `--color-error` | `1px --color-error` | Form fields |

### 7.2 Focus Ring

Every interactive element must have a visible focus ring for keyboard navigation.

```css
:focus-visible {
  outline: 2px solid var(--color-border-strong);
  outline-offset: 2px;
}
/* Remove for mouse interaction only — accessibility still served by :focus-visible */
:focus:not(:focus-visible) {
  outline: none;
}
```

Focus rings must be visible in both dark and light mode. `--color-border-strong` (#3a4a62 dark, #b8a898 light) provides sufficient contrast on both backgrounds. Focus is trapped within modals and the command palette and returns to the trigger element when overlays close.

### 7.3 Button Hierarchy

Three button levels. Never use a primary button and a secondary button together where only one clear action exists.

| Level | Style | Use |
|---|---|---|
| Primary | `--color-agent-running` bg, white Inter 500 text, `--radius-sm` | The single most important action in the current context |
| Secondary | `1px --color-border-default` border, transparent bg, Inter 400 `--color-text-secondary` | Alternative or supporting actions |
| Ghost | No border, no bg, Inter 400 `--color-text-muted` | Tertiary actions, dismiss, cancel |

**Exception:** Two buttons use `--color-accent` (verdigris) as their background: the Accept button in the Agent Tab (sanctioned use #7) and the primary plan CTA on the trial expiry modal (sanctioned use #8). These are completion-category uses and override the standard primary button colour. No other button uses verdigris.

**Destructive actions:** Use `--color-error` text on secondary button style. Never use a red primary button as the default choice.

### 7.4 Form Fields

| Property | Default | Focused | Error |
|---|---|---|---|
| Background | `--color-bg-base` | `--color-bg-base` | `rgba(176,60,60,0.04)` |
| Border | `1px --color-border-subtle` | `1px --color-border-strong` | `1px --color-error` |
| Text | `--color-text-primary` | `--color-text-primary` | `--color-text-primary` |
| Placeholder | `--color-text-disabled` italic | — | `--color-text-disabled` italic |
| Error message | — | — | Inter 300 11px `--color-error`, margin-top: 4px |

Field height: 36px for standard inputs, 32px for compact inputs. Border-radius: `--radius-sm` (4px).

### 7.5 Inline Editing

Node names and short descriptions in the tree are inline-editable on double-click. Rules:

- Only one node is editable at a time. Beginning to edit a second node auto-saves and closes the first.
- The editing field replaces the display text exactly — same position, no layout shift.
- `Enter` confirms and closes. `Escape` cancels and restores the previous value.
- Auto-save on blur (clicking elsewhere).
- No explicit save button.

### 7.6 Drag and Drop (Node Reordering)

Nodes are reorderable within their sibling group via drag and drop (react-arborist).

- **Drag handle:** Visible on hover at the far left of the node row (six dots icon, `--color-text-muted`).
- **Dragging state:** Node row at 0.7 opacity, `--shadow-sm`, cursor `grabbing`.
- **Drop target indicator:** 2px `--color-accent` horizontal line between target siblings.
- **Locked nodes:** Cannot be dragged or reordered. The drag handle is hidden.
- **Cross-layer drops:** Not permitted. Nodes can only reorder within their sibling layer.

On tablet: drag handles are replaced by a long-press gesture (500ms) to initiate drag.

### 7.7 Confirmation Patterns

Only three actions require a confirmation modal: layer locking, node deletion, and leaving with unsaved changes. All other potentially destructive actions (status changes, refining prose) are recoverable via version history — they do not require confirmation.

**Modal copy standard (from Brand Identity v2.0 §10):** State what will happen specifically. State reversibility. No exclamation marks. No "Are you sure?"

| Action | Title | Body | Buttons |
|---|---|---|---|
| Lock layer | "Lock Chapter layer?" | "Individual nodes can be unlocked later." | Lock · Cancel |
| Delete node | "Delete [name]?" | "This cannot be undone. [N] child nodes will also be deleted." | Delete (error) · Cancel |
| Unsaved changes | "Leave without saving?" | "Your changes to [node name] will be lost." | Save and leave · Leave · Cancel |

### 7.8 Progressive Disclosure

Features are revealed only in the moment they become useful. Implementation:

| Feature | Revealed when |
|---|---|
| Agent tab in detail panel | Node has content (summary or prose populated) |
| Comments badge | Unresolved comments exist on this node |
| History tab badge | More than one version exists |
| Document Operations in tree toolbar | At least one layer is locked |
| Context tab linked context | Context nodes have been linked to this node |
| Attachments tab | `attachment_count > 0` on this node (V2) |
| Mobile Notes section | `mobile_notes.length > 0` on this node |

None of these features are announced or prompted — they appear when relevant. The author learns them through use, not through onboarding.

---

## 8. Notification System

### 8.1 Governing Principle

Notifications must never interrupt writing. The notification system is **toast-only** — there is no notification centre, no notification bell, no inbox, no unread count in the header. Toast messages appear at the bottom-right of the viewport and auto-dismiss. The author is never required to act on a notification to continue working.

This is a product-level decision grounded in the brand philosophy: the tool must not demand attention it has not been given. A notification bell with an unread count sits in the peripheral vision demanding acknowledgement. Toasts do not — they appear, communicate, and disappear.

### 8.2 What Triggers a Toast

| Event | Variant | Title | Body (optional) |
|---|---|---|---|
| Agent operation complete | success | "[Operation]: [node name]" | "Previous version saved in history." |
| Agent operation failed | error | "[Operation] failed." | "The API returned an error. Your content is unchanged." |
| Workflow complete | success | "Workflow complete." | "[N] steps executed." |
| Workflow step failed | error | "Step [N] failed." | "The workflow has paused. Review in the Director panel." |
| API limit approaching (80%) | warning | "Token budget at 80%." | — |
| API limit reached | warning | "Token budget reached. AI operations paused." | — |
| Lock conflict | warning | "[Node name] is locked by [name]." | — |
| BYOK key invalid | error | "API key rejected." | "Update your key in Organisation Settings → API Key." |
| Backup complete | success | "Backup complete." | "[N] documents backed up to [provider]." |
| Backup failed | error | "Backup failed." | "Check your [provider] connection in Organisation Settings." |

### 8.3 What Does Not Trigger a Toast

Status badge changes, version creation, comment resolution, node reordering, word count reaching target, auto-save — none of these generate toasts. They are visible in the interface state without announcement.

### 8.4 Toast Specifications

Position: fixed, bottom-right, `right: 24px`, `bottom: 24px`. Maximum 3 visible simultaneously — the oldest auto-dismisses when a 4th appears. Stack direction: upward (newest at bottom, closest to trigger). Gap: 8px.

Auto-dismiss: 4000ms. The author can dismiss manually via the × button.

See Component Specification v2.0 §8.1 for the full `Toast` component specification.

---

## 9. Accessibility Rules

### 9.1 Contrast Requirements

All text must meet WCAG AA minimum. Prose text meets AAA.

| Token pairing | Ratio | Level |
|---|---|---|
| `--color-text-primary` on `--color-bg-base` | 14.8:1 | AAA |
| `--color-text-secondary` on `--color-bg-surface` | ~5.2:1 | AA |
| `--color-text-muted` on `--color-bg-base` | ~3.1:1 | AA large text only — use at 14px+ only |
| `--color-accent` on `--color-bg-base` | ~4.8:1 | AA |

Light mode pairings must meet the same standards. Verify all light mode combinations against WCAG 2.1 AA before each phase ships.

### 9.2 Keyboard Navigation

Every significant action has a keyboard shortcut. Every interactive element is reachable by Tab in reading order. No action requires a mouse.

**Core keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| `⌘K` | Open command palette |
| `⌘Return` | Enter / exit Focus Mode |
| `⌘.` | Toggle Edit ↔ Director Mode |
| `⌘E` | Expand current node (agent) |
| `⌘S` | Synthesise prose (current node) |
| `⌘1` | Focus node tree |
| `⌘2` | Focus detail panel |
| `↑↓` | Navigate tree nodes |
| `→←` | Expand / collapse tree node |
| `Enter` | Open selected node in detail panel |
| `⌘←/⌘→` | Previous / next sibling node (Focus Mode) |
| `Escape` | Exit Focus Mode / close modal / close palette |

### 9.3 ARIA Landmarks

Every page template must implement the following ARIA landmark structure:

```html
<header role="banner">           <!-- AppHeader -->
<nav role="navigation"
     aria-label="Project navigation">   <!-- Sidebar -->
<main role="main">               <!-- Mode body -->
<aside role="complementary"
       aria-label="Node detail"> <!-- DetailPanel -->
<aside role="complementary"
       aria-label="Director">    <!-- DirectorPanel (Director Mode only) -->
```

### 9.4 Component-Level ARIA Requirements

| Component | ARIA requirements |
|---|---|
| Node tree | `role="tree"` on container, `role="treeitem"` per row, `aria-expanded`, `aria-level`, `aria-selected`. Screen reader label on each row includes node name and status: `aria-label="Chapter 5, approved"`. |
| Status badges | Not announced on change — status available via node row `aria-label`. Avoids excessive announcements during agent operations. |
| Mode tab bar | `role="tablist"` on container, `role="tab"` per tab, `aria-selected` on active. |
| Modals | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to header. Focus trapped. Escape closes. Focus returns to trigger on close. |
| Toasts | `role="status"` for success/info (polite). `role="alert"` for error/warning (assertive). `aria-live="polite"` on the toast container. |
| Dropdown menus | `role="menu"`, `role="menuitem"`, keyboard navigation with `↑↓`, `Enter` selects, `Escape` closes. |
| ProseEditor | `aria-label="Prose content"`, `aria-multiline="true"`. |
| SummaryEditor | `aria-label="Node summary"`. |
| FocusBreadcrumb | `aria-hidden="true"` — decorative location text, not navigation. |
| CommandPalette | `role="combobox"` on input, `role="listbox"` on results, `aria-activedescendant` on focused result. |

### 9.5 Reduced Motion

See §6.3. `prefers-reduced-motion` maps all animation durations to 0ms. No exceptions.

---

## 10. Empty, Loading, and Error States

### 10.1 Empty States

Empty states are minimal and text-only. No illustrations in V1. Copy follows the Brand Identity voice standard: state what is absent, not what the author should feel.

| Context | Empty state copy | Action available |
|---|---|---|
| No projects | "No projects yet." | [New Project] button |
| New document (no nodes) | "Your document is empty." | [+ Add Book Node] prompt |
| Parent node with no children | Dimmed inline row "+ Add [layer type]..." | Click creates child inline |
| No context nodes | "No context nodes linked to this node." | [+ Link context node] button |
| No comments | "No comments on this node." | New comment form always visible |
| No version history | "No previous versions." | — |
| No mobile notes | "Notes added on your phone will appear here." | — |
| Director — first use | "The Director is ready. Describe what you want to achieve." | Message input |
| Director — no workflow history | "No previous workflows." | — |

**Visual treatment:** All empty states use `--color-text-muted`, Inter 300, 12–13px, centred within the containing area. No icons, no illustrations, no buttons except where an action is listed above.

### 10.2 Loading States

| Context | Loading treatment |
|---|---|
| Initial page load | Skeleton screens — grey shimmer blocks in the positions of actual content. Duration: until data is ready. |
| Agent operation in progress | Progress bar in Agent tab + breathing animation on tree node icon. No modal or overlay — the author can navigate elsewhere. |
| Director processing | `ThinkingIndicator` in conversation thread. Input disabled with "Director is working..." placeholder. |
| Export generating | Inline progress in the export dialog — percentage + "Generating [format]..." No separate page. |
| Backup running | Silent — no indicator during the run. Toast on completion or failure. |

**Skeleton screen specification:** Shimmer blocks use `--color-bg-hover` as base with `--color-bg-elevated` as the shimmer highlight. Animation: `background-position` sweep left to right, 1.5s ease-in-out infinite. Respects `prefers-reduced-motion` (static on reduced motion).

### 10.3 Error States

Errors are specific, actionable, and never blame the author. See Brand Identity v2.0 §10.3 for the full copy standard.

| Context | Treatment |
|---|---|
| Agent operation failed | Toast (error variant) with specific message. Content in the node is unchanged. |
| Form validation error | Inline red border on the failing field + error message below the field. Submit button does not disable — shows errors on attempt. |
| Network error (API unreachable) | Toast (error): "Connection error. Check your internet connection and try again." |
| BYOK key invalid | Toast (error) + banner in Organisation Settings → API Key. |
| Token budget exceeded | Non-blocking banner in the agent panel area: "Token budget reached for this period. [View plans]." Agent buttons disabled. |
| Supabase auth error | Redirect to login with query param: `?error=session_expired`. Banner on login page: "Your session has expired. Sign in again." |
| 404 (document/node not found) | Centred message in the main content area: "This [document / node] was not found. It may have been deleted." Link back to dashboard. |

---

## 11. Component Inventory

See Component Specification v2.0 for the full specification of every component. The table below is the definitive inventory — every component that must be built.

### 11.1 Layout Components

| Component | File | Description |
|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | Root layout: header + mode body |
| `Header` | `components/layout/Header.tsx` | 48px fixed header |
| `Sidebar` | `components/layout/Sidebar.tsx` | Collapsible left sidebar |
| `PanelResizer` | `components/layout/PanelResizer.tsx` | Drag handle between panels |
| `ModeTabBar` | `components/layout/ModeTabBar.tsx` | Edit / Director mode switcher |

### 11.2 Navigation Components

| Component | File | Description |
|---|---|---|
| `Wordmark` | `components/brand/Wordmark.tsx` | 🔒 Only component using Cinzel/Cormorant |
| `HeaderBreadcrumb` | `components/nav/HeaderBreadcrumb.tsx` | Clickable ancestor chain in header |
| `CommandPalette` | `components/nav/CommandPalette.tsx` | ⌘K search with commands and nodes |
| `ProjectDashboard` | `components/nav/ProjectDashboard.tsx` | Project card grid |
| `ProjectCard` | `components/nav/ProjectCard.tsx` | Individual project card |
| `NewDocumentModal` | `components/nav/NewDocumentModal.tsx` | Template picker for new documents |

### 11.3 Tree Components

| Component | File | Description |
|---|---|---|
| `NodeTree` | `components/tree/NodeTree.tsx` | Root react-arborist tree |
| `NodeRow` | `components/tree/NodeRow.tsx` | Individual node row |
| `NodeStatusBadge` | `components/tree/NodeStatusBadge.tsx` | 8px status dot |
| `LayerDivider` | `components/tree/LayerDivider.tsx` | Horizontal separator with layer label |
| `TreeToolbar` | `components/tree/TreeToolbar.tsx` | Search, filter, expand/collapse controls |
| `AgentActivityIndicator` | `components/tree/AgentActivityIndicator.tsx` | Breathing animation on active nodes |
| `WorkflowStepIndicator` | `components/tree/WorkflowStepIndicator.tsx` | ◌ ⟳ ✓ ✗ during Director execution |
| `WordCountBar` | `components/tree/WordCountBar.tsx` | 36×3px progress bar on leaf nodes |

### 11.4 Detail Panel Components

| Component | File | Description |
|---|---|---|
| `NodeDetailPanel` | `components/detail/NodeDetailPanel.tsx` | Root right panel |
| `TabStrip` | `components/detail/TabStrip.tsx` | Content/Comments/Agent/History/Context tabs |
| `SummaryEditor` | `components/detail/SummaryEditor.tsx` | 🔒 Tiptap + Inter — planning text only |
| `ProseEditor` | `components/detail/ProseEditor.tsx` | 🔒 Tiptap + Lora — prose surface |
| `ProseEditorCursor` | `components/detail/ProseEditorCursor.tsx` | 2px verdigris cursor CSS override |
| `SelectionTooltip` | `components/detail/SelectionTooltip.tsx` | Bold · Italic · Link on selection |
| `WordCount` | `components/detail/WordCount.tsx` | Fading word count with target state |
| `FocusModeButton` | `components/detail/FocusModeButton.tsx` | ⊞ Focus Mode entry button |
| `MetadataForm` | `components/detail/MetadataForm.tsx` | Dynamic fields from node type schema |
| `AgentControls` | `components/detail/AgentControls.tsx` | Instruction, profile, operation buttons |
| `CommentThread` | `components/detail/CommentThread.tsx` | Comment list with type indicators |
| `VersionHistory` | `components/detail/VersionHistory.tsx` | Version list with restore |
| `ContextLinker` | `components/detail/ContextLinker.tsx` | Context node list and linker |
| `MobileNotesSection` | `components/detail/MobileNotesSection.tsx` | Read-only phone notes log |
| `AttachmentsTab` | `components/detail/AttachmentsTab.tsx` | File attachments (V2 UI) |

### 11.5 Focus Mode Components

| Component | File | Description |
|---|---|---|
| `FocusMode` | `components/focus/FocusMode.tsx` | Full-screen overlay |
| `FocusBreadcrumb` | `components/focus/FocusBreadcrumb.tsx` | Fading non-clickable breadcrumb |
| `FocusWordCount` | `components/focus/FocusWordCount.tsx` | Fading word count |
| `FocusEscHint` | `components/focus/FocusEscHint.tsx` | Exit hint (fades after 5s, never returns) |
| `TypewriterContainer` | `components/focus/TypewriterContainer.tsx` | Active line at 42% viewport height |
| `SentenceFocus` | `components/focus/SentenceFocus.tsx` | Opacity fade by sentence proximity |

### 11.6 Director Components

| Component | File | Description |
|---|---|---|
| `DirectorPanel` | `components/director/DirectorPanel.tsx` | Root panel, 580px max 55vw |
| `ConversationThread` | `components/director/ConversationThread.tsx` | Scrollable message list |
| `UserMessage` | `components/director/UserMessage.tsx` | Right-aligned bubble |
| `DirectorMessage` | `components/director/DirectorMessage.tsx` | Left-aligned with ◆ indicator |
| `ThinkingIndicator` | `components/director/ThinkingIndicator.tsx` | Animated dots while processing |
| `PlanCard` | `components/director/PlanCard.tsx` | Trust-building plan proposal |
| `ExecutionCard` | `components/director/ExecutionCard.tsx` | Live step progress after approval |
| `ResearchCard` | `components/director/ResearchCard.tsx` | Research proposal (V2) |
| `DirectorInput` | `components/director/DirectorInput.tsx` | Message input with @ mention |

### 11.7 Feedback Components

| Component | File | Description |
|---|---|---|
| `Toast` | `components/feedback/Toast.tsx` | Individual toast notification |
| `ToastManager` | `components/feedback/ToastManager.tsx` | Singleton root-level manager |
| `ProgressBar` | `components/feedback/ProgressBar.tsx` | Inline 3px progress bar |

### 11.8 Overlay Components

| Component | File | Description |
|---|---|---|
| `Modal` | `components/overlay/Modal.tsx` | Standard modal with backdrop |
| `Dropdown` | `components/overlay/Dropdown.tsx` | Dropdown menu |
| `Tooltip` | `components/overlay/Tooltip.tsx` | 600ms hover tooltip |

### 11.9 Scheduler Components

| Component | File | Description |
|---|---|---|
| `ScheduleButton` | `components/scheduler/ScheduleButton.tsx` | Split-button: Run Now + Schedule |
| `SchedulePicker` | `components/scheduler/SchedulePicker.tsx` | Schedule configuration dropdown |
| `ScheduledJobsList` | `components/scheduler/ScheduledJobsList.tsx` | Organisation-level jobs list |

---

## 12. Key User Journeys

These journeys define the specific flows the UI must support. They correspond to the user journeys in Product Specification v1.2 §6 — see that document for the acceptance signals. The descriptions here are at the interaction level: what the user does and what they see.

### 12.1 Onboarding: First-Time User to First Document (Target: <5 minutes)

1. Signup: email + password or Google. Single screen.
2. "What are you writing?" — three cards. Selection sets default template. One click, no form.
3. Empty dashboard: one nudge, [Create your first project →].
4. Project name only — no other required fields.
5. Redirected to New Document. Novel pre-selected. [Create Document].
6. Empty Edit Mode. Single tooltip: "This is your node tree. Start by adding your book summary →." [+ Add Book Node] prominent.
7. Book node created. Detail panel opens. Summary placeholder: "Summarise this node for the agent...". Tooltip: "Write a brief summary of your book here."
8. User types. Auto-saves. First version created.
9. Not yet seen: agent profiles, context nodes, locking, versioning, document operations, Director, BYOK, or organisation settings.

### 12.2 Core Workflow: Book to Chapter Summaries

1. Book node with completed summary. Open Agent tab.
2. Optional instruction field. Click [⚡ Expand].
3. Micro-confirmation: "Generate chapter structure from your book summary?" [Generate].
4. Progress indicator. Tree node shows breathing animation.
5. Chapter nodes appear in tree with summaries. Tree auto-expands.
6. Review by clicking through chapters (keyboard `↓`). Edit summaries inline.
7. Unsatisfactory chapter: add instruction comment, click [Refine]. Summary revised.
8. Satisfied: [Lock Layer] from tree toolbar. Confirmation modal. All nodes show purple lock badges.
9. Select a chapter, click Expand → Scenes. Next layer.

### 12.3 Beat Synthesis

1. Scene with 5 approved beats. Select Beat 1. Agent tab. [✨ Synthesise].
2. Prose streams into prose field (Lora text appearing word by word).
3. Prose complete. Read. Not quite right.
4. Add instruction comment. Click [Refine]. Prose revised.
5. Satisfied. `⌘↓` to Beat 2. Repeat.
6. All 5 beats done. `⌘Return` → Focus Mode. Read scene as continuous prose.
7. One issue noted. Exit (Escape). Beat 3. Comment. Refine. Lock scene.

### 12.4 Director Structural Revision

1. Chapters 4–6 feel weak. Click Director tab. Director panel loads.
2. Type: "Chapters 4, 5 and 6 feel weak..." Send.
3. ThinkingIndicator: "Director is reading your document..."
4. Director response: analysis + PlanCard (5 steps, times, node targets).
5. Read plan. Uncheck Step 3. Click [Approve Selected].
6. PlanCard transitions to ExecutionCard. Tree shows ⟳ on affected chapters.
7. Steps complete. Tree updates. Director posts summary message.
8. Click Chapter 4 in tree. Read revised summary. Satisfied.
9. Click Edit tab. Return to Edit Mode.

---

## 13. Responsive Behaviour

### 13.1 Desktop ≥1280px

Full three-panel layout as described in §5.2. All features available. Sidebar and detail panel user-resizable via drag handles.

### 13.2 Laptop 1024px–1279px

Three-panel layout maintained:
- Sidebar defaults to collapsed icon rail (48px) — user can expand
- Detail panel narrower (320px default)
- Node tree receives more horizontal space

### 13.3 Tablet 768px–1023px

```css
@media (max-width: 1024px) {
  .sidebar { width: 48px; }
  .sidebar .sidebar-label,
  .sidebar .sidebar-item-text { display: none; }
  .tree-panel { min-width: 260px; }
  .detail-panel { min-width: 280px; }
  .node-row { height: 44px; }            /* Touch targets */
  .focus-mode-prose-column { max-width: 560px; }
}
```

No features are removed on tablet. No new components are required — existing components respond to CSS breakpoints. The bottom tab bar pattern (for tablet navigation between sections) is available but not required in V1 — the sidebar icon rail is sufficient.

### 13.4 Mobile <768px

Mobile is not a V1 or V2 scope. The application loads and is navigable on mobile but no mobile-optimised layout is designed. Focus Mode functions correctly full-screen on mobile. A non-intrusive "Better on a larger screen" nudge appears on screens below 640px. The mobile native app (V3) handles dedicated mobile use cases.

---

## 14. Locked Decisions

| Decision | Choice | Reason |
|---|---|---|
| Three-mode architecture | Edit / Focus / Director | Genuinely different cognitive states require genuinely different interfaces — not the same layout with toggles. Established in v0.1. |
| Mode switching | Animated, 200–280ms, spatially continuous | Author always sees where they came from. Teleporting breaks context. |
| Dark mode as primary | `#0d1014` base | Halation research informs the warm near-black. Not pure `#000000`. See Brand Identity v2.0 §4.2. |
| Dark/light mode toggle | Account settings only | The brand philosophy is simplicity unless the user seeks detail. A header toggle adds chrome to a surface that should never have chrome the author isn't looking for. |
| Prose column | 620px max-width, Lora 18px, 1.85 line-height | Bringhurst's 66-character ideal, confirmed by screen typography research. Tablet variant: 560px. All values locked. |
| No visible prose toolbar | Selection tooltip + keyboard shortcuts only | Inviolable #5 in Brand Identity v2.0. Prose editor produces running text. Structure lives in the Summary field and node tree. |
| Typeface boundary absolute | Inter = structure, Lora = prose | Inviolable #4. The typeface transition is the signal that the author has crossed from managing to writing. |
| Notification system | Toast only — no notification centre | The tool must not demand attention it has not been given. A notification bell with unread count sits in peripheral vision demanding acknowledgement. Toasts do not. |
| Status badge changes | Instant (0ms) | Status is information, not an event. Animating it would imply celebration or alarm. |
| No illustrations in empty states (V1) | Text only | Consistent with the brand's quiet, serious voice. Illustration is a future enhancement decision, not a V1 absence. |
| Confirmations for 3 actions only | Lock / Delete / Unsaved changes | All other potentially destructive actions are recoverable via version history. Confirmation fatigue reduces the signal value of genuine confirmations. |

---

## 15. Open Design Questions

All previously open questions from v0.3.1 of the source document have been resolved. There are currently no open design questions. This section will be repopulated as new questions arise during subsequent build phases.

| # | Question | Status | Resolution |
|---|---|---|---|
| DQ-1 | Dark/light mode toggle placement | Resolved | Account settings only — not in header. See §3.3 and Locked Decisions §14. |
| DQ-2 | Plan card: expand-on-click vs always-expanded | Resolved | Always expanded. Steps are always visible — the author is approving a plan and must see all of it. Resolves open question from Component Spec. |
| DQ-3 | Dark/light auto-switching | Resolved | Opt-in, off by default, 2-minute fade. See Brand Identity v2.0 §4.5 and §3.3 of this document. |
| DQ-4 | Notification system design | Resolved | Toast-only. No notification centre. See §8. |
| DQ-5 | Onboarding copy and illustrations | Resolved | Text-only empty states (no illustrations in V1). Copy per Brand Identity voice standard. Specific onboarding copy locked in §12.1. |
| DQ-6 | Report panel design | Deferred to V2 | Document operations ship in Phase 3a. Report panel design will be specified as a standalone section addition to this document before Phase 3a begins. |

---

## 16. Changelog

**v1.0 — 2026-05-01** Initial standard-compliant version. Derived from `stelavox_ui_design_v0_4.md` and restructured to comply with the AI-Native Project Specification Standard v1.1. Major structural additions over v0.4: §4 Layout Grid and Spacing System (column grid per breakpoint, panel width table, chrome height table, touch target rules — the column grid was absent from v0.4); §7 System-Level Interaction Patterns (element state table, button hierarchy, form field states, inline editing rules, drag-and-drop rules, confirmation pattern table, progressive disclosure table — these existed in the Component Spec but not at the system level here); §8 Notification System (toast-only rationale, trigger table, non-trigger list — this was an open question in v0.4); §9 Accessibility Rules (landmark structure, component-level ARIA table, keyboard shortcut table — §11 of Component Spec existed but system-level accessibility was absent from the UI Design Spec); §10 Empty, Loading, and Error states (loading states and error states were absent; empty states were scattered across sections). Resolved all six previously-open design questions (DQ-1 through DQ-5 closed; DQ-6 formally deferred to V2). Updated `--easing-prose` from the unresolved value `cubic-bezier(0.25, 0, 0.5, 1)` to the locked value `cubic-bezier(0.25, 0.1, 0.25, 1)` per Brand Identity v2.0 §9.2. Updated verdigris use count from seven to nine per Brand Identity v2.0. Updated all companion document references to current versions.
