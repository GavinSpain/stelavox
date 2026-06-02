// Phase 8.01.D T-9 — Sample Novel import helper.
//
// Mirrors the data + import logic from scripts/seed-sample-novel.ts in a
// form the /api/samples/import route can call with a server-side
// supabase client. Allows duplicate imports per OQ-3 lock: a suffix
// `(N)` is appended for the second, third, … copy; lowest-available N
// reused after a delete.
//
// Spec: Component Spec v2.21 §18.6 SampleNovelImportModal.
//       Phase 8.01.D build checklist OQ-3 lock.

import type { SupabaseClient } from '@supabase/supabase-js'

const BASE_NAME = 'Sample Novel — The Quiet Door'

interface BeatSpec { name: string; summary: string; prose: string }
interface SceneSpec { name: string; summary: string; beats: BeatSpec[] }
interface ChapterSpec { name: string; summary: string; scenes: SceneSpec[] }
interface ActSpec { name: string; summary: string; chapters: ChapterSpec[] }
interface BookSpec { name: string; summary: string; acts: ActSpec[] }

const BOOK: BookSpec = {
  name: 'The Quiet Door',
  summary: 'Mara walks to a house she has never seen before and asks for what is hers. Ord, the keeper, says nothing she expects.',
  acts: [{
    name: 'Threshold',
    summary: 'Mara arrives, is met, and learns the terms.',
    chapters: [
      {
        name: 'Arrival', summary: 'Mara reaches the house and is admitted.',
        scenes: [
          { name: 'The Door', summary: 'Mara stands at the door and waits.', beats: [
            { name: 'The Walk', summary: 'Mara walks the last quarter mile.', prose: 'The road was longer than the map had said, and by the time Mara reached the bend in the fence she had stopped counting her own footsteps. The house was small. It was painted the colour of weather, not the colour of paint. She stood at the gate for a long moment before she pushed it open.' },
            { name: 'The Knock', summary: 'She knocks. The door answers.', prose: 'There was a brass weight at the centre of the door, shaped like a hand. She lifted it. She held it. She let it fall. The sound was not loud. From inside, after a pause she could not have measured, a voice said: "It is open." So she opened it.' },
          ] },
          { name: 'The Keeper', summary: 'Mara meets Ord, who has been waiting.', beats: [
            { name: 'The Room', summary: 'Inside is warmer than expected.', prose: 'The room had two chairs and a table and a fire that should not have been lit at that hour. Ord did not stand. He looked at her once, briefly, and gestured to the second chair. "Sit," he said, and the word arrived without weight. "You have walked far." She did not say no.' },
            { name: 'The Question', summary: 'Mara asks why he was expecting her.', prose: '"You knew I was coming." It was not a question, although she had meant to make it one. Ord put down the cup he had been holding. "I knew someone would come," he said. "I did not know it would be you. That is a small difference." She thought about this for some time before she answered.' },
          ] },
        ],
      },
      {
        name: 'Inside', summary: 'Mara is given terms, and chooses.',
        scenes: [
          { name: 'The Hall', summary: 'Ord shows her the room with the box.', beats: [
            { name: 'The Lamp', summary: 'Ord takes a lamp and leads her down a hall.', prose: 'He lit a lamp the old way, with a long taper, although the wires in the wall were live and the switch was visible. "Habit," he said when he saw her look. The hall behind the room was longer than the room itself. She wondered, but did not ask, whether the house was strictly inside its own outside.' },
            { name: 'The Box', summary: 'A black box sits on a small table.', prose: 'The box was the size of a loaf of bread and the colour of nothing. Ord set the lamp beside it. "This is what you came for," he said. "Or what came for you. I have not yet decided which way that sentence runs." Mara looked at the box for a long moment before she reached.' },
          ] },
          { name: 'The Decision', summary: 'Mara is offered a choice and takes it.', beats: [
            { name: 'The Terms', summary: 'Ord explains what taking it means.', prose: '"It is not yours to keep," Ord said. "It is yours to carry. There is a difference, and the difference is the whole shape of what happens next. If you carry it, you will know things you did not ask to know. If you do not, you will leave through the door you came in by, and the road home will be exactly as long as the road here was."' },
            { name: 'The Lifting', summary: 'Mara lifts the box. She turns to the door.', prose: 'She lifted the box. It was heavier than its size and lighter than its colour, and she did not yet know what was inside it. Ord watched her, not with approval and not with regret, but with a kind of small attention she would think about for a long time. She turned, and walked back through the hall, and the lamp went with her, although neither of them had moved it.' },
          ] },
        ],
      },
    ],
  }],
}

const CONTEXT_NODES = [
  { node_type: 'character', name: 'Mara', short_description: 'The visitor. Late twenties, walked here on foot from somewhere not described.' },
  { node_type: 'character', name: 'Ord',  short_description: 'The keeper. Indeterminate age. Lights lamps with a taper despite electric wiring.' },
  { node_type: 'location',  name: 'The Door House', short_description: 'A small weathered house on a road. Interior larger than exterior would suggest.' },
  { node_type: 'theme',     name: 'What belongs to whom', short_description: 'The story turns on the difference between keeping and carrying.' },
]

function toTiptap(text: string): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content: text.length > 0 ? [{ type: 'text', text }] : [] }] }
}
function wordCount(text: string): number { return text.trim().split(/\s+/).filter(Boolean).length }

interface ExistingProjectRow { name: string }

/**
 * Pick the lowest-available suffix N per OQ-3 lock (1a + 2).
 * If no `BASE_NAME` collision exists, returns `BASE_NAME` itself.
 * Otherwise returns `BASE_NAME (2)`, `(3)`, … filling gaps.
 */
export function pickNextSampleName(existingNames: ReadonlyArray<string>): string {
  const taken = new Set<number>()
  for (const n of existingNames) {
    if (n === BASE_NAME) {
      taken.add(1)
    } else {
      const m = n.match(/^Sample Novel — The Quiet Door \((\d+)\)$/)
      if (m) taken.add(Number.parseInt(m[1], 10))
    }
  }
  // Lowest N starting at 1 not in taken.
  let n = 1
  while (taken.has(n)) n++
  return n === 1 ? BASE_NAME : `${BASE_NAME} (${n})`
}

export interface ImportResult {
  projectId: string
  documentId: string
  projectName: string
}

export async function importSampleNovel(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ImportResult> {
  // Find existing samples to compute the suffix.
  const { data: existing } = await supabase
    .from('projects')
    .select('name')
    .eq('organisation_id', orgId)
    .eq('metadata->>is_sample', 'true')
    .returns<ExistingProjectRow[]>()
  const projectName = pickNextSampleName((existing ?? []).map((r) => r.name))

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({
      organisation_id: orgId,
      name: projectName,
      description: 'A small functional sample.',
      metadata: { is_sample: true, sample_kind: 'small-functional' },
    })
    .select('id')
    .single<{ id: string }>()
  if (projErr || !project) throw new Error(`project insert failed: ${projErr?.message}`)
  const projectId = project.id

  const { data: rpc, error: rpcErr } = await supabase.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: BOOK.name,
    p_description: 'Small functional sample for Phase 8.01 testing.',
    p_document_type: 'novel',
    p_authors: ['Sample Author'],
  })
  if (rpcErr || !rpc) throw new Error(`create_document_with_layer_stack failed: ${rpcErr?.message}`)
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const documentId = setup.document.id
  const bookId = setup.root_node.id

  await supabase.from('nodes').update({
    name: BOOK.name,
    summary: toTiptap(BOOK.summary),
    metadata: { is_sample: true },
  }).eq('id', bookId)

  async function insertChild(parentId: string, layerIndex: number, nodeType: string, order: number, name: string, summary: string, prose: string | null, isLeaf: boolean): Promise<string> {
    const { data, error } = await supabase.from('nodes').insert({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: parentId,
      node_category: 'structural',
      node_type: nodeType,
      order, layer_index: layerIndex,
      name,
      summary: toTiptap(summary),
      prose: prose ? toTiptap(prose) : null,
      status: 'draft', version: 1,
      word_count_target: isLeaf ? 100 : null,
      word_count_actual: prose ? wordCount(prose) : null,
      metadata: { is_sample: true },
    }).select('id').single<{ id: string }>()
    if (error || !data) throw new Error(`node insert ${nodeType} '${name}' failed: ${error?.message}`)
    return data.id
  }

  for (let ai = 0; ai < BOOK.acts.length; ai++) {
    const act = BOOK.acts[ai]
    const actId = await insertChild(bookId, 1, 'act', ai + 1, act.name, act.summary, null, false)
    for (let ci = 0; ci < act.chapters.length; ci++) {
      const ch = act.chapters[ci]
      const chId = await insertChild(actId, 2, 'chapter', ci + 1, ch.name, ch.summary, null, false)
      for (let si = 0; si < ch.scenes.length; si++) {
        const sc = ch.scenes[si]
        const scId = await insertChild(chId, 3, 'scene', si + 1, sc.name, sc.summary, null, false)
        for (let bi = 0; bi < sc.beats.length; bi++) {
          const bt = sc.beats[bi]
          await insertChild(scId, 4, 'beat', bi + 1, bt.name, bt.summary, bt.prose, true)
        }
      }
    }
  }

  for (let i = 0; i < CONTEXT_NODES.length; i++) {
    const ctx = CONTEXT_NODES[i]
    await supabase.from('nodes').insert({
      organisation_id: orgId, project_id: projectId, document_id: documentId,
      parent_id: null, node_category: 'context', node_type: ctx.node_type,
      order: i + 1, layer_index: null, scope: 'document',
      name: ctx.name, short_description: ctx.short_description,
      summary: toTiptap(ctx.short_description), status: 'draft', version: 1,
      metadata: { is_sample: true },
    })
  }

  return { projectId, documentId, projectName }
}

/** Exposed for unit testing — internal preview meta block in the modal. */
export const SAMPLE_PREVIEW = {
  title: BOOK.name,
  baseName: BASE_NAME,
  metaLine: 'NOVEL · ~640 words drafted · 1 act · 2 chapters · 4 scenes · 8 beats · 4 context nodes',
}
