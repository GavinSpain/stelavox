import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  const docId = '8d1347b1-5baf-4b57-9ef4-fd0505d7be45'

  const { data: all } = await supabase
    .from('nodes')
    .select('id, layer_index, word_count_actual, word_count_target, name')
    .eq('document_id', docId)
    .eq('node_category', 'structural')
    .returns<{ id: string; layer_index: number; word_count_actual: number | null; word_count_target: number | null; name: string }[]>()

  if (!all) { console.log('no data'); return }

  const byLayer = new Map<number, { count: number; actualSum: number; targetSum: number; actualNull: number; minActual: number; maxActual: number }>()
  for (const n of all) {
    const b = byLayer.get(n.layer_index) ?? { count: 0, actualSum: 0, targetSum: 0, actualNull: 0, minActual: Infinity, maxActual: 0 }
    b.count++
    if (n.word_count_actual === null) b.actualNull++
    else {
      b.actualSum += n.word_count_actual
      b.minActual = Math.min(b.minActual, n.word_count_actual)
      b.maxActual = Math.max(b.maxActual, n.word_count_actual)
    }
    b.targetSum += n.word_count_target ?? 0
    byLayer.set(n.layer_index, b)
  }

  console.log('layer | count | actualSum | targetSum | nullCount | min  | max')
  for (const [k, b] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${k}   | ${String(b.count).padStart(5)} | ${String(b.actualSum).padStart(9)} | ${String(b.targetSum).padStart(9)} | ${String(b.actualNull).padStart(9)} | ${b.minActual === Infinity ? '-' : String(b.minActual).padStart(4)} | ${b.maxActual}`)
  }

  console.log()
  console.log('TOTAL actualSum across all layers:', all.reduce((a, n) => a + (n.word_count_actual ?? 0), 0))
  console.log('TOTAL leaf (layer 4) actualSum:  ', byLayer.get(4)?.actualSum)
  console.log('TOTAL nodes:', all.length)

  // Sample 3 beats to verify their prose
  const beats = all.filter(n => n.layer_index === 4).slice(0, 3)
  for (const b of beats) {
    const { data: full } = await supabase.from('nodes').select('prose, word_count_actual').eq('id', b.id).single()
    const proseStr = JSON.stringify(full?.prose)
    const stripped = proseStr ? proseStr.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean) : []
    console.log(`\nBeat "${b.name}": stored word_count_actual=${full?.word_count_actual} prose-JSON-bytes=${proseStr?.length ?? 0}`)
    // Extract just the text values to count properly
    type T = { type: string; content?: T[]; text?: string }
    function textOf(node: T): string {
      if (node.type === 'text') return node.text ?? ''
      if (Array.isArray(node.content)) return node.content.map(textOf).join(' ')
      return ''
    }
    const text = textOf(full?.prose as T)
    const wc = text.trim().split(/\s+/).filter(Boolean).length
    console.log(`  extracted-text length=${text.length} chars; word count (whitespace split) = ${wc}`)
    console.log(`  first 200 chars: ${text.slice(0, 200)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
