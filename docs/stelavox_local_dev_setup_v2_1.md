# Stelavox — Local Development Setup Guide
## Version 2.1

---

### Who This Guide Is For

This guide is for **you** — the product owner setting up your development environment on Windows to work with Claude Code. It assumes:

- You have completed the **Deployment & Setup Guide v1.0** — specifically Phase A (local Supabase running) or Phase B (cloud dev project set up). Your GitHub repository and Anthropic API account exist.
- You have Node.js 20+, Git for Windows, the Supabase CLI, and Docker Desktop already installed and verified (all confirmed in the Deployment & Setup Guide §1)
- You have a **Claude Pro or Max subscription** at claude.ai — this is separate from the Anthropic API account and is what Claude Code authenticates against

This guide covers everything from installing Claude Code through to your first day of productive development on Stelavox.

---

## Table of Contents

1. [Install Claude Code on Windows](#1-install-claude-code-on-windows)
2. [Clone the Repository and Install Dependencies](#2-clone-the-repository-and-install-dependencies)
3. [Configure Your Local Environment File](#3-configure-your-local-environment-file)
4. [Verify the Development Environment](#4-verify-the-development-environment)
5. [Set Up CLAUDE.md — The Project Context File](#5-set-up-claudemd--the-project-context-file)
6. [Your First Claude Code Session](#6-your-first-claude-code-session)
7. [Day-to-Day Development Workflow](#7-day-to-day-development-workflow)
8. [How to Direct Claude Code Effectively](#8-how-to-direct-claude-code-effectively)
9. [Common Development Tasks](#9-common-development-tasks)
10. [When Things Go Wrong](#10-when-things-go-wrong)
11. [Quick Reference Card](#11-quick-reference-card)
12. [Changelog](#12-changelog)

---

## 1. Install Claude Code on Windows

Claude Code runs natively on Windows and requires **Git for Windows** (Git Bash) to operate. If you followed the Deployment & Setup Guide, Git is already installed.

### 1.1 Install Claude Code

Open **PowerShell** (not Command Prompt, not Git Bash — PowerShell specifically) and run:

```powershell
irm https://claude.ai/install.ps1 | iex
```

This is the official Anthropic installer. It will:
- Download the Claude Code binary for Windows
- Install it to `~\.local\bin`
- Set up your PATH automatically
- Configure auto-updates in the background

You do **not** need to run PowerShell as Administrator. You do **not** need to install Node.js separately for Claude Code (it has its own runtime).

When the installer completes, **close PowerShell and open a new window**. This is required for the PATH changes to take effect.

### 1.2 Verify the Installation

In the new PowerShell window:

```powershell
claude --version
```

You should see a version number printed (e.g. `2.x.x`). If you see "command not found" or "not recognised", see §10.1.

Run the health check:

```powershell
claude doctor
```

This will show your installation type, version, Git Bash path, and any configuration issues. Resolve anything flagged before continuing.

### 1.3 Authenticate with Your Claude Account

Claude Code authenticates through your **Claude Pro or Max subscription** at claude.ai. Run:

```powershell
claude
```

The first time you run this, it will open your browser and prompt you to log in to claude.ai and authorise Claude Code. Do this — it stores a session token locally. You will not need to do this again on this machine unless the token expires.

After authentication, type `/exit` or press `Ctrl+C` to leave the session for now.

---

## 2. Clone the Repository and Install Dependencies

### 2.1 Choose a Working Directory

Decide where on your machine the project will live. A simple path with no spaces is best:

```powershell
C:\dev\stelavox
```

Create it if it does not exist:

```powershell
mkdir C:\dev\stelavox
cd C:\dev\stelavox
```

### 2.2 Clone the Repository

```powershell
git clone https://github.com/[your-username]/stelavox.git .
```

The `.` at the end clones into the current directory rather than creating a subfolder.

If prompted for credentials, use your GitHub username and your Personal Access Token (not your GitHub password). You generated this in the Deployment & Setup Guide.

### 2.3 Install Node Dependencies

```powershell
cd C:\dev\stelavox
npm install
```

This installs all packages listed in `package.json`. It will take 1–2 minutes on first run. You should see no errors. Warnings about deprecated dependencies are normal and can be ignored.

Verify:

```powershell
npx next --version
```

---

## 3. Configure Your Local Environment File

Your local environment file tells the application where your database is and which API keys to use. It is never committed to Git.

### 3.1 Create the File

```powershell
copy .env.example .env.local
```

### 3.2 Open and Edit

Open `.env.local` in any text editor. VS Code or Notepad++ will be easier to read:

```powershell
# If you have VS Code installed:
code .env.local

# Otherwise:
notepad .env.local
```

### 3.3 Fill in the Values — Phase A (Local Supabase)

If you are in Phase A (local Supabase via Docker Desktop), your values come from `supabase start`. Run it first:

```powershell
# In a separate PowerShell window — Docker Desktop must be running
supabase start
```

The CLI will print your local credentials. Use those values:

```bash
# .env.local — Phase A: local Supabase instance
# Values printed by `supabase start`

NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon key printed by supabase start]
SUPABASE_SERVICE_ROLE_KEY=[service_role key printed by supabase start]
ANTHROPIC_API_KEY=sk-ant-api03-[your-development-key]
PROMPT_CANARY_TOKEN=[generate — see §3.4]
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

### 3.4 Fill in the Values — Phase B (Cloud Dev)

If you are in Phase B (stelavox-dev Supabase cloud project), your values come from the Supabase dashboard. From §4.7 of the Deployment & Setup Guide:

```bash
# .env.local — Phase B: stelavox-dev cloud project
# From: supabase.com → stelavox-dev → Settings → API

NEXT_PUBLIC_SUPABASE_URL=https://[dev-project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[dev-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[dev-service-role-key]
ANTHROPIC_API_KEY=sk-ant-api03-[your-development-key]
PROMPT_CANARY_TOKEN=[generate — see §3.5]
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```

All values except `NEXT_PUBLIC_APP_URL` and `NODE_ENV` come from your **dev** project — never put prod keys in your local file.

### 3.5 Generate Your Canary Token

The `PROMPT_CANARY_TOKEN` is a random string embedded in every agent prompt. It is a security requirement that detects prompt injection attacks. Run this once to generate a value:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output into your `.env.local`. Keep this value — you will also need to add it to your Vercel production environment variables (with a **different** generated value for production).

### 3.6 Verify the File Is Gitignored

```powershell
git check-ignore -v .env.local
# Should print: .gitignore:1:.env*    .env.local
```

If it does not print anything, open `.gitignore` and add `.env.local` on its own line.

---

## 4. Verify the Development Environment

### 4.1 Start the Local Supabase Stack (Phase A only)

If you are in Phase A, start the local Supabase stack before starting the Next.js server. Docker Desktop must be running first.

```powershell
# Window 1 (leave running):
supabase start
```

When ready, Studio is at http://localhost:54323. Confirm in Studio that:
- All 12 migrations are applied
- `platform_config` has 40+ rows
- `director_configs` has one row with `status = 'production'`

If `platform_config` is empty, re-run the seed: `supabase db execute --file supabase/seed.sql`

### 4.2 Start the Development Server

```powershell
# Window 2 (leave running):
cd C:\dev\stelavox
npm run dev
```

You should see:

```
  ▲ Next.js 15.x.x
  - Local:        http://localhost:3000
  - Environments: .env.local

 ✓ Ready in 1.8s
```

Open **http://localhost:3000** in your browser. You should see the Stelavox login page.

**If you see an error instead:** Check that `.env.local` has all values filled in and that your Supabase instance (local or cloud) is running. The error message will usually name the missing variable.

### 4.3 Verify Database Connection

On the login page, attempt to create an account with a test email address. If the form submits without errors and you receive a verification email (cloud dev) or see a user appear in Studio (local), the database connection is working.

### 4.4 Window Setup

Keep this structure throughout your development sessions:

| Window | Purpose | Command |
|---|---|---|
| Window 1 | Local Supabase (Phase A only) | `supabase start` — leave running |
| Window 2 | Dev server | `npm run dev` — leave running |
| Window 3 | Claude Code | `claude` |
| Window 4 | Git and general commands | Used for migrations, git, npm |

---

## 5. Deploy the CLAUDE.md Files

There are two CLAUDE.md files. Both are pre-written documents in the Stelavox docs library — you do not write them from scratch. You deploy them to the correct locations.

### 5.1 The Global CLAUDE.md

The global file lives at `~/.claude/CLAUDE.md` on your local machine. It contains your standing working principles — how you want Claude Code to behave on every project, not just Stelavox. It is written once and rarely changes.

```powershell
# Create the .claude directory if it does not exist
mkdir "$env:USERPROFILE\.claude" -ErrorAction SilentlyContinue

# Copy the global file from the docs library
copy docs\CLAUDE_global.md "$env:USERPROFILE\.claude\CLAUDE.md"
```

Verify:
```powershell
type "$env:USERPROFILE\.claude\CLAUDE.md"
# Should print the global working principles
```

**Once this file is in place, it applies to all Claude Code sessions on this machine — not just Stelavox.** If you update your working principles in future, edit it at `~/.claude/CLAUDE.md` directly and keep the docs library copy in sync.

### 5.2 The Project CLAUDE.md

The project file lives at the repository root (`C:\dev\stelavox\CLAUDE.md`). It contains Stelavox-specific context: the spec library reference, architecture rules, the Five Inviolables, known hazards, and the component specification table. Claude Code reads it at the start of every session in this directory.

```powershell
# Copy the project file to the repository root
copy docs\CLAUDE_stelavox_project.md CLAUDE.md
```

Verify it is in place:
```powershell
type CLAUDE.md
# Should print the Stelavox project context
```

Commit both files:
```powershell
git add CLAUDE.md docs\CLAUDE_global.md docs\CLAUDE_stelavox_project.md
git commit -m "Add CLAUDE.md files — global and project context"
git push origin main
```

### 5.3 Keeping CLAUDE.md Current

The project `CLAUDE.md` must be updated when:

- A new Inviolable is added to the Brand Identity — add it to the Five Inviolables section
- A new hazard is added to the Technical Architecture — add a one-line summary to the Known Hazards section
- A new component has critical constraints — add it to the Critical Component Specifications table
- The build phase advances — update the Session Start Checklist to point at the current phase checklist
- Any spec document changes version — update the Spec Library Reference table

When you update `CLAUDE.md`, also update `docs\CLAUDE_stelavox_project.md` (the source copy in the docs library) so the two stay in sync. Commit both together.

### 5.4 Add Docs to the Repository


The documentation library lives inside the project repository so Claude Code can read it. Create a `docs/` folder and copy all documents into it:

```powershell
mkdir docs
mkdir docs\wireframes
```

Copy the following files into `docs\`:

**Specification documents (current versions):**
- `stelavox_product_specification_v1_2.md`
- `stelavox_technical_architecture_v1_3.md`
- `stelavox_brand_identity_v2_0.md`
- `stelavox_ui_design_specification_v1_0.md`
- `stelavox_component_specification_v2_0.md`
- `stelavox_deployment_setup_v1_0.md`
- `stelavox_local_dev_setup_v2_0.md` *(this document)*
- `stelavox_phase1_build_checklist_v1.0.md`
- `stelavox_wireframe_errata_v1_0.md` *(read before reading any wireframe)*

Copy the wireframe HTML files into `docs\wireframes\`:
- `wireframe_edit_mode_v1.html`
- `wireframe_focus_mode_v1.html`
- `wireframe_prose_surface_v1.html`
- `wireframe_director_mode_v1.html`
- `wireframe_agent_tab_v1.html`
- `wireframe_empty_states_toast_v1.html`
- `wireframe_project_dashboard_v1.html`
- `wireframe_cmd_palette_modals_v1.html`
- `wireframe_mobile_notes_v1.html`
- `wireframe_tablet_v1.html`

Commit everything:

```powershell
git add docs/
git add CLAUDE.md
git commit -m "Add project documentation and Claude Code context file"
git push origin main
```

---

## 6. Your First Claude Code Session

You are now ready to use Claude Code. This section walks through starting a session and understanding what you are seeing.

### 6.1 Start a Session

Make sure `npm run dev` is running (and `supabase start` if in Phase A). In your Claude Code window:

```powershell
cd C:\dev\stelavox
claude
```

Claude Code will start and display a prompt. It will automatically read `CLAUDE.md` and have context about the project:

```
✓ Loaded CLAUDE.md (project context)
✓ Connected to git repository

Claude Code v2.x.x
Type your instruction or /help for commands.

>
```

### 6.2 Your First Instruction

Try a simple read-only task first to confirm everything is working:

```
> Read the Phase 1 build checklist and tell me what the first uncompleted task is
```

Claude Code will read the markdown file, understand its structure, and respond with the first uncompleted item. If it does this correctly, your setup is working.

### 6.3 What Claude Code Can See

Claude Code has access to:
- All files in your project directory (`C:\dev\stelavox`)
- Your git history and current branch status
- The ability to run terminal commands (npm, git, supabase, etc.)
- The files you explicitly reference in your instructions

Claude Code does **not** have access to:
- Your browser (it cannot see the running application visually)
- Your Supabase database directly (it works through code, not direct DB access)
- The internet during a session (it uses its training knowledge)

### 6.4 Useful Commands Within a Session

```
/help           List all available commands
/status         Show current git status and recent changes
/clear          Clear the conversation (start fresh context)
/exit           End the session
/bug            Report a Claude Code issue to Anthropic
```

---

## 7. Day-to-Day Development Workflow

A typical Phase A development session has four windows open:

| Window | Purpose |
|---|---|
| Window 1 | `supabase start` — local stack (Phase A only, leave running) |
| Window 2 | `npm run dev` — dev server (leave running, hot-reload handles changes) |
| Window 3 | `claude` — Claude Code sessions |
| Window 4 | Git, migrations, and general commands |

In Phase B, Window 1 is not needed — the cloud dev project is always available.

### 7.1 Starting a New Feature

```powershell
# In Window 4:
git checkout main
git pull origin main          # Get any latest changes
git checkout -b feature/node-tree-component

# In Window 3 (Claude Code):
> I am building Phase 2 of the build checklist — the Node Tree component.
  Please read the checklist at docs/stelavox_phase1_build_checklist_v1.0.md,
  the component spec at docs/stelavox_component_specification_v2_0.md sections
  4.1-4.6, and wireframe_edit_mode_v1.html (first check
  docs/stelavox_wireframe_errata_v1_0.md for corrections to that file).
  Then implement the NodeTree, NodeRow, and NodeStatusBadge components.
```

### 7.2 Reviewing Claude Code's Work

**Before accepting any change Claude Code makes, check:**

1. Open your browser at http://localhost:3000 — does it look right?
2. Are there TypeScript errors? Check the dev server window for red text.
3. Did Claude Code follow the Five Inviolables?
4. Does the component use CSS tokens (`var(--color-*)`) rather than hardcoded values?
5. Did it use `getConfig()` for any operational values (limits, durations, etc.)?

If something looks wrong, tell Claude Code directly:

```
> The NodeRow height is 40px but the spec requires exactly 36px. Fix this.
```

```
> You used --color-accent on the active tab underline. The component spec
  says this must use --color-text-primary at opacity 0.6, not verdigris.
  See Component Spec §5.2. Please correct this.
```

### 7.3 Committing Work

When a meaningful unit is complete and working:

```powershell
# In Window 4:
git add .
git diff --staged           # Review exactly what changed
git commit -m "Add NodeTree, NodeRow, NodeStatusBadge components (Phase 2)"
git push origin feature/node-tree-component
```

Pushing to a feature branch automatically creates a **Vercel preview deployment** (Phase B/C only). Check the Vercel dashboard for the preview URL.

### 7.4 Completing a Phase

When all checklist items for a phase are ticked and the checkpoint is passing:

```powershell
# In Window 4:
git checkout main
git merge feature/[phase-branch]
git push origin main
# Vercel auto-deploys to production (Phase C only)
```

Verify the deployment in the Vercel dashboard before moving to the next phase.

---

## 8. How to Direct Claude Code Effectively

Claude Code responds best to specific, grounded instructions that reference the existing documentation. The following guidance is specific to the Stelavox project.

### 8.1 Always Reference the Authoritative Document

Instead of describing what you want from memory, point Claude Code to the specification:

❌ "Make a component that shows the node's title and some info"
✅ "Implement the NodeDetailPanel component according to Component Spec §5.1. The panel header spec is in §5.1, the tab strip in §5.2."

❌ "The active node should have a coloured border"
✅ "The active node row should have a 2px left border using --color-accent as specified in Component Spec §4.2. This is verdigris sanctioned use #9."

### 8.2 Give Context About Current State

Claude Code benefits from knowing what already exists and what phase you are in:

```
> Phase 2 of the build checklist is complete. NodeTree, NodeRow, and
  NodeStatusBadge are implemented. I am now starting Phase 3 — Content
  Editing. Please begin with the SummaryEditor component (Component Spec §5.3).
  Note that SummaryEditor uses Inter font — this is the structural planning
  field, not the prose surface. The typeface boundary is Inviolable #4.
```

### 8.3 Specify What Not to Do

For brand-critical requirements, state the constraint explicitly:

```
> Implement the ProseEditor component. Critical: this component uses Lora 400
  font, not Inter. It must never use Inter. The typeface change from Inter
  (in SummaryEditor) to Lora (in ProseEditor) is Inviolable #4 — it is the
  product's primary mode signal.
```

```
> Add the word count display below the ProseEditor. Critical: the word count
  must be INVISIBLE while the author is typing and for 3 seconds after they
  stop. It then fades to opacity 0.4. See Component Spec §5.7 for the
  complete opacity state machine. This is not optional — it is a brand decision.
```

### 8.4 Ask Claude Code to Verify Against the Spec

After implementing a component, ask Claude Code to check its own work:

```
> The ProseEditor is implemented. Now read Component Spec §5.4 and §5.5 and
  verify that the implementation matches every value in the spec. List any
  discrepancies.
```

### 8.5 Break Large Tasks Into Checkpoints

```
> Let us implement Phase 1.3 — the database schema. Do Migration 001 only
  (organisations, organisation_members, projects, documents, agent_profiles,
  layer_stacks tables). Do not proceed to Migration 002 until I review and
  confirm 001. After writing the SQL, also check it against Technical
  Architecture §3.2 for the correct RLS policy pattern.
```

### 8.6 Reference the Wireframe Errata First

Before asking Claude Code to build any UI component:

```
> Before building the Edit Mode layout, read docs/stelavox_wireframe_errata_v1_0.md,
  then read wireframe_edit_mode_v1.html. The errata document lists corrections
  that take precedence over the HTML file.
```

### 8.7 Platform Config for Operational Values

Remind Claude Code of the no-magic-numbers rule whenever it involves a configurable value:

```
> Implement the token budget check in the agent API route. Do not hardcode
  the budget amounts — read them from platform_config using getConfig()
  from lib/config/platform-config.ts. See Technical Architecture §3.7 for
  the complete list of config keys and the getConfig() implementation.
```

---

## 9. Common Development Tasks

### 9.1 Creating a Database Migration

```
# In Window 3 (Claude Code):
> Create a new migration file for [describe the change]. Name it with today's
  timestamp. After writing the SQL, check it against Technical Architecture
  §3.3 for the correct RLS policy pattern.
```

Then apply it in Window 4:

```powershell
# Phase A — apply locally:
supabase db push

# Phase B — apply to cloud dev:
supabase login
supabase link --project-ref [dev-project-ref]
supabase db push

# Always regenerate types after any migration:
supabase gen types typescript --linked > lib/types/database.ts
git add lib/types/database.ts
git commit -m "Update database types for [migration name]"
```

### 9.2 Adding a New API Route

```
# In Window 3:
> Create an API route at app/api/nodes/[id]/status/route.ts that handles
  PUT requests to update a node's status field. Validate the transition
  rules: draft → in_review → approved → locked. Return 403 if the node
  is locked. Use the server Supabase client — not the anon client.
  See Technical Architecture §3.2 for the RLS pattern and §3.4 for the
  correct API route structure.
```

### 9.3 Implementing an Agent Operation

```
# In Window 3:
> Implement the Synthesise operation in the agent job runner Edge Function.
  Read Technical Architecture §6.1 for the async flow and §6.2 for context
  assembly. Key requirements: check the token budget before starting (using
  getConfig() for the budget value), wrap all user content in XML user_data
  tags (see §4.2), inject the canary token, stream the response, and record
  usage in usage_records on completion.
```

### 9.4 Adding a New Platform Config Key

When a new configurable value is needed:

```
# In Window 3:
> I need to add a configurable value for [describe what]. Add it to the
  platform_config seed in supabase/seed.sql and update the canonical key
  table in docs/stelavox_technical_architecture_v1_3.md §3.7.4.
  Then update all code that uses this value to read from getConfig() instead
  of any hardcoded constant.
```

### 9.5 Running the Verdigris Check

Before merging any branch, verify verdigris appears only in the nine sanctioned locations:

```powershell
# In Window 4:
grep -r "color-accent\|#3d7858\|#254a38" src/components --include="*.tsx" --include="*.css" | grep -v "color-accent-hover\|color-accent-muted\|color-agent"
```

Every result must correspond to one of the nine sanctioned uses listed in CLAUDE.md. If you see an unexpected result, fix it before merging.

### 9.6 Fixing a Type Error

If the dev server shows a TypeScript error:

```
# In Window 3:
> There is a TypeScript error in components/tree/NodeRow.tsx:
  "Property 'status' does not exist on type 'Node'".
  Check lib/types/database.ts for the correct type and fix the component.
  Note: lib/types/database.ts is generated — do not edit it directly.
  If the type is wrong, the migration may need updating.
```

---

## 10. When Things Go Wrong

### 10.1 `claude` is not recognised after installation

The PATH was not updated. Try:

```powershell
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$env:USERPROFILE\.local\bin", [EnvironmentVariableTarget]::User)
$env:PATH = "$env:PATH;$env:USERPROFILE\.local\bin"
claude --version
```

If this works, it is set for future sessions. If not, run `claude doctor` from Git Bash instead of PowerShell and follow its guidance.

### 10.2 `npm run dev` fails to start

Check `.env.local` — missing or incorrect values are the most common cause. The error message will usually name the missing variable. Verify against the values from `supabase start` (Phase A) or your Supabase cloud project settings (Phase B).

### 10.3 Local Supabase fails to start (Phase A)

Docker Desktop must be running. Check the system tray — if Docker is not running, start it and wait 30 seconds before retrying `supabase start`.

If Docker is running but `supabase start` fails, try:

```powershell
supabase stop
supabase start
```

If it still fails, check that no other service is using port 54321 or 54322.

### 10.4 Supabase cloud connection errors (Phase B)

Your Supabase dev project may have been paused (free tier projects pause after 7 days of inactivity). Log in to supabase.com, find `stelavox-dev`, and click **Restore project**. It takes 1–2 minutes.

### 10.5 `getConfig()` throws "key not found"

The `platform_config` table is empty or missing rows. Re-run the seed:

```powershell
# Phase A:
supabase db execute --file supabase/seed.sql

# Phase B:
supabase link --project-ref [dev-project-ref]
supabase db execute --file supabase/seed.sql
```

The seed uses `ON CONFLICT DO NOTHING` — safe to re-run without overwriting any admin changes.

### 10.6 Claude Code makes a change that breaks things

```powershell
# In Window 4 — see what changed:
git diff

# Revert all uncommitted changes:
git checkout -- .

# Or revert a specific file:
git checkout -- components/tree/NodeRow.tsx
```

Claude Code's changes are not committed until you run `git commit`. You can always revert.

### 10.7 Claude Code stops responding or behaves strangely

```
# In the Claude Code session:
/clear           # Clear conversation context and start fresh

# Or exit and restart:
/exit
claude
```

If a session runs very long (many changes, many files), the context can become unwieldy. Starting fresh with a clear instruction about current state is often more effective than continuing.

### 10.8 The dev server stops hot-reloading

Sometimes Next.js hot-reload stops working after deep file changes. Press `Ctrl+C` in Window 2 to stop the server, then restart:

```powershell
npm run dev
```

### 10.9 Git merge conflicts after a long feature branch

```powershell
git checkout main
git pull origin main
git checkout feature/[your-branch]
git rebase main              # Replays your commits on top of current main
```

Resolve any conflicts Claude Code flags, then continue.

---

## 11. Quick Reference Card

### Starting Every Day — Phase A

```powershell
# Window 1 — start Docker Desktop first (system tray), then:
supabase start

# Window 2:
cd C:\dev\stelavox && npm run dev

# Window 3:
cd C:\dev\stelavox && claude

# Window 4:
cd C:\dev\stelavox
git status     # See where you left off
```

### Starting Every Day — Phase B

```powershell
# Window 2:
cd C:\dev\stelavox && npm run dev

# Window 3:
cd C:\dev\stelavox && claude

# Window 4:
cd C:\dev\stelavox
git status
```

### Key URLs

| Resource | URL |
|---|---|
| Local app | http://localhost:3000 |
| Local Supabase Studio (Phase A) | http://localhost:54323 |
| Supabase dev dashboard (Phase B) | supabase.com → stelavox-dev |
| Vercel dashboard | vercel.com → stelavox |
| Anthropic Console | console.anthropic.com |
| GitHub repository | github.com/[your-username]/stelavox |

### Key Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build (checks for errors) |
| `npm run type-check` | TypeScript check only |
| `npm run lint` | ESLint check |
| `supabase start` | Start local Supabase stack (Phase A) |
| `supabase db push` | Apply pending migrations |
| `supabase db reset` | Drop and rebuild local DB (Phase A only) |
| `supabase db execute --file supabase/seed.sql` | Load seed data |
| `supabase gen types typescript --linked > lib/types/database.ts` | Regenerate types after migration |
| `claude` | Start Claude Code session |
| `claude doctor` | Check Claude Code health |
| `git status` | What has changed |
| `git diff --staged` | What is about to be committed |

---

## 12. Changelog

**v2.1 — 2026-05-02** Updated two references from `stelavox_technical_architecture_v1_2.md` to `stelavox_technical_architecture_v1_3.md` following the v1.3 Technical Architecture correction.

**v2.0 — 2026-05-01** Significant update. Changes from v1.0: (a) CLAUDE.md template fully rewritten — updated all document version references to current (Brand Identity v2.0, Component Spec v2.0, UI Design Spec v1.0, Technical Architecture v1.2), corrected verdigris count from eight to nine with the complete nine-location list, expanded from Three Inviolables to Five Inviolables with full text of each, added `lib/config/platform-config.ts` to the project structure, added Known Hazards section (H-01 to H-10 headlines), added Key Component Specifications table with the two corrections from Component Spec v2.0 (TabStrip active indicator and PanelResizer dragging colour), added wireframe errata reference, updated build commands to include `supabase start`/`db push`/`db reset`/`db execute`. (b) `docs/` file list updated — all documents at current versions, added Wireframe Errata and the two new spec documents (UI Design Spec v1.0, Component Spec v2.0), added two new wireframes (mobile_notes, tablet). (c) §3 environment file section restructured into Phase A (local Supabase) and Phase B (cloud dev) with correct values for each. (d) §4 verification section now includes local Supabase startup and platform_config verification as a required step. (e) Window setup table updated from three to four windows (added Supabase window for Phase A). (f) §8.6 added — wireframe errata reference in prompting guidance. (g) §8.7 added — platform_config / getConfig() prompting pattern. (h) §9.4 added — task pattern for adding new platform config keys. (i) §9.5 verdigris grep updated from "eight" to "nine". (j) §10.5 added — `getConfig()` key not found troubleshooting. (k) §10.3 added — local Supabase startup failures. (l) Companion document references updated to current versions.

**v1.0 — Initial document.** Local development setup guide for Stelavox on Windows with Claude Code. Covered: Claude Code installation, repository setup, environment configuration, CLAUDE.md project context file, day-to-day workflow, effective prompting guidance, common task patterns, and troubleshooting.
