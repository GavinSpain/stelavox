// Spec: stelavox_phase4_api_contract_v1_0.md §5 G-2 (server validation deferred — V1 client-side),
//                                            §2.5 (metadata field — free-form server, schema-validated client),
//                                            G-4 (V1 whitelist).
//       stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.4
//       stelavox_phase4_test_plan_v1_0.md TC-U-07 (Character schema render)
//
// V1 metadata schemas for the six core context types. Rendered by
// MetadataForm; validated client-side only (per G-2 the server keeps
// `metadata` as free-form JSONB). Free-form keys not in the schema
// round-trip through the API but are not displayed in the form.
//
// All fields are optional in V1 — a context node without filled
// metadata is still useful (the agent system in Phase 5 reads what's
// present). The form never blocks submission on missing fields; it
// blocks only on type mismatches (e.g. text in a number field).

import type { ContextNodeType } from './types'

export type MetadataFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select'

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
  character: {
    fields: [
      { key: 'role',  label: 'Role',  type: 'select',
        options: ['protagonist', 'antagonist', 'supporting', 'minor'],
        description: 'Narrative role in this work.' },
      { key: 'age',   label: 'Age',   type: 'number',
        description: 'Years (or use Voice for non-numeric ages).' },
      { key: 'want',  label: 'Want',  type: 'text',
        description: 'What the character is consciously pursuing.' },
      { key: 'fear',  label: 'Fear',  type: 'text',
        description: 'What the character is afraid of, often unconsciously.' },
      { key: 'voice', label: 'Voice', type: 'textarea',
        description: 'Speech patterns, verbal tics, register. Used by the agent system to maintain dialogue consistency.' },
    ],
  },
  location: {
    fields: [
      { key: 'region',                label: 'Region',                type: 'text' },
      { key: 'climate',               label: 'Climate',               type: 'text' },
      { key: 'era',                   label: 'Era',                   type: 'text',
        description: 'Historical period if relevant.' },
      { key: 'mood',                  label: 'Mood',                  type: 'text',
        description: 'The atmospheric register the location evokes (oppressive, serene, claustrophobic, etc.).' },
      { key: 'physical_description',  label: 'Physical description',  type: 'textarea',
        description: 'What a character sees, hears, smells when present.' },
    ],
  },
  organisation: {
    fields: [
      { key: 'type',         label: 'Type',         type: 'select',
        options: ['government', 'corporate', 'criminal', 'religious', 'academic', 'family', 'other'] },
      { key: 'power_level',  label: 'Power level',  type: 'text',
        description: 'Local, regional, national, global, etc.' },
      { key: 'goals',        label: 'Goals',        type: 'textarea',
        description: 'What the organisation is trying to achieve in this work.' },
      { key: 'key_members',  label: 'Key members',  type: 'textarea',
        description: 'List of named members who appear; link them as separate Character nodes for full coverage.' },
    ],
  },
  theme: {
    fields: [
      { key: 'statement',         label: 'Statement',         type: 'textarea',
        description: 'Single-sentence formulation of the theme. Drives consistency reviews.' },
      { key: 'evidence',          label: 'Evidence in work',  type: 'textarea',
        description: 'Where the theme surfaces (scenes, dialogue, imagery).' },
      { key: 'counter_examples',  label: 'Counter-examples',  type: 'textarea',
        description: 'Moments that complicate or undermine the theme — often the most interesting material.' },
    ],
  },
  plot_thread: {
    fields: [
      { key: 'arc',           label: 'Arc',           type: 'textarea',
        description: 'The shape from setup to payoff.' },
      { key: 'key_moments',   label: 'Key moments',   type: 'textarea',
        description: 'Beats where the thread advances; link them as you write.' },
      { key: 'thread_status', label: 'Status',        type: 'select',
        options: ['setup', 'rising', 'climax', 'resolution'],
        description: 'Where the thread currently sits in the document.' },
    ],
  },
  world: {
    fields: [
      { key: 'genre_grounding',       label: 'Genre grounding',     type: 'text',
        description: 'Realist / fantastical / speculative / etc.' },
      { key: 'magic_or_technology',   label: 'Magic or technology', type: 'textarea',
        description: 'The non-realist systems in play and their constraints.' },
      { key: 'historical_period',     label: 'Historical period',   type: 'text' },
      { key: 'core_rules',            label: 'Core rules',          type: 'textarea',
        description: 'The world’s ground rules. Used as guardrails by the agent system.' },
    ],
  },
}

export function getMetadataSchema(type: ContextNodeType): MetadataSchema {
  return SCHEMAS[type]
}
