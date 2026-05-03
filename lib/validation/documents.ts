import { z } from 'zod'

const DOCUMENT_TYPES_V1 = ['novel', 'short_story', 'series'] as const
const STATUS_V1 = ['active', 'archived', 'published'] as const

const nameField = z.string().transform(s => s.trim()).pipe(
  z.string().min(1).max(200)
)

const descriptionField = z.string().max(5000).nullable().optional()

const authorsField = z.array(
  z.string().transform(s => s.trim()).pipe(z.string().min(1).max(100))
).max(20).optional()

export const documentPostSchema = z.object({
  name: nameField,
  description: descriptionField,
  document_type: z.enum(DOCUMENT_TYPES_V1),
  authors: authorsField,
}).strict()

export const documentPatchSchema = z.object({
  name: nameField.optional(),
  description: descriptionField,
  status: z.enum(STATUS_V1).optional(),
  authors: authorsField,
}).strict()

export type DocumentPost  = z.infer<typeof documentPostSchema>
export type DocumentPatch = z.infer<typeof documentPatchSchema>
