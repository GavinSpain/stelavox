import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import NewProjectDialog from '@/components/projects/NewProjectDialog'
import ProjectMenu from '@/components/projects/ProjectMenu'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, default_document_type, created_at')
    .order('created_at', { ascending: false })

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
          Projects
        </h1>
        <NewProjectDialog />
      </div>

      {!projects?.length ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
            No projects yet. Create one to get started.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {projects.map(project => (
            <li
              key={project.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '6px',
              }}
            >
              <Link
                href={`/projects/${project.id}`}
                style={{ textDecoration: 'none', flex: 1 }}
              >
                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                  {project.name}
                </span>
                {project.description && (
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', display: 'block', marginTop: 'var(--space-1)' }}>
                    {project.description}
                  </span>
                )}
              </Link>
              <ProjectMenu projectId={project.id} projectName={project.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
