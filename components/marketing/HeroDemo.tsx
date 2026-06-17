'use client'

/**
 * HeroDemo — the animated, cinematic product preview in the landing hero.
 *
 * A looping three-act sequence, each act framed by an interstitial title
 * card that names + sells the capability, with fade-through transitions:
 *
 *   01 · Structure first   → create a beat and write prose into it
 *   02 · Ask anything      → ask the Director about pacing; it advises
 *   03 · You direct        → direct a fix; approve; the prose updates
 *
 * Tells the whole product story in one frame so a cold visitor sees it's a
 * live demo, not an image to puzzle over. A "live preview" pill + caption
 * make that explicit.
 *
 * Accessibility: one role="img" with a descriptive label; the churning inner
 * content is aria-hidden. Honours prefers-reduced-motion — no timers / caret /
 * transitions; renders a representative static frame (prose in a new beat).
 *
 * Still a CSS mock of the real UI; swap for a real screen capture once the
 * live UI is camera-ready (spec D1·B).
 */

import { useEffect, useState } from 'react'

import styles from './landing.module.css'

const PROSE_A =
  'The rope bit her palms. Mara hauled once, twice — and far below the pier the great bell answered, tolling up through the black water.'
const Q_B = 'Does the harbour chapter drag before the reveal?'
const ADVICE_B =
  'A little — beats two and three repeat the same tension. Try cutting one and letting the bell arrive sooner; the reveal will land harder.'
const DIR_C = 'Tighten the opening line — keep the tide imagery.'
const PROSE_C =
  'The tide hung wrong that morning — too still, too low — as if the sea were holding its breath.'

const CARDS = {
  structure: { k: '01', t: 'Structure first', l: 'Build your book as a tree — then write straight into it.' },
  ask: { k: '02', t: 'Ask anything', l: 'Stuck on a scene? The Director is a thinking partner — never a ghostwriter.' },
  direct: { k: '03', t: 'You direct — it executes', l: 'Point it at a fix. Nothing changes until you approve.' },
} as const

type Stage = 'card' | 'create' | 'advice' | 'fix' | 'black'

export function HeroDemo() {
  const [stage, setStage] = useState<Stage>('card')
  const [card, setCard] = useState<{ k: string; t: string; l: string }>(CARDS.structure)
  const [reduced, setReduced] = useState(false)

  // scene 1 (create)
  const [beatAdded, setBeatAdded] = useState(false)
  const [proseA, setProseA] = useState('')
  // scene 2 (advice)
  const [qB, setQB] = useState('')
  const [thinkingB, setThinkingB] = useState(false)
  const [adviceB, setAdviceB] = useState('')
  // scene 3 (fix)
  const [dirC, setDirC] = useState('')
  const [planC, setPlanC] = useState(false)
  const [approvedC, setApprovedC] = useState(false)
  const [proseC, setProseC] = useState('')

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) {
      // Representative static frame: a new beat with prose in it.
      /* eslint-disable react-hooks/set-state-in-effect */
      setReduced(true)
      setStage('create')
      setBeatAdded(true)
      setProseA(PROSE_A)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    let cancelled = false
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const type = async (text: string, set: (s: string) => void, per: number) => {
      for (let i = 1; i <= text.length; i++) {
        if (cancelled) return
        set(text.slice(0, i))
        await wait(per)
      }
    }
    // Fade out to black, then bring the next stage up.
    const cut = async (next: Stage) => {
      setStage('black')
      await wait(360)
      if (cancelled) return false
      setStage(next)
      await wait(140)
      return !cancelled
    }

    const run = async () => {
      while (!cancelled) {
        // ACT 1 — create + write
        setCard(CARDS.structure)
        if (!(await cut('card'))) return
        await wait(2300)
        if (cancelled) return
        setBeatAdded(false)
        setProseA('')
        if (!(await cut('create'))) return
        await wait(750)
        if (cancelled) return
        setBeatAdded(true)
        await wait(1000)
        if (cancelled) return
        await type(PROSE_A, setProseA, 26)
        await wait(1900)
        if (cancelled) return

        // ACT 2 — ask + advice
        setCard(CARDS.ask)
        if (!(await cut('card'))) return
        await wait(2300)
        if (cancelled) return
        setQB('')
        setAdviceB('')
        setThinkingB(false)
        if (!(await cut('advice'))) return
        await type(Q_B, setQB, 30)
        await wait(550)
        if (cancelled) return
        setThinkingB(true)
        await wait(1200)
        if (cancelled) return
        setThinkingB(false)
        await type(ADVICE_B, setAdviceB, 21)
        await wait(2500)
        if (cancelled) return

        // ACT 3 — direct + fix
        setCard(CARDS.direct)
        if (!(await cut('card'))) return
        await wait(2300)
        if (cancelled) return
        setDirC('')
        setPlanC(false)
        setApprovedC(false)
        setProseC('')
        if (!(await cut('fix'))) return
        await type(DIR_C, setDirC, 30)
        await wait(450)
        if (cancelled) return
        setPlanC(true)
        await wait(1200)
        if (cancelled) return
        setApprovedC(true)
        await wait(950)
        if (cancelled) return
        await type(PROSE_C, setProseC, 24)
        await wait(2600)
        if (cancelled) return
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const caret = () => (reduced ? null : <span className={styles.caret} />)
  const on = (s: Stage) => (stage === s ? styles.stageLayerActive : '')

  return (
    <figure className={styles.demoFigure}>
      <div
        className={styles.viz}
        role="img"
        aria-label="An animated preview of Stelavox: a writer creates a beat and writes prose into it, asks the Director whether a chapter drags and gets pacing advice, then directs it to tighten a line and approves the change — staying in control throughout."
      >
        <div className={styles.vizBar} aria-hidden="true">
          <span className={styles.vizDot} style={{ background: '#e0564f' }} />
          <span className={styles.vizDot} style={{ background: '#e6b04a' }} />
          <span className={styles.vizDot} style={{ background: '#5aa87a' }} />
          <span className={styles.vizUrl}>stelavox.com / your manuscript</span>
          <span className={styles.livePill}>
            <span className={styles.liveDot} /> live preview
          </span>
        </div>

        <div className={styles.stage} aria-hidden="true">
          {/* interstitial framing card */}
          <div className={`${styles.stageLayer} ${styles.cardLayer} ${on('card')}`}>
            <span className={styles.cardKicker}>{card.k}</span>
            <span className={styles.cardTitle}>{card.t}</span>
            <span className={styles.cardLine}>{card.l}</span>
          </div>

          {/* ACT 1 — create + write */}
          <div className={`${styles.stageLayer} ${on('create')}`}>
            <div className={styles.sceneGrid}>
              <div className={styles.sceneTree}>
                <div className={styles.vizCaption}>Live structure</div>
                <div className={styles.tnode}><span className={styles.tlab}>Book</span> The Tidewright Cycle</div>
                <div className={`${styles.tnode} ${styles.act}`}><span className={styles.tlab}>Act 1</span> Saltbound</div>
                <div className={`${styles.tnode} ${styles.ch}`}><span className={styles.tlab}>Ch 1</span> The Drowned Bell</div>
                <div className={`${styles.tnode} ${styles.sc} ${beatAdded ? '' : styles.tsel}`}>
                  <span className={styles.tlab}>Sc 2</span> At the harbour
                </div>
                {beatAdded && (
                  <div className={`${styles.tnode} ${styles.bt} ${styles.tsel} ${styles.tnodeWriting} ${styles.beatNew}`}>
                    <span className={styles.tlab}>Bt 3</span> The bell tolls
                  </div>
                )}
                <div className={`${styles.tnode} ${styles.ch}`}><span className={styles.tlab}>Ch 2</span> Low Water</div>
              </div>
              <div className={styles.scenePanel}>
                {beatAdded ? (
                  <>
                    <div className={styles.proseHead}>Bt 3 · The bell tolls — new beat</div>
                    <p className={styles.proseText}>
                      {proseA}
                      {proseA.length < PROSE_A.length && proseA.length > 0 && caret()}
                    </p>
                  </>
                ) : (
                  <div className={styles.proseHead}>+ New beat…</div>
                )}
              </div>
            </div>
          </div>

          {/* ACT 2 — ask + advice */}
          <div className={`${styles.stageLayer} ${on('advice')}`}>
            <div className={styles.convo}>
              <div className={styles.dirmark}>◆ Director</div>
              <div className={styles.userWho}>You</div>
              <div className={styles.userBubble}>
                {qB}
                {qB.length < Q_B.length && !thinkingB && !adviceB && caret()}
              </div>
              {thinkingB && <div className={styles.thinking}>•••</div>}
              {adviceB && (
                <div className={styles.dirBubble}>
                  {adviceB}
                  {adviceB.length < ADVICE_B.length && caret()}
                </div>
              )}
            </div>
          </div>

          {/* ACT 3 — direct + fix */}
          <div className={`${styles.stageLayer} ${on('fix')}`}>
            <div className={styles.convo}>
              <div className={styles.dirmark}>◆ Director</div>
              <div className={styles.userWho}>You</div>
              <div className={styles.userBubble}>
                {dirC}
                {dirC.length < DIR_C.length && !planC && caret()}
              </div>
              {planC && (
                <div className={styles.planCard}>
                  <span>▸ Plan · 1 step · revise opening of &ldquo;At the harbour&rdquo;</span>
                  <span className={approvedC ? styles.approveDone : styles.approveBtn}>
                    {approvedC ? '✓ Approved' : 'Approve'}
                  </span>
                </div>
              )}
              {proseC && (
                <div className={styles.proseResult}>
                  <div className={styles.proseHead}>Updated · At the harbour</div>
                  <p className={styles.proseText}>
                    {proseC}
                    {proseC.length < PROSE_C.length && caret()}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <figcaption className={styles.demoCaption}>
        Structure, a thinking-partner Director, and edits you approve — all in one workspace.
      </figcaption>
    </figure>
  )
}
