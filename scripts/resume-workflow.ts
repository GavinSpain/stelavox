/**
 * One-off helper: re-trigger workflow advancement for a given workflow_id.
 * Used to recover a workflow whose previous agent_job got cancelled
 * (e.g. during the 2026-05-22 dispatcher-runner contract fix).
 *
 * Usage:
 *   npm run script scripts/resume-workflow.ts -- <workflow_id>
 */

import { advanceWorkflow } from '@/lib/director/workflow-executor'

async function main() {
  const workflowId = process.argv[2]
  if (!workflowId) {
    console.error('usage: resume-workflow.ts <workflow_id>')
    process.exit(1)
  }
  await advanceWorkflow(workflowId)
  console.log('advanceWorkflow returned for', workflowId)
}

main().catch((err) => {
  console.error('resume-workflow failed', err)
  process.exit(1)
})
