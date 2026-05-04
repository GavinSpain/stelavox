// Spec: stelavox_phase3_api_contract_v1_0.md §5 G-4 (client-side only in Phase 3)
//       stelavox_phase3_build_checklist_v1_0.md §3.7 T-7.1
//
// Per-node-type metadata schemas. All fields optional; advisory only.
// Phase 4's Context System will introduce server-side schema validation; Phase 3
// keeps the validation layer in the client.

export interface MetadataField {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string[]
}

export type MetadataSchema = MetadataField[]

const COMMON_NARRATIVE_FIELDS: MetadataSchema = [
  { key: 'pov_character', label: 'POV character',  type: 'text' },
  { key: 'time_of_day',   label: 'Time of day',    type: 'select',
    options: ['', 'Dawn', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night'] },
  { key: 'location',      label: 'Location',       type: 'text' },
  { key: 'mood',          label: 'Mood',           type: 'text' },
]

// V1 structural types per the seeded layer_stacks templates.
const SCHEMAS: Record<string, MetadataSchema> = {
  // Novel
  book:    [],
  act:     [],
  chapter: COMMON_NARRATIVE_FIELDS,
  scene:   COMMON_NARRATIVE_FIELDS,
  beat:    COMMON_NARRATIVE_FIELDS,
  // Short story
  short_story: [],
  // Series
  series:  [],
}

export function metadataSchemaForNodeType(nodeType: string): MetadataSchema {
  return SCHEMAS[nodeType] ?? []
}
