import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const supabase = createClient(url, key)

  const orgId = '94822bb9-339a-4af4-a366-aa319fae1d25'

  // Count total structural nodes across the org
  const { count: totalStructural } = await supabase
    .from('nodes')
    .select('*', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .eq('node_category', 'structural')
  console.log(`Total structural nodes in org: ${totalStructural}`)

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .eq('organisation_id', orgId)
    .returns<{ id: string; name: string }[]>()

  for (const p of projects ?? []) {
    const { count } = await supabase
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', p.id)
      .eq('node_category', 'structural')
    console.log(`  ${p.name}: ${count} structural`)
  }

  console.log('\n--- Now mimicking getProjectAggregates query (default 1000 row limit) ---')
  const projectIds = (projects ?? []).map(p => p.id)
  const { data: nodeRows } = await supabase
    .from('nodes')
    .select('project_id, document_id, parent_id, word_count_actual, word_count_target, updated_at, layer_index')
    .in('project_id', projectIds)
    .eq('node_category', 'structural')
  console.log(`Default-limit query returned: ${nodeRows?.length} rows`)

  // Per-project sample sizes in returned set
  const sampleByProject = new Map<string, number>()
  const sumByProject = new Map<string, number>()
  for (const n of nodeRows ?? []) {
    sampleByProject.set(n.project_id, (sampleByProject.get(n.project_id) ?? 0) + 1)
    // Mimic the isLeaf check: layer_index = max(layer_index) per document
    // For simplicity here, just treat layer_index === 4 as leaf for novel/series stacks
    if (n.layer_index === 4) {
      sumByProject.set(n.project_id, (sumByProject.get(n.project_id) ?? 0) + (n.word_count_actual ?? 0))
    }
  }
  for (const p of projects ?? []) {
    console.log(`  ${p.name}: ${sampleByProject.get(p.id) ?? 0} rows in sample, leaf-sum=${sumByProject.get(p.id) ?? 0}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
