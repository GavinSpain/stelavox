import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  const docId = '8d1347b1-5baf-4b57-9ef4-fd0505d7be45'

  // Count beats per scene parent
  const { data: scenes } = await supabase
    .from('nodes').select('id, name, order')
    .eq('document_id', docId).eq('layer_index', 3)
    .order('order').returns<{ id: string; name: string; order: number }[]>()

  const { data: beats } = await supabase
    .from('nodes').select('parent_id, order')
    .eq('document_id', docId).eq('layer_index', 4)
    .returns<{ parent_id: string; order: number }[]>()

  const beatsByScene = new Map<string, number>()
  for (const b of beats ?? []) {
    beatsByScene.set(b.parent_id, (beatsByScene.get(b.parent_id) ?? 0) + 1)
  }

  const histo = new Map<number, number>()
  let firstMissing = -1
  for (let i = 0; i < (scenes?.length ?? 0); i++) {
    const s = scenes![i]!
    const cnt = beatsByScene.get(s.id) ?? 0
    histo.set(cnt, (histo.get(cnt) ?? 0) + 1)
    if (cnt < 5 && firstMissing === -1) firstMissing = i
  }
  console.log('scenes:', scenes?.length)
  console.log('beats:', beats?.length)
  console.log('histogram (beats-per-scene → scene count):')
  for (const [k, v] of [...histo.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${k} beats:`, v, 'scenes')
  }
  console.log('first scene index missing beats (0-based):', firstMissing)

  // Walk scenes and find where the pattern breaks
  console.log('\nbeats-per-scene by index (first 20 short):')
  let count = 0
  for (let i = 0; i < (scenes?.length ?? 0); i++) {
    const s = scenes![i]!
    const cnt = beatsByScene.get(s.id) ?? 0
    if (cnt < 5 && count < 20) {
      console.log(`  scene[${i}] order=${s.order} "${s.name}" beats=${cnt}`)
      count++
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
