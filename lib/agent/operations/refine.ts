/**
 * Refine operation — validate plain-text refined output, route by target_field.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_agent_profile_library_v1_0.md §2.6–§2.11, §2.18.
 * Build Checklist T-7.3.
 *
 * Refine emits plain text irrespective of target_field. The result column
 * depends on the field:
 *   target_field='summary' → result_summary
 *   target_field='prose'   → result_prose
 *   target_field='notes'   → result_notes
 *
 * The Accept route converts via plainTextToTiptap() before writing to
 * the corresponding nodes.<field> (G-9).
 */

import { RefineOutputSchema } from '@/lib/llm/schemas/refine'

const VALID_TARGET_FIELDS = ['summary', 'prose', 'notes'] as const

export async function runRefine(
  content: string,
  targetField: string | undefined,
): Promise<Record<string, string>> {
  if (!targetField || !VALID_TARGET_FIELDS.includes(targetField as 'summary' | 'prose' | 'notes')) {
    throw new Error(
      `invalid_target_field:${targetField ?? 'undefined'} (must be one of ${VALID_TARGET_FIELDS.join('|')})`,
    )
  }

  const result = RefineOutputSchema.safeParse(content)
  if (!result.success) {
    throw new Error(`output_schema_invalid:${JSON.stringify(result.error.issues)}`)
  }

  const columnByField = {
    summary: 'result_summary',
    prose: 'result_prose',
    notes: 'result_notes',
  } as const

  const column = columnByField[targetField as keyof typeof columnByField]
  return { [column]: result.data }
}
