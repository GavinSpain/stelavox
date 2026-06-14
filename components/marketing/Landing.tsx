/**
 * Landing — the public landing page (Phase 13.1).
 *
 * Confident-dark tone (D4 · B), screenshot-framed product hero (D1 · B).
 * Conversion model (research-backed, 2026-06-14): outcome-led emotional
 * headline · authentic founding-cohort scarcity (real cap, unstated; closes
 * at launch) · a genuine reward (50% off annual, locked for life while
 * subscribed) · a definitive ownership/no-lock-in band · a fuller, more
 * direct FAQ. See docs/stelavox_landing_page_spec_v1_0.md §3/§7.
 *
 * Server component; the CTA is mode-driven (marketing.signup_mode):
 *   waitlist → founding-access capture · open → "Get started" → /signup.
 *
 * Cinzel / Cormorant appear only via <Wordmark> (Inviolables #3/#6). The
 * marketing surface is not bound by the app's verdigris-12-use rule.
 */

import Link from 'next/link'

import { Wordmark } from '@/components/brand/Wordmark'

import { HeroDemo } from './HeroDemo'
import styles from './landing.module.css'
import { WaitlistForm } from './WaitlistForm'

export function Landing({ mode }: { mode: 'waitlist' | 'open' }) {
  const waitlist = mode === 'waitlist'

  return (
    <div className={styles.page}>
      {/* ---- nav ---- */}
      <nav className={styles.nav}>
        <Wordmark size="compact" as="a" href="/" ariaLabel="Stelavox home" />
        <div className={styles.navRight}>
          <a className={styles.navLink} href="#how">How it works</a>
          <a className={styles.navLink} href="#founding">{waitlist ? 'Founding offer' : 'Pricing'}</a>
          <Link className={styles.navLink} href="/login">Sign in</Link>
          {waitlist ? (
            <a className={styles.btnPrimary} href="#join">Claim founding access</a>
          ) : (
            <Link className={styles.btnPrimary} href="/signup">Get started</Link>
          )}
        </div>
      </nav>

      {/* ---- hero ---- */}
      <header className={styles.hero} id="join">
        <div className={styles.heroBrand}>
          <Wordmark size="marketing" />
        </div>
        <p className={styles.eyebrow}>
          {waitlist ? 'Founding access · opening soon' : 'A writing workspace, not a ghostwriter'}
        </p>
        <h1 className={styles.title}>
          Write the book you&rsquo;ve been carrying
          <br />
          — without losing the thread.
        </h1>
        <p className={styles.sub}>
          Stelavox is a structured writing workspace: plan your story as a living tree, write at
          any layer, and call on a Director that only ever helps where you point it. The work is
          yours — every word.
        </p>

        {waitlist ? (
          <>
            <WaitlistForm />
            <p className={styles.foundingNote}>
              Join the list and you&rsquo;re first in line for <strong>founding membership: 50% off
              annual, locked in for life</strong>. A limited first cohort — it closes the day we open.
            </p>
          </>
        ) : (
          <div className={styles.ctaRow}>
            <Link className={styles.btnPrimary} href="/signup">Get started — free trial</Link>
            <Link className={styles.btnGhost} href="/login">Sign in</Link>
          </div>
        )}

        {/*
          Hero product visual (D1 · B). An animated, looping micro-demo
          (ask → approve → prose lands) that signals "this is the product",
          honours prefers-reduced-motion, and carries a caption. Still a CSS
          mock; swap for a real screen capture once the UI is camera-ready.
        */}
        <HeroDemo />
      </header>

      {/* ---- the turn (pain → promise) ---- */}
      <section className={styles.section}>
        <div className={styles.turn}>
          <h2>If you think in structure, a blank page works against you.</h2>
          <p>
            And most AI tools go further — they write the book <em>for</em> you. Stelavox is built
            the other way around: a workspace shaped like your outline, where you hold the pen and
            the AI works only where you point it.
          </p>
        </div>
      </section>

      {/* ---- value props ---- */}
      <section className={styles.section}>
        <div className={styles.wrap}>
          <div className={styles.props}>
            <div className={styles.prop}>
              <div className={styles.propIco}>⌗</div>
              <h3>Structure-first writing</h3>
              <p>
                Think in acts, chapters, beats? Your outline is a living tree you write straight
                into — at any layer, in any order. Rearrange freely; the structure holds.
              </p>
            </div>
            <div className={styles.prop}>
              <div className={styles.propIco}>◆</div>
              <h3>A Director, not an author</h3>
              <p>
                It proposes, you approve, and only then does it act. The Director never writes a
                word you didn&rsquo;t ask for — and you can write every word yourself.
              </p>
            </div>
            <div className={styles.prop}>
              <div className={styles.propIco}>🔒</div>
              <h3>Private by default</h3>
              <p>
                Encrypted at rest and private to your account. We never train AI on your writing.
                Export the whole manuscript any time, in standard formats.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- ownership manifesto (definitive) ---- */}
      <section className={styles.section}>
        <div className={styles.ownership}>
          <h2 className={styles.ownershipHeading}>Your book is yours. Full stop.</h2>
          <p className={styles.ownershipBody}>
            Every word you write — and everything the Director helps you shape — is{' '}
            <strong>yours</strong>. We claim no rights to your work and we never use it to train AI.
            Take the complete manuscript and leave whenever you like, in standard formats. No
            lock-in. No hostage-taking. No questions.
          </p>
          <div className={styles.ownershipPoints}>
            <span className={styles.ownershipPoint}>You own every word</span>
            <span className={styles.ownershipPoint}>We never train on your writing</span>
            <span className={styles.ownershipPoint}>Export everything, any time — no lock-in</span>
          </div>
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section className={styles.section} id="how">
        <div className={styles.wrap}>
          <h2 className={styles.sectionHeading}>How it works</h2>
          <div className={styles.howrow}>
            <div className={styles.howstep}>
              <div className={styles.hownum}>1</div>
              <h4>Build your structure</h4>
              <p>Lay out Book → Act → Chapter → Scene → Beat. Or grow it as you go.</p>
            </div>
            <div className={styles.howstep}>
              <div className={styles.hownum}>2</div>
              <h4>Write, or ask</h4>
              <p>Write at any layer yourself, or point the Director at a node.</p>
            </div>
            <div className={styles.howstep}>
              <div className={styles.hownum}>3</div>
              <h4>Approve the plan</h4>
              <p>The Director proposes; you approve before a word is written.</p>
            </div>
            <div className={styles.howstep}>
              <div className={styles.hownum}>4</div>
              <h4>Export</h4>
              <p>Your manuscript, per book — DOCX, EPUB, or Markdown.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- founding membership (waitlist) / pricing (open) ---- */}
      <section className={styles.section} id="founding">
        <div className={styles.wrap}>
          {waitlist ? (
            <div className={styles.foundingBand}>
              <p className={styles.foundingKicker}>Founding membership · limited · closes at launch</p>
              <h2 className={styles.foundingHeading}>Join now, and lock in 50% off — for life.</h2>
              <p className={styles.foundingBody}>
                Everyone who joins the list before we open is first in line for founding membership:{' '}
                <strong>50% off annual membership, for as long as you stay subscribed</strong>. The
                founding cohort is deliberately limited — a first group small enough for us to look
                after properly — and it closes the day we launch. Only writers on the list get the
                offer, and you&rsquo;ll get it before we open to everyone.
              </p>
              <a className={styles.btnPrimary} href="#join">Claim founding access</a>
            </div>
          ) : (
            <p className={styles.pricingTeaser}>
              A free trial, then simple plans from Writer to Pro.{' '}
              <Link href="/signup">Get started →</Link>
            </p>
          )}
        </div>
      </section>

      {/* ---- faq ---- */}
      <section className={styles.section}>
        <div className={styles.faq}>
          <h2 className={styles.sectionHeading}>Questions</h2>
          <FaqItem
            q="Do I own what I write?"
            a="Completely. Every word is yours — including anything the Director helps you draft. We claim no rights to your work and we never use it to train AI."
          />
          <FaqItem
            q="Does the AI write the book for me?"
            a="No. The Director only acts where you point it, and only after you approve its plan. You can also write every word yourself — it's a workspace first, an assistant second."
          />
          <FaqItem
            q="Will my writing be used to train AI models?"
            a="Never. Your manuscripts are private to your account and are not used for training, by us or anyone else."
          />
          <FaqItem
            q="Can I export my work and leave?"
            a="Any time. The complete manuscript, in standard formats (DOCX, EPUB, Markdown). No lock-in, no questions."
          />
          <FaqItem
            q="Do I have to outline everything before I start?"
            a="No. The tree supports structured thinking, but you can write at any layer, in any order, and grow the structure as you go."
          />
          <FaqItem
            q="How do the plans work — and what's “bring your own key”?"
            a="Two ways, whichever suits you. A platform plan (Writer, Author, or Pro) is the simplest: one subscription that includes your AI assistance — nothing to set up, the Director just works. Or bring your own key (BYOK): connect your own AI provider account, pay for AI usage at cost, and Stelavox charges only a low flat platform fee. Heavy writers often prefer BYOK; most people are happiest on a platform plan. Either way there's a free trial first, and you can switch between them any time."
          />
          <FaqItem
            q="What happens if I run out of AI usage?"
            a="You keep writing — always. On a platform plan, if a month's AI assistance runs out, only the Director and agents pause until your next cycle (or you upgrade, or switch to BYOK). Your manuscript is never locked, and you can write every word yourself whenever you like."
          />
          {waitlist ? (
            <>
              <FaqItem
                q="What is founding membership?"
                a="Writers who join the list before we open are first in line for founding membership: 50% off annual membership, locked in for as long as you stay subscribed. The cohort is limited and closes the day we launch."
              />
              <FaqItem
                q="When does it open?"
                a="Soon. Join the list and you'll be among the first in — and we'll send your founding offer before we open to everyone."
              />
            </>
          ) : (
            <FaqItem
              q="What does it cost?"
              a="A free trial to start, then a simple platform plan (Writer, Author, or Pro) with AI included — or bring your own key and pay a low flat platform fee. Whichever fits how much you write."
            />
          )}
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className={styles.footer}>
        <Wordmark size="compact" />
        <div className={styles.footLinks}>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:hello@stelavox.com">hello@stelavox.com</a>
        </div>
        <span>© 2026 Stelavox</span>
      </footer>
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className={styles.faqItem}>
      <p className={styles.faqQ}>{q}</p>
      <p className={styles.faqA}>{a}</p>
    </div>
  )
}
