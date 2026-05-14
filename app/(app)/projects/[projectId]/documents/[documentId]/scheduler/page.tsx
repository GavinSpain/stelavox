import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SchedulerPanel } from '@/components/scheduler/SchedulerPanel'

/**
 * V1.x-B.1.1 — SchedulerPanel routable view per CS v2.10 §17.4.
 *
 * Per-document scope: lists the document's active Brief + queued Briefs
 * + recent agent_jobs with level-appropriate cancel + reschedule + intent
 * controls. Stop is deferred to session 3 (needs paused-status enum +
 * lib/scheduler/dispatcher).
 */

interface Props {
  params: Promise<{ projectId: string; documentId: string }>
}

export default async function SchedulerPage({ params }: Props) {
  const { projectId, documentId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase
    .from('documents')
    .select('id, name')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) notFound()

  return (
    <SchedulerPanel
      projectId={projectId}
      documentId={documentId}
      documentName={document.name}
    />
  )
}
