// Phase 8.01.D T-6 — ProjectGrid.
//
// 3-column responsive grid wrapping ProjectCards. Responsive contract
// in 8.01.F; for 8.01.D the minmax(280px, 1fr) gives sensible reflow.

import { ProjectCard } from './ProjectCard'
import type { ProjectAggregate } from '@/lib/dashboard/projectAggregates'

interface ProjectGridProps {
  aggregates: ProjectAggregate[]
}

export function ProjectGrid({ aggregates }: ProjectGridProps) {
  return (
    <div
      data-testid="project-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}
    >
      {aggregates.map((a) => (
        <ProjectCard key={a.projectId} aggregate={a} />
      ))}
    </div>
  )
}
