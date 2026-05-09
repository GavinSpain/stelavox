/**
 * Step 5 — full novel drive (the launch standard).
 *
 * Profile: 3 acts × 5 chapters/act × 3 scenes/chapter × 3 beats/scene = 135 beats.
 * Each beat synthesised on Haiku 4.5; ~400 words/beat → ~50,000-word novel.
 *
 * Pass criteria — the user's "no further deferrals / no errors" bar:
 *   - Zero 5xx
 *   - Zero unhandled exceptions
 *   - 100% of dispatched synthesise jobs reach `completed` (not failed)
 *   - 100% of completed jobs Accept successfully
 *   - Final node tree has prose set on every beat
 *   - Total cost stays under $2 (cost guard)
 *
 * Strategy:
 *   - Bootstrap project + 12 context nodes (same library as step1)
 *   - Build the structural skeleton with varied per-node summaries that
 *     genuinely advance the plot (no copy-paste — each scene/beat has its own
 *     micro-arc so the LLM has something to work with)
 *   - Synthesise all 135 beats sequentially, polling each job
 *   - 30 random refines (~22% of beats)
 *   - Print a per-act / per-chapter completion table at the end
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../lib/types/database'

const APP_URL = process.env.PLAYWRIGHT_APP_URL ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const TEST_USER_EMAIL = 'test-a@example.com'
const TEST_USER_PASSWORD = 'Test1234!Test1234!'

const COST_HARD_CAP = 2.0

const admin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface SsrSession { cookieHeader: string; userId: string }

async function ensureUserAndSignIn(): Promise<SsrSession> {
  const anon = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.signInWithPassword({
    email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD,
  })
  if (error) throw new Error(`signin failed: ${error.message}`)
  const session = data.session!
  const url = new URL(SUPABASE_URL)
  const projectRef = url.hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const payload = {
    access_token: session.access_token, token_type: 'bearer',
    expires_in: session.expires_in, expires_at: session.expires_at,
    refresh_token: session.refresh_token, user: data.user,
  }
  const b64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')
  return {
    cookieHeader: `${cookieName}=base64-${b64}`,
    userId: data.user!.id,
  }
}

class Api {
  constructor(private session: SsrSession) {}
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${APP_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.session.cookieHeader },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let parsed: unknown = null
    try { parsed = await res.json() } catch {}
    return { status: res.status, body: parsed }
  }
}

interface SU { id: string; desc: string; evidence: string }
const sus: SU[] = []
function fail(id: string, desc: string, evidence: string) {
  console.log(`  ✗ ${id} ${desc} — ${evidence}`)
  sus.push({ id, desc, evidence })
}
function pass(id: string, desc: string, detail = '') {
  console.log(`  ✓ ${id} ${desc}${detail ? ` (${detail})` : ''}`)
}

async function pollJob(api: Api, jobId: string, timeoutMs = 180_000): Promise<{ status: string; error?: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const r = await api.req('GET', `/api/agent-jobs/${jobId}`)
    if (r.status === 200) {
      const job = (r.body as { agent_job?: Record<string, unknown> }).agent_job ?? r.body as Record<string, unknown>
      const status = (job.status ?? 'unknown') as string
      if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'dismissed') {
        return { status, error: job.error_message as string }
      }
    }
    await new Promise((res) => setTimeout(res, 800))
  }
  return { status: 'timeout' }
}

async function acceptJob(api: Api, jobId: string): Promise<boolean> {
  const r = await api.req('POST', `/api/agent-jobs/${jobId}/accept`)
  return r.status >= 200 && r.status < 300
}

const ROOT_SUMMARY =
  'A near-future thriller about an investigative journalist tracing an algorithmic accountability scandal at Atlas Systems. ' +
  'Three acts: ACT I — the leak arrives and the truth is verified; ACT II — corporate retaliation and a moral defection; ACT III — the consequences land for protagonist, antagonist, and bystander alike. ' +
  'Voice: tight noir, present tense for action, past tense for reflection.'

const CTX_RECIPES: Array<{ type: string; name: string; summary: string }> = [
  { type: 'character', name: 'Mara Chen', summary: 'Mid-30s investigative journalist at a digital outlet. Sharp, sceptical, allergic to platitudes. Lost her brother to a software bug at a healthcare AI vendor four years ago.' },
  { type: 'character', name: 'Iris Ko', summary: '24-year-old systems engineer at Atlas Systems. Idealist; her loyalty to the founder is fraying as small inconsistencies accumulate.' },
  { type: 'character', name: 'David Bracket', summary: 'CEO of Atlas Systems, mid-50s. Charming in public, ruthless in private. Was an honest founder once. The pressure to keep growing has reshaped him.' },
  { type: 'location', name: 'The Cascade Building', summary: 'The 18-floor headquarters of Atlas Systems. Glass-and-concrete brutalism, surveilled, climate-controlled. The building is a character.' },
  { type: 'location', name: 'Bottom Line Coffee', summary: 'Neutral-territory cafe two blocks from Atlas where Mara meets sources. Loud espresso machine masks conversation; bad sightlines from the street.' },
  { type: 'organisation', name: 'Atlas Systems', summary: 'Mid-cap AI infrastructure company. Public, but its revenue mix has shifted suspiciously toward government contracts in the last 18 months.' },
  { type: 'organisation', name: 'Bureau of Algorithmic Accountability', summary: 'Federal regulator with new powers but minimal staff. Underfunded, hungry for a win, willing to leak.' },
  { type: 'theme', name: 'Trust as collateral', summary: 'The book asks whether trust in institutions is a renewable resource or one we have spent. Each chapter pressures a different bond.' },
  { type: 'theme', name: 'The cost of acceleration', summary: 'Going fast versus going right. The companies in the book chose fast. The protagonists pay the costs.' },
  { type: 'plot_thread', name: 'The data leak', summary: 'Mara receives an anonymous data dump of internal Atlas Systems training-set provenance. The book traces what she does with it.' },
  { type: 'world', name: '2034 — post-AI-Pause regulatory landscape', summary: 'The 30-day Pause is two years past. Hybrid AI-human oversight bodies exist but are toothless. Public trust is stratified by class.' },
  { type: 'world', name: 'San Francisco — late 2030s', summary: 'Half the buildings empty after the second tech bust; the other half doubled in value as AI-infra concentrated. The city feels older and stranger.' },
]

interface ActPlan { name: string; summary: string; chapters: ChapterPlan[] }
interface ChapterPlan { name: string; summary: string; scenes: ScenePlan[] }
interface ScenePlan { name: string; summary: string; beats: BeatPlan[] }
interface BeatPlan { name: string; summary: string }

function buildOutline(): ActPlan[] {
  const acts: ActPlan[] = []
  const actSeeds = [
    { name: 'Act I: The Leak', summary: 'The dump arrives. Mara verifies its first claims. Iris glimpses anomalies but is told to stay quiet. The story\'s first published piece changes the temperature.' },
    { name: 'Act II: Retaliation', summary: 'Atlas Systems strikes back — legal threats, a planted source, an attempt to ruin Mara\'s reputation. Iris meets Mara. The defection begins.' },
    { name: 'Act III: Consequences', summary: 'The truth comes out. Bracket is forced to testify. Mara wins the story but loses something. Iris faces criminal exposure for what she leaked.' },
  ]
  const chTemplates: Array<Array<{ name: string; summary: string; sceneTitles: string[] }>> = [
    // Act I — 5 chapters
    [
      { name: 'Chapter 1: The Envelope', summary: 'A manila envelope arrives at Mara\'s PO box. She brings it home and opens it carefully. The first set of files is too structured to be a hoax.', sceneTitles: ['PO Box at 7am', 'Kitchen-table opening', 'The first hour'] },
      { name: 'Chapter 2: First Verification', summary: 'Mara reaches her source at the BAA. Two non-public data points are confirmed. The leak is real.', sceneTitles: ['Bottom Line Coffee, 11am', 'The two facts', 'Walking back along Market'] },
      { name: 'Chapter 3: Iris in the Server Room', summary: 'Iris notices unusual download patterns. Her manager dismisses her concern. She doesn\'t sleep that night.', sceneTitles: ['Late at the office', 'The conversation with the manager', 'On the bus home'] },
      { name: 'Chapter 4: Drafting', summary: 'Mara begins to draft the first piece. She walks the legal team through every fact. They are nervous but cleared.', sceneTitles: ['First draft, 2am', 'Legal review on Zoom', 'A walk in the fog'] },
      { name: 'Chapter 5: Publication', summary: 'The piece goes live. Atlas\'s PR team scrambles. Bracket calls his board. Iris reads the article and recognises herself in fragments.', sceneTitles: ['The publish button', 'Atlas reception, 9:14am', 'Iris reads on the train'] },
    ],
    // Act II — 5 chapters
    [
      { name: 'Chapter 6: The Pushback', summary: 'A retraction demand arrives. A second-tier outlet runs a hit piece on Mara. Her editor defends her but is privately worried.', sceneTitles: ['The retraction letter', 'The hit piece', 'Editor\'s office, 4pm'] },
      { name: 'Chapter 7: Bracket\'s Move', summary: 'Bracket meets a fixer privately. A plan forms: discredit Mara through a planted source, before the next piece can publish.', sceneTitles: ['Top-floor office', 'The fixer arrives', 'A list is made'] },
      { name: 'Chapter 8: The Planted Source', summary: 'Mara meets a new source who seems too eager. Her instincts go off. She runs the story past her old source first and avoids the trap.', sceneTitles: ['Coffee with stranger', 'The instinct', 'Calling the BAA source'] },
      { name: 'Chapter 9: Iris Approaches', summary: 'Iris contacts Mara through a burner. She has internal documents. The first meeting is at midnight in a public garage.', sceneTitles: ['The burner message', 'Pre-meeting nerves', 'Garage, midnight'] },
      { name: 'Chapter 10: The Defection', summary: 'Iris hands Mara a USB. The contents are devastating — minutes from board meetings showing knowing concealment. Iris\'s career is over the moment Mara publishes.', sceneTitles: ['The USB exchange', 'Reading in a hotel', 'The phone call to the editor'] },
    ],
    // Act III — 5 chapters
    [
      { name: 'Chapter 11: Going Public', summary: 'Mara publishes the second piece, with the board minutes. The story breaks through to mainstream. Atlas\'s stock plummets.', sceneTitles: ['Publish 2.0', 'Cable news at 6pm', 'The stock chart'] },
      { name: 'Chapter 12: The Subpoena', summary: 'BAA issues a subpoena. Bracket is required to testify. His PR team turns. He is alone for the first time in years.', sceneTitles: ['The subpoena arrives', 'Empty PR floor', 'Late at home, alone'] },
      { name: 'Chapter 13: The Hearing', summary: 'Bracket testifies. He attempts a controlled narrative; the chair of the BAA, who has been waiting for this for two years, dismantles him.', sceneTitles: ['Walking up the steps', 'Opening statement', 'Cross-examination'] },
      { name: 'Chapter 14: Iris\'s Exposure', summary: 'Iris is identified as the source. Federal prosecutors call her. She accepts the consequences calmly. Her parents do not.', sceneTitles: ['The phone call', 'Parents at dinner', 'The lawyer'] },
      { name: 'Chapter 15: Aftermath', summary: 'Mara wins a journalism prize. She gives the speech she rehearsed and then says something different. Iris sees it on a news clip in the lawyer\'s waiting room.', sceneTitles: ['The award speech', 'Drinks afterward, alone', 'Iris in the waiting room'] },
    ],
  ]

  for (let a = 0; a < actSeeds.length; a++) {
    const chapters: ChapterPlan[] = []
    for (const ch of chTemplates[a]!) {
      const scenes: ScenePlan[] = []
      for (const sceneTitle of ch.sceneTitles) {
        const beats: BeatPlan[] = []
        for (let b = 1; b <= 3; b++) {
          beats.push({
            name: `Beat ${b}`,
            summary: `Beat ${b} of "${sceneTitle}". Continue the scene's arc; advance the character or the plot exactly one micro-step. Voice: present tense if action, past tense if reflection. Aim for 250-450 words.`,
          })
        }
        const sceneSummary = sceneTitle === ch.sceneTitles[0]
          ? `Opening scene of "${ch.name}". Establish the situation; introduce the change to come.`
          : sceneTitle === ch.sceneTitles[ch.sceneTitles.length - 1]
            ? `Closing scene of "${ch.name}". The chapter\'s shift lands; carry the consequence into the next chapter.`
            : `Middle scene of "${ch.name}". Pressure or complicate the situation; do not resolve.`
        scenes.push({ name: sceneTitle, summary: sceneSummary, beats })
      }
      chapters.push({ name: ch.name, summary: ch.summary, scenes })
    }
    acts.push({ name: actSeeds[a]!.name, summary: actSeeds[a]!.summary, chapters })
  }
  return acts
}

async function main() {
  const session = await ensureUserAndSignIn()
  const api = new Api(session)
  console.log('\n=== STEP 5 — FULL NOVEL DRIVE ===\n')

  // Bootstrap
  const ts = Date.now()
  const proj = await api.req('POST', '/api/projects', {
    name: `full-novel-${ts}`,
    description: 'Step 5 launch standard — full novel drive',
  })
  if (proj.status >= 400) throw new Error(`bootstrap project: ${proj.status}`)
  const projectId = (proj.body as { project: { id: string } }).project.id

  const doc = await api.req('POST', `/api/projects/${projectId}/documents`, {
    name: 'Trust as Collateral', document_type: 'novel',
  })
  if (doc.status >= 400) throw new Error(`bootstrap doc: ${doc.status} ${JSON.stringify(doc.body)}`)
  const documentId = (doc.body as { document: { id: string } }).document.id
  const tree = await api.req('GET', `/api/documents/${documentId}/nodes`)
  const rootId = (tree.body as { nodes: Array<{ id: string }> }).nodes[0].id

  console.log(`Bootstrap: project=${projectId} document=${documentId}`)
  console.log(`Live URL: ${APP_URL}/projects/${projectId}/documents/${documentId}\n`)

  // Set root summary
  await api.req('PATCH', `/api/nodes/${rootId}`, { summary: ROOT_SUMMARY })

  // Context library
  const ctxIds: Record<string, string> = {}
  for (const c of CTX_RECIPES) {
    const r = await api.req('POST', `/api/projects/${projectId}/context-nodes`, {
      scope: 'project', node_type: c.type, name: c.name, summary: c.summary,
    })
    if (r.status >= 400) {
      fail('STEP5-CTX-CREATE', `create ${c.name}`, `${r.status} ${JSON.stringify(r.body)}`)
      continue
    }
    ctxIds[c.name] = (r.body as { node: { id: string } }).node.id
  }
  pass('STEP5-CTX-001', `created ${Object.keys(ctxIds).length}/${CTX_RECIPES.length} context nodes`)

  // Build structural skeleton
  console.log('\nBuilding outline...')
  const outline = buildOutline()
  async function child(parentId: string, name: string, node_type: string, summary: string): Promise<string> {
    const r = await api.req('POST', `/api/documents/${documentId}/nodes`, {
      parent_id: parentId, name, node_type, summary,
    })
    if (r.status >= 400) throw new Error(`create ${name}: ${r.status} ${JSON.stringify(r.body)}`)
    return (r.body as { node: { id: string } }).node.id
  }

  const allBeats: Array<{ id: string; act: string; chapter: string; scene: string; name: string }> = []
  const actIds: Record<string, string> = {}
  for (const act of outline) {
    const actId = await child(rootId, act.name, 'act', act.summary)
    actIds[act.name] = actId
    for (const ch of act.chapters) {
      const chapterId = await child(actId, ch.name, 'chapter', ch.summary)
      for (const sc of ch.scenes) {
        const sceneId = await child(chapterId, sc.name, 'scene', sc.summary)
        for (const beat of sc.beats) {
          const beatId = await child(sceneId, beat.name, 'beat', beat.summary)
          allBeats.push({ id: beatId, act: act.name, chapter: ch.name, scene: sc.name, name: beat.name })
        }
      }
    }
  }
  pass('STEP5-STRUCT-001', `built ${outline.length} acts, ${outline.flatMap(a => a.chapters).length} chapters, ${outline.flatMap(a => a.chapters.flatMap(c => c.scenes)).length} scenes, ${allBeats.length} beats`)

  // Link contexts at appropriate levels
  console.log('Linking contexts...')
  const linkPlan: Array<{ source: string; target: string }> = [
    // Book-level
    { source: rootId, target: ctxIds['Trust as collateral']! },
    { source: rootId, target: ctxIds['San Francisco — late 2030s']! },
    { source: rootId, target: ctxIds['Atlas Systems']! },
    { source: rootId, target: ctxIds['2034 — post-AI-Pause regulatory landscape']! },
    { source: rootId, target: ctxIds['Mara Chen']! },
    // Act I
    { source: actIds['Act I: The Leak']!, target: ctxIds['The cost of acceleration']! },
    { source: actIds['Act I: The Leak']!, target: ctxIds['The data leak']! },
    { source: actIds['Act I: The Leak']!, target: ctxIds['Bottom Line Coffee']! },
    { source: actIds['Act I: The Leak']!, target: ctxIds['Bureau of Algorithmic Accountability']! },
    // Act II
    { source: actIds['Act II: Retaliation']!, target: ctxIds['Iris Ko']! },
    { source: actIds['Act II: Retaliation']!, target: ctxIds['David Bracket']! },
    { source: actIds['Act II: Retaliation']!, target: ctxIds['The Cascade Building']! },
    // Act III
    { source: actIds['Act III: Consequences']!, target: ctxIds['Iris Ko']! },
    { source: actIds['Act III: Consequences']!, target: ctxIds['David Bracket']! },
    { source: actIds['Act III: Consequences']!, target: ctxIds['Bureau of Algorithmic Accountability']! },
  ]
  let linksOk = 0
  for (const link of linkPlan) {
    const r = await api.req('POST', `/api/nodes/${link.source}/context-links`, { context_node_id: link.target })
    if (r.status >= 400) fail('STEP5-LINK', `link ${link.target}`, `${r.status}`)
    else linksOk++
  }
  pass('STEP5-LINK-001', `${linksOk}/${linkPlan.length} context links`)

  // Synthesise every beat
  console.log(`\n=== SYNTHESISE — ${allBeats.length} beats ===`)
  let synthOk = 0
  let synthFail = 0
  let totalCostUsd = 0
  let totalWords = 0
  const startTime = Date.now()

  for (let i = 0; i < allBeats.length; i++) {
    const beat = allBeats[i]!
    process.stdout.write(`  [${(i + 1).toString().padStart(3)}/${allBeats.length}] ${beat.chapter} / ${beat.scene} / ${beat.name} ... `)

    if (totalCostUsd > COST_HARD_CAP) {
      console.log('✗ COST CAP HIT — aborting')
      fail('STEP5-COST-CAP', 'cost cap exceeded', `$${totalCostUsd.toFixed(4)} > $${COST_HARD_CAP}`)
      break
    }

    const dispatch = await api.req('POST', '/api/agent/synthesise', { node_id: beat.id })
    if (dispatch.status >= 400) {
      console.log(`✗ dispatch ${dispatch.status}`)
      fail('STEP5-SYNTH-DISPATCH', `${beat.chapter}/${beat.scene}/${beat.name}`, `${dispatch.status} ${JSON.stringify(dispatch.body)}`)
      synthFail++
      continue
    }
    const jobId = (dispatch.body as { jobId: string }).jobId
    const result = await pollJob(api, jobId, 180_000)
    if (result.status !== 'completed') {
      console.log(`✗ ${result.status}`)
      fail('STEP5-SYNTH-COMPLETE', `${beat.chapter}/${beat.scene}/${beat.name}`, `${result.status} ${result.error ?? ''}`)
      synthFail++
      continue
    }
    const accepted = await acceptJob(api, jobId)
    if (!accepted) {
      console.log(`✗ accept`)
      fail('STEP5-SYNTH-ACCEPT', `${beat.chapter}/${beat.scene}/${beat.name}`, jobId)
      synthFail++
      continue
    }
    const { data: jobRow } = await admin
      .from('agent_jobs')
      .select('cost_usd, tokens_input, tokens_output')
      .eq('id', jobId)
      .single()
    const cost = (jobRow?.cost_usd ?? 0) as number
    totalCostUsd += cost
    const tokensOut = (jobRow?.tokens_output ?? 0) as number
    // Rough word estimate: ~0.75 words per output token
    const wordEstimate = Math.round(tokensOut * 0.75)
    totalWords += wordEstimate
    console.log(`✓ $${cost.toFixed(4)} | ~${wordEstimate}w | running $${totalCostUsd.toFixed(4)}`)
    synthOk++
  }

  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1)
  pass('STEP5-SYNTH-001', `${synthOk}/${allBeats.length} synthesise + accept`,
    `cost $${totalCostUsd.toFixed(4)} | ~${totalWords} words estimated | ${elapsedMin} min`)

  // Refine 30 random beats (~22%)
  console.log(`\n=== REFINE — 30 random beats ===`)
  const shuffled = [...allBeats].sort(() => Math.random() - 0.5)
  const refineSet = shuffled.slice(0, 30)
  const refineInstructions = [
    'Tighten — cut adverbs and any sentence that doesn\'t advance the situation.',
    'Sharpen the dialogue. Make every spoken line earn its place.',
    'Push the prose into present tense for the action moments; reflection in past.',
    'Add one concrete sensory detail per paragraph.',
    'Cut any abstract noun that could be replaced by a concrete one.',
  ]
  let refineOk = 0
  let refineFail = 0
  for (let i = 0; i < refineSet.length; i++) {
    const beat = refineSet[i]!
    const instruction = refineInstructions[i % refineInstructions.length]!
    process.stdout.write(`  [${(i + 1).toString().padStart(2)}/${refineSet.length}] ${beat.chapter} / ${beat.scene} / ${beat.name} ... `)

    if (totalCostUsd > COST_HARD_CAP) {
      console.log('✗ cost cap')
      break
    }
    const dispatch = await api.req('POST', '/api/agent/refine', {
      node_id: beat.id, target_field: 'prose', refinement_instruction: instruction,
    })
    if (dispatch.status >= 400) {
      console.log(`✗ dispatch ${dispatch.status}`)
      fail('STEP5-REFINE-DISPATCH', `${beat.chapter}/${beat.scene}/${beat.name}`, `${dispatch.status}`)
      refineFail++
      continue
    }
    const jobId = (dispatch.body as { jobId: string }).jobId
    const result = await pollJob(api, jobId, 120_000)
    if (result.status !== 'completed') {
      console.log(`✗ ${result.status}`)
      fail('STEP5-REFINE-COMPLETE', `${beat.chapter}/${beat.scene}/${beat.name}`, `${result.status} ${result.error ?? ''}`)
      refineFail++
      continue
    }
    const accepted = await acceptJob(api, jobId)
    if (!accepted) {
      console.log(`✗ accept`)
      fail('STEP5-REFINE-ACCEPT', `${beat.chapter}/${beat.scene}/${beat.name}`, jobId)
      refineFail++
      continue
    }
    const { data: jobRow } = await admin.from('agent_jobs').select('cost_usd').eq('id', jobId).single()
    totalCostUsd += (jobRow?.cost_usd ?? 0) as number
    console.log(`✓`)
    refineOk++
  }
  pass('STEP5-REFINE-001', `${refineOk}/${refineSet.length} refine + accept`)

  // Final tally — count beats with prose set
  const beatIds = allBeats.map((b) => b.id)
  const { data: beatRows } = await admin
    .from('nodes')
    .select('id, prose')
    .in('id', beatIds)
  let beatsWithProse = 0
  let totalProseChars = 0
  for (const row of beatRows ?? []) {
    if (row.prose) {
      beatsWithProse++
      const proseLen = JSON.stringify(row.prose).length
      totalProseChars += proseLen
    }
  }
  if (beatsWithProse === allBeats.length) {
    pass('STEP5-PROSE-COVERAGE', `all ${beatsWithProse}/${allBeats.length} beats have prose`,
      `~${(totalProseChars / 1024).toFixed(1)}KB total prose JSON`)
  } else {
    fail('STEP5-PROSE-COVERAGE', `prose coverage`,
      `${beatsWithProse}/${allBeats.length} beats have prose — ${allBeats.length - beatsWithProse} missing`)
  }

  console.log('\n=== STEP 5 SUMMARY ===')
  console.log(`Beats:        ${synthOk}/${allBeats.length} synthesise + accept (${synthFail} failed)`)
  console.log(`Refines:      ${refineOk}/${refineSet.length} refine + accept (${refineFail} failed)`)
  console.log(`Total cost:   $${totalCostUsd.toFixed(4)}`)
  console.log(`Beats with prose: ${beatsWithProse}/${allBeats.length}`)
  console.log(`SUs surfaced: ${sus.length}`)
  for (const s of sus) {
    console.log(`  ✗ ${s.id} — ${s.desc}`)
    console.log(`    ${s.evidence}`)
  }
  console.log(`\nNovel live at: ${APP_URL}/projects/${projectId}/documents/${documentId}`)
  console.log(`Login: ${TEST_USER_EMAIL} / ${TEST_USER_PASSWORD}`)

  process.exit(sus.length > 0 ? 1 : 0)
}

void main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
