# Variety Test — Editorial & Budget Summary

Three scene types run end-to-end (Chapter → Scene → Beats → Prose) on the same
in-progress novel, exercising the new cascading content-discipline architecture
across dramatically different scene shapes. Output artifacts:

- [ch2-action-the-wipe.json](ch2-action-the-wipe.json)
- [ch4-dialogue-first-contact.json](ch4-dialogue-first-contact.json)
- [ch5-ensemble-the-crew.json](ch5-ensemble-the-crew.json)

---

## Budget Compliance Snapshot

| Test | Scene | Beats | Target | Prose | Compliance | Cost   | Wall    |
|------|-------|------:|-------:|------:|-----------:|-------:|--------:|
| B1   | The Accusation (action, single-POV) | 5 | 2,750w | 2,796w | **101.7%** | $0.0471 | 77s\*  |
| B2   | The Encrypted Archive (two-hander)  | 6 | 1,800w | 2,031w | **112.8%** | $0.0459 | 155s   |
| B3   | The Bridge (4-character ensemble)   | 7 | 2,400w | 2,755w | **114.8%** | $0.0544 | 172s   |
| **Total** |                              | **18** | **6,950w** | **7,582w** | **109.1%** | **$0.1474** | **≈7 min** |

\* B1 inherited scenes + beats from a prior run; only synthesise executed. B2/B3 ran the full cascade.

**Verdict on compliance**: all three sit in the 100–115% band. Cascade is holding
end-to-end across scene types — no runaways, no collapse-to-summary. The Phase 5
benchmark (Iron Ghost, 4 beats) hit 99.9% on a clean run; we're now seeing the
same discipline survive across pickup tests with no model re-priming.

### Beat-level over/under

| Beat | Target | Actual | Δ% |
|------|------:|------:|---:|
| **B1** Phantom Wipe | 400 | 420 | +5.0% |
| **B1** Terrible Understanding | 350 | 350 | 0.0% |
| **B1** Distress Calls | 550 | 570 | +3.6% |
| **B1** Branded Terrorist | 650 | 592 | **−8.9%** |
| **B1** Vow Broken | 800 | 864 | +8.0% |
| **B2** Into the Booth | 280 | 354 | +26.4% |
| **B2** First Glimpse | 320 | 369 | +15.3% |
| **B2** Impossibility Deepens | 300 | 330 | +10.0% |
| **B2** The Crack | 280 | 317 | +13.2% |
| **B2** The Origin | 340 | 366 | +7.6% |
| **B2** Unspoken Ask | 280 | 295 | +5.4% |
| **B3** Arrival | 250 | 278 | +11.2% |
| **B3** The Briefing | 400 | 432 | +8.0% |
| **B3** Device Unveiled | 350 | 494 | **+41.1%** |
| **B3** Corporate Conspiracy | 400 | 430 | +7.5% |
| **B3** The Logistics | 300 | 340 | +13.3% |
| **B3** Synchronization | 350 | 395 | +12.9% |
| **B3** Kael's Choice | 350 | 386 | +10.3% |

- **B1 Branded Terrorist (-8.9%)** is the only meaningful undershoot. Notable: it's
  the only beat the model *compressed*. Useful signal that the budget anchor is
  a real ceiling-and-floor, not just decorative.
- **B3 Device Unveiled (+41.1%)** is the lone overshoot of concern. It's a
  reveal-beat with heavy expository payload (overlaying waveforms, the
  "something out there is talking back" reveal); the model treated it as the
  scene's centrepiece and over-extended.
- The B2 systematic +10–25% drift on a *small* 1,800w scene suggests budgets
  below ~2,000w may be tight for the synthesise profile's natural cadence. Not
  launch-blocking; worth flagging for the eventual prompt-tuning pass.

---

## Editorial Assessment (Scene-Type Generalisation)

### B1 — Action ("The Accusation")
Action scene done well *without* falling into disaster-porn. The model anchors
the wipe through Kael's interiority — phantom empathy, sensory cascade,
cognitive reassembly — rather than cutting to colony footage. Result reads like
literary SF rather than novelisation prose. Pace control is exemplary: short
paragraphs and one-line resets ("Then it wasn't light anymore." / "Thousands of
silences.") give the prose physical impact without losing register.

The terror→understanding→horror→branded→vow-broken arc lands cleanly across the
five beats. POV discipline holds throughout (Kael only).

**Concern**: terminal-fragment closes ("That was enough.", "His hands were
shaking again.") are appearing across beats. Tic risk if uncorrected at length.

### B2 — Dialogue ("The Encrypted Archive")
Dialogue scene is the most interesting case because the model *under-uses*
direct dialogue. Of six beats, only Bt5 ("The Origin") is dialogue-driven; the
other five are predominantly Mira-POV interior reflection grounded by physical
gestures (hands trembling, implant-flicker, finger-on-screen).

This is not necessarily wrong — it's a fair literary choice. But it suggests the
synthesise profile defaults to *internal* dialogue scenes rather than verbal
ones. If the user wants tight back-and-forth (Sorkin-style) the profile may
need a beat_function hint like `dialogue_exchange` or an explicit cue in the
beat summary.

POV anchored to Mira (chosen because she's the new character and we needed her
interiority). Two-character scene managed well: Kael is rendered through Mira's
observation rather than alternating POV.

**Strength**: The "alien architecture as code that has no translation key" passage
(Bt3) is genuinely good prose. Found a way to dramatise *failure to decrypt* as
a positive event rather than a stall.

### B3 — Ensemble ("The Bridge")
Hardest scene type and the model's most impressive performance. Four characters
in a confined space (the bridge), each with distinct purpose:

- Mira drives the tech reveal (Bt3)
- Juno drives the conspiracy reveal (Bt4)
- Rax drives the logistics (Bt5)
- Kael owns the leadership choice (Bt7)

The model anchored POV to Kael throughout and used *observed* action for the
others. This is the right call architecturally — four-headed POV would
have shattered the scene — but it does mean Mira/Juno/Rax come through as
*types* (the hacker, the analyst, the soldier) rather than fully-realised
characters. Their interiority is reported, not entered.

The "Synchronization" beat (Bt6) is the standout: it dramatises a *crew*
forming through micro-interactions ("Mira challenges Juno's interpretation",
"Juno catches Rax's miscalculation") rather than stating it. That's tradecraft.

**Concern**: The closing beat ("Are you with me?") is structurally on-the-nose
— the model leans into the heroic-question end rather than ending on the
quieter image of the trajectory line lit on the console. This is a synthesise
profile bias toward *declarative* beat closes when given a turning-point
function.

---

## Cross-Cutting Observations

1. **Budget discipline holds across genre.** Action, dialogue, and ensemble all
   land within 15% of target with one notable per-beat outlier (B3 Bt3). The
   cascading word_count_target architecture is genre-agnostic in practice, not
   just in theory.

2. **Cost is essentially fixed per word.** ≈$0.0000195/w across all three
   tests. 7,582 words for $0.1474 total. Predictable enough to quote.

3. **Beat-function metadata is being respected.** `inciting incident`, `reveal`,
   `escalate`, `turning point`, `release` map visibly onto prose pacing — the
   model isn't just reading the summary, it's using the structural cue. This is
   working.

4. **POV discipline is robust.** Every beat anchors to one POV character and
   stays there. The ensemble case (4 characters present) didn't break it.

5. **Voice cohesion across scenes.** A reader unaware these were generated
   would, I think, accept all three as written by the same author. Same
   register, same sentence-rhythm signature, same thematic anchors
   ("isolation does not protect anyone", the device-as-witness imagery).

---

## Recommendations (Queued, Not Launch-Blocking)

1. **Bump small-scene budget tolerance.** Below ~2,000w synthesise tends to
   run +10–15% over. Either tighten the profile's "PRIMARY TARGET" framing for
   small budgets, or accept the drift and tune downstream budgets to compensate.

2. **Add a `dialogue_exchange` beat-function hint.** Current `inciting incident`
   / `reveal` / etc. cues do not distinguish *spoken* from *internal* scenes.
   The profile defaults to internal interpretation.

3. **Watch for terminal-fragment tics.** Multiple beats end on punchy
   one-liners ("Are you with me?", "That was enough.", "His hands were shaking
   again.") — risks becoming a signature mannerism at novel length.

4. **B3 Bt3 +41% overshoot is the diagnostic case** for whether reveal-beats
   need their own budget calibration when the reveal payload is dense (multiple
   data layers being unveiled in one beat).
