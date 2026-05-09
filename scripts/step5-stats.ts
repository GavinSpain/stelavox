/**
 * Step 5 stats — count words in the produced novel + cost tally.
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface TiptapNode { type: string; text?: string; content?: TiptapNode[] }

function extractText(node: TiptapNode): string {
  if (node.text) return node.text
  if (!node.content) return ''
  return node.content.map(extractText).join(' ')
}

async function main() {
  const c = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: beats } = await c
    .from('nodes')
    .select('id, prose')
    .eq('document_id', '84e062d1-662a-425a-84d3-53f06667a9c1')
    .eq('node_type', 'beat')
  if (!beats) { console.log('no beats'); return }
  let total = 0
  let withProse = 0
  for (const b of beats) {
    if (!b.prose) continue
    withProse++
    const proseObj = typeof b.prose === 'string' ? JSON.parse(b.prose) : b.prose
    const text = extractText(proseObj as TiptapNode)
    const words = text.split(/\s+/).filter(Boolean).length
    total += words
  }
  console.log(`beats=${beats.length} with_prose=${withProse} total_words=${total} avg=${Math.round(total/withProse)}`)

  const { data: jobs } = await c
    .from('agent_jobs')
    .select('cost_usd, tokens_input, tokens_output, operation_type')
    .gte('created_at', '2026-05-09T15:10')
    .not('cost_usd', 'is', null)
  if (!jobs) return
  const totalCost = jobs.reduce((a, b) => a + ((b.cost_usd ?? 0) as number), 0)
  const totalIn = jobs.reduce((a, b) => a + ((b.tokens_input ?? 0) as number), 0)
  const totalOut = jobs.reduce((a, b) => a + ((b.tokens_output ?? 0) as number), 0)
  const synthCount = jobs.filter((j) => j.operation_type === 'synthesise').length
  const refineCount = jobs.filter((j) => j.operation_type === 'refine').length
  console.log(`jobs=${jobs.length} synth=${synthCount} refine=${refineCount}`)
  console.log(`total_cost=$${totalCost.toFixed(4)} tokens_in=${totalIn} tokens_out=${totalOut}`)
}

void main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
