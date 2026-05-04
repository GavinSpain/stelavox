import { StarterKit } from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extension-placeholder'

// Options removed from all three editor surfaces
const baseDisabled = {
  heading: false,
  blockquote: false,
  code: false,
  horizontalRule: false,
  codeBlock: false,
  strike: false,
  underline: false,
} as const

// Summary: structural planning input — no Link, no Code, no Headings
// Keeps BulletList/OrderedList for structural enumeration
export const summaryExtensions = Object.freeze([
  StarterKit.configure({
    ...baseDisabled,
    link: false,
  }),
  Placeholder.configure({
    placeholder: 'Summarise this node for the agent…',
  }),
])

// Prose: the writing surface — no lists, Link for inline (⌘K via StarterKit config)
export const proseExtensions = Object.freeze([
  StarterKit.configure({
    ...baseDisabled,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    link: { openOnClick: false },
  }),
  Placeholder.configure({
    placeholder: 'Begin writing…',
  }),
])

// Notes: same shape as Summary but Link admitted (reference URLs, research links)
// Link is not consumed by agent system so it needs no stripping (see §5.13)
export const notesExtensions = Object.freeze([
  StarterKit.configure({
    ...baseDisabled,
    link: { openOnClick: false },
  }),
  Placeholder.configure({
    placeholder: 'Notes to yourself about this node…',
  }),
])
