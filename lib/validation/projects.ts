import { z } from 'zod'

const DOCUMENT_TYPES_V1 = ['novel', 'short_story', 'series'] as const

const nameField = z.string().transform(s => s.trim()).pipe(
  z.string().min(1).max(200)
)

const descriptionField = z.string().max(5000).nullable().optional()

const documentTypeField = z.enum(DOCUMENT_TYPES_V1).optional()

const KNOWN_POST_KEYS = new Set(['name', 'description', 'default_document_type'])
const KNOWN_PATCH_KEYS = new Set(['name', 'description', 'default_document_type'])

export const projectPostSchema = z.object({
  name: nameField,
  description: descriptionField,
  default_document_type: documentTypeField,
}).strict()

export const projectPatchSchema = z.object({
  name: nameField.optional(),
  description: descriptionField,
  default_document_type: z.enum(DOCUMENT_TYPES_V1).nullable().optional(),
}).strict()

export { KNOWN_POST_KEYS, KNOWN_PATCH_KEYS }
export type ProjectPost  = z.infer<typeof projectPostSchema>
export type ProjectPatch = z.infer<typeof projectPatchSchema>
