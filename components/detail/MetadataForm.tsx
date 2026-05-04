'use client'

// Spec: stelavox_phase3_build_checklist_v1_0.md §3.7 T-7.2
//       stelavox_phase3_api_contract_v1_0.md §5 G-4
//
// Renders the per-node-type metadata fields. All fields optional. Each input
// updates editor-store.metadata, which folds into the next autosave PATCH
// (one round trip per debounce window — invariant 3).

import { metadataSchemaForNodeType } from '@/lib/editor/metadata-schemas'
import { useEditorStore } from '@/lib/stores/editor-store'

interface MetadataFormProps {
  nodeType: string
  readOnly?: boolean
}

export function MetadataForm({ nodeType, readOnly }: MetadataFormProps) {
  const metadata = useEditorStore(s => s.metadata)
  const setMetadata = useEditorStore(s => s.setMetadata)
  const schema = metadataSchemaForNodeType(nodeType)
  if (schema.length === 0) return null

  function update(key: string, value: string) {
    const next = { ...(metadata ?? {}) }
    if (value === '') delete next[key]
    else next[key] = value
    setMetadata(next)
  }

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '11px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 'var(--space-2)',
        }}
      >
        Metadata
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 12px', alignItems: 'center' }}>
        {schema.map(field => {
          const value = (metadata?.[field.key] as string | undefined) ?? ''
          return (
            <FieldRow key={field.key} field={field} value={value} readOnly={readOnly} onChange={update} />
          )
        })}
      </div>
    </div>
  )
}

function FieldRow({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: ReturnType<typeof metadataSchemaForNodeType>[number]
  value: string
  readOnly?: boolean
  onChange: (key: string, value: string) => void
}) {
  const sharedInputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    fontSize: '12px',
    fontWeight: 400,
    background: 'var(--color-bg-base)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: '4px',
    padding: '4px 8px',
  }

  return (
    <>
      <label
        htmlFor={`metadata-${field.key}`}
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '12px',
          color: 'var(--color-text-muted)',
        }}
      >
        {field.label}
      </label>
      {field.type === 'select' ? (
        <select
          id={`metadata-${field.key}`}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(field.key, e.target.value)}
          style={sharedInputStyle}
        >
          {(field.options ?? []).map(opt => (
            <option key={opt} value={opt}>{opt || '—'}</option>
          ))}
        </select>
      ) : (
        <input
          id={`metadata-${field.key}`}
          type={field.type}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(field.key, e.target.value)}
          style={sharedInputStyle}
        />
      )}
    </>
  )
}
