import type { Editor } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'

export function toStorage(editor: Editor): string {
  return JSON.stringify(editor.getJSON())
}

export function fromStorage(text: string | null): JSONContent | null {
  if (!text) return null
  try {
    return JSON.parse(text) as JSONContent
  } catch {
    return null
  }
}
