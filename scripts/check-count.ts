import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  const docId = '8d1347b1-5baf-4b57-9ef4-fd0505d7be45'

  for (let layer = 0; layer <= 4; layer++) {
    const { count } = await supabase
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', docId)
      .eq('node_category', 'structural')
      .eq('layer_index', layer)
    console.log(`layer ${layer}: ${count} nodes`)
  }

  // Total count of all structural
  const { count: totalCount } = await supabase
    .from('nodes')
    .select('*', { count: 'exact', head: true })
    .eq('document_id', docId)
    .eq('node_category', 'structural')
  console.log(`TOTAL structural: ${totalCount}`)

  // Sum of word_count_actual across leaves — paginated
  let leafSum = 0, leafCount = 0
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('nodes')
      .select('word_count_actual')
      .eq('document_id', docId)
      .eq('node_category', 'structural')
      .eq('layer_index', 4)
      .range(offset, offset + 999)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    for (const r of data) { leafSum += r.word_count_actual ?? 0; leafCount++ }
    offset += data.length
    if (data.length < 1000) break
  }
  console.log(`\npaginated leaf count: ${leafCount}`)
  console.log(`paginated leaf word_count_actual SUM: ${leafSum}`)
}
main().catch(e => { console.error(e); process.exit(1) })
