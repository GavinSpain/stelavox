/**
 * j5-novel — Context nodes.
 *
 * Document-scoped context nodes attached to the J5 fixture. Each node
 * uses the V1 hardcoded metadata schema from
 * `stelavox_product_specification_v1_6.md` §4.7.
 *
 * Six V1 context types: character / location / organisation / theme /
 * plot_thread / world. The j5-novel scenario uses character, location,
 * theme, and plot_thread.
 *
 * Slugs are stable. Renames are breaking.
 */

export interface ContextNodeData {
  slug: string
  node_type: 'character' | 'location' | 'organisation' | 'theme' | 'plot_thread' | 'world'
  name: string
  short_description: string
  summary: string
  metadata: Record<string, unknown>
  tags?: string[]
}

export const CONTEXT_NODES: ContextNodeData[] = [
  {
    slug: 'ctx-voss',
    node_type: 'character',
    name: 'Detective Halsey Voss',
    short_description: 'Protagonist. Returned to active duty after the death of her teenage daughter.',
    summary:
      'Halsey Voss is a detective in the city department, recently returned to active duty after a year on bereavement leave following the death of her teenage daughter Liana. She is forty-seven, methodical, and has a reputation for closing cases by patience rather than pressure. She is also still grieving in a way she does not name to colleagues. The Maya Reilly disappearance is her first solo case since returning to work.',
    metadata: {
      role: 'protagonist',
      age: 47,
      want: 'Find Maya Reilly alive',
      fear: 'That Maya is already dead, and that Voss has failed another young person',
      voice: 'Third-person-close, present tense. Clipped, mid-Atlantic / New England Massachusetts. No regional Southern markers. Observational, weather-aware, sparing with adjectives.',
    },
    tags: ['protagonist'],
  },
  {
    slug: 'ctx-bracket',
    node_type: 'character',
    name: 'Councillor Marcus Bracket',
    short_description: 'Antagonist. City councillor with property interests on Calder Street.',
    summary:
      "Marcus Bracket is a city councillor in his late fifties who has held his ward seat for over a decade. He sits on the committee that administers grants to the Calder Street halfway house. He also owns, through a registered LLC, two properties on the surrounding blocks. The conflict of interest is documented in city filings if anyone goes looking. Bracket is a politician's politician — never alone in a room he can't read, never on the record about anything that matters.",
    metadata: {
      role: 'antagonist',
      age: 58,
      want: 'Protect his property and grant-administration interests around Calder Street',
      fear: 'That an investigation reaches the paper trail between his LLC and the halfway house grants',
      voice: 'Politician. Smooth, deflecting, never quite on the record. Speaks in passive constructions when the topic is uncomfortable.',
    },
    tags: ['antagonist'],
  },
  {
    slug: 'ctx-maya',
    node_type: 'character',
    name: 'Maya Reilly',
    short_description: 'Missing person. Twenty-year-old former resident of the Calder Street halfway house.',
    summary:
      'Maya Reilly is twenty, originally from the next county over, placed at the Calder Street halfway house eight months before the events of Act 1 after a juvenile record was sealed and a halfway-house referral was attached as a condition of release. She kept a small black notebook she did not show to staff. She did not return to her room on the night of November twelfth. Her mother lives across town and has not heard from her in three weeks before that. Maya is not on the page in Act 1; she is present through her room, her notebook, her mother, and the people who knew her.',
    metadata: {
      role: 'minor',
      age: 20,
      want: 'A life outside the halfway-house ecosystem',
      fear: 'That the survival rules she had already learned were the only rules available to her',
      voice: 'Not present in Act 1; reported through her notebook (terse, direct, slightly self-deprecating) and the people who knew her.',
    },
    tags: ['missing-person'],
  },
  {
    slug: 'ctx-reuben',
    node_type: 'character',
    name: 'Reuben Ortiz',
    short_description: "Voss's retired former partner. Mentor figure.",
    summary:
      "Reuben Ortiz was Voss's partner for nine years before he retired three years ago. He is sixty-seven, lives on Bellingham Street with a daughter and two grandchildren on the next block, and has been spending his retirement on the porch. He knew the city before Voss did and he knows the parts of it she does not yet see. He warned her, when she first joined his squad, that the city's institutions were not what they appeared. He is also the only person whose advice she still trusts unreservedly.",
    metadata: {
      role: 'mentor',
      age: 67,
      want: 'To be left alone in retirement',
      fear: 'That the cases he never closed will reach his daughter and grandchildren',
      voice: 'Weary, paternal, fond, indirect. Tells stories sideways. Spelled R-E-U-B-E-N consistently.',
    },
    tags: ['mentor', 'retired'],
  },
  {
    slug: 'ctx-calder-house',
    node_type: 'location',
    name: 'Calder Street Halfway House',
    short_description: 'Three-storey brownstone halfway house in the city ward Bracket represents.',
    summary:
      'The Calder Street halfway house occupies a three-storey brownstone halfway down a block of similar buildings, most of them now offices or empty. The house is a residential transitional facility for young women between eighteen and twenty-five with sealed juvenile records. It runs on a mix of state funding and city grants, the latter administered by a committee Marcus Bracket sits on. The building has a side gate to a service alley that connects to an empty lot behind. The lot is officially owned by a city land bank but has been in administrative limbo for six years.',
    metadata: {
      region: 'Rust-belt city, US northeast',
      climate: 'Continental, late autumn — first frost of the year already on the ground when Act 1 opens',
      era: 'Contemporary',
      mood: 'Institutional decay. Paint peeling at the cornices. The kind of building people stop seeing.',
      physical_description: 'Three-storey brownstone, peeling cornices, ten residents at capacity. Side gate to an alley. Empty lot behind. Communal kitchen, TV room, residents on three floors above.',
    },
    tags: ['institution'],
  },
  {
    slug: 'ctx-theme-rot',
    node_type: 'theme',
    name: 'Institutional Rot',
    short_description: 'Institutions designed to help vulnerable people end up extracting from them.',
    summary:
      "The institutional-rot theme runs across the act through the halfway house's grants paperwork, the housemother's evasions, Bracket's land holdings, Reuben's warnings, and the residents' silence. It is the texture of the world Voss is investigating.",
    metadata: {
      statement: 'Institutions designed to protect vulnerable people end up extracting from them; the protagonist must reckon with this even when the institutions are her own.',
      evidence: 'The housemother\'s evasions in Ch 1; Maya\'s notebook in Ch 2; Reuben\'s warnings in Ch 5; Bracket\'s grants paperwork in Ch 5; the residents\' silence in Ch 6.',
      counter_examples: "Reuben's prior integrity (now in retreat). Voss's own persistence (which is itself shaped by institutional habit).",
    },
    tags: ['theme', 'primary'],
  },
  {
    slug: 'ctx-theme-forgive',
    node_type: 'theme',
    name: 'Self-Forgiveness',
    short_description: "Voss's internal arc: forgiving herself for Liana's death.",
    summary:
      "Voss's internal arc across the novel is moving from grief to a usable form of self-forgiveness about her daughter Liana's death. In Act 1 Liana appears as a presence Voss is still reckoning with — referenced in flashes of memory and procedural pauses, not yet given a concrete scene of her own.",
    metadata: {
      statement: 'The protagonist must find a usable form of self-forgiveness for a past failure before she can act fully in the present.',
      evidence: "Voss's grief about Liana, four mentions in Act 1. Her hesitation at first interactions in Ch 1. Her edge with the guard in Ch 3 Sc 3. Her dawn vigil in Ch 4 Sc 1.",
      counter_examples: "Voss's professional persistence — present even when the internal arc is stalled.",
    },
    tags: ['theme', 'internal-arc'],
  },
  {
    slug: 'ctx-plot-disappearance',
    node_type: 'plot_thread',
    name: 'The Disappearance of Maya Reilly',
    short_description: "Investigation thread: Maya's vanishing, the institutional connection, the unresolved.",
    summary:
      "The investigation thread tracks Voss's effort to find Maya Reilly. In Act 1 it moves from the initial report at the halfway house, through the discovery of Maya's notebook and the visit to her mother, through the diner and the guard, to the community meeting where Bracket is glimpsed, the research that connects Bracket to the grants, the threatening text, and the phone in the empty lot. The Act 1 climax is the lock-in: Voss is committed beyond turning back. The thread continues through Acts 2 and 3.",
    metadata: {
      arc: 'Missing-person investigation, contemporary detective story, single-protagonist focal POV.',
      key_moments: "Initial report at Calder Street (Ch 1), Maya's notebook (Ch 2), guard confrontation (Ch 3), Bracket glimpsed (Ch 4), grants paper-trail (Ch 5), threatening text (Ch 5), phone in the empty lot (Ch 6 — Act 1 climax).",
      status: 'Open at end of Act 1; resolved in Act 3.',
    },
    tags: ['plot', 'investigation'],
  },
]
