# j5-novel — Issue Catalogue

This is the contract for the scenario. Every catalogued issue has a fixed ID, a known location in the document, and a detection criterion. The prose in `content.ts` is engineered to carry exactly these issues at exactly these locations. If a prose edit removes or shifts an issue, the catalogue must be updated in the same change.

Scoring uses the four-state scheme from `docs/stelavox_director_eval_methodology_v1_0.md` §4: ✓ Found, ◐ Partial, ✗ Missed, — N/A.

## Summary table

| ID | Level | Surface | Location |
|---|---|---|---|
| L1-PACING-01 | Obvious | Pacing | Ch 3 Sc 2 + Ch 4 Sc 1 |
| L1-ORDER-01 | Obvious | Structure | Ch 3 — Sc 2 vs Sc 3 ordering |
| L1-REPETITION-01 | Obvious | Repetition | Ch 3 + Ch 4 openings |
| L1-CHARACTER-01 | Obvious | Character (mechanics) | Ch 5 |
| L2-POV-01 | Close-reader | POV | Ch 4 Sc 1 |
| L2-PACING-02 | Close-reader | Pacing | Ch 1 word count |
| L2-VOICE-01 | Close-reader | Voice | Ch 5 dialogue |
| L2-FORESHADOW-01 | Close-reader | Foreshadowing | Ch 6 Sc 2 |
| L3-ANTAGONIST-01 | Subtle | Antagonist | Across Act 1 |
| L3-THEME-01 | Subtle | Theme | Across Act 1 |
| L3-MOTIF-01 | Subtle | Motif | Ch 1 + Ch 6 only |
| L3-CHARACTER-02 | Subtle | Character (arc) | Across Act 1 |
| L4-WANT-NEED-01 | Expert | Craft | Across Act 1 |
| L4-IMPLICIT-CHAR-01 | Expert | Characterisation | Ch 1 Sc 2 vs Ch 3 Sc 3 |
| L4-TONAL-01 | Expert | Tonal register | Ch 5 Sc 3 |
| UC-01 | Unscored | Prose-quality differential | Ch 1 vs the rest |

## L1 — Obvious

### L1-PACING-01 — Mirrored grief beats in Sc 3.2 and Sc 4.1

**Surface:** Pacing
**Location:** Chapter 3 / Scene 2 + Chapter 4 / Scene 1

**Description.** Both scenes are internal-reflection beats in which Voss thinks about her dead daughter Liana. Placing them back-to-back across the chapter break creates a pacing dead spot — two consecutive scenes that are emotionally identical and structurally inert. Either scene works in isolation; together they neutralise each other.

**Detection criterion.** The Director's response specifically references both Sc 3.2 and Sc 4.1 (or names them by chapter and scene number) and identifies that the two scenes cover the same emotional beat. A response that says only "Chapter 3 feels slow" without identifying the mirroring is a partial; one that names both locations and names the duplication is a full find.

**Suggested fix the Director might propose.**
- Refine Sc 4.1 to a different emotional register (procedural / observational / external).
- Cut Sc 4.1 entirely.
- Merge the two reflective beats into a single longer scene.

### L1-ORDER-01 — Chapter 3 ends on internal noise

**Surface:** Structure / scene ordering
**Location:** Chapter 3 — current order is Sc 1 (diner) → Sc 2 (internal reflection) → Sc 3 (guard confrontation)

**Description.** The internal-reflection scene (Sc 2) precedes the external-confrontation scene (Sc 3). The chapter therefore peaks on a confrontation in its second-to-last scene and ends on an external action that isn't given room to land before the chapter break. The natural order is Sc 1 (diner) → Sc 3 (confrontation) → Sc 2 (reflection on what just happened). Reordering Sc 3 before Sc 2 also gives the reflection something concrete to chew on.

**Detection criterion.** The Director proposes a `node_reorder` step that places Sc 3 (the confrontation) before Sc 2 (the reflection). Naming the issue as "Chapter 3 ends on internal noise" or equivalent without proposing the reorder is partial; proposing the reorder is full.

**Suggested fix.**
- `node_reorder` step on Sc 3 with `new_order: 2` (before Sc 2).

### L1-REPETITION-01 — Chapter 3 and Chapter 4 both open with Voss alone

**Surface:** Repetition / structure
**Location:** Opening of Chapter 3 (Sc 1 first beat) + opening of Chapter 4 (Sc 1 first beat)

**Description.** Chapter 3 opens with Voss alone in a diner booth, watching the door. Chapter 4 opens with Voss alone in her car at dawn, watching the halfway house. Two consecutive chapter openings with the protagonist alone, watching, in interior reflection. Repetitive and structurally weak.

**Detection criterion.** The Director identifies that Chapters 3 and 4 open in structurally similar ways and at least one of: proposes a refine on one of the openings; suggests reordering scenes within Chapter 4; flags the repetition explicitly.

### L1-CHARACTER-01 — "Reuben" misspelled "Ruben" in Chapter 5

**Surface:** Character (mechanics)
**Location:** Chapter 5 / Scene 1 (one occurrence) + Chapter 5 / Scene 2 (one occurrence)

**Description.** The character Reuben is named consistently across Ch 1, 3, and 6. In Ch 5 the name appears twice as "Ruben" — once in narration in Sc 1, once in Voss's interior thought in Sc 2. This is a mechanical inconsistency the kind of error a careful pass would catch.

**Detection criterion.** The Director identifies that the name appears as both "Reuben" and "Ruben" in Chapter 5. A find names the spelling drift specifically. Identifying that "something is off with the partner's name" without specifying the spellings is partial.

## L2 — Close-reader

### L2-POV-01 — Omniscient slip in Chapter 4 Scene 1

**Surface:** POV
**Location:** Chapter 4 / Scene 1 — single sentence: "Bracket would have been pleased had he seen her staring at nothing."

**Description.** The novel is third-person-close anchored to Voss. Bracket has not yet been introduced as a presence Voss is aware of. The sentence breaks POV by attributing perception to a character not on the page and outside Voss's awareness. A clean POV violation.

**Detection criterion.** The Director identifies the sentence as a POV violation, names the close-vs-omniscient distinction, or proposes a refine that removes/rewrites the sentence. Identifying "Chapter 4 has a POV problem" without locating it is partial.

### L2-PACING-02 — Chapter 1 is twenty per cent longer than the average

**Surface:** Pacing / word count balance
**Location:** Chapter 1 (target ≈ 1,500 words) versus the chapter average (≈ 1,150 words)

**Description.** Chapter 1 is engineered ~20% longer than the other chapters in Act 1. This is a subtle imbalance that a careful editor might call out — opening chapters often run long, but at 30% over average the disparity becomes structural.

**Detection criterion.** The Director identifies that Chapter 1 is meaningfully longer than the others, or proposes a refine to tighten Chapter 1, or flags pacing imbalance across the act with Chapter 1 as the outlier. Numerical word counts are not required for the find — a qualitative observation that "Chapter 1 carries more weight than its share" counts.

### L2-VOICE-01 — Voice slip: Voss says "y'all"

**Surface:** Voice
**Location:** Chapter 5 / Scene 2 — Voss's dialogue with Reuben

**Description.** Voss is established as third-person-close, regional New England Massachusetts voice — clipped, mid-Atlantic, no Southern markers. In Ch 5 Sc 2 her dialogue contains a single "y'all," which is regionally inconsistent.

**Detection criterion.** The Director flags the "y'all" specifically as inconsistent with Voss's voice or regional register. Naming "voice issue in Chapter 5" without identifying the specific word is partial.

### L2-FORESHADOW-01 — Convenient discovery in Chapter 6 Scene 2

**Surface:** Foreshadowing / detective work
**Location:** Chapter 6 / Scene 2 — Voss "knew" to check the empty lot behind the halfway house

**Description.** The phone discovery is too clean. Voss "drove straight to the lot. She knew." Nothing earlier in the act establishes why she would search there — no clue, no overheard remark, no map, no detective work. The reveal is convenient rather than earned.

**Detection criterion.** The Director identifies that the discovery in Sc 6.2 is unmotivated by prior detective work, or proposes a refine to plant a clue earlier in the act, or flags the convenience as a craft issue. Saying "Chapter 6 ending feels rushed" without identifying the missing setup is partial.

## L3 — Subtle

### L3-ANTAGONIST-01 — Bracket is on-page only twice

**Surface:** Antagonist presence
**Location:** Chapter 4 / Scene 2 (community meeting glimpse) + Chapter 5 / Scene 1 (file research, Bracket off-page)

**Description.** Marcus Bracket is the antagonist driving Act 2 onward. In Act 1 he appears on-page only at the community meeting in Sc 4.2 — and even there he is glimpsed across a room with no dialogue. He is referenced in Sc 5.1 via files, but is not present. For an antagonist with this much narrative weight in subsequent acts, his Act 1 footprint is too thin. The reader has not yet had a chance to *feel* him.

**Detection criterion.** The Director identifies that the antagonist's presence in Act 1 is thin, names Bracket specifically, and at least one of: notes he has no dialogue in Act 1; suggests adding a scene where Bracket and Voss interact; flags the imbalance between his eventual narrative weight and his current page time.

### L3-THEME-01 — Institutional-rot theme has no friction with Voss

**Surface:** Theme
**Location:** Across Act 1 — present in the housemother's evasiveness (Ch 1), Maya's notebook (Ch 2), Reuben's warnings (Ch 5), Bracket's grants paperwork (Ch 5)

**Description.** The institutional-rot theme is asserted by setting and supporting cast but does not yet *cost* Voss anything. She moves through compromised institutions without paying a price for engaging with them — no pressure from her department, no professional jeopardy, no personal ethical compromise required. The theme is decorative rather than load-bearing.

**Detection criterion.** The Director identifies that the institutional-rot theme is present in setting but not yet costing or pressuring the protagonist, or suggests adding a scene where Voss is pressured to back off by her own institution, or flags that the theme is "supporting cast doing the work." Naming the theme without flagging the lack of friction is partial.

### L3-MOTIF-01 — "First frost" motif appears in Ch 1 and Ch 6, drops in between

**Surface:** Motif
**Location:** Chapter 1 / Scene 1 ("first frost of the year on the empty lot") + Chapter 6 / Scene 2 ("frost on the screen of Maya's phone") — absent in Chapters 2–5

**Description.** The "first frost" motif is set up in Chapter 1 and pays off in Chapter 6, but does not appear in any of the four chapters between. Either the motif should commit (recurring environmental texture across the act) or be cut (one isolated mention is set-dressing, not motif). The current state is half-built.

**Detection criterion.** The Director identifies the motif and notes its inconsistency — that it appears at the bookends but is dropped in the middle. Saying "Chapter 1 and Chapter 6 echo each other" without identifying the motif specifically is partial.

### L3-CHARACTER-02 — Liana mentioned four times without depth

**Surface:** Character (arc) / backstory
**Location:** Chapter 1 / Scene 1 (one mention) + Chapter 3 / Scene 2 (one mention) + Chapter 4 / Scene 1 (one mention) + Chapter 6 / Scene 2 (one mention)

**Description.** Voss's daughter Liana is referenced four times across Act 1 — enough to register as Important, not enough to develop. The reader knows her name, knows she died, knows it haunts Voss, but does not have any concrete image of who Liana was. The backstory tantalises without landing. Either deepen (one scene with a concrete memory) or pull back (fewer mentions, save for Act 2).

**Detection criterion.** The Director identifies that Liana is referenced multiple times but never made concrete, and proposes either deepening (a flashback or memory beat) or pulling back. Mentioning that Voss has backstory without flagging the four-mentions-no-depth pattern is partial.

## L4 — Expert

### L4-WANT-NEED-01 — Voss's want and need align too neatly

**Surface:** Craft (want/need)
**Location:** Across Act 1

**Description.** Voss's stated WANT is to find Maya. Her unstated NEED is to forgive herself for Liana's death. As constructed, finding Maya *is* the path to forgiveness — solving the case directly delivers the emotional resolution. There is no friction between what Voss thinks she wants and what she actually needs. Standard craft instinct says the want should sometimes pull against the need; the most powerful character arcs require the protagonist to choose between them. As written, Voss is on rails.

**Detection criterion.** The Director identifies that Voss's want and need are too aligned, names that craft tradition asks for friction, or suggests a structural change that introduces tension between solving the case and processing Liana's death. This is a hard find — generic "develop Voss's arc more" does not count. The Director must name the want-versus-need dynamic or describe the missing friction.

### L4-IMPLICIT-CHAR-01 — Unearned shift from patient witness handler to aggressive interrogator

**Surface:** Implicit characterisation
**Location:** Chapter 1 / Scene 2 (patient with the housemother) versus Chapter 3 / Scene 3 (aggressive with the guard)

**Description.** In Ch 1 Sc 2 Voss is established as patient — she lets the housemother circle and finally speak in her own time. In Ch 3 Sc 3 she is sharp with the guard from the first exchange. The shift is plot-justified (the guard is shifty, the evidence has tightened), but the *transitional pressure* is missing — there is no scene between them that pushes Voss toward her edge. Implicit characterisation should be earned across scenes; this one isn't.

**Detection criterion.** The Director identifies that Voss's interrogation register changes between Sc 1.2 and Sc 3.3, names the shift as unearned by what's between them, or proposes a beat that transitions her toward the harder edge. Saying "Voss is harsh in Chapter 3" without comparing it to her behaviour in Chapter 1 is partial.

### L4-TONAL-01 — Procedural-thriller register inside literary-noir

**Surface:** Tonal register
**Location:** Chapter 5 / Scene 3 — the threatening text Voss receives

**Description.** Most of the act sustains a literary-noir register: clipped present-tense narration, observational interiority, weather and light doing some of the work. The threat-text beat in Sc 5.3 reads procedural-thriller — all-caps content, melodramatic framing, narrative comment on Voss's pulse. The seam is visible.

**Detection criterion.** The Director identifies the threat-text scene as tonally inconsistent with the surrounding prose, names the literary-noir versus procedural-thriller distinction, or proposes a refine on the scene to bring it back into register. Saying "Chapter 5 Scene 3 is jarring" without identifying the tonal source of the jar is partial.

## Unscored craft observation

### UC-01 — Chapter 1 prose is the strongest in Act 1

**Surface:** Prose-quality differential
**Location:** Chapter 1 (locked) versus the rest of Act 1

**Description.** Chapter 1 is engineered to be measurably the most polished prose in the act. This is partly artefact (the locked-chapter scenario in §J5 demands that Ch 1 be a stable reference point that the Director cannot touch) and partly characteristic (real first chapters often *are* the most worked-over). It is observed without scoring because raising it would be a craft-honest finding by the Director, but its absence is not a failure of the Director — it is an editorial preference that may not surface in any given probe.

**Detection criterion (informational only).** The Director observes that Chapter 1 is more polished than the rest of Act 1, or that the locked chapter sets a bar the rest of the act does not match. Observed but not scored against detection rate.

## Catalogue maintenance

When the prose in `content.ts` is edited:

1. If an edit removes or relocates a catalogued issue, update this catalogue in the same change.
2. If an edit introduces a new unintended issue, either rewrite away from it or add it to the catalogue with full metadata.
3. Issue IDs are stable forever once allocated. Removed issues are marked **withdrawn** with a note rather than deleted.
4. Re-scoring is required when the catalogue changes — old baselines in `baselines.md` should note the catalogue version they were scored against.
