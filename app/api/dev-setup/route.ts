// DEV-ONLY MANUAL TEST FIXTURE BOOTSTRAP — gated by NODE_ENV !== production.
// Idempotent: safe to re-run. Returns the login credentials and the IDs of
// the populated entities so the manual tester knows what to navigate to.
//
// What it creates (only if absent — uses upsert / find-or-create):
//   user:      test@stelavox.local / test-password-123
//   project:   "The Northern Light Project"
//   document:  "The Northern Light" (Novel template)
//   book root: populated with a 200-word synopsis
//   acts:      3 acts already expanded (so the tester can immediately
//              click into one and try expand_act_into_chapters)
//   context:   1 character (Elena Vasquez), 1 location (The Mill House)
//              both linked to the book root so they assemble into ancestor
//              context for any agent operation downstream
//   comments:  2 unresolved comments on the book root for testing
//              the Comments tab
//
// Will be removed before phase merge alongside /api/smoke.

import { NextResponse } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

const TEST_EMAIL = 'test@stelavox.local'
const TEST_PASSWORD = 'test-password-123'

function tiptapDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text }],
    }],
  })
}

const BOOK_SYNOPSIS = "Eleanor Marsh, a disgraced magistrate's daughter exiled to the windswept northern coast, discovers her father's old ledger hidden beneath the floorboards of her grandmother's house. The ledger reads like an accountant's shopping list — until she realises the names match those of forty-three people who drowned in the wreck of the Aurelia thirty years ago. As Eleanor pulls at the thread, the witnesses begin to die: an old fisherman, a former harbour-master, a woman who had been a child of seven on the morning of the wreck. The deaths are too clean to be coincidence and too quiet to be murder. Eleanor must decide whether to expose what her father did, knowing that the people who buried the truth thirty years ago are still in this town, still listening, still capable of arranging an accident. A slow-burn moral thriller about whether justice that comes too late is justice at all."

const ELENA_SUMMARY = "Eleanor Marsh, 38, was the magistrate's daughter — once. Now she is a woman who has spent three years in exile cataloguing other people's furniture for the auction house in Kirkwall, learning the small art of being unseen. She is intelligent, watchful, and morally rigorous in ways that have cost her everything. Her great wound is her father: she was the one who told the inquiry what she had overheard, and the family never forgave her, and her father went to his grave still calling her a Judas. The lie she now lives by is that exile is enough — that bearing witness once was sufficient and she owes the world nothing more. The story will dismantle this lie. Eleanor's voice is dry, precise, frequently funny in a way that surprises people who expect a victim. She watches rooms the way a chess player watches a board. Physically: thin, strong from years of walking the cliffs, hair the colour of wet rope, the kind of face that disappears in a crowd unless she chooses to be seen."

const LOCATION_SUMMARY = "The Mill House sits at the head of the cove where the Aurelia went down, three storeys of black slate and salt-pitted granite that has been in the Marsh family since 1812. The wind is the first thing you notice; it does not stop. The sea is the second; it is visible from every window. The kitchen smells permanently of woodsmoke and the brine that comes in on the south wind. The floors slope. The old harbour-master's chart of the bay is still pinned to the parlour wall, dated the year of the wreck, three faint pencil marks where someone has measured something. The house has the atmosphere of a museum to an accusation no one will speak aloud. For Eleanor, it is the house she was sent to die in slowly. For the town, it is the place from which the magistrate's daughter watches them, and they have not forgiven that either."

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_in_production' }, { status: 403 })
  }

  const supabase = createServiceRoleClient()
  const log: string[] = []

  try {
    // ─── User ────────────────────────────────────────────────────────────
    let userId: string
    const { data: existing } = await supabase.auth.admin.listUsers()
    const found = existing.users.find((u) => u.email === TEST_EMAIL)
    if (found) {
      userId = found.id
      log.push(`user (existing): ${userId}`)
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        email_confirm: true,
      })
      if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`)
      userId = created.user.id
      // Wait for handle_new_user trigger to create the org
      await new Promise((r) => setTimeout(r, 500))
      log.push(`user (new): ${userId}`)
    }

    // ─── Org ─────────────────────────────────────────────────────────────
    const { data: membership } = await supabase
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userId)
      .single()
    if (!membership) throw new Error('membership not found — handle_new_user trigger failed?')
    const orgId = membership.organisation_id
    log.push(`org: ${orgId}`)

    // ─── Project ─────────────────────────────────────────────────────────
    let projectId: string
    const { data: existingProject } = await supabase
      .from('projects')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('name', 'The Northern Light Project')
      .maybeSingle()
    if (existingProject) {
      projectId = existingProject.id
      log.push(`project (existing): ${projectId}`)
    } else {
      const { data: created, error: projErr } = await supabase
        .from('projects')
        .insert({
          organisation_id: orgId,
          name: 'The Northern Light Project',
          default_document_type: 'novel',
        })
        .select('id').single()
      if (projErr || !created) throw new Error(`project: ${projErr?.message}`)
      projectId = created.id
      log.push(`project (new): ${projectId}`)
    }

    // ─── Document + book root via RPC ────────────────────────────────────
    let documentId: string
    let bookNodeId: string
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id, root_node_id')
      .eq('project_id', projectId)
      .eq('name', 'The Northern Light')
      .maybeSingle()
    if (existingDoc) {
      documentId = existingDoc.id
      bookNodeId = existingDoc.root_node_id ?? ''
      log.push(`document (existing): ${documentId}`)
    } else {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc(
        'create_document_with_layer_stack',
        {
          p_project_id: projectId,
          p_organisation_id: orgId,
          p_name: 'The Northern Light',
          p_description: 'Manual test fixture document',
          p_document_type: 'novel',
          p_authors: [],
        },
      )
      if (rpcErr || !rpcRes) throw new Error(`document RPC: ${rpcErr?.message}`)
      const r = rpcRes as { document?: { id?: string }; root_node?: { id?: string } }
      documentId = r.document?.id ?? ''
      bookNodeId = r.root_node?.id ?? ''
      if (!documentId || !bookNodeId) throw new Error('RPC missing IDs')
      log.push(`document (new): ${documentId}`)
      log.push(`book node (new): ${bookNodeId}`)
    }

    // ─── Backfill book root with synopsis ───────────────────────────────
    await supabase.from('nodes').update({
      name: 'The Northern Light',
      summary: tiptapDoc(BOOK_SYNOPSIS),
    }).eq('id', bookNodeId)
    log.push('book root summary populated')

    // ─── Three acts (idempotent — only insert if absent) ────────────────
    const { data: existingActs } = await supabase
      .from('nodes')
      .select('id, name, position')
      .eq('parent_id', bookNodeId)
      .eq('node_category', 'structural')
      .order('position')
    if ((existingActs?.length ?? 0) === 0) {
      const acts = [
        {
          name: 'Act One: The Inheritance',
          short_description: 'Eleanor returns to the Mill House and discovers the ledger.',
          summary: 'Three years into her exile, Eleanor returns to the Mill House for her grandmother\'s funeral and decides — half from grief, half from spite — to stay. She finds the ledger by accident, hidden under a loose floorboard in her father\'s old study. The names mean nothing to her at first. She is more interested in the loneliness of the house, the way the wind never stops, the small unfriendly attentions of the village. The act ends when she recognises a name in the ledger from a memorial plaque in the harbour church: forty-three drowned, the wreck of the Aurelia, 1992.',
        },
        {
          name: 'Act Two: The Witnesses',
          short_description: 'Eleanor begins to investigate, and the witnesses begin to die.',
          summary: 'Eleanor pulls the threads. She visits the old harbour-master, who tells her her father took the wreck claim through too quickly. She visits a fisherman who remembers seeing Eleanor\'s father with the ship\'s owner the night before the Aurelia sailed. The fisherman dies the next week — heart attack, alone in his boat. Then the harbour-master, found at the foot of his stairs. Then a woman who had been a child on the rescue boat, hit by a delivery van on the road into Kirkwall. Eleanor cannot prove they are not accidents, and yet she understands that they are not. The midpoint: she finds her father\'s second ledger — the one with the payments. She is no longer investigating a wreck. She is investigating what her father knew, and from whom he was paid to know it. She becomes aware that she is being watched. The act ends with the death of the seventh witness, and Eleanor\'s realisation that she is the only one left who can speak.',
        },
        {
          name: 'Act Three: The Reckoning',
          short_description: 'Eleanor decides whether the truth is worth the cost — and from whom.',
          summary: 'Eleanor knows enough now to expose the truth, but no one she could expose it to is alive or untouched. The harbourmaster\'s widow refuses to speak; the local paper editor was at school with the ship\'s owner\'s son; the police inspector is the wreck investigator\'s nephew. Eleanor is offered, by indirection, the same arrangement her father took: silence, and the modest comfort of being permitted to live in the house. She refuses. The climax is not a confrontation but a publication: she sends the second ledger to a journalist in Edinburgh who has no skin in this place, and waits at the kitchen window for whatever comes next. What comes is not what she expects. The book ends in the morning after, the wind still not stopping, Eleanor making tea and watching the door, no longer afraid of it but no longer pretending the fear is gone either.',
        },
      ]
      let pos = 0
      for (const act of acts) {
        await supabase.from('nodes').insert({
          organisation_id: orgId,
          project_id: projectId,
          document_id: documentId,
          parent_id: bookNodeId,
          node_category: 'structural',
          node_type: 'act',
          layer_index: 1,
          depth: 1,
          position: pos++,
          name: act.name,
          short_description: act.short_description,
          summary: tiptapDoc(act.summary),
          status: 'draft',
          version: 1,
        })
      }
      log.push(`3 acts created`)
    } else {
      log.push(`acts (existing): ${existingActs?.length}`)
    }

    // ─── Context nodes (Elena + The Mill House) ─────────────────────────
    const { data: existingContexts } = await supabase
      .from('nodes')
      .select('id, name, node_type')
      .eq('project_id', projectId)
      .eq('node_category', 'context')
    const haveCharacter = existingContexts?.some((c) => c.node_type === 'character')
    const haveLocation = existingContexts?.some((c) => c.node_type === 'location')
    const newContextIds: string[] = []
    if (!haveCharacter) {
      const { data: ch } = await supabase.from('nodes').insert({
        organisation_id: orgId,
        project_id: projectId,
        document_id: null,
        parent_id: null,
        node_category: 'context',
        node_type: 'character',
        scope: 'project',
        name: 'Eleanor Marsh',
        short_description: 'Protagonist; magistrate\'s daughter, exile.',
        summary: tiptapDoc(ELENA_SUMMARY),
        metadata: {
          full_name: 'Eleanor Margaret Marsh',
          age: 38,
          role: 'protagonist',
          wound: 'Testified against her father at the inquiry; family disowned her; he died still calling her a Judas.',
          lie: 'Bearing witness once was enough; she owes the world nothing more.',
          want: 'To be left alone in exile.',
          need: 'To complete the act of bearing witness — to expose what her father did.',
          ghost: 'The morning her father refused to look at her in the courtroom.',
          arc_type: 'positive_change',
          voice_notes: 'Dry, precise, frequently funny in a way that surprises people. Watches rooms like a chess player.',
          physical_description: 'Thin, strong from cliff-walking, hair the colour of wet rope, a face that disappears unless she chooses to be seen.',
        },
        status: 'draft',
        version: 1,
      }).select('id').single()
      if (ch) newContextIds.push(ch.id)
      log.push('character (Eleanor Marsh) created')
    }
    if (!haveLocation) {
      const { data: loc } = await supabase.from('nodes').insert({
        organisation_id: orgId,
        project_id: projectId,
        document_id: null,
        parent_id: null,
        node_category: 'context',
        node_type: 'location',
        scope: 'project',
        name: 'The Mill House',
        short_description: 'Eleanor\'s grandmother\'s house at the head of the cove.',
        summary: tiptapDoc(LOCATION_SUMMARY),
        metadata: {
          location_type: 'domestic interior with coastal exterior',
          atmosphere: 'A museum to an accusation no one will speak aloud.',
          sensory_notes: 'The wind never stops. Woodsmoke and brine. Sloping floors. Pencil marks on an old chart.',
          historical_significance: 'In the Marsh family since 1812; site of the 1992 Aurelia wreck claim adjudication.',
          thematic_resonance: 'Inheritance and complicity made architectural.',
          time_of_day_variations: 'Morning light is grey and bleached; evening gives the granite a wet-coal sheen.',
        },
        status: 'draft',
        version: 1,
      }).select('id').single()
      if (loc) newContextIds.push(loc.id)
      log.push('location (Mill House) created')
    }

    // ─── Link context nodes to the book root ─────────────────────────────
    for (const ctxId of newContextIds) {
      await supabase.from('node_context_links').insert({
        organisation_id: orgId,
        source_node_id: bookNodeId,
        target_node_id: ctxId,
        link_type: 'structural_to_context',
      }).select('id').single()
    }
    if (newContextIds.length > 0) log.push(`${newContextIds.length} context links created`)

    // ─── Two unresolved comments on the book root ────────────────────────
    const { count: existingCommentCount } = await supabase
      .from('node_comments')
      .select('*', { count: 'exact', head: true })
      .eq('node_id', bookNodeId)
    if ((existingCommentCount ?? 0) === 0) {
      await supabase.from('node_comments').insert([
        {
          node_id: bookNodeId,
          organisation_id: orgId,
          author_type: 'human',
          author_label: userId,
          comment_type: 'instruction',
          content: 'When expanding into acts, make sure the structural pace matches a literary thriller — slow burn, not action-driven.',
          resolved: false,
        },
        {
          node_id: bookNodeId,
          organisation_id: orgId,
          author_type: 'human',
          author_label: userId,
          comment_type: 'note',
          content: 'Consider whether Act Two should be longer than the others — the investigation is the heart of the book.',
          resolved: false,
        },
      ])
      log.push('2 comments created on book root')
    }

    return NextResponse.json({
      ok: true,
      log,
      login: {
        url: 'http://localhost:3000/login',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
      navigate_to: {
        project: `/projects/${projectId}`,
        document: `/projects/${projectId}/documents/${documentId}`,
        book_node: bookNodeId,
      },
      ids: { userId, orgId, projectId, documentId, bookNodeId },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, log, error: (err as Error).message },
      { status: 500 },
    )
  }
}
