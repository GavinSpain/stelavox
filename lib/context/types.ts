// Spec: stelavox_phase4_api_contract_v1_0.md §2.5 (validation rules — node_type),
//                                            §3.1 step 7,
//                                            §5 G-4 (V1 whitelist).
//       stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.1
//
// V1 context-node type whitelist. Per Product Spec v1.3 §4.7 row 1, the
// six core types ship in V1; the 30+ extended types are Phase 2+.
//
// Per API Contract G-4, this whitelist is an architectural enum, not an
// operational value (H-12 distinction) — additions require a contract
// bump and a code change, not a config-table edit. V2 introduces a
// per-organisation override path via `metadata_schemas` (SU-15).
//
// `as const` narrows the tuple so the derived union is the six string
// literals, not just `string`.

export const CONTEXT_NODE_TYPES_V1 = [
  'character',
  'location',
  'organisation',
  'theme',
  'plot_thread',
  'world',
] as const

export type ContextNodeType = typeof CONTEXT_NODE_TYPES_V1[number]

export function isContextNodeType(value: unknown): value is ContextNodeType {
  return typeof value === 'string'
    && (CONTEXT_NODE_TYPES_V1 as readonly string[]).includes(value)
}
