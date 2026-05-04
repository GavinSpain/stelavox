// Spec: stelavox_phase3_api_contract_v1_0.md v1.1 §2.12
//       stelavox_technical_architecture_v1_6.md H-15
//
// Server-side extension types for node responses. The generated
// lib/types/database.ts (H-10) defines the on-row shape; this module adds
// the derived fields the API layer attaches before responding.

import type { Database } from './database'

export type NodeRow = Database['public']['Tables']['nodes']['Row']

// Derived flag: true iff node.layer_index === max(layer_stack.layers[*].index)
// for the node's document. Computed at the data layer (lib/data/nodes.ts);
// never stored on the row; never inferred from child count (H-15).
export type NodeWithMeta = NodeRow & { is_leaf: boolean }
