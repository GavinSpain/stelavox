// V1 metadata schemas for the six core context types.
//
// Spec: stelavox_phase4_api_contract_v1_0.md §5 G-2 (server validation
//       deferred — V1 client-side only); §5 G-4 (V1 whitelist).
//       stelavox_phase5_api_contract_v1_0.md v1.2 §5 G-10 (schemas pinned
//       to match agent-emitted shapes from agent profile library v1.0
//       §2.12–§2.17).
//       stelavox_phase4_test_plan_v1_0.md TC-U-07; TC-U-25/26 (Phase 5).
//
// Phase 5 amendment (G-10): the schemas now match what each
// generate_context_<type> profile emits in its `metadata` block. The
// agent's output therefore round-trips through the form cleanly.
// Free-form keys not in the schema still round-trip through the API
// per G-2 but are not displayed in the form.
//
// All fields remain optional in V1 — a context node without filled
// metadata is still useful (the agent system reads what's present).
// The form blocks submission only on type mismatches.

import type { ContextNodeType } from './types'

export type MetadataFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'string_array'

export interface MetadataField {
  key: string
  label: string
  type: MetadataFieldType
  options?: string[]    // required when type === 'select'
  description?: string  // shown as helper text below the field
}

export interface MetadataSchema {
  fields: MetadataField[]
}

const SCHEMAS: Record<ContextNodeType, MetadataSchema> = {
  // — Character — agent profile §2.12 emits these fields
  character: {
    fields: [
      { key: 'full_name', label: 'Full name', type: 'text' },
      { key: 'age', label: 'Age', type: 'number',
        description: 'Years (or use Voice notes for non-numeric ages).' },
      { key: 'role', label: 'Role', type: 'select',
        options: ['protagonist', 'antagonist', 'mentor', 'foil', 'supporting', 'minor'],
        description: 'Narrative role in this work.' },
      { key: 'wound', label: 'Wound', type: 'textarea',
        description: 'The formative experience that shaped this character. The engine of present behaviour.' },
      { key: 'lie', label: 'Lie', type: 'textarea',
        description: 'The misbelief the wound produced. Self-protective and false.' },
      { key: 'want', label: 'Want', type: 'textarea',
        description: 'What the character consciously pursues. Drives plot.' },
      { key: 'need', label: 'Need', type: 'textarea',
        description: 'What the character actually requires to become whole. Drives theme.' },
      { key: 'ghost', label: 'Ghost', type: 'textarea',
        description: 'The specific past memory or moment that most concretely expresses the wound.' },
      { key: 'arc_type', label: 'Arc type', type: 'select',
        options: ['positive_change', 'negative_change', 'flat_steadfast', 'tragic'],
        description: 'The shape of this character’s transformation.' },
      { key: 'voice_notes', label: 'Voice notes', type: 'textarea',
        description: 'Speech patterns, perception habits, the metaphors they reach for. Used by the agent system to maintain dialogue consistency.' },
      { key: 'physical_description', label: 'Physical presence', type: 'textarea',
        description: 'What you notice first. Presence, not catalogue.' },
      { key: 'key_relationships', label: 'Key relationships', type: 'string_array',
        description: 'Each entry: "Name: one-line dynamic with this character".' },
    ],
  },

  // — Location — agent profile §2.13 emits these fields
  location: {
    fields: [
      { key: 'location_type', label: 'Type', type: 'text',
        description: 'e.g. "domestic interior", "civic exterior", "wilderness", "transit".' },
      { key: 'physical_description', label: 'Physical description', type: 'textarea',
        description: 'The visual and spatial facts.' },
      { key: 'atmosphere', label: 'Atmosphere', type: 'textarea',
        description: 'The emotional register the place evokes (oppressive, serene, claustrophobic, etc.).' },
      { key: 'sensory_notes', label: 'Sensory notes', type: 'textarea',
        description: 'Specific sounds, smells, textures, temperatures.' },
      { key: 'historical_significance', label: 'Historical significance', type: 'textarea',
        description: 'What happened here before this story; the layers the place carries.' },
      { key: 'thematic_resonance', label: 'Thematic resonance', type: 'textarea',
        description: 'How the place embodies or contrasts with the story’s themes.' },
      { key: 'character_relationships', label: 'Character relationships', type: 'string_array',
        description: 'Each entry: "Name: relationship to this place" (home, exile, danger, memory).' },
      { key: 'time_of_day_variations', label: 'Time-of-day variations', type: 'textarea',
        description: 'How the place changes across times of day or seasons. Optional.' },
    ],
  },

  // — Organisation — agent profile §2.14 emits these fields
  organisation: {
    fields: [
      { key: 'organisation_type', label: 'Type', type: 'select',
        options: ['corporation', 'religious institution', 'criminal network', 'family business', 'government agency', 'academic institution', 'paramilitary unit', 'charitable trust', 'other'] },
      { key: 'founded', label: 'Founded', type: 'text',
        description: 'Era, decade, or specific year if material.' },
      { key: 'stated_purpose', label: 'Stated purpose', type: 'textarea',
        description: 'What this organisation tells itself it stands for.' },
      { key: 'actual_function', label: 'Actual function', type: 'textarea',
        description: 'What it really does, where this differs from stated purpose. The gap is often the dramatic material.' },
      { key: 'internal_culture', label: 'Internal culture', type: 'textarea',
        description: 'What it feels like to be a member here. What is rewarded, forbidden, ritualised.' },
      { key: 'power_structure', label: 'Power structure', type: 'textarea',
        description: 'Formal vs actual hierarchy. How dissent and succession are handled.' },
      { key: 'internal_conflicts', label: 'Internal conflicts', type: 'textarea',
        description: 'The fault lines that drive internal drama (factions, generations, ideologies).' },
      { key: 'external_relationships', label: 'External relationships', type: 'textarea',
        description: 'Allies, rivals, dependents. Public face vs reality.' },
      { key: 'key_members', label: 'Key members', type: 'string_array',
        description: 'Each entry: "Name: role in organisation". Link them as separate Character nodes for full coverage.' },
      { key: 'thematic_function', label: 'Thematic function', type: 'textarea',
        description: 'How this organisation embodies or tests the story’s themes.' },
    ],
  },

  // — World — agent profile §2.15 emits these fields
  world: {
    fields: [
      { key: 'physical_reality', label: 'Physical reality', type: 'textarea',
        description: 'Geography, climate, ecology — as a lived environment, not a textbook catalogue.' },
      { key: 'political_reality', label: 'Political reality', type: 'textarea',
        description: 'Who holds power, who is excluded, what they do about it.' },
      { key: 'social_cultural_reality', label: 'Social and cultural reality', type: 'textarea',
        description: 'How people organise relationships, families, communities. What is normal, transgressive, sacred, or forbidden.' },
      { key: 'economic_reality', label: 'Economic reality', type: 'textarea',
        description: 'How people survive and prosper. What is scarce. Who controls scarce things.' },
      { key: 'historical_weight', label: 'Historical weight', type: 'textarea',
        description: 'What happened before the story began. Unresolved histories, golden ages remembered as better than they were.' },
      { key: 'thematic_resonance', label: 'Thematic resonance', type: 'textarea',
        description: 'How this world embodies or challenges the story’s themes.' },
      { key: 'internal_conflicts', label: 'Internal conflicts', type: 'textarea',
        description: 'The tensions that drive the world’s drama (and supply plot).' },
      { key: 'tone_and_register', label: 'Tone and register', type: 'text',
        description: 'e.g. "grimdark", "elegiac", "satirical", "mythic", "domestic".' },
    ],
  },

  // — Theme — agent profile §2.16 emits these fields
  theme: {
    fields: [
      { key: 'theme_statement', label: 'Theme statement', type: 'textarea',
        description: 'Single sentence: subject + verb + argument. Not a topic, an argument.' },
      { key: 'false_version', label: 'False version', type: 'textarea',
        description: 'The lie or counterargument the story refutes. The protagonist’s lie often embodies it.' },
      { key: 'central_question', label: 'Central question', type: 'textarea',
        description: 'The dramatic question that embodies this theme.' },
      { key: 'character_vehicles', label: 'Character vehicles', type: 'string_array',
        description: 'Each entry: "Name: position in the thematic argument".' },
      { key: 'plot_vehicles', label: 'Plot vehicles', type: 'string_array',
        description: 'Each entry: a plot event that tests the theme directly.' },
      { key: 'imagery_and_motif', label: 'Imagery and motif', type: 'textarea',
        description: 'Recurring images or motifs that carry the theme.' },
      { key: 'resolution', label: 'Resolution', type: 'textarea',
        description: 'What the story ultimately argues. Does the theme win, lose, or become more complex?' },
    ],
  },

  // — Plot thread — agent profile §2.17 emits these fields
  plot_thread: {
    fields: [
      { key: 'thread_name', label: 'Thread name', type: 'text' },
      { key: 'thread_type', label: 'Thread type', type: 'select',
        options: ['main', 'character', 'thematic', 'external_stakes'],
        description: 'The narrative function this thread serves.' },
      { key: 'dramatic_question', label: 'Dramatic question', type: 'textarea',
        description: 'The specific question this thread asks and answers.' },
      { key: 'opening_condition', label: 'Opening condition', type: 'textarea',
        description: 'The state from which this thread begins.' },
      { key: 'key_escalation_points', label: 'Key escalation points', type: 'string_array',
        description: 'Each entry: a one-line escalation moment.' },
      { key: 'intersection_points', label: 'Intersection points', type: 'string_array',
        description: 'Each entry: "Other thread: how they intersect".' },
      { key: 'resolution', label: 'Resolution', type: 'textarea',
        description: 'How this thread closes. Triumph, tragedy, ambiguity.' },
      { key: 'thematic_function', label: 'Thematic function', type: 'textarea',
        description: 'What this thread argues or tests within the larger thematic structure.' },
      { key: 'characters_involved', label: 'Characters involved', type: 'string_array',
        description: 'The characters whose arcs intersect this thread.' },
    ],
  },
}

export function getMetadataSchema(type: ContextNodeType): MetadataSchema {
  return SCHEMAS[type]
}
