# Stelavox — Public Landing Page Specification v1.0

> **Phase 13.1 — Landing Page** (pulled forward as a pre-launch activity from the Phase 13 "public website" plan). This is the *single* public landing page + required legal stubs. Pricing page, blog, about, and the full signup funnel remain later Phase 13 sub-phases. Process: **this spec → wireframe (`wireframe_landing_page_v1.html`) → build**, per the wireframe-first rule.

## 1. Purpose & audience

**Audience — two complementary profiles** (the page must speak to both):

1. **The structured thinker (the architect / plotter).** A writer who thinks in *structure* — acts, chapters, scenes, beats — not a single linear scroll. They plan, they outline, they hold a whole book in a hierarchy in their head. Conventional tools give them a blank sequential page that fights how they actually work. **The node tree is the primary draw for this person** — a living outline they can build, rearrange, and write into at any layer.
2. **The authorship-preserving writer.** A writer who wants AI *assistance* without surrendering authorship — frustrated that mainstream AI tools "write the book for you." **The Director-not-an-author model is the primary draw for this person** — AI that works only where they point it, on a plan they approve.

These overlap heavily — the structured writer who also wants AI strictly on their terms is the core user — and the locked tagline already spans both: *structure stays in your hands* (profile 1) *and AI helps where you ask it to* (profile 2). The page leads with **structure** as the distinctive hook and pairs it with **controlled AI** as the trust pillar; neither is a footnote.

**The one conversion action.** Move that visitor to a single click:
- **Pre-launch (waitlist mode):** capture their email — "Join the waitlist."
- **At launch (open mode):** "Get started" → `/signup` → free trial.

Everything on the page serves that one action. The page is a conversion tool, not a brochure.

## 2. Scope (LOCKED 2026-06-14)

- **In:** one scrolling landing page at `/`; Privacy Policy + Terms stubs (required for signup + Stripe); the phased CTA mechanism.
- **Out (later Phase 13 sub-phases):** dedicated `/pricing` page, blog, about page, full signup-funnel polish, post-signup onboarding hand-off.

## 3. The phased CTA (decision: "both / phased")

A single platform_config key controls the call-to-action so you can launch on a waitlist and flip to open sign-up with no rebuild/deploy:

- **`marketing.signup_mode`** = `'waitlist'` | `'open'` (default `'waitlist'`).
- **Waitlist mode:** the hero CTA is an email field + "Join the waitlist" → `POST /api/waitlist` → inserts into a new **`waitlist_signups`** table `(id, email, source, created_at)`; public + rate-limited; dedupes on email; success → "You're on the list." No auth.
- **Open mode:** the hero CTA is a "Get started" button → `/signup` (existing). A secondary "Sign in" link → `/login` is present in both modes.
- The landing page (server component) reads the mode via `getConfig('marketing.signup_mode')` and renders the matching CTA. Flip the mode with a single config UPDATE (or the admin payments-style editor) — consistent with the platform_config-driven design.
- **Email handling note:** V1 just *collects* addresses. Confirmation emails / launch announcements are a manual export initially (a later sub-phase can wire automated email). Privacy Policy must mention the waitlist email use.

### 3.1 Conversion model — founding cohort (LOCKED 2026-06-14, v1.2)

Research (waitlist conversion 2025–26) is consistent: plain "coming soon" pages convert ~2–5%; pages built on **authentic** scarcity + exclusivity + a genuine first-mover reward convert 20–40%+. The single hard rule: scarcity must be **real** — fake caps / resetting timers / perpetual "limited" permanently destroy trust. So every scarcity claim on the page is one we will honour.

The page therefore runs a **founding-cohort** model (not a generic waitlist):

- **The reward (real, permanent):** founding members get **50% off annual membership, for as long as they stay continuously subscribed.** This is the "lock in the lowest rate forever" driver — genuine value, honoured indefinitely.
- **The scarcity (real, unstated number):** the founding cohort is **limited** — internally capped at ~1000 (the first-cohort capacity the platform can support well), but the number is **not stated publicly** (a soft "a limited first cohort"). No live counter (a tiny early number would *hurt* social proof).
- **The deadline (real):** founding membership **closes at launch** ("coming soon"). After launch the offer is gone.
- **The mechanism:** the email list **is** the founding queue. Only writers on the list get the founding offer, and they get it **before** public launch.
- **CTA microcopy:** "Claim founding access" / "Claim your founding spot" (beats "Join the waitlist"). Single email field. Success → "You're in. We'll send your founding offer before we open."
- **Hero leads with the outcome, not the feature** — an emotional dream-state headline ("Write the book you've been carrying — without losing the thread"), with the structure + control promise in the subhead. Sell the result; the product visual + value props carry the *how*.
- **Definitive ownership** is itself a conversion driver for the AI-wary writer — stated flatly in a dedicated band (§4.5a) and the FAQ: you own every word, we never train on your work, export everything any time, **no lock-in, no questions.**

When `marketing.signup_mode` flips to `'open'` at launch, the founding bands disappear and the CTA becomes "Get started" → `/signup` (the offer has closed).

## 4. Page structure (section by section)

A vertical scroll. Draft copy below is a starting point to refine in the wireframe.

1. **Header (sticky, minimal):** Wordmark left; "Sign in" link + the primary CTA right. No app nav.
2. **Hero:**
   - Headline = the locked tagline: *"A hierarchical writing workspace where structure stays in your hands and AI helps where you ask it to."*
   - Subhead (draft): "Build your story as a tree — Book to Beat — and write at any layer. Call on a Director that assists where you point it, and never takes over." (Speaks to both profiles: the structure in the first sentence, the controlled AI in the second.)
   - Primary CTA (phased, per §3).
   - Visual: a clean rendering of the Book→Act→Chapter→Scene→Beat tree + a Director prompt (screenshot or illustration; finalize in wireframe).
3. **The turn (problem → promise):** name *both* frustrations, then the promise. Draft: "If you think in structure — acts, chapters, beats — a blank linear page works against you. And most AI tools go further and write the book *for* you. Stelavox is built the other way around: a workspace shaped like your outline, where you hold the pen and the AI works only where you point it." (First sentence = the structured-thinker's pain; second = the authorship pain; third = the promise to both.)
4. **Value props (3, locked):**
   - **Structure-first writing** — for writers who think in hierarchy, not a linear scroll. Your outline is a living tree (Book → Beat); every layer is a place to think, plan, and write. Rearrange freely; the structure holds.
   - **A Director, not an author** — propose, approve, and the AI executes against *your* plan; nothing is written without your say-so.
   - **Your work, yours alone** — encrypted at rest, private to your account, export anytime in standard formats. No lock-in.
5. **How it works (3–4 steps):** (1) Build your structure. (2) Write where you want, or ask the Director. (3) Approve its plan. (4) Export your manuscript (DOCX / EPUB / Markdown).
6. **Pricing teaser:** one line — "A free trial, then simple plans from Writer to Pro, plus bring-your-own-key." Links to full pricing later; for V1, a compact tier strip or a single reassuring line.
7. **FAQ (objection-handling):** Is my writing private? · Does the AI write for me? · **Do I have to outline everything before I start?** (no — the tree supports structured thinking but you can write at any layer, in any order, and grow the structure as you go) · Can I export and leave? · What does it cost? · (waitlist mode) When does it open?
8. **Footer:** Wordmark; links to Privacy, Terms, contact email; copyright. Secondary CTA repeat.

## 5. Technical approach

- **Location:** a new public route group **`app/(marketing)/`** with its own minimal layout (marketing header + footer; no AppShell), mirroring the `(admin)` shell pattern. The landing page is `app/(marketing)/page.tsx` at `/`.
- **Root routing:** `/` serves the landing page to logged-out visitors; logged-in users are redirected to `/dashboard`. (Confirm current `/` behaviour during build and adjust.)
- **Rendering:** statically generated where possible (instant load, SEO). The CTA mode is read server-side; if that forces dynamic, keep the shell static and the CTA a small client island.
- **SEO / sharing:** Next `metadata` export — title, description, canonical, and Open Graph + Twitter card tags (so a shared link shows a proper preview). A simple OG image.
- **Brand:** reuse the existing wordmark component, design tokens, typography. The marketing surface may use the brand more expressively than the app, but consistently (same verdigris, same type). *Note:* the Inviolables (verdigris-12-uses, prose-surface, typeface boundary) govern the **app UI**; the marketing page is a separate surface and isn't bound by the 12-use enumeration, but should stay visually consistent with the brand. Cinzel/Cormorant (the wordmark) are welcome here.
- **Legal stubs:** `app/(marketing)/privacy/page.tsx` + `terms/page.tsx` — real, reviewable copy (placeholder content flagged for legal review; Privacy must cover account data, the waitlist email, and Stripe).
- **Analytics:** decision for build — Vercel Analytics (simplest, privacy-friendly) vs none for V1. Recommend Vercel Analytics.
- **Performance/accessibility:** Lighthouse-clean; semantic headings; keyboard-navigable; respects prefers-reduced-motion.

## 6. New substrate (small)

- Migration: **`waitlist_signups`** table (id, email CITEXT UNIQUE, source TEXT, created_at) + RLS (no public read; insert via SECURITY DEFINER RPC or a service-role endpoint with rate limiting).
- Config key: **`marketing.signup_mode`** (default `'waitlist'`).
- Route: **`POST /api/waitlist`** (public, rate-limited, dedupe, validation).
- Everything else is presentational.

## 7. Decisions — RESOLVED 2026-06-14

**Resolved:** D1 = **B** (real-screenshot hero; built as a swappable screenshot-framed product mock until the live UI is camera-ready) · D2 = **teaser line** · D3 = **Vercel Analytics** (installed, mounted on the marketing surface) · D4 = **B** (confident-dark) · **Founding model** = 50% off annual for life (while continuously subscribed), limited cohort (unstated ~1000 cap), closes at launch, queue = founding list (see §3.1).

Original directions (for provenance):

- **D1 — Hero visual: SHOW BOTH in the wireframe.** Produce two hero variants — (a) a real app screenshot of the tree+Director, and (b) a clean illustration of the same — so the choice can be made by eye. Lean remains a polished screenshot once the UI is settled, but we decide after seeing both.
- **D2 — Pricing: teaser line.** A single reassuring line ("a free trial, then simple plans … plus bring-your-own-key") linking to a future `/pricing`. Full pricing page is a later sub-phase.
- **D3 — Analytics: Vercel Analytics.** Privacy-friendly, zero-config.
- **D4 — Visual tone: a FEW options, restrained-with-appeal.** The author likes restrained/literary (it's the differentiator) but it must have real marketing pull — *not too restrained*, and consistent with the brand theme. The wireframe will present a few tone treatments along that spectrum (e.g. quiet-literary → confident-literary → warmer-marketing) all within the brand system, to pick from.

## 8. What you (the author) own vs what I build

- **You:** register + own the domain; do the DNS → Vercel pointing (I'll give exact steps); final sign-off on copy + legal review of Privacy/Terms.
- **Me:** this spec, the wireframe, the route group + page + legal stubs + waitlist substrate, SEO/meta, and preview verification.

## 9. Process & next steps

1. **Spec** (this doc) — review + refine.
2. **Wireframe** — `wireframe_landing_page_v1.html`: full scroll, both CTA modes, with the draft copy in place, for sign-off.
3. **Build** — marketing route group + page + legal stubs + `waitlist_signups` + `/api/waitlist` + `marketing.signup_mode`; verify in preview; (you) wire the domain.

---
**Changelog**
**v1.4 — 2026-06-14** **Hero demo → three-act cinematic sequence.** Extended the single-loop demo into a looping three-act story, each act introduced by an interstitial framing title card (kicker + Lora title + selling line) with fade-through-black cuts: **01 · Structure first** — create a beat and write prose into it (the beat animates into the tree); **02 · Ask anything** — ask the Director if a chapter drags, it returns pacing *advice* (thinking-partner, not ghostwriter); **03 · You direct — it executes** — direct a one-line fix, approve, the prose updates. Act 2/3 "cut to" a Director close-up (no tree) for shot variety. Honours prefers-reduced-motion (static frame). Verified: type-check + lint clean, no console errors, all four layers + both Director scaffolds mount, engine advances act→act (full ~30s loop runs at real speed in a visible tab; the headless preview throttles the per-char timer).
**v1.3 — 2026-06-14** **Animated hero demo + plan-types FAQ.** (1) The static hero mock was ambiguous ("is this a screenshot I'm meant to read?"). Replaced with `HeroDemo` — a looping ~12s micro-demo that tells the whole story in one frame: a writer types a request to the Director (typewriter) → the Director proposes a one-step plan → the writer approves → the new prose lands in the beat (typewriter, in the prose typeface). A "live preview" pill + a one-line caption make it unmistakably a product demo. Honours `prefers-reduced-motion` (no timers/caret/transitions; static end-state) and is a single `role="img"` with a descriptive label (inner churn aria-hidden). Still a CSS mock — swap for a real screen capture once the UI is camera-ready. (2) FAQ expanded to explain the two plan models for a cold reader — platform plans (AI included) vs BYOK (own key, pay usage at cost + low flat platform fee), the free-trial-either-way + switch-any-time, and the writing-never-blocked guarantee ("What happens if I run out of AI usage?").
**v1.2 — 2026-06-14** **Conversion revision — founding-cohort model (research-backed).** After a cold-read critique found the page clear but head-over-heart with no driver to act *now*, researched waitlist conversion best practice (scarcity/exclusivity/FOMO work, but only when authentic; outcome-led emotional headlines beat feature headlines; "Reserve/Claim" CTA beats "Join the waitlist"; social-proof counters only help once flattering). New §3.1 locks the **founding-cohort** model: **50% off annual for life** (while continuously subscribed) · **limited cohort, unstated ~1000 cap** · **closes at launch** · email list = founding queue · offer delivered before public launch. Page rebuilt: outcome headline ("Write the book you've been carrying — without losing the thread"), `Founding access · opening soon` eyebrow, "Claim founding access" CTA + 50%-for-life founding note at the form, a dedicated **founding-membership band**, a definitive **"Your book is yours. Full stop."** ownership manifesto band (you own every word · we never train on your writing · export everything, no lock-in — *no questions*), sharpened value props, and an expanded, more direct FAQ (ownership / no-training / export-and-leave / founding terms / **how the plans work — platform plans vs BYOK, explained for a cold reader** / **what happens if you run out of AI usage** — the writing-never-blocked guarantee). D1–D4 resolved (see §7). Live build is the canonical copy record; the static wireframe predates this revision.
**v1.1 — 2026-06-14** Audience expanded to **two complementary profiles** — the *structured thinker* (the node tree is the draw; for writers who think in hierarchy, not a linear scroll) alongside the *authorship-preserving* writer (the Director-not-author model is the draw). Threaded through §1, the hero subhead, the problem→promise turn, the Structure-first value prop, and a new "do I have to outline everything first?" FAQ. Open-decision directions set: D1 show **both** hero variants in the wireframe; D2 teaser line; D3 Vercel Analytics; D4 present **a few** tone treatments (restrained-with-marketing-appeal, within the brand system).
**v1.0 — 2026-06-14** Initial spec. Phase 13.1 landing page pulled forward as a pre-launch activity. Locked: phased CTA (waitlist → open via `marketing.signup_mode`); single-page scope + legal stubs. Open: hero visual, pricing presentation, analytics, visual tone (resolve in wireframe).
