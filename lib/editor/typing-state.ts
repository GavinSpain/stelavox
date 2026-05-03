import type { Editor } from '@tiptap/react'

export function attachTypingDetector(editor: Editor, durationMs = 1200): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const el = editor.view.dom as HTMLElement

  const onKeydown = () => {
    el.classList.add('is-typing')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => el.classList.remove('is-typing'), durationMs)
  }

  el.addEventListener('keydown', onKeydown)

  return () => {
    el.removeEventListener('keydown', onKeydown)
    if (timer) clearTimeout(timer)
    el.classList.remove('is-typing')
  }
}
