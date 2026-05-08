# Stelavox — Deployment & Setup Guide
## Version 1.1

---

## Development Environment Phases

This document covers three distinct phases of environment setup. Do not jump ahead — each phase has a clear entry criterion.

| Phase | When | What you have | What you set up |
|---|---|---|---|
| **A — Local** | Before any code is written | Nothing yet | Docker Desktop, Supabase CLI, local Supabase instance |
| **B — Cloud dev** | Schema stable, integration testing begins | Working local app | `stelavox-dev` Supabase cloud project |
| **C — Production** | Phase 1 feature-complete, ready to ship | Tested application | `stelavox-prod`, Vercel, production smoke test |

The majority of the build — all schema work, migrations, RLS policies, the data layer, agents, and Director — is done entirely in Phase A against a local database with no cloud dependency. Phase C is only reached when there is something worth deploying to real users.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Anthropic API Setup](#2-anthropic-api-setup)
3. [GitHub Repository Setup](#3-github-repository-setup)
4. [Supabase Setup](#4-supabase-setup)
5. [Vercel Setup](#5-vercel-setup-phase-c-only)
6. [Environment Variables Reference](#6-environment-variables-reference)
7. [First Deployment Sequence](#7-first-deployment-sequence)
8. [Day-to-Day Development Workflow](#8-day-to-day-development-workflow)
9. [Promoting Database Changes to Production](#9-promoting-database-changes-to-production)
10. [Monitoring and Maintenance](#10-monitoring-and-maintenance)
11. [Cloud Backup and Attachments Setup](#11-cloud-backup-and-attachments-setup)
12. [Changelog](#12-changelog)

---

## 1. Prerequisites

### 1.1 Check What You Already Have

Open PowerShell or Windows Terminal and run each of these:

```powershell
node --version
# Should print v20.x.x or higher.

git --version
# Should print git version 2.x.x.

npm --version
# Comes with Node.js. Should print 10.x.x or higher.
```

### 1.2 Node.js (if not installed)

Download the LTS installer from https://nodejs.org

Run the installer with all defaults. When complete, close and reopen PowerShell and verify with `node --version`.

### 1.3 Git for Windows (if not installed)

Download from https://git-scm.com/download/windows

Run the installer. On the option "Adjusting your PATH environment", select "Git from the command line and also from 3rd-party software". All other defaults are fine.

Verify with `git --version`.

### 1.4 Supabase CLI

```powershell
npm install -g supabase

# Verify
supabase --version
# Should print 2.x.x or higher
```

### 1.5 Vercel CLI

```powershell
npm install -g vercel

# Verify
vercel --version
```

### 1.6 Windows Line Ending Configuration

This is a Windows-specific step that prevents subtle bugs when Git manages files that will also run on Linux servers (Vercel runs on Linux).

```powershell
git config --global core.autocrlf input
```

Run this once — it applies globally to all Git repositories on your machine.

### 1.7 Docker Desktop *(required for Phase A local development)*

The Supabase CLI uses Docker to run a full local Supabase stack on your machine. This gives you a local Postgres database, Auth, and Storage that you can reset instantly — the correct environment for schema and data layer development before committing to any cloud infrastructure.

Docker is used only on your local development machine. It is not used in production — Vercel and Supabase Cloud handle that.

1. Download Docker Desktop for Windows from https://www.docker.com/products/docker-desktop
2. Run the installer with all defaults
3. When prompted, enable the WSL 2 backend (recommended for Windows)
4. Start Docker Desktop — it runs as a system tray app
5. Verify from PowerShell:

```powershell
docker --version
# Should print Docker version 24.x.x or higher

docker ps
# Should print an empty table (no containers running yet)
```

Docker Desktop must be running whenever you use `supabase start`. You do not need to understand Docker beyond starting it — the Supabase CLI manages everything inside it automatically.

---

## 2. Anthropic API Setup

Your Claude.ai subscription is a separate product from the Anthropic API. The API is what your application calls programmatically to run agent operations. You need a separate API account at console.anthropic.com.

### 2.1 Create the API Account

1. Go to https://console.anthropic.com
2. Click **Sign Up**
3. You can sign up with the same email as your Claude.ai account — they will be linked but are separate products with separate billing
4. Verify your email address

### 2.2 Add a Payment Method

1. In the Anthropic Console, go to **Settings → Billing**
2. Add a credit card
3. There is no monthly fee — you are charged only for tokens used
4. A typical development session costs cents. A full novel generation costs approximately $10–15 in API calls

### 2.3 Set a Spend Limit

This is important. Without a spend limit, a bug that causes runaway API calls could incur significant charges.

1. Go to **Settings → Limits**
2. Set a monthly spend limit of **$50** to start
3. You can adjust this upward later when you understand your usage patterns
4. Anthropic will email you when you approach the limit

### 2.4 Generate API Keys

1. Go to **API Keys** in the left navigation
2. Click **Create Key**, name it `stelavox-development`, copy and save it securely
3. Click **Create Key** again, name it `stelavox-production`, copy and save it securely

Using separate keys for dev and prod means you can revoke the development key independently if needed. Store both in a password manager — they are only shown once.

---

## 3. GitHub Repository Setup

### 3.1 Create the Repository

1. Go to https://github.com and log in to your existing account
2. Click the **+** icon in the top right → **New repository**
3. Repository name: `stelavox`
4. Description: `Hierarchical writing tool with AI agent assistance`
5. Set to **Private**
6. Do **not** initialise with a README, .gitignore, or licence
7. Click **Create repository**

### 3.2 Configure Branch Protection

Once you have pushed your first commit (Section 7), do this:

1. Go to your repository → **Settings → Branches**
2. Click **Add branch protection rule**
3. Branch name pattern: `main`
4. Enable: **Require a pull request before merging**
5. Enable: **Do not allow bypassing the above settings**
6. Click **Save changes**

This ensures code only reaches production deliberately, not by accident.

### 3.3 Verify the .gitignore File

When the project code is created, confirm the `.gitignore` file contains at minimum:

```
# Environment variables — NEVER commit these
.env
.env.local
.env.development.local
.env.production.local

# Node modules
node_modules/

# Next.js build output
.next/
out/

# Vercel
.vercel/

# Supabase local state
supabase/.branches
supabase/.temp

# OS files
.DS_Store
Thumbs.db
```

The most important line is `.env.local`. This file will contain your API keys. If it is ever committed to GitHub, rotate all keys it contained immediately.

### 3.4 Connect Your Local Code to GitHub

When the project code is on your machine and ready to push:

```powershell
cd C:\dev\stelavox

# Initialise git (if not already done by the project scaffolding)
git init

# Stage all files
git add .

# First commit
git commit -m "Initial project setup"

# Add GitHub as the remote origin
git remote add origin https://github.com/[your-username]/stelavox.git

# Push to GitHub
git push -u origin main
```

If Git prompts for credentials, use your GitHub username and a Personal Access Token (not your password). Generate one at: GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → Generate new token → give it the `repo` scope.

---

## 4. Supabase Setup

### Phase A — Local Supabase instance

This is your primary development database for all Phase A work: schema design, migrations, RLS policies, seed data, and data layer testing. No cloud account required at this stage.

Docker Desktop must be running before using any `supabase` CLI commands.

#### 4.1 Initialise Supabase in the Project

Run this once from the project root, after the project code exists:

```powershell
cd C:\dev\stelavox
supabase init
```

This creates a `supabase/` folder in your project with `config.toml` and a `migrations/` directory. The migrations for Stelavox (001–012) live here.

#### 4.2 Start the Local Stack

```powershell
supabase start
```

First run downloads Docker images — this takes 3–5 minutes. Subsequent starts are fast. When complete, the CLI prints your local credentials:

```
API URL:      http://localhost:54321
GraphQL URL:  http://localhost:54321/graphql/v1
DB URL:       postgresql://postgres:postgres@localhost:54322/postgres
Studio URL:   http://localhost:54323
Anon key:     eyJhbGci... (local, safe to use)
Service role: eyJhbGci... (local, safe to use)
```

Copy the `Anon key` and `Service role` values — you will need them for `.env.local`.

Studio is the full Supabase dashboard running locally. Open http://localhost:54323 to browse tables, run SQL, and inspect RLS policies exactly as you would in the cloud dashboard.

#### 4.3 Apply Migrations Locally

```powershell
supabase db push
```

This applies all migration files in `supabase/migrations/` to your local database in order. Run this whenever you add a new migration file. Stelavox has twelve migrations (001–012) — confirm all twelve are applied in Studio.

#### 4.4 Load Seed Data Locally

```powershell
supabase db execute --file supabase/seed.sql
```

The seed file populates: default agent profiles, the Director v1.0 config record, and all `platform_config` entries with their default values. See Technical Architecture v1.2 §3.7.5 for the full `platform_config` seed content.

Verify in Studio (http://localhost:54323):
- `agent_profiles` has 20+ rows (default profiles for all operation types)
- `director_configs` has at least one row with `status = 'production'`
- `platform_config` has 40+ rows covering token budgets, prices, model selections, export defaults, and agent limits

**The `platform_config` seed is not optional.** The application calls `getConfig()` on the first agent operation. If `platform_config` is empty, every agent call will throw. Run the seed before testing any agent functionality.

#### 4.5 Resetting the Local Database

When you want a clean slate — after a bad migration, a data experiment, or before testing the full migration sequence from scratch:

```powershell
supabase db reset
```

This drops and recreates the local database, re-applies all migrations from migration 001, and re-runs the seed file. It takes about 15 seconds. Use this freely during development — it costs nothing and is completely safe.

---

### Phase B — Cloud development project

Set this up when the schema is stable and you need to test against real Supabase services: Auth, Edge Functions, Realtime, and the scheduler. Your local dev work continues to use the local instance; the cloud dev project is for integration testing.

#### 4.6 Create the Development Project

1. Log in to https://supabase.com
2. Click **New Project**
3. Select your existing organisation
4. Project name: `stelavox-dev`
5. Database password: generate a strong password and save it in your password manager
6. Region: **Southeast Asia (Singapore)**
7. Plan: **Free**
8. Click **Create new project** and wait 1–2 minutes

#### 4.7 Locate Your Cloud Dev Project Keys

Go to **Settings → API** and record:

| Value | Location | Environment variable name |
|---|---|---|
| Project URL | Settings → API → Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| anon / public key | Settings → API → anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| service_role key | Settings → API → service_role key | `SUPABASE_SERVICE_ROLE_KEY` |

Also go to **Settings → Database → Connection string** and copy the URI for use with CLI migrations.

#### 4.8 Apply Schema to Cloud Dev

```powershell
supabase login
supabase link --project-ref [dev-project-ref]
supabase db push
supabase db execute --file supabase/seed.sql
```

The project ref is the subdomain in your project URL: `https://abcdefghijkl.supabase.co` → ref is `abcdefghijkl`

**Mandatory verification — every cloud project, every time.** SU-49 (Phase 5c, 2026-05-08) discovered that `stelavox-dev` was missing 11 of 18 system agent_profiles after its initial cloud setup, and the 7 that did exist had stale system_prompt content. Migration 027's SECURITY DEFINER helper either didn't fully run on the cloud at first apply, or was the earlier version of the migration content. **Verify all four counts before considering the cloud DB ready:**

| Table | Expected | How to query |
|---|---|---|
| `platform_config` | 40+ rows | `SELECT count(*) FROM platform_config;` |
| `director_configs` | 1 row, status='production' | `SELECT count(*) FROM director_configs WHERE status='production';` |
| `agent_profiles` | **exactly 18 system profiles** | `SELECT count(*) FROM agent_profiles WHERE is_system_profile=true;` |
| `agent_profiles[synthesise_beat].system_prompt` | matches local source-of-truth | length should be **4974** characters; spot-check below |

```sql
-- Spot-check: synthesise_beat prompt should be 4974 chars verbatim
SELECT length(system_prompt) AS prompt_len
FROM agent_profiles
WHERE name = 'synthesise_beat';
```

If `agent_profiles` count is < 18 OR the prompt length doesn't match, the migration content drifted. Apply the recovery procedure in §4.8.1 below.

#### 4.8.1 Recovery — agent_profiles drift (only run if §4.8 verification fails)

This procedure pulls all 18 system profiles from a known-good local DB and upserts onto cloud, keyed on `name`. Preserves cloud row IDs so any historical `agent_jobs.profile_id` references survive. Used to fix `stelavox-dev` post-Phase 5b.

Prerequisite: a local Supabase running on the same migration set with all 18 profiles already seeded (verified by the same query above against `127.0.0.1:54331`).

```typescript
// Save as scripts/sync-cloud-agent-profiles.ts and run with:
//   npx tsx scripts/sync-cloud-agent-profiles.ts
import { createClient } from '@supabase/supabase-js'

const local = createClient(
  'http://127.0.0.1:54331',
  process.env.LOCAL_SERVICE_ROLE_KEY!,
)
const cloud = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const { data: lProfiles } = await local
  .from('agent_profiles')
  .select('*')
  .eq('is_system_profile', true)
const { data: cProfiles } = await cloud
  .from('agent_profiles')
  .select('id, name')
  .eq('is_system_profile', true)
const cByName = new Map((cProfiles ?? []).map((p) => [p.name, p.id]))

for (const lp of lProfiles!) {
  const { id, created_at, updated_at, ...payload } = lp
  if (cByName.has(lp.name)) {
    await cloud.from('agent_profiles').update(payload).eq('id', cByName.get(lp.name)!)
  } else {
    await cloud.from('agent_profiles').insert(payload)
  }
}
```

Also sync the Director config prompt body:

```typescript
const { data: lDc } = await local.from('director_configs').select('*').eq('status', 'production').single()
const { data: cDc } = await cloud.from('director_configs').select('id').eq('status', 'production').single()
await cloud.from('director_configs').update({ system_prompt: lDc!.system_prompt }).eq('id', cDc!.id)
```

After running, re-verify all four §4.8 counts.

#### 4.9 Enable Real-Time (cloud dev project)

Phase 5/5b/5c require five tables in the `supabase_realtime` publication. Migrations 030 + 031 add them automatically when applied to a fresh cloud project. **Verify** in **Database → Replication** that all five toggles are on:

1. `nodes` (Phase 3)
2. `agent_jobs` (Phase 5 — required by `useAgentJobsRealtime` for AgentTab + Jobs tab)
3. `node_comments` (Phase 5 — required by CommentThread realtime)
4. `workflows` (Phase 5b — required by Director ExecutionCard)
5. `workflow_steps` (Phase 5b — required by Director ExecutionCard step progress)

If any are missing, toggle on + click **Save**. If `agent_jobs` is off, the AgentTab's IDLE → COMPLETE transition won't fire on the deployed app (Phase 5c failure mode, also see §5.3.1 below for the CSP variant of the same symptom).

#### 4.10 Verify Automated Backups

1. Go to **Settings → Database → Backups**
2. Confirm daily backups are shown as active (free tier provides 7-day retention)

---

### Phase C — Production project

#### 4.11 Create the Production Project

Repeat the cloud setup from §4.6–4.10:

1. Project name: `stelavox-prod`
2. Database password: **different** from dev — save separately
3. Region: **Southeast Asia (Singapore)**
4. Plan: **Free**

Apply migrations and seed data as in §4.8 — and **run the verification block in §4.8 in full**, including the agent_profiles count check that catches the SU-49 drift pattern. Enable Realtime on the five tables listed in §4.9.

---

## 5. Vercel Setup *(Phase C only)*

Do not configure Vercel until you have a working, tested application in Phase B. There is nothing to deploy before that point.

### 5.1 Connect Vercel to GitHub

1. Log in to https://vercel.com with your existing account
2. Click **Add New → Project**
3. Under **Import Git Repository**, find your `stelavox` repository
4. Click **Import**

### 5.2 Configure the Project

On the configuration screen:

- **Framework Preset**: Next.js (auto-detected)
- **Root Directory**: `/` (default)
- **Build Command**: default (`next build`)
- **Output Directory**: default

Do **not** click Deploy yet — add environment variables first.

### 5.3 Add Environment Variables

Click **Environment Variables** and add the following. Each variable can be scoped to Production, Preview, and/or Development environments.

```
NEXT_PUBLIC_SUPABASE_URL
  Production:  stelavox-prod Project URL
  Preview:     stelavox-dev Project URL

NEXT_PUBLIC_SUPABASE_ANON_KEY
  Production:  stelavox-prod anon key
  Preview:     stelavox-dev anon key

SUPABASE_SERVICE_ROLE_KEY
  Production:  stelavox-prod service_role key
  Preview:     stelavox-dev service_role key

ANTHROPIC_API_KEY
  Production:  stelavox-production API key (from §2.4)
  Preview:     stelavox-development API key (from §2.4)

PROMPT_CANARY_TOKEN
  Production:  [generate — see §6]
  Preview:     [generate — see §6]
```

Note: `NEXT_PUBLIC_` variables are visible in the browser bundle. This is intentional and safe for the Supabase URL and anon key. All other variables are server-side only and must never have the `NEXT_PUBLIC_` prefix added.

### 5.3.1 Verify the CSP allows `wss://` for Supabase Realtime

`vercel.json` ships with a Content-Security-Policy that must explicitly list both `https://*.supabase.co` AND `wss://*.supabase.co` in `connect-src`. The `wss://` scheme is required for the realtime websocket — Chrome enforces strict scheme matching and silently blocks the WS handshake if only `https://` is listed.

Verify the deployed CSP matches expectation after first deploy:

```powershell
curl -I https://your-deployment-url.vercel.app | grep -i content-security
```

The header value's `connect-src` should contain both `https://*.supabase.co` and `wss://*.supabase.co`. If it doesn't, the deploy is running an out-of-date `vercel.json` — confirm master is up to date and redeploy.

**Failure signature when this is wrong:** synthesise streaming surface streams prose correctly, but on completion the AgentTab returns to IDLE without showing Accept/Dismiss. The agent_jobs row IS in `status='completed'` server-side, but the client never receives the realtime UPDATE event because the websocket can't open. Phase 5c diagnosed and fixed this — captured in `reference_vercel_csp_websocket.md` project memory.

### 5.4 Set the Deployment Region

1. After initial setup, go to **Settings → Functions**
2. Set **Function Region** to `syd1` (Sydney). If `syd1` is unavailable on your plan, use `sin1` (Singapore) to co-locate with your Supabase projects.

### 5.5 Deploy

Click **Deploy**. The first build takes 2–4 minutes. When complete, Vercel assigns a production URL (`stelavox-[hash].vercel.app`).

### 5.6 Optional: Custom Domain

1. Go to **Settings → Domains**
2. Click **Add Domain** and enter your domain
3. Add the DNS records Vercel specifies at your domain registrar
4. SSL certificate is provisioned automatically

---

## 6. Environment Variables Reference

### Phase A — Local development (.env.local pointing at local Supabase)

Create this file in the project root. The local keys are printed by `supabase start` and are safe — they only work against your local database.

```bash
# .env.local — Phase A: local Supabase instance
# Run `supabase start` to get the Supabase values

NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon key printed by supabase start]
SUPABASE_SERVICE_ROLE_KEY=[service_role key printed by supabase start]
ANTHROPIC_API_KEY=sk-ant-api03-[your-development-key]
PROMPT_CANARY_TOKEN=[generate with the command below]
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Generate `PROMPT_CANARY_TOKEN`:**
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Generate a separate value for development and production. Store both in your password manager. See Technical Architecture v1.2 §4.4 for the role of this variable — it is a security requirement, not optional.

### Phase B — Cloud dev (.env.local pointing at stelavox-dev)

When switching to Phase B, update `.env.local` with cloud dev project values:

```bash
# .env.local — Phase B: stelavox-dev cloud project

NEXT_PUBLIC_SUPABASE_URL=https://[dev-project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[dev-anon-key]
SUPABASE_SERVICE_ROLE_KEY=[dev-service-role-key]
ANTHROPIC_API_KEY=sk-ant-api03-[your-development-key]
PROMPT_CANARY_TOKEN=[your-dev-canary-token]
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Complete Variable Reference

#### V1 Variables (required at Phase C production launch)

| Variable | Scope | Description | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + Server | Supabase project URL | Safe to expose — RLS enforces access |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + Server | Low-privilege public Supabase key | Safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Bypasses RLS — admin operations | **Never expose to browser** |
| `ANTHROPIC_API_KEY` | Server only | Anthropic API key for platform tier calls | **Never expose to browser** |
| `PROMPT_CANARY_TOKEN` | Server only | Security canary injected into all LLM prompts | **Never expose to browser**. Generate with `crypto.randomBytes(32).toString('hex')`. See Technical Architecture v1.2 §4.4. |
| `NEXT_PUBLIC_APP_URL` | Browser + Server | Full URL of the app (e.g. `https://stelavox.io`) | Used for OAuth redirect construction |

#### V2 Variables (required when billing and BYOK features ship)

| Variable | Scope | Description | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Server only | Stripe secret key | `sk_live_...` in production, `sk_test_...` in preview |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook signing secret | Generate in Stripe Dashboard → Webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser + Server | Stripe publishable key | `pk_live_...` in production |

#### V2 Variables (required when cloud backup ships)

| Variable | Scope | Description |
|---|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | Server only | Google Drive OAuth app client ID |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Server only | Google Drive OAuth app client secret |
| `DROPBOX_APP_KEY` | Server only | Dropbox OAuth app key |
| `DROPBOX_APP_SECRET` | Server only | Dropbox OAuth app secret |
| `ONEDRIVE_CLIENT_ID` | Server only | Microsoft Azure app client ID |
| `ONEDRIVE_CLIENT_SECRET` | Server only | Microsoft Azure app client secret |
| `BACKUP_SIGNING_SECRET` | Server only | HMAC signing key for backup job verification |

### The .env.example File

The project contains a `.env.example` file at the root with placeholder values for every variable listed above. Copy it to `.env.local` and fill in real values. Never put real values in `.env.example` — it is committed to GitHub.

```bash
# .env.example — copy to .env.local and fill in real values
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
PROMPT_CANARY_TOKEN=
NEXT_PUBLIC_APP_URL=

# V2 — Billing (add when Stripe integration ships)
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# V2 — Cloud backup (add when backup feature ships)
# GOOGLE_DRIVE_CLIENT_ID=
# GOOGLE_DRIVE_CLIENT_SECRET=
# DROPBOX_APP_KEY=
# DROPBOX_APP_SECRET=
# ONEDRIVE_CLIENT_ID=
# ONEDRIVE_CLIENT_SECRET=
# BACKUP_SIGNING_SECRET=
```

---

## 7. First Deployment Sequence

### Phase A — Local setup *(start here, before any cloud accounts needed)*

```
Step 1 — Confirm prerequisites
```
```powershell
node --version    # v20+
git --version     # 2.x+
supabase --version
docker --version  # Docker Desktop must be running
```

```
Step 2 — Create GitHub repository
```
Create the `stelavox` private repo as per Section 3.1. Do not push code yet.

```
Step 3 — Generate Anthropic API keys and canary token
```
Create `stelavox-development` and `stelavox-production` keys as per Section 2.4. Store both in your password manager. You only need the development key for now.

Generate your development `PROMPT_CANARY_TOKEN`:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Save this value in your password manager alongside your API keys.

```
Step 4 — Set up local environment
```
```powershell
cd C:\dev\stelavox
npm install
copy .env.example .env.local
# Edit .env.local with the Phase A values (see §6)
# Supabase values come from Step 5 below — add them after supabase start
```

```
Step 5 — Start local Supabase and apply schema
```
```powershell
supabase start
# Note the anon key and service_role key printed — add to .env.local

supabase db push
# Applies migrations 001-012 in order

supabase db execute --file supabase/seed.sql
# Loads agent_profiles, director_configs, and platform_config defaults
```

Verify in Studio (http://localhost:54323):
- All 12 migrations applied (check `supabase_migrations` table)
- `agent_profiles`: 20+ rows
- `director_configs`: 1 row with `status = 'production'`
- `platform_config`: 40+ rows (token budgets, prices, model IDs, export settings, agent limits)

If `platform_config` is empty, re-run `supabase db execute --file supabase/seed.sql` before proceeding.

```
Step 6 — Run locally and verify
```
```powershell
npm run dev
```

Open http://localhost:3000 and confirm the application runs against your local database. All data layer, auth, agent, and Director work happens in this environment. Reset freely with `supabase db reset` as needed.

```
Step 7 — Push code to GitHub
```
```powershell
git add .
git commit -m "Initial project setup"
git remote add origin https://github.com/[your-username]/stelavox.git
git push -u origin main
```

**Phase A is complete. Continue building. Return to this document when the schema is stable and you are ready to test against real Supabase cloud services.**

---

### Phase B — Cloud dev integration *(when schema is stable)*

Entry criterion: migrations 001–012 are all applied locally without errors, the core data layer works, and you are ready to test Auth, Edge Functions, and Realtime against real Supabase cloud infrastructure.

```
Step 8 — Create stelavox-dev Supabase cloud project
```
Follow Sections 4.6–4.10. Record all keys in your password manager.

```
Step 9 — Switch .env.local to cloud dev
```
Update `.env.local` with Phase B values (cloud dev project keys — see §6).

```
Step 10 — Apply schema to cloud dev
```
```powershell
supabase login
supabase link --project-ref [dev-project-ref]
supabase db push
supabase db execute --file supabase/seed.sql
```

Confirm in the Supabase dashboard: `platform_config` has 40+ rows, `director_configs` has one production record.

```
Step 11 — Verify integration
```
Run `npm run dev` and confirm:
- [ ] Login and signup work via Supabase Auth
- [ ] Can create a project and document
- [ ] Can trigger an agent operation and see streaming output
- [ ] `platform_config` keys resolve correctly — no `getConfig()` errors in console
- [ ] Scheduler Edge Function receives and processes a job
- [ ] Realtime updates reflect node changes

**Phase B is complete. Continue building until Phase 1 is feature-complete.**

---

### Phase C — Production *(when Phase 1 is feature-complete and tested)*

Entry criterion: the application is fully working in Phase B, all acceptance criteria in the Phase 1 Build Checklist are met, and you are ready to ship to real users.

```
Step 12 — Create stelavox-prod Supabase project
```
Follow Section 4.11.

```
Step 13 — Generate production canary token
```
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Save this separately from your development canary token — they must be different values.

```
Step 14 — Configure and deploy on Vercel
```
Follow Sections 5.1–5.5. Add all V1 environment variables before deploying — including `PROMPT_CANARY_TOKEN` with the production value generated in Step 13.

```
Step 15 — Apply schema to production
```
```powershell
supabase link --project-ref [prod-project-ref]
supabase db push
supabase db execute --file supabase/seed.sql
```

Verify in the Supabase production dashboard:
- All 12 migrations applied
- `platform_config` has 40+ rows
- `director_configs` has one production record

```
Step 16 — Production smoke test
```
Open your Vercel production URL and verify:

- [ ] Login page loads with no console errors
- [ ] Can create an account and log in
- [ ] Can create a project
- [ ] Can create a document using the Novel template
- [ ] Can create a book node and add a summary
- [ ] Can trigger an agent Expand operation and see child nodes appear
- [ ] Vercel function logs show no `getConfig() key not found` errors
- [ ] Can lock a node
- [ ] Can export to DOCX

All items checked — the application is live.

---

## 8. Day-to-Day Development Workflow

### Phase A — Starting a session (local Supabase)

```powershell
# Ensure Docker Desktop is running (check system tray)

cd C:\dev\stelavox

# Start local Supabase if not already running
supabase start

# Start Next.js dev server
npm run dev
# Application at http://localhost:3000
# Database Studio at http://localhost:54323
# Code changes hot-reload in the browser
```

If you need a clean database state at any point:

```powershell
supabase db reset
# Drops and rebuilds local DB from all migrations + seed — takes ~15 seconds
# The seed re-populates platform_config, agent_profiles, and director_configs automatically
```

### Phase B — Starting a session (cloud dev)

```powershell
cd C:\dev\stelavox
npm run dev
# Application at http://localhost:3000
# Connects to stelavox-dev Supabase cloud project
# Code changes hot-reload in the browser
```

### Making a Change (both phases)

```powershell
# Create a feature branch
git checkout -b feature/your-feature-name

# ... make changes, test at localhost:3000 ...

# Commit when ready
git add .
git commit -m "Add: description of change"

# Push branch to GitHub
git push origin feature/your-feature-name
```

In Phase B, pushing any branch (other than `main`) to GitHub triggers a Vercel **preview deployment** — a live URL for that exact branch, connecting to the `stelavox-dev` project. Check the Vercel dashboard for the preview URL. This lets you test in a real deployed environment before going to production.

### Deploying to Production *(Phase C only)*

```powershell
# Merge feature branch into main
git checkout main
git merge feature/your-feature-name
git push origin main
# Vercel detects the push and deploys automatically (2-3 minutes)

# Clean up the feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

Watch the deployment in the Vercel dashboard. If it fails, the previous deployment remains live — nothing breaks.

---

## 9. Promoting Database Changes to Production

Schema changes require care. A bad migration to production is harder to undo than a bad code deployment.

### Creating a Migration File

New migrations go in `supabase/migrations/` as numbered SQL files:

```
supabase/migrations/
  20240101000000_initial_schema.sql           ← migrations 001-012 already applied
  20240115120000_add_your_new_feature.sql     ← your new migration
```

Name format: `YYYYMMDDHHMMSS_descriptive_name.sql`

After writing any migration, regenerate TypeScript types:

```powershell
supabase gen types typescript --linked > lib/types/database.ts
```

This is mandatory — see Technical Architecture v1.2 H-10. `lib/types/database.ts` is a generated file and must never be edited by hand.

### The Safe Promotion Sequence

**1. Apply and test locally (Phase A)**

```powershell
supabase db push
# Or reset entirely and verify the full sequence:
supabase db reset
```

Test your application at localhost:3000. Confirm the change works as expected.

**2. Apply and test on cloud dev (Phase B)**

```powershell
supabase link --project-ref [dev-project-ref]
supabase db push
```

Test against the cloud dev project. Confirm nothing broke in integration.

**3. Regenerate TypeScript types**

```powershell
supabase gen types typescript --linked > lib/types/database.ts
git add lib/types/database.ts
git commit -m "Update database types for new migration"
```

**4. Deploy code to production first**

Push your code changes to `main`. Let Vercel deploy. The new code is live but the production database doesn't have the new schema yet — this is fine for additive changes (new columns, new tables) since the old code doesn't use them.

**5. Apply migration to production**

```powershell
supabase link --project-ref [prod-project-ref]
supabase db push
```

**6. Verify production**

Test the new functionality on the live production URL.

### Rules

- Always apply locally and test before cloud dev, cloud dev before prod
- Only make additive changes in V1 (add columns/tables, never remove or rename)
- Never edit migration files that have already been applied — write a new migration instead
- Never apply schema changes via the Supabase SQL editor directly — always use migration files so the history stays complete
- If a migration adds new `platform_config` keys, add the corresponding seed rows and re-run the seed against all environments: `supabase db execute --file supabase/seed.sql` (the `ON CONFLICT DO NOTHING` clause makes re-running safe)

---

## 10. Monitoring and Maintenance

### Vercel — Deployment Logs and Errors

**Deployments:** vercel.com → your project → **Deployments**
See full build logs for every deployment. Click any deployment to inspect it.

**Function logs:** Deployments → **Functions**
Real-time logs from your Next.js API routes. Agent operation errors and `getConfig()` failures appear here.

**Rolling back:** Click any previous deployment → **Promote to Production**
Instantly reverts production to a prior version without a code push.

### Supabase — Database Logs and Usage

**Query logs:** Your project → **Logs → Postgres**
All database queries, errors, and slow queries.

**Edge Function logs:** **Logs → Edge Functions**
Logs from agent job execution, Director runner, and scheduled job runner functions.

**Usage:** **Settings → Usage**
Monitor against free tier limits. For V1 user counts (up to approximately 100 users), the free tier is sufficient. Paid plans become viable and necessary at approximately 100 users — see Technical Architecture v1.2 OA-1.

| Resource | Free tier limit | Expected V1 usage |
|---|---|---|
| Database size | 500MB | A full novel is under 5MB |
| Bandwidth | 5GB/month | Very low for text content |
| Edge Function invocations | 500,000/month | A few hundred per novel |

### Anthropic Console — API Costs

**Usage:** console.anthropic.com → **Usage**
Token consumption by day, model, and API key.

**Billing:** **Settings → Billing**
Current month charges and spend limit management.

If costs are unexpectedly high, check the `agent_jobs` table in Supabase Studio — sort by `tokens_input` descending to find any operations that sent an unusually large context. This usually indicates a context assembly configuration issue. Also check `platform_config` for the relevant budget keys — confirm they match expected values.

### Keeping Dependencies Updated

```powershell
# Check for outdated packages
npm outdated

# Apply non-breaking updates
npm update

# Review and apply major version updates one at a time
npm install [package-name]@latest
```

After any update, run locally and test the core workflow before pushing to production. GitHub Dependabot will email you about security vulnerabilities — check **Security → Dependabot alerts** on your repository.

---

## 11. Cloud Backup and Attachments Setup

### 11.1 Supabase Storage Bucket

Create the `node-attachments` storage bucket in **both dev and prod** Supabase projects:

1. Go to **Storage** in the Supabase dashboard
2. Click **New bucket**
3. Name: `node-attachments`
4. Public: **No**
5. File size limit: `52428800` (50MB — matches the `platform_config` key `limits.attachment_max_file_size_bytes` default)
6. Allowed MIME types: `application/pdf,image/jpeg,image/png,image/webp,image/gif,text/plain,text/markdown`

Or via SQL (also included in Migration 010 — do not run manually if migrations have already been applied):

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('node-attachments', 'node-attachments', FALSE, 52428800,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/gif',
        'text/plain','text/markdown']);
```

The storage RLS policy is applied via Migration 010 (see Technical Architecture v1.2 §3.6 Migration 010).

For local development, `supabase start` provides a local Storage instance. Create the bucket locally via the Studio UI at http://localhost:54323 → Storage, or by adding the INSERT statement above to your seed file.

### 11.2 Google Drive OAuth App

Required for the cloud backup feature (V2). Set up now so credentials are ready.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project named `stelavox-backup`
3. Enable the **Google Drive API**
4. Create OAuth 2.0 credentials:
   - Application type: **Web application**
   - Name: `Stelavox Cloud Backup`
   - Authorised redirect URIs:
     - `http://localhost:3000/api/backup/oauth/google/callback` (dev)
     - `https://[your-prod-domain]/api/backup/oauth/google/callback` (prod)
5. Note the **Client ID** and **Client Secret**
6. Add to Vercel environment variables: `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`

### 11.3 Dropbox OAuth App

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Create new app:
   - API: **Scoped access**
   - Access type: **App folder** (scoped to `/Apps/Stelavox Backups/`)
   - Name: `Stelavox Backup`
3. In Permissions, enable: `files.content.write`, `files.content.read`, `files.metadata.read`
4. Add redirect URIs:
   - `http://localhost:3000/api/backup/oauth/dropbox/callback`
   - `https://[your-prod-domain]/api/backup/oauth/dropbox/callback`
5. Note **App key** and **App secret**
6. Add to Vercel: `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET`

### 11.4 Microsoft OneDrive OAuth App

1. Go to [Azure App Registration](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps)
2. New registration:
   - Name: `Stelavox Backup`
   - Supported account types: **Personal Microsoft accounts only** (writers use personal OneDrive)
   - Redirect URI: Web — `http://localhost:3000/api/backup/oauth/onedrive/callback`
3. Add production redirect URI in Authentication settings
4. In API Permissions, add **Microsoft Graph**: `Files.ReadWrite.AppFolder`
5. In Certificates and secrets, create a client secret
6. Note **Application (client) ID** and **Client Secret Value**
7. Add to Vercel: `ONEDRIVE_CLIENT_ID` and `ONEDRIVE_CLIENT_SECRET`

### 11.5 Backup Environment Variables Summary

These variables are not required for V1. The OAuth apps can be registered now and the credentials stored securely for use when V2 backup feature build begins.

```bash
# Add to .env.local for development and Vercel environment variables for production
# when V2 backup feature ships:

GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=

DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=

ONEDRIVE_CLIENT_ID=
ONEDRIVE_CLIENT_SECRET=

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
BACKUP_SIGNING_SECRET=
```

---

## 12. Changelog

**v1.1 — 2026-05-08** Phase 5c follow-up — SU-49 (cloud agent_profiles seed gap) absorbed. Three amendments. **§4.8 Apply Schema to Cloud Dev** — verification block expanded from "platform_config has 40+ rows + director_configs has one production record" to a four-row table that also covers `agent_profiles` count (must be exactly 18 system profiles) and a synthesise_beat prompt-length spot-check (must be 4974 chars). SU-49 surfaced when `stelavox-dev` was found to have only 7 of 18 system profiles, with the 7 having stale system_prompt content; the migration apply succeeded but the SECURITY DEFINER seed helper either ran partially or against earlier migration content. **§4.8.1 Recovery — agent_profiles drift** (new sub-section) — the imperative upsert procedure that was used to bring `stelavox-dev` back to parity with local; pulls all 18 profiles from a known-good local DB and upserts onto cloud keyed on `name`, preserving cloud row IDs. **§4.9 Enable Real-Time** — table list corrected from the v1.0 set (`nodes` / `agent_jobs` / `agent_reports`) to the V1 actual (`nodes` / `agent_jobs` / `node_comments` / `workflows` / `workflow_steps`); `agent_reports` was a v0.6 leftover for a V2 feature that doesn't ship in V1. **§4.11 Phase C** — pointer updated to reference the new §4.8 verification block. **§5.3.1 Verify the CSP allows wss://** (new sub-section) — Phase 5c diagnostic absorption: vercel.json must list `wss://*.supabase.co` separately from `https://*.supabase.co` in `connect-src`; Chrome enforces strict scheme matching and silently blocks the realtime websocket otherwise. Failure signature documented (synthesise streams correctly but Accept/Dismiss never appears post-completion) so future occurrences are diagnosed in seconds. Cross-references reference_vercel_csp_websocket.md project memory.

**v1.0 — 2026-05-01** Initial standard-compliant version. Derived from `stelavox_deployment_setup_v0_6.md`. Changes from v0.6: (a) Added `PROMPT_CANARY_TOKEN` to all environment variable sections — this variable is a V1 security requirement per Technical Architecture v1.2 §4.4 and was absent from v0.6. (b) Added explicit `platform_config` seed verification step to §4.4, §4.8, §7 Steps 5, 10, and 15 — the `platform_config` table (Migration 012) is required at runtime from the first agent call; missing it causes application errors not visible until testing. (c) Expanded environment variables reference (§6) into three groups: V1 required, V2 billing, V2 backup — all variables documented in one place. (d) Added `NEXT_PUBLIC_APP_URL` to the V1 variable set. (e) Updated migration count references from 001–011 to 001–012 throughout. (f) Added `agent_reports` table to the Real-Time enable step (§4.9) — absent from v0.6. (g) Updated companion document references from Technical Architecture v0.11 / Product Specification v0.9 to Technical Architecture v1.2 / Product Specification v1.2. (h) Added §12 Changelog.
