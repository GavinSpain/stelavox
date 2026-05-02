# Stelavox — Product Specification
## Version 1.2

---

## Table of Contents

1. [Vision and Target User](#1-vision-and-target-user)
2. [Scope and Platform Strategy](#2-scope-and-platform-strategy)
3. [Pricing and Monetisation Model](#3-pricing-and-monetisation-model)
4. [Feature Inventory](#4-feature-inventory)
5. [Data Model Summary](#5-data-model-summary)
6. [User Journeys](#6-user-journeys)
7. [Out of Scope](#7-out-of-scope)
8. [Locked Decisions](#8-locked-decisions)
9. [Open Questions](#9-open-questions)
10. [Changelog](#10-changelog)

---

## 1. Vision and Target User

### 1.1 Vision Statement

Stelavox is a structured writing environment that treats any written work as a tree of hierarchically related nodes. Each node represents one layer of the intellectual or creative structure of the work. Authors build their writing top-down, one layer at a time — establishing intent at the highest level, progressively elaborating it downward until finished prose is reached. AI agents are available at every layer: to generate, refine, synthesise, and critique, always operating with full awareness of the context the author has established above.

The product's structural approach is designed for complexity. It does not add value to simple writing tasks — a short email, a one-page memo. Its value is proportional to the structural depth and contextual richness of the work: the more a piece of writing depends on the coherence of many parts across a long period of composition, the more the Stelavox model contributes.

### 1.2 Target User — V1

**Primary:** Fiction and non-fiction novelists writing book-length works that follow a chapter-based structure. This includes traditional genre fiction, literary fiction, narrative non-fiction, memoir, and similar multi-chapter long-form works. The minimum viable use case is a work with at least three chapters; the system adds progressively more value as structural depth and complexity increase. These are authors who have experienced the difficulty of maintaining coherence, voice, and narrative logic across a long project — and who are either already comfortable with AI writing tools or are open to integrating AI assistance into their process.

**Full product target (V2 and beyond):** The full scope of the platform extends to any written form where the task is complex enough to benefit from hierarchical decomposition. This includes academic papers, board reports, technical specifications, essays, and other structured non-fiction. The core data model and agent system are designed to support all of these forms from the foundation; the phased roadmap delivers templates and agent profiles for each form progressively. V1 is targeted at novelists because they represent the clearest product-market fit for the structured top-down workflow and because delivering one document type well is preferable to delivering many document types partially.

### 1.3 Design Principles

- **One data model, infinite forms.** A single generic node structure powers all document types, present and future.
- **Context is king.** The quality of agent output is determined entirely by the quality and structure of the context fed to the agent. The system is designed around feeding agents the right information at the right time.
- **Lock and progress.** Authors move forward deliberately. Completed layers are locked and the work proceeds downward.
- **Agents are collaborators, not autocomplete.** Every agent action is configurable, auditable, and reversible.
- **The database is the source of truth.** All state lives in the database. Export is a rendering concern.

---

## 2. Scope and Platform Strategy

### 2.1 V1 Scope

V1 delivers a complete end-to-end working system for novelists. The measure of completeness is: an author can open a blank project, build a novel top-down through the full structural hierarchy, use AI agents at every layer, maintain a rich context library, lock completed work, and export a formatted manuscript. Every component of that workflow is present and working in V1.

### 2.2 Platform Support

| Platform | V1 | V2 | V3 |
|---|---|---|---|
| Desktop web (1024px+) | ✓ Full product | ✓ | ✓ |
| Tablet web (768px–1023px) | — | ✓ Responsive layout | ✓ |
| Phone — iOS native | — | — | ✓ Mobile notes only |
| Phone — Android native | — | — | ✓ Mobile notes only |

**V1 is desktop web only.** The backend infrastructure for tablet and mobile is built in V1 (data fields, API endpoints, storage configurations), but the mobile and tablet UI is not. This ensures no mobile requirements create constraints on V1 architecture.

### 2.3 Document Types by Phase

| Document Type | Phase Available |
|---|---|
| Novel (fiction and non-fiction, chapter-based) | V1 — Phase 1 |
| Short Story | V1 — Phase 1 |
| Series (multi-book) | V1 — Phase 1 |
| Academic / Scientific Paper | V2 — Phase 2 |
| Board Paper / Executive Report | V2 — Phase 2 |
| Opinion / Essay | V2 — Phase 2 |
| Technical Specification | V2 — Phase 2 |
| Short Essay / Brief | V2 — Phase 2 |

All document types are within the product scope. The phase column indicates delivery timing, not a scope decision. The underlying data model supports all types from V1.

### 2.4 Browser Support

Modern evergreen browsers: Chrome, Firefox, Safari, Edge (latest two major versions each). Internet Explorer is not supported. No browser extension or plugin is required.

---

## 3. Pricing and Monetisation Model

### 3.1 Subscription Tiers

Stelavox offers six subscription tiers across three models: Trial, BYOK (Bring Your Own Key), and Platform. All prices are in USD.

#### Trial

| Tier | Monthly Price | Annual Price | Duration | AI Access | Token Budget |
|---|---|---|---|---|---|
| **Trial** | $0 | n/a | 30 days | Platform tokens | 1,000,000 tokens (full period, no reset) |

The 30-day trial provides unrestricted access to all features, including the Director. The trial token budget is 1,000,000 tokens for the full 30-day period — it does not reset monthly within the trial. After 30 days the trial expires and the user must select a paid plan to continue. There is no permanent free tier.

#### BYOK Tiers

| Tier | Monthly Price | Annual Price | Users | AI Access |
|---|---|---|---|---|
| **BYOK Solo** | $15/mo | $144/yr | 1 | User's own API key |
| **BYOK Team** | $35/seat/mo | $336/seat/yr | 2+ seats | User's own API key |

The user provides their own LLM provider API key (Anthropic or OpenAI at launch). They pay their API provider directly for every token consumed. Stelavox charges a flat fee for platform access only. No token quotas are enforced by Stelavox — the user's own provider rate limits apply. BYOK users receive full feature access including the Director.

Annual prices reflect a 20% discount on the monthly rate. Annual pricing is locked here as a reference; the actual amounts are stored in the database and are changeable without a code deployment.

#### Platform Tiers

| Tier | Monthly Price | Annual Price | Token Budget/Period | Features |
|---|---|---|---|---|
| **Writer** | $20/mo | $192/yr | 1,000,000 tokens | Full |
| **Author** | $50/mo | $480/yr | 4,000,000 tokens | Full |
| **Pro** | $120/mo | $1,152/yr | 16,000,000 tokens | Full |

Stelavox provides the API key and absorbs token costs into the subscription price. All platform tiers include full feature access. Token budgets are hard ceilings — overage is never charged. Budget resets on the subscription anniversary date each billing period.

**All prices are database-configurable.** The figures above are the launch prices and serve as the locked reference in this specification. Changes to pricing require a minor version bump to this document and a database update; no code deployment is needed.

### 3.2 Token Budget Details

| Tier | Budget | Approximate capacity |
|---|---|---|
| Trial | 1,000,000 | ~400 synthesise operations on a mature document |
| Writer | 1,000,000 per period | Regular short-form or occasional long-form work |
| Author | 4,000,000 per period | Intensive long-form work; a full novel in active writing mode |
| Pro | 16,000,000 per period | Heavy daily use across multiple active projects |

Token budgets are measured as the sum of input and output tokens across all agent operations, Director sessions, and document operations in the billing period. BYOK tiers have no Stelavox-imposed budget.

At 80% of budget consumed, a non-intrusive nudge appears in the agent panel. At 100%, AI operations are paused and an upgrade prompt is shown. No email notifications are sent for budget consumption.

### 3.3 Annual Billing

Annual subscribers receive a 20% discount. The token budget still resets monthly on the subscription anniversary date — the annual payment covers 12 budget periods. Annual pricing figures are locked in §3.1.

### 3.4 Billing Infrastructure

Stripe handles all payment processing. Stelavox never stores, processes, or transmits card data and is not in scope for PCI DSS. The integration covers: Checkout (hosted payment page), Webhooks (subscription lifecycle events), and Customer Portal (Stripe-hosted subscription management). Stelavox builds no subscription management UI beyond a "Manage Billing" button that links to the Stripe portal.

**What Stelavox stores from Stripe:** `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`. No payment details are stored in the Stelavox database.

### 3.5 Refund Policy

Monthly subscriptions are non-refundable. The subscription remains active until the period end following cancellation. Annual subscriptions are refunded pro-rata within 30 days of the payment date. No refund is issued on annual subscriptions after the 30-day window. Trial expiry does not trigger a refund — the trial is free and the 30-day window is the commitment.

### 3.6 Payment Failure

On payment failure, the organisation's status is set to `past_due`. AI operations remain available for a 7-day grace period while Stripe retries. After the grace period, AI operations are suspended until payment is recovered or the user selects a new plan. There is no fallback to a free tier.

---

## 4. Feature Inventory

Features are grouped by surface area. The Phase column indicates the development phase in which the feature is delivered. All features listed are within V1 product scope; phase assignment reflects delivery timing.

### 4.1 Authentication and Identity

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Email + password auth | Standard credential login with email verification and password reset | As a new user, I want to create an account with my email address | `auth.users`, `audit_log` | 1 |
| Magic link (passwordless) | One-time login link sent to email address | As a user, I want to sign in without a password | `auth.users`, `audit_log` | 1 |
| Google OAuth | One-click sign-in with Google account | As a user, I want to sign in using my Google account | `auth.users`, `organisation_members`, `audit_log` | 2 |
| GitHub OAuth | One-click sign-in with GitHub account | As a user, I want to sign in using my GitHub account | `auth.users`, `organisation_members`, `audit_log` | 2 |
| Session management | 7-day session expiry; user can view and revoke active sessions | As a user, I want to see where I am signed in and revoke suspicious sessions | `auth.sessions`, `audit_log` | 1 |
| Auto-organisation creation | New user gets an organisation created automatically at signup in a single transaction | As a new user, I want to start using the product immediately without manual setup | `organisations`, `organisation_members` | 1 |

### 4.2 Organisations and Multi-Tenancy

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Organisation model | Every piece of user data belongs to an organisation; billing is at org level | As a user, all my work is scoped to my account | `organisations`, all data tables | 1 (schema); 2 (UI) |
| Member roles | `owner` and `member` in V1; `admin` in V2 | As an owner, I want to control who has access to my organisation | `organisation_members` | 2 |
| Member invitation | Invite by email; 72-hour token; existing or new user flows | As an owner, I want to invite a collaborator by email | `organisation_invites`, `organisation_members` | 2 |
| Node locks | Temporary exclusive edit lock per node; 5-minute expiry; auto-release on idle | As a collaborator, I want to know if someone else is editing a node | `node_locks` | 2 |
| Force-release lock | Organisation owner can release any lock from settings | As an owner, I want to unblock a node locked by an absent member | `node_locks`, `audit_log` | 2 |
| Audit log | Security-relevant events recorded: logins, role changes, key management, lock releases | As an owner, I want a record of who did what in my organisation | `audit_log` | 1 (schema + writes); 2 (UI) |
| Data export (GDPR) | Full workspace export as JSON archive | As a user, I want to download all my data | All tables | 2 |
| Account deletion | Cascade delete of all data; audit logs retained 90 days | As a user, I want to delete my account and all my data | All tables | 2 |

### 4.3 Subscriptions and Billing

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Subscription tiers | Trial, BYOK Solo, BYOK Team, Writer, Author, Pro | As a user, I want to choose the plan that fits my usage | `organisations.plan` | 2 |
| Stripe checkout | Hosted payment page; Stelavox never handles card data | As a user, I want to subscribe to a paid plan | `organisations`, `subscription_events` | 2 |
| Stripe webhooks | Subscription lifecycle events update org status | As the system, I need to keep org billing status current | `organisations`, `subscription_events` | 2 |
| Customer portal | Stripe-hosted portal for subscription management | As a user, I want to update my card or cancel my subscription | Stripe (external) | 2 |
| Token budget enforcement | Hard ceiling on token consumption for platform tiers | As a Writer subscriber, I want to know I will never be charged overage | `usage_records`, `organisations` | 2 |
| Usage dashboard | Percentage-of-budget bar with daily consumption chart | As a user, I want to see how much of my token budget I have used | `usage_records` | 2 |
| BYOK key management | User-provided API key stored encrypted in Supabase Vault; key validation on submission | As a BYOK user, I want to use my own Anthropic key | `organisations.byok_api_key_vault_id` (Vault) | 2 |
| Token usage recording | Every LLM call records input and output tokens | As the system, I need to track token consumption per organisation | `usage_records`, `agent_jobs` | 1 (schema); 2 (enforcement) |

### 4.4 Projects and Documents

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Project creation | Named container for related works; supports multiple documents and shared context | As an author, I want to group related books under one project | `projects` | 1 |
| Document creation | Single written work within a project; forked layer stack at creation | As an author, I want to start a new novel | `documents`, `layer_stacks` | 1 |
| Document types | V1: Novel, Short Story, Series. V2+: Academic Paper, Board Paper, Essay, Technical Spec, and others | As an author, I want to choose the structure appropriate to my work | `documents.document_type`, `layer_stacks` | 1 (Novel/Short Story/Series); 2+ (others) |
| Multi-document projects | Multiple works in one project sharing project-scoped context | As an author writing a trilogy, I want all three books to share my character library | `projects`, `documents`, `nodes.scope` | 1 |
| Document archiving | Set document status to `archived`; excluded from active views | As an author, I want to archive a completed draft | `documents.status` | 1 |

### 4.5 The Node System

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Node CRUD | Create, read, update, delete structural and context nodes | As an author, I want to add, edit, and remove nodes in my document | `nodes` | 1 |
| Structural tree | Hierarchical node tree ordered by integer position | As an author, I want to see my document structure as a tree | `nodes.parent_id`, `nodes.order` | 1 |
| Node reordering | Move nodes within siblings; integer reordering with sibling renumbering | As an author, I want to move Chapter 3 before Chapter 2 | `nodes.order` | 1 |
| Content fields | `summary`, `prose`, `notes`, `metadata` | As an author, I want to write a chapter summary and then eventually produce prose | `nodes` | 1 |
| Node status | `draft`, `in_review`, `approved`, `locked` | As an author, I want to mark a chapter as approved before moving on | `nodes.status` | 1 |
| Node locking | Hard lock on a node and all descendants at a layer; prevents all content changes | As an author, I want to lock Act 1 so agents cannot touch it | `nodes.locked` | 1 |
| Node versioning | Every content change creates a new version record | As an author, I want to see what a scene looked like before the last agent edit | `node_versions` | 1 |
| Editorial comments | Human and agent comments on nodes; threaded; typed (instruction, question, note, critique, approval) | As an author, I want to leave an instruction for the agent on a specific scene | `node_comments` | 1 |
| Node attachments | PDF, image, or text files attached to a node and stored in Supabase Storage | As an author, I want to attach a reference image to a location node | `node_attachments` | 1 (backend); 2 (UI) |
| Mobile notes | Append-only timestamped notes on a node, added from the phone interface | As an author, I want to capture a thought on my phone before I lose it | `nodes.mobile_notes` | 1 (backend); 3 (phone UI) |

### 4.6 Layer Stack Templates

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Built-in templates | Novel, Short Story, Series, Academic Paper, Board Paper, Essay, Technical Spec, Short Essay | As an author, I want to start from a structure appropriate to my document type | `layer_stacks` | 1 (Novel/Short Story/Series); 2+ (others) |
| Template forking | Layer stack is copied into the document at creation; the copy is fully editable | As an author, I want to customise my novel's structure without affecting the template | `layer_stacks` (per-document copy) | 1 |
| Custom templates | Author can save a customised layer stack as a workspace-level template | As an author with an unusual structure, I want to reuse it across projects | `layer_stacks` | 2 |

### 4.7 Context Node System

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Context node types | Character, Location, Organisation, Theme, Plot Thread, World, and 30+ other sub-types | As an author, I want to create a structured character profile that agents can reference | `nodes` (context category) | 1 (core types); 2+ (extended) |
| Context linking | Connect context nodes to structural nodes via junction table | As an author, I want to tell the system which characters appear in Chapter 5 | `node_context_links` | 1 |
| Project vs document scope | Context nodes scoped to project (shared across all documents) or document (private to one) | As an author writing a trilogy, I want my character library shared across all three books | `nodes.scope` | 1 |
| Context-to-context linking | Link context nodes to each other (character to location, theme to plot thread) | As an author, I want to record that my protagonist lives in the northern city | `node_context_links.link_type = 'context_to_context'` | 3a |
| Metadata schemas | Structured JSON schemas per context type (character, location, evidence, theme, etc.) | As an author, I want to fill in a structured form for a character with fields like age, want, fear | `nodes.metadata` | 1 |

### 4.8 Agent System — Single-Node Operations

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Agent profiles | Named, reusable configurations defining agent behaviour per node type | As an author, I want the agent to behave differently when expanding a chapter vs. writing prose | `agent_profiles` | 1 |
| Expand operation | Generate child nodes one layer down based on the current node's content and context | As an author, I want the agent to draft scenes for Chapter 3 from my chapter summary | `nodes`, `agent_jobs` | 1 |
| Synthesise operation | Generate prose at a leaf node from the accumulated context above | As an author, I want the agent to write prose for a beat based on everything I've established | `nodes`, `agent_jobs` | 1 |
| Refine operation | Rewrite or improve existing content in a node | As an author, I want the agent to improve the prose in Scene 2, making it more tense | `nodes`, `agent_jobs`, `node_versions` | 1 |
| Generate context operation | Generate a context node's content from scratch or from existing partial content | As an author, I want the agent to flesh out a character profile from the notes I've written | `nodes`, `agent_jobs` | 1 |
| Critique operation | Provide critical feedback on a node's content without modifying it | As an author, I want the agent to identify weaknesses in this chapter's structure | `node_comments`, `agent_jobs` | 3a |
| Custom operation | Author-defined operation with a freeform system prompt override | As an author, I want to give the agent a one-off instruction that doesn't fit the standard types | `nodes`, `agent_jobs` | 1 |
| Agent job logging | Every agent operation recorded with status, tokens consumed, model, and timestamps | As an author, I want a complete audit trail of all AI-generated content | `agent_jobs` | 1 |
| Context assembly | Agent collects context from ancestor nodes and linked context nodes before every operation | As the agent, I need the full structural and contextual hierarchy to write well | `nodes`, `node_context_links` | 1 |
| Prompt caching | Anthropic prompt caching applied to shared context portions; reduces token costs ~35–40% | As a BYOK Anthropic user, I want to minimise my token costs | LLM call layer | 1 |

### 4.9 Agent System — Document Operations

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Style consistency analysis | Cross-document operation analysing prose style consistency across all nodes | As an author, I want to know if my prose style drifts between chapters | `agent_reports`, `node_comments` | 3a |
| Voice consistency by character | Analyse whether each character's dialogue and narration voice is consistent | As an author, I want to confirm that Elena sounds the same in Chapter 12 as she did in Chapter 2 | `agent_reports`, `node_comments` | 3a |
| POV discipline audit | Identify POV slippage across scenes | As an author using strict third-person limited, I want to catch where I accidentally slip into another character's head | `agent_reports`, `node_comments` | 3a |
| Pacing analysis | Analyse scene length, tension arc, and structural rhythm across the document | As an author, I want to know if the middle third of my novel is paced too slowly | `agent_reports`, `node_comments` | 3a |
| Timeline continuity audit | Identify inconsistencies in character positions, timelines, or cause-and-effect sequences | As an author, I want to catch if a character is in two places at once | `agent_reports`, `node_comments` | 3a |
| Agent Reports panel | UI for reviewing document operation reports with per-node references | As an author, I want to read the style analysis and navigate to the flagged nodes | `agent_reports` | 3a |

### 4.10 The Director

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Director Mode | Conversational interface to Stelavox; the author describes goals in natural language | As an author, I want to describe what I need in plain language without navigating menus | `conversations`, `conversation_messages` | 5 |
| Workflow planning | Director produces a structured multi-step plan before taking any action | As an author, I want to see and approve what the Director plans to do before it does anything | `workflows`, `workflow_steps` | 5 |
| Plan approval gate | No Director action occurs without explicit author approval of the plan | As an author, I want to be in control of all changes to my document | `workflows.status` | 5 |
| Workflow execution | Director executes approved plan; calls all other agents and APIs as tools | As an author, I want the Director to carry out the approved plan automatically | `workflows`, `nodes`, `agent_jobs` | 5 |
| Workflow history | Completed workflows are stored and browsable from the Director panel | As an author, I want to see what the Director has done in past sessions | `workflows`, `workflow_steps` | 5 |
| Conversation thread | Persistent conversation history per document; Director remembers prior decisions | As an author, I want the Director to remember what we discussed last session | `conversations`, `conversation_messages` | 5 |
| Locked node respect | Director will never modify a locked node; plans note locked nodes explicitly | As an author, I want my locked chapters to be safe from Director modifications | `nodes.locked`, workflow planning | 5 |
| Downstream impact assessment | Director assesses what downstream nodes will be affected by a proposed change | As an author, I want to understand the knock-on effects before I approve a plan | `workflows`, node tree analysis | 5 |
| Research pipeline | Director research lands in context nodes as proposals, never as established fact | As an author, I want to review any research before it becomes part of my document | `nodes` (context), Director tool suite | 6 |
| Director config table | Director behaviour defined by a database record (model, system prompt, tool suite, flags) | As a developer, I want to update the Director's configuration without a code deployment | `director_configs` | 1 (schema + seed); 5 (executor) |
| Director version pin | A document can be pinned to a specific Director config version | As an author mid-project, I want to stay on the Director version I started with | `documents.director_config_id` | 6 |

### 4.11 Scheduled Jobs

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Scheduler | pg_cron polling every minute; executes scheduled agent or Director jobs | As an author, I want to schedule a document operation to run overnight | `scheduled_jobs` | 1 (schema + runner); 1 (UI) |
| Schedulable job types | Document operation, Director workflow, context regeneration, backup | As an author, I want to set a recurring weekly pacing analysis | `scheduled_jobs` | 1 |
| Lock-aware execution | Scheduler defers if target nodes are locked by another user; fails after 3 deferrals | As the system, I must not run a scheduled operation that conflicts with an active session | `node_locks`, `scheduled_jobs` | 1 |

### 4.12 Versioning

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Per-node version history | Every content change creates a new version record | As an author, I want to revert a scene to how it was before the last agent edit | `node_versions` | 1 |
| Version comparison | View two versions of a node side by side | As an author, I want to see what changed between version 3 and version 7 of this beat | `node_versions` | 2 |
| Version restore | Restore a node to any previous version | As an author, I want to undo the last three agent operations on this scene | `nodes`, `node_versions` | 2 |

### 4.13 Export System

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| DOCX export | Export document as a formatted Word document | As an author, I want to send my manuscript to an editor as a Word file | `nodes`, export job | 1 |
| JSON export | Full-fidelity export of the complete node tree and all content fields | As an author, I want a machine-readable backup of my entire document | `nodes`, `node_versions` | 1 |
| Markdown export | Prose content exported as Markdown, organised by document structure | As an author, I want to import my prose into Obsidian | `nodes` | 2 |
| PDF export | Export as PDF with document-appropriate formatting | As an author, I want to share a reading copy | Export job | 2 |
| EPUB export | Export as EPUB for e-reader distribution | As an author preparing to self-publish, I want a valid EPUB file | Export job | 4 |
| KDP export | DOCX in Amazon KDP-compliant format | As an author publishing on Amazon, I want a KDP-ready file | Export job | 4 |
| Export profiles | Saved export configuration presets | As an author, I want to save my preferred DOCX styling for this project | `export_profiles` | 4 |
| Outline export mode | Export structural nodes only (no prose) as a readable outline | As an author, I want a printable outline of my novel's structure | Export job | 2 |

### 4.14 Cloud Backup

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Google Drive backup | Scheduled or manual backup exported directly to Google Drive | As an author, I want my work automatically backed up to my Google Drive every night | `backup_configs`, `backup_jobs` | 1 (backend); 2 (UI) |
| Dropbox backup | As above, to Dropbox | As an author who uses Dropbox with Obsidian, I want my backups there | `backup_configs`, `backup_jobs` | 1 (backend); 2 (UI) |
| OneDrive backup | As above, to Microsoft OneDrive | As an author in the Microsoft ecosystem, I want my backups in OneDrive | `backup_configs`, `backup_jobs` | 1 (backend); 2 (UI) |
| iCloud backup | As above, to iCloud (requires native iOS app) | As an iOS author, I want my backups in iCloud | `backup_configs`, `backup_jobs` | 3 (with iOS app) |
| Backup formats | JSON (full fidelity), Markdown (prose only), ZIP (both) | As an author, I want a backup format I can use outside Stelavox | Backup job output | 2 |
| Backup scheduling | Daily or weekly at user-configured time; or manual only | As an author, I want to control when backups run | `backup_configs.schedule` | 2 |

### 4.15 Security and Data Protection

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Encryption at rest | AES-256 managed by Supabase across all data | As a user, I want my content protected if Supabase is compromised | All storage | 1 (inherent to Supabase) |
| TLS in transit | All communication over TLS 1.3 | As a user, I want my data protected in transit | All network traffic | 1 (inherent) |
| BYOK double encryption | BYOK API keys encrypted with Vault-managed key in addition to at-rest encryption | As a BYOK user, I want my API key to receive maximum protection | Supabase Vault | 2 |
| RLS enforcement | All data access enforced at the database level via Row Level Security | As the system, I must prevent any cross-organisation data access regardless of application bugs | All tables | 1 |
| Honest E2EE positioning | Privacy policy clearly states that AI operations require server-side content access; Stelavox does not claim E2EE | As a user, I want honest disclosure about how my content is handled | Privacy policy | 1 |

### 4.16 Mobile and Tablet

| Feature | Description | User Story | Data Touched | Phase |
|---|---|---|---|---|
| Tablet responsive layout | Desktop layout adapts at ≤1024px; sidebar collapses; prose column max 560px | As a tablet user, I want the full product experience on my iPad | No new tables | 2 |
| Phone — browse and read | Read-only document tree navigation and node content viewing | As an author on my phone, I want to review what I wrote | Mobile API endpoints | 3 |
| Phone — mobile notes | Append-only timestamped notes on any node; speech-to-text via native APIs | As an author, I want to capture a thought on my phone before I lose it | `nodes.mobile_notes` | 3 |
| Phone — offline queue | Notes queued locally when offline; sync on connectivity restore | As an author with patchy connectivity, I want my notes captured regardless | Local SQLite, mobile sync API | 3 |

---

## 5. Data Model Summary

This section describes the conceptual shape of the data — the entities and how they relate. The authoritative schema (DDL/SQL) lives in the Technical Architecture (see Technical Architecture v1.0 §3). In cases of discrepancy, the Technical Architecture is authoritative.

### 5.1 Entity Overview

**Organisations** are the top-level containers. Every piece of user data belongs to an organisation. A solo author is an organisation of one. Billing is at the organisation level.

**Users** have identity through Supabase Auth. A user can belong to multiple organisations. Each user–organisation relationship is captured in **Organisation Members**, which also carries the user's role (`owner`, `member`, `admin`).

**Projects** belong to organisations. A project is a named container for related work — a trilogy, a research programme, a client account. Projects group documents that share context.

**Documents** belong to projects. A document is a single written work. At creation, a document receives a **Layer Stack** forked from a template. The layer stack defines the structural hierarchy: `Book → Act → Chapter → Scene → Beat` for a novel.

**Nodes** are the fundamental unit. Every structural element (book, chapter, scene, beat) and every piece of reference material (character, location, theme, plot thread) is a node. Structural nodes form an ordered tree; context nodes exist outside the tree but are linked to structural nodes through **Node Context Links**. All nodes live in a single `nodes` table, distinguished by `node_category` (`structural` | `context`).

**Node Versions** capture every content change to a node. The current content is denormalised back into the `nodes` table for query performance. The versions table is the historical record.

**Agent Profiles** define how the AI agent behaves for a specific node type and operation. They are reusable workspace-level configurations.

**Agent Jobs** record every AI operation: what was requested, what was generated, how many tokens were consumed, and whether it succeeded.

**Agent Reports** store the outputs of document-level operations (style analysis, pacing review, etc.) — structured analytical documents with references to specific nodes.

**Editorial Comments** are attached to nodes. Both humans and agents post comments. Comments can be instructions, questions, notes, critiques, or approvals. Document operations post critique comments to multiple nodes simultaneously.

**Conversations** are the Director's persistent chat history, one per document. **Workflows** are the Director's plans — ordered sequences of **Workflow Steps** with status tracking and a full audit trail.

**Scheduled Jobs** describe agent or Director operations to be triggered at a future time or on a recurring schedule.

**Backup Configs** describe a user's cloud storage connection and schedule. **Backup Jobs** record each backup run.

**Usage Records** aggregate token consumption per organisation per billing period for budget enforcement and the usage dashboard.

**Subscription Events** record every subscription lifecycle change for audit and debugging.

**Audit Log** records all security-relevant events: logins, member changes, role changes, BYOK key operations, lock releases.

### 5.2 Key Relationships

- An organisation has many users (through organisation_members); a user can belong to many organisations.
- An organisation has many projects; a project has many documents; a document has many nodes.
- Every data record (projects, documents, nodes, agent_jobs, etc.) carries `organisation_id` for RLS enforcement.
- A structural node has one parent node (or is the root); a context node has no parent.
- A structural node can link to many context nodes; a context node can link to many structural nodes (many-to-many through `node_context_links`).
- A document has one layer stack (its forked copy); a layer stack has many layer definitions.
- An agent profile is used by many layer definitions; a layer definition references one default agent profile.

---

## 6. User Journeys

These journeys describe complete end-to-end tasks a user would perform. They form the basis of acceptance test design. Each journey is for a single session or a coherent sequence of sessions.

### J1 — Starting a Novel: Project, Document, and Top-Level Context

**User:** A fiction author beginning a new fantasy novel.

**Narrative:** The author creates a project called "The Veil Chronicles" and within it a document of type Novel named "Book 1: The Broken Seal." The system forks the Novel layer stack and creates the root `book` node. The author writes a book-level summary in the root node describing the core premise, protagonist, and central conflict. She then creates three context nodes at the project level: a Character node for her protagonist Elena, a World node for the setting, and a Theme node for the central theme. She fills in Elena's structured metadata fields — age, role, core want, core fear, psychological profile — and writes a paragraph in the summary field. She links Elena to the book root node. She saves and the system creates version 1 of each node. She then opens the agent panel and runs the **Generate Context** operation on the Elena character node to have the agent expand Elena's voice notes and arc description from the summary she has written. The agent produces a draft; the author reviews it, edits one sentence, and saves. A new version is created.

**Acceptance signals:** Project and document exist. Root node has content. Three context nodes exist with correct scope (`project`). Elena has two versions. The agent job is recorded in `agent_jobs`. Elena's context is linked to the book root node in `node_context_links`.

---

### J2 — Building Structure: Top-Down Expansion with Agent Assistance

**User:** The same author, next session, ready to plan her chapters.

**Narrative:** The author navigates to the Book 1 root node and runs the **Expand** operation. She provides an agent instruction: "Generate five chapters. Act 1 should cover the discovery of the breach; Act 2 the journey; Act 3 the confrontation." The agent produces five chapter nodes, each with a name and a summary. The author reviews each summary in turn. She is satisfied with chapters 1, 3, and 5. Chapter 2's summary is wrong — the agent misunderstood the pacing. She edits Chapter 2's summary directly. She is not happy with Chapter 4 and runs **Refine** on it with the instruction "Make this chapter focus on Elena's internal conflict, not the external battle." The agent produces a new version of Chapter 4's summary. Satisfied, the author selects all five chapters and sets their status to `approved`. She then selects Chapter 1 and runs **Expand** again to generate scenes. The agent produces four scene nodes under Chapter 1. She reviews and approves three of them. The fourth she deletes and manually creates a replacement with her own summary.

**Acceptance signals:** Five chapter nodes exist as children of the root. Chapter 2 has a user-edited version. Chapter 4 has two versions (original and refined). All five have `status = approved`. Chapter 1 has four scene child nodes, one of which was created manually. All agent operations are logged in `agent_jobs`.

---

### J3 — Context Creation: Building the World Before Writing

**User:** The author is mid-structure, building out context before writing any prose.

**Narrative:** The author switches her focus from structure to context. She creates a Location node for "The Northern Citadel" at project scope, filling in the structured metadata (location type, atmosphere, historical significance, sensory notes). She then creates a Plot Thread node called "Elena's Betrayal Arc" and writes a summary of how the betrayal develops across the three acts. She links the Plot Thread to Chapters 3, 4, and 7. She creates a Timeline Event node for "The Night of the Breach" and links it to Chapter 1. She then runs **Generate Context** on the Northern Citadel location node to have the agent expand the atmosphere and sensory notes fields from the description she has written. The agent produces a rich atmospheric description. The author reviews it and leaves an editorial comment of type `instruction`: "Add a reference to the smell of burning pine — this appears throughout the series." She then re-runs **Refine** on the location node and the agent incorporates the instruction. The comment is marked resolved. The author links the Northern Citadel to Chapter 3.

**Acceptance signals:** Location, Plot Thread, and Timeline Event context nodes exist. Plot Thread is linked to chapters 3, 4, and 7 in `node_context_links`. Timeline Event is linked to Chapter 1. Location node has two versions. One resolved comment exists on the location node. Location is linked to Chapter 3.

---

### J4 — Writing Prose: Scene Expansion, Editorial Review, and Agent Revision

**User:** The author is ready to write prose for a specific scene.

**Narrative:** The author navigates to Scene 2 of Chapter 1. The scene has an approved summary: "Elena discovers the breach in the Veil — a moment of horror and resolve." She runs **Expand** to generate beats. The agent produces three beat nodes. She reviews each beat's summary. Beat 2 has an issue — the agent has Elena react with confusion, but the character profile says Elena is decisive. The author leaves an editorial comment of type `instruction` on Beat 2: "Elena must not be confused here. She recognises what she sees immediately and is terrified but resolute. Revise the beat summary to reflect this." She then runs **Refine** on Beat 2 referencing the comment. The agent reads the comment and the character profile and produces a revised beat summary. The author approves the revision and marks the comment resolved. She then runs **Synthesise** on each of the three beats in sequence to generate prose. She reviews Beat 1's prose and it is good. Beat 3's prose has a stylistic problem — the tone is wrong. She runs **Refine** on Beat 3's prose with the instruction "Too formal. Elena is seventeen and thinks in short, blunt thoughts. Rewrite the prose to match her voice." The agent produces revised prose. The author is satisfied and locks all three beats.

**Acceptance signals:** Three beat nodes exist under Scene 2. Beat 2 has two summary versions; the comment is resolved. All three beats have prose (populated from Synthesise). Beat 3 has two prose versions. All three beats are locked. Six agent jobs are recorded (one Expand, one Refine on Beat 2, three Synthesise, one Refine on Beat 3). Elena's character profile was included in the context assembly for the Synthesise operations (visible in `agent_jobs.context_snapshot`).

---

### J5 — Director: Document-Level Review and Planned Revisions

**User:** The author has completed a full draft of Act 1 (six chapters, all beats written and prose generated) and wants the Director to review the pacing and propose structural changes.

**Narrative:** The author switches from Edit Mode to Director Mode. The Director panel opens in the right column; the node tree remains visible on the left. The author types: "Act 1 feels slow in the middle. Chapters 3 and 4 seem to drag and I think the scene order might be wrong. Can you review the structure and suggest changes?"

The Director begins its read phase. It calls `get_document_state` first to orient itself — this returns the layer stack, node counts, locked layers, and word count progress. It then calls `get_nodes_by_layer` to retrieve all Act 1 scene summaries. It calls `get_node` on each scene in chapters 3 and 4 to read their content and linked context nodes. The Director's read tool calls are visible as brief status indicators in the UI ("Director is reading Chapter 3...") but do not block the conversation stream — the author sees the Director's reasoning in real time as text streams into the panel.

After its analysis the Director produces a workflow proposal embedded in its response. The proposal reads: "I've reviewed Act 1. The pacing issue in chapters 3 and 4 stems from two things: Scene 2 of Chapter 3 and Scene 1 of Chapter 4 cover the same emotional beat (Elena processing her fear) back to back, and Chapter 3 ends on an internal reflection rather than an external event, which reduces momentum. Here is my proposed plan:"

The workflow plan is rendered as a structured card below the Director's message. It contains three steps:
- **Step 1:** Reorder Chapter 3 — move Scene 3 (the confrontation with the guard) before Scene 2 (the reflection). Estimated duration: 30 seconds.
- **Step 2:** Refine Chapter 3 Scene 2 summary — agent rewrite to make the reflection briefer and tied to external action. Estimated duration: 45 seconds.
- **Step 3:** Refine Chapter 4 Scene 1 summary — agent rewrite to differentiate this scene's emotional focus from the now-repositioned Chapter 3 Scene 2. Estimated duration: 45 seconds.

The plan also notes: "Chapter 1 is locked and is not affected by this plan. All other Act 1 chapters are untouched."

The author reads the plan. She agrees with steps 1 and 2 but wants to handle Step 3 herself. She clicks the trash icon on Step 3 to remove it from the plan, then clicks "Approve Plan." The workflow status transitions from `draft` to `approved`.

The Director executes: Step 1 reorders the scenes (the tree updates live). Step 2 triggers a Refine agent job on Chapter 3 Scene 2; the author watches the summary rewrite in the node tree. Both steps complete. The Director's final message confirms: "Done. Chapter 3 Scene 3 is now before Scene 2, and Scene 2's summary has been revised. I've left Chapter 4 Scene 1 for you to handle directly — navigate there when you're ready."

The author clicks the Chapter 4 Scene 1 link in the Director's message, which navigates the tree to that node. The Director panel remains open in the background with the full conversation history preserved.

**Acceptance signals:** A `conversations` record exists for this document. A `workflows` record exists with `status = completed`. `workflow_steps` contains two completed steps and one step that was removed before approval (recorded with `status = removed`). Chapter 3 node order has changed (Scene 3 before Scene 2). Chapter 3 Scene 2 has a new version authored by the Refine agent job. Chapter 1 is unchanged (locked). The Director's two read tool calls (`get_document_state`, `get_nodes_by_layer`, `get_node` × N) are recorded in the conversation message's tool call log but created no `agent_jobs` (read-only). Step 2's Refine is recorded in `agent_jobs` with `triggered_by = workflow_step`. Token usage is recorded in `usage_records` for the Director conversation.

---

## 7. Out of Scope

The following are deliberately not built in V1 — these are product-level exclusions, not just phase-timing decisions. Items excluded by timing only appear in the phase plan in §4 under their relevant feature with a phase assignment.

| Item | Reason |
|---|---|
| Real-time collaborative editing (operational transformation / CRDT) | Async collaboration with node locks covers the real use cases without the engineering complexity of live OT. Not in scope for any version of V1. Async is a deliberate model choice, not a temporary limitation. |
| Self-hosted / on-premises deployment | The target market does not want to manage infrastructure. All users are on Stelavox's hosted SaaS. |
| iCloud backup in V1 or V2 | CloudKit API is not viable as a web integration. iCloud backup requires the native iOS app (V3). |
| End-to-end encryption | Architecturally incompatible with server-side AI operations. The server must be able to read content in plaintext to pass it to the Anthropic API. Stelavox does not claim E2EE and the privacy policy states this explicitly. |
| Restore from backup | Per-node version history (§4.12) covers all content recovery use cases. Backup is for data portability and disaster recovery, not in-app restore. |
| Permanent free tier | The trial (30 days) is the onboarding mechanism. No permanent free tier exists. The trial is not reinstated after expiry. |
| Multi-region data residency (V1) | All data is in Supabase's Singapore region. EU or US residency requires a separate deployment configuration — possible but not built. |
| In-app image generation | Out of scope for all versions. Stelavox is a writing tool; image generation is a different product category. |
| Footnotes, bibliographies, citations (V1) | Required for academic papers; deferred to V2 with the Academic Paper template. |
| Apple Sign-In (OAuth) | Requires a native application. The only native app in scope is the phone (V3), which is limited to mobile notes. Apple Sign-In is not implemented in any currently planned version. |

---

## 8. Locked Decisions

These decisions are closed and must not be re-litigated without a major version bump to this document.

| Decision | Choice | Reason |
|---|---|---|
| Database | Supabase (PostgreSQL) | Provides RLS, real-time subscriptions, managed auth, Vault, and Storage in one platform. Switching now would require rebuilding all of these layers. |
| Frontend framework | Next.js 15 | App Router model suits the server-component / streaming architecture. Deep integration with Vercel deployment. |
| Hosting | Vercel | Integrated with Next.js; edge functions; preview deployments per PR. |
| Auth provider | Supabase Auth | Integrated with RLS; JWT flows; supports all required OAuth providers. |
| Payment processor | Stripe | Absorbs PCI DSS; proven at scale; Customer Portal eliminates billing UI build. |
| Data isolation model | Row Level Security (Supabase) | All isolation enforced at the database level. Application bugs cannot leak cross-tenant data. |
| Collaboration model | Async + node locks | Real-time OT adds architectural complexity that is not justified by the use cases. Async is the deliberate model. |
| BYOK key storage | Supabase Vault | Keys never in plain text in any table. Double-encrypted. Accessible only from server-side Edge Functions. |
| LLM abstraction layer | Vercel AI SDK (two-tier) | Provider-agnostic from day one. Components and API routes must never call the LLM SDK directly. Anthropic Native Provider for platform + BYOK Anthropic (full optimisations); Vercel SDK Provider for all other BYOK providers. |
| Encryption model | Encryption at rest (AES-256, Supabase-managed) | Not E2EE. AI operations require server-side content access. Clearly communicated in the privacy policy. |
| Token budget model | Hard ceiling, no overage | Billing must be completely predictable. Users will never be charged more than their plan. |
| Subscription billing period | Subscription anniversary date (not calendar month) | Avoids simultaneous reset spikes; eliminates partial-month complexity. |
| Annual billing discount | 20% | Standard SaaS; attractive without being margin-destructive. |
| Refund policy | Monthly: no refund. Annual: pro-rata within 30 days. | Aligned with SaaS industry standard (Notion, Linear, comparable tools). |
| Free tier | None — 30-day trial only | 30 days is sufficient to evaluate the product. Permanent free tier creates subsidy and support burden without conversion. |
| Mobile notes model | Append-only JSONB array | Prevents sync conflicts between phone and desktop. Cannot be edited from the phone — only appended. |
| Backup restore | Not built | Per-node versioning covers recovery. Backup is portability only. |
| Phone interface scope (V3) | Mobile notes only | Phone is for thought capture, not editing. Prevents sync complexity. |
| Organisation auto-creation | Single transaction at signup | No user ever exists without an organisation. The billing and access model is clean from the first API call. |
| Director write tools | Write tools produce Workflow steps for approval; they never execute inside the agentic loop | The Director never modifies anything without explicit author approval. This is a core product principle, not a safety guard. |
| Director config | All Director parameters live in `director_configs` database record | Director behaviour can be updated by a database write; no code deployment required. The executor contains no Director-specific values. |
| Apple Sign-In | Not implemented in any planned version | Requires a native application. The phone scope (V3) is mobile notes only — insufficient to justify the Apple Developer programme requirements. |
| BYOK provider expansion | Anthropic and OpenAI at launch; additional providers targeted V4 | V4 follows tablet (V2) and phone (V3). Architecture supports additional providers via the VercelProvider; no code changes needed beyond wiring. |
| Phase 3a → Phase 5 dependency | Phase 3a (context-to-context linking) must be complete before Phase 5 (Director) begins | Director benefits from context-to-context linking. This is a confirmed hard dependency. |
| Prices (launch) | As specified in §3.1 | Prices are database-configurable; these are the locked launch values. Changes require a minor version bump to this document. |

---

## 9. Open Questions

All open questions from v1.1 have been resolved. There are currently no open questions. This section will be repopulated as new questions arise during subsequent phases.

| # | Question | Status | Resolution |
|---|---|---|---|
| OQ-2 | Apple Sign-In (OAuth) | Resolved — closed | Apple Sign-In requires a native application. As the only native app in scope is the phone (V3), and that scope is limited to mobile notes only, Apple Sign-In is not implemented at this time. It is a candidate for a future request but is currently out of scope for all planned versions. |
| OQ-3 | BYOK provider expansion (Google Gemini, Mistral) | Resolved — V4 target | Additional BYOK providers are targeted for V4, after tablet (V2) and phone (V3) are delivered. |
| OQ-4 | Phase 3a dependency on Phase 5 (Director) | Resolved — confirmed dependency | Phase 3a (context-to-context linking) must precede Phase 5 (Director). Phase 5 planning must not begin until Phase 3a is complete. |

---

## 10. Changelog

**v1.2 — 2026-05-01** Resolved all three open questions from v1.1. OQ-2 (Apple Sign-In): closed as out of scope for all planned versions — requires a native application; added to Out of Scope section (§7) and Locked Decisions (§8). OQ-3 (BYOK provider expansion): targeted V4, after tablet V2 and phone V3; added to Locked Decisions. OQ-4 (Phase 3a → Phase 5 dependency): confirmed as a hard dependency; added to Locked Decisions. Open Questions section (§9) now holds no active questions.

**v1.1 — 2026-05-01** Completed User Journey J5 (Director: Document-Level Review and Planned Revisions) with full step-by-step detail derived from Technical Architecture v1.0. J5 was a placeholder in v1.0 pending review of the Technical Architecture. Resolved OQ-1 (J5 placeholder). Updated Locked Decisions table with two Director-specific decisions (write tools produce Workflow steps; Director config is fully database-driven). Removed OQ-1 from Open Questions.

**v1.0 — 2026-05-01** Initial published version. Derived from `stelavox_product_specification_v0.9.md` and restructured to comply with the AI-Native Project Specification Standard v1.1. Added required sections: Vision and Target User (§1), Scope and Platform Strategy (§2), locked annual pricing and refund policy (§3), full Feature Inventory in tabular form with user stories and phase assignments (§4), Data Model Summary (§5), User Journeys J1–J4 (§6, J5 placeholder), Out of Scope (§7), Locked Decisions (§8), and Open Questions (§9).
