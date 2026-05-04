// Spec: stelavox_phase3_api_contract_v1_0.md §2.8 (pagination), §3.2
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.7
//
// Query-param schema for GET /api/nodes/[id]/versions.
// Coerces from strings (URLSearchParams values are always strings).

import { z } from 'zod'

export const versionsListQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict()

export type VersionsListQuery = z.infer<typeof versionsListQuerySchema>
