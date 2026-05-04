// Spec: stelavox_phase4_api_contract_v1_0.md §3.3 (POST link body)
//       stelavox_phase4_build_checklist_v1_0.md §3.1 T-1.7
//
// Zod schema for POST /api/nodes/[id]/context-links body. The schema
// is intentionally tiny — the real correctness work is in the route's
// step-by-step validation (source category, target category, scope
// consistency, lock checks). Body shape is just `{ context_node_id }`.

import { z } from 'zod'

export const contextLinkPostSchema = z.object({
  context_node_id: z.string().uuid(),
}).strict()

export type ContextLinkPost = z.infer<typeof contextLinkPostSchema>
