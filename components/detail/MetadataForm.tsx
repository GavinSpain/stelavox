'use client'

// Spec: stelavox_phase3_build_checklist_v1_0.md §3.7 T-7.2
//       stelavox_phase3_api_contract_v1_0.md §5 G-4
//       stelavox_phase4_build_checklist_v1_0.md §3.7 T-7.1
//       stelavox_phase4_api_contract_v1_0.md §5 G-2
//
// Renders the per-node-type metadata fields. All fields optional. Each input
// updates editor-store.metadata, which folds into the next autosave PATCH
// (one round trip per debounce window — invariant 3).
//
// Phase 4: branches on node_category. Structural nodes use the existing
// editor schemas (POV character / time / location / mood from §3.7). Context
// nodes use the V1 six-core schemas in lib/context/metadata-schemas.ts —
// each schema may include `description` (helper text below the input) and
// `type === 'textarea'` (multi-line).

import { metadataSchemaForNodeType } from '@/lib/editor/metadata-schemas'
import {
  getMetadataSchema as getContextMetadataSchema,
  type MetadataField as ContextMetadataField,
} from '@/lib/context/metadata-schemas'
import { isContextNodeType } from '@/lib/context/types'
import { useEditorStore } from '@/lib/stores/editor-store'

// The form deals with a unified field shape internally. Both schema sources
// produce values that fit this superset. `string_array` was added in Phase 5
// (G-10) for agent-emitted list-shaped metadata (e.g. character.key_relationships);
// the renderer is a temporary multi-line textarea (one entry per line) until
// T-6.2 lands the full list-control UI.
interface UnifiedField {
  key:          string
  label:        string
  type:         'text' | 'textarea' | 'number' | 'date' | 'select' | 'string_array'
  options?:     string[]
  description?: string
}

interface MetadataFormProps {
  nodeType:     string
  nodeCategory: 'structural' | 'context'
  readOnly?:    boolean
}

function fieldsForNode(nodeType: string, nodeCategory: 'structural' | 'context'): UnifiedField[] {
  if (nodeCategory === 'context' && isContextNodeType(nodeType)) {
    const schema = getContextMetadataSchema(nodeType)
    return schema.fields.map((f: ContextMetadataField) => ({
      key:         f.key,
      label:       f.label,
      type:        f.type,
      options:     f.options,
      description: f.description,
    }))
  }
  // Structural — existing flat-array shape from lib/editor/metadata-schemas.ts.
  return metadataSchemaForNodeType(nodeType).map(f => ({
    key:     f.key,
    label:   f.label,
    type:    f.type,
    options: f.options,
  }))
}

export function MetadataForm({ nodeType, nodeCategory, readOnly }: MetadataFormProps) {
  const metadata = useEditorStore(s => s.metadata)
  const setMetadata = useEditorStore(s => s.setMetadata)
  const fields = fieldsForNode(nodeType, nodeCategory)
  if (fields.length === 0) return null

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {fields.map(field => {
          const value = (metadata?.[field.key] as string | number | undefined) ?? ''
          return (
            <FieldRow
              key={field.key}
              field={field}
              value={String(value)}
              readOnly={readOnly}
              onChange={update}
            />
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
  field: UnifiedField
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
          <option value="">—</option>
          {(field.options ?? []).filter(o => o !== '').map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.type === 'textarea' || field.type === 'string_array' ? (
        // string_array uses textarea-as-list-stub for Phase 5 — see T-6.2 for
        // the proper list-control UI. Each line is one entry. The store sees
        // it as a string; a future improvement parses to/from string[].
        <textarea
          id={`metadata-${field.key}`}
          value={value}
          disabled={readOnly}
          rows={field.type === 'string_array' ? 4 : 3}
          onChange={(e) => onChange(field.key, e.target.value)}
          style={{ ...sharedInputStyle, resize: 'vertical' }}
        />
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
      {field.description && (
        <span
          style={{
            fontSize: '11px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            color: 'var(--color-text-muted)',
          }}
        >
          {field.description}
        </span>
      )}
    </div>
  )
}
