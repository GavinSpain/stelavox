/**
 * j5-novel — Tree structure.
 *
 * Defines the node hierarchy for the §J5 scenario. Prose payloads live in
 * content.ts; context nodes live in context.ts. The seed runner combines
 * structure + content + context to populate the database.
 *
 * Slugs are stable — they are referenced by content.ts and context.ts.
 * Renaming a slug is a breaking change to the fixture; prefer adding new
 * nodes over renaming.
 *
 * Layer stack (Novel template):
 *   depth 0 / index 0 — Book (auto-created with the document)
 *   depth 1 / index 1 — Act
 *   depth 2 / index 2 — Chapter
 *   depth 3 / index 3 — Scene
 *   depth 4 / index 4 — Beat (leaf — carries prose)
 */

export interface FixtureNodeRef {
  slug: string
  parent_slug: string | null
  depth: number
  layer_index: number
  node_type: 'book' | 'act' | 'chapter' | 'scene' | 'beat'
  name: string
  order: number
  locked?: boolean
}

/**
 * The book root is created automatically by `create_document_with_layer_stack`.
 * Its slug is `__root__` for reference by other nodes; the seed runner
 * substitutes the auto-created node's UUID at insertion time.
 */
export const ROOT_SLUG = '__root__'

export const STRUCTURE: FixtureNodeRef[] = [
  // Acts (only Act 1 is populated; Act 2 and Act 3 are stubs to make the
  // document feel like a real Act 1 of a three-act novel)
  { slug: 'act-1', parent_slug: ROOT_SLUG, depth: 1, layer_index: 1, node_type: 'act', name: 'Act 1', order: 1 },
  { slug: 'act-2', parent_slug: ROOT_SLUG, depth: 1, layer_index: 1, node_type: 'act', name: 'Act 2', order: 2 },
  { slug: 'act-3', parent_slug: ROOT_SLUG, depth: 1, layer_index: 1, node_type: 'act', name: 'Act 3', order: 3 },

  // Chapter 1 — locked. Two scenes, two beats each.
  { slug: 'ch-1', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 1: The November Set', order: 1, locked: true },
  { slug: 'ch-1-sc-1', parent_slug: 'ch-1', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: Calder Street', order: 1 },
  { slug: 'ch-1-sc-1-bt-1', parent_slug: 'ch-1-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'Arrival at the halfway house', order: 1 },
  { slug: 'ch-1-sc-1-bt-2', parent_slug: 'ch-1-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The empty lot', order: 2 },
  { slug: 'ch-1-sc-2', parent_slug: 'ch-1', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: The housemother', order: 2 },
  { slug: 'ch-1-sc-2-bt-1', parent_slug: 'ch-1-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'Mrs Quinto in the kitchen', order: 1 },
  { slug: 'ch-1-sc-2-bt-2', parent_slug: 'ch-1-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'The grants paperwork', order: 2 },

  // Chapter 2 — Cold Mailbox. Two scenes, two beats each.
  { slug: 'ch-2', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 2: Cold Mailbox', order: 2 },
  { slug: 'ch-2-sc-1', parent_slug: 'ch-2', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: Maya’s room', order: 1 },
  { slug: 'ch-2-sc-1-bt-1', parent_slug: 'ch-2-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The bedside drawer', order: 1 },
  { slug: 'ch-2-sc-1-bt-2', parent_slug: 'ch-2-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The notebook', order: 2 },
  { slug: 'ch-2-sc-2', parent_slug: 'ch-2', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: Maya’s mother', order: 2 },
  { slug: 'ch-2-sc-2-bt-1', parent_slug: 'ch-2-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'The kitchen at Belden Avenue', order: 1 },
  { slug: 'ch-2-sc-2-bt-2', parent_slug: 'ch-2-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'The cold mailbox', order: 2 },

  // Chapter 3 — The Diner. Three scenes, one beat each.
  // Note: Sc 2 is internal reflection, Sc 3 is external confrontation.
  // Current order (Sc 1 → Sc 2 → Sc 3) is the engineered L1-ORDER-01 issue.
  { slug: 'ch-3', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 3: The Diner', order: 3 },
  { slug: 'ch-3-sc-1', parent_slug: 'ch-3', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: Reuben at the diner', order: 1 },
  { slug: 'ch-3-sc-1-bt-1', parent_slug: 'ch-3-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'Booth at the back', order: 1 },
  { slug: 'ch-3-sc-2', parent_slug: 'ch-3', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: After Reuben', order: 2 },
  { slug: 'ch-3-sc-2-bt-1', parent_slug: 'ch-3-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'Maya’s notebook again', order: 1 },
  { slug: 'ch-3-sc-3', parent_slug: 'ch-3', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 3: The guard', order: 3 },
  { slug: 'ch-3-sc-3-bt-1', parent_slug: 'ch-3-sc-3', depth: 4, layer_index: 4, node_type: 'beat', name: 'Cigarette at the side gate', order: 1 },

  // Chapter 4 — Open House. Two scenes, two beats each.
  { slug: 'ch-4', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 4: Open House', order: 4 },
  { slug: 'ch-4-sc-1', parent_slug: 'ch-4', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: Dawn on Calder Street', order: 1 },
  { slug: 'ch-4-sc-1-bt-1', parent_slug: 'ch-4-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'In the car', order: 1 },
  { slug: 'ch-4-sc-1-bt-2', parent_slug: 'ch-4-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The thermos', order: 2 },
  { slug: 'ch-4-sc-2', parent_slug: 'ch-4', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: The community meeting', order: 2 },
  { slug: 'ch-4-sc-2-bt-1', parent_slug: 'ch-4-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'Folding chairs', order: 1 },
  { slug: 'ch-4-sc-2-bt-2', parent_slug: 'ch-4-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'Bracket across the room', order: 2 },

  // Chapter 5 — Bracket Files. Three scenes, one beat each.
  { slug: 'ch-5', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 5: Bracket Files', order: 5 },
  { slug: 'ch-5-sc-1', parent_slug: 'ch-5', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: City clerk’s office', order: 1 },
  { slug: 'ch-5-sc-1-bt-1', parent_slug: 'ch-5-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The grants ledger', order: 1 },
  { slug: 'ch-5-sc-2', parent_slug: 'ch-5', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: Reuben warns her off', order: 2 },
  { slug: 'ch-5-sc-2-bt-1', parent_slug: 'ch-5-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'The porch on Bellingham', order: 1 },
  { slug: 'ch-5-sc-3', parent_slug: 'ch-5', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 3: The text', order: 3 },
  { slug: 'ch-5-sc-3-bt-1', parent_slug: 'ch-5-sc-3', depth: 4, layer_index: 4, node_type: 'beat', name: 'Voss reads the text', order: 1 },

  // Chapter 6 — The Lot Behind. Two scenes, two beats each. Act 1 climax.
  { slug: 'ch-6', parent_slug: 'act-1', depth: 2, layer_index: 2, node_type: 'chapter', name: 'Chapter 6: The Lot Behind', order: 6 },
  { slug: 'ch-6-sc-1', parent_slug: 'ch-6', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 1: The resident', order: 1 },
  { slug: 'ch-6-sc-1-bt-1', parent_slug: 'ch-6-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'The TV room at Calder', order: 1 },
  { slug: 'ch-6-sc-1-bt-2', parent_slug: 'ch-6-sc-1', depth: 4, layer_index: 4, node_type: 'beat', name: 'What Maya was paid for', order: 2 },
  { slug: 'ch-6-sc-2', parent_slug: 'ch-6', depth: 3, layer_index: 3, node_type: 'scene', name: 'Scene 2: The empty lot', order: 2 },
  { slug: 'ch-6-sc-2-bt-1', parent_slug: 'ch-6-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'Frost on the screen', order: 1 },
  { slug: 'ch-6-sc-2-bt-2', parent_slug: 'ch-6-sc-2', depth: 4, layer_index: 4, node_type: 'beat', name: 'The walk back', order: 2 },
]
