'use client'

/**
 * HeroDemo — the animated product preview in the landing hero.
 *
 * A looping three-act demo where the app frame stays FULL at all times (the
 * tree is always visible; act content cross-fades inside the right panel),
 * with a narrated lower line naming the current act. This deliberately
 * replaces the earlier full-screen "title cards" that left the frame empty
 * between acts — the centrepiece should never look like a void.
 *
 *   01 Structure — create a beat and write prose into it
 *   02 Ask       — ask the Director about pacing; it advises
 *   03 Direct    — direct a fix; approve; the prose updates
 *
 * Accessibility: one role="img" with a descriptive label; the churning inner
 * content is aria-hidden. Honours prefers-reduced-motion (static frame).
 *
 * Still a CSS mock of the real UI; swap for a real screen capture once the
 * live UI is camera-ready (spec D1·B).
 */

import { useEffect, useState } from 'react'

import styles from './landing.module.css'

const PROSE_A =
  'The rope bit her palms. Mara hauled once, twice — and far below the pier the great bell answered, tolling up through the black water. She had not rung it. No one had rung it in ninety years, and yet the sound climbed the harbour like a tide coming in.'
const Q_B = 'Does the harbour chapter drag before the reveal?'
const ADVICE_B =
  'A little — beats two and three repeat the same tension. Try cutting one and letting the bell arrive sooner; the reveal will land harder.'
const DIR_C = 'Tighten the opening line — keep the tide imagery.'
const PROSE_C =
  'The tide hung wrong that morning — too still, too low — as if the sea were holding its breath.'

const NARR = {
  create: { n: '01', t: 'Shaping a beat — and writing into it.' },
  advise: { n: '02', t: 'Asking the Director about pacing.' },
  fix: { n: '03', t: 'Directing a fix — you approve, it writes.' },
} as const

type Phase = 'create' | 'advise' | 'fix'

export function HeroDemo() {
  const [phase, setPhase] = useState<Phase>('create')
  const [proseA, setProseA] = useState('')
  const [qB, setQB] = useState('')
  const [thinkingB, setThinkingB] = useState(false)
  const [adviceB, setAdviceB] = useState('')
  const [dirC, setDirC] = useState('')
  const [planC, setPlanC] = useState(false)
  const [approvedC, setApprovedC] = useState(false)
  const [proseC, setProseC] = useState('')
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mq.matches) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setReduced(true)
      setPhase('create')
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
    const run = async () => {
      while (!cancelled) {
        // ACT 1 — create + write
        setProseA('')
        setPhase('create')
        await wait(520)
        if (cancelled) return
        await type(PROSE_A, setProseA, 26)
        await wait(2000)
        if (cancelled) return

        // ACT 2 — ask + advise
        setQB('')
        setAdviceB('')
        setThinkingB(false)
        setPhase('advise')
        await wait(520)
        if (cancelled) return
        await type(Q_B, setQB, 30)
        await wait(500)
        if (cancelled) return
        setThinkingB(true)
        await wait(1150)
        if (cancelled) return
        setThinkingB(false)
        await type(ADVICE_B, setAdviceB, 21)
        await wait(2400)
        if (cancelled) return

        // ACT 3 — direct + fix
        setDirC('')
        setPlanC(false)
        setApprovedC(false)
        setProseC('')
        setPhase('fix')
        await wait(520)
        if (cancelled) return
        await type(DIR_C, setDirC, 30)
        await wait(420)
        if (cancelled) return
        setPlanC(true)
        await wait(1150)
        if (cancelled) return
        setApprovedC(true)
        await wait(900)
        if (cancelled) return
        await type(PROSE_C, setProseC, 24)
        await wait(2400)
        if (cancelled) return
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const caret = () => (reduced ? null : <span className={styles.caret} />)
  const active = (p: Phase) => (phase === p ? styles.demoLayerActive : '')
  const narr = NARR[phase]

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

        {/* The frame body is ALWAYS full: tree on the left, act content cross-
            fading on the right. */}
        <div className={styles.vizBody} aria-hidden="true">
          <div className={styles.vizTree}>
            <div className={styles.vizCaption}>Live structure</div>
            <div className={styles.tnode}><span className={styles.tlab}>Book</span> The Tidewright Cycle</div>
            <div className={`${styles.tnode} ${styles.act}`}><span className={styles.tlab}>Act 1</span> Saltbound</div>
            <div className={`${styles.tnode} ${styles.ch}`}><span className={styles.tlab}>Ch 1</span> The Drowned Bell</div>
            <div
              className={`${styles.tnode} ${styles.sc} ${phase === 'create' ? '' : `${styles.tsel} ${styles.tnodeWriting}`}`}
            >
              <span className={styles.tlab}>Sc 2</span> At the harbour
            </div>
            <div
              className={`${styles.tnode} ${styles.sc} ${phase === 'create' ? `${styles.tsel} ${styles.tnodeWriting}` : ''}`}
              style={{ paddingLeft: 60 }}
            >
              <span className={styles.tlab}>Bt 3</span> The bell tolls
            </div>
            <div className={`${styles.tnode} ${styles.ch}`}><span className={styles.tlab}>Ch 2</span> Low Water</div>
          </div>

          <div className={styles.demoRight}>
            {/* ACT 1 — create + write */}
            <div className={`${styles.demoLayer} ${active('create')}`}>
              <div className={styles.proseHead}>Bt 3 · The bell tolls — new beat</div>
              <p className={styles.proseText}>
                {proseA}
                {proseA.length < PROSE_A.length && proseA.length > 0 && caret()}
              </p>
            </div>

            {/* ACT 2 — ask + advise */}
            <div className={`${styles.demoLayer} ${active('advise')}`}>
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

            {/* ACT 3 — direct + fix */}
            <div className={`${styles.demoLayer} ${active('fix')}`}>
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

      <figcaption className={styles.demoNarration} aria-hidden="true">
        <span className={styles.demoNarrationNum}>{narr.n}</span>
        <span className={styles.demoNarrationText}>{narr.t}</span>
      </figcaption>
    </figure>
  )
}
