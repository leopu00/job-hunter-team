'use client'

export type SelectFilter = { type: 'select'; key: string; label: string; options: { value: string; label: string }[]; value: string }
export type SearchFilter = { type: 'search'; key: string; label: string; placeholder?: string; value: string }
export type DateFilter   = { type: 'date';   key: string; label: string; value: string }
export type FilterDef    = SelectFilter | SearchFilter | DateFilter
export type FilterValues = Record<string, string>

type Props = { filters: FilterDef[]; values: FilterValues; onChange: (key: string, value: string) => void; onClear?: () => void }

const inputBase: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'var(--color-card)',
  color: 'var(--color-bright)', borderRadius: 6, fontSize: 11,
  padding: '5px 10px', fontFamily: 'var(--font-mono)',
  transition: 'border-color 0.15s',
}

export function FilterBar({ filters, values, onChange, onClear }: Props) {
  const hasActive = filters.some(f => values[f.key] && values[f.key] !== '')
  return (
    <div className="flex items-end gap-2 flex-wrap">
      {filters.map(f => {
        const val = values[f.key] ?? ''
        const activeBorder = val ? 'rgba(0,232,122,0.3)' : 'var(--color-border)'
        if (f.type === 'select') return (
          <div key={f.key} className="flex flex-col gap-0.5">
            <label htmlFor={`filter-${f.key}`} className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>{f.label}</label>
            <select id={`filter-${f.key}`} value={val} onChange={e => onChange(f.key, e.target.value)} style={{ ...inputBase, borderColor: activeBorder }}>
              <option value="">Tutti</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )
        if (f.type === 'search') return (
          <div key={f.key} className="flex flex-col gap-0.5">
            <label htmlFor={`filter-${f.key}`} className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>{f.label}</label>
            <input id={`filter-${f.key}`} type="search" value={val} placeholder={f.placeholder ?? 'Cerca…'}
              onChange={e => onChange(f.key, e.target.value)}
              style={{ ...inputBase, minWidth: 160, borderColor: activeBorder }} />
          </div>
        )
        if (f.type === 'date') return (
          <div key={f.key} className="flex flex-col gap-0.5">
            <label htmlFor={`filter-${f.key}`} className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>{f.label}</label>
            <input id={`filter-${f.key}`} type="date" value={val} onChange={e => onChange(f.key, e.target.value)}
              style={{ ...inputBase, colorScheme: 'dark', borderColor: activeBorder }} />
          </div>
        )
        return null
      })}
      {onClear && hasActive && (
        <button onClick={onClear}
          className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-dim)', background: 'transparent' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-red)'; e.currentTarget.style.borderColor = 'rgba(255,69,96,0.3)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-dim)'; e.currentTarget.style.borderColor = 'var(--color-border)' }}>
          ✕ reset
        </button>
      )}
    </div>
  )
}
