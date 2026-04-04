'use client'

import { useState, useEffect } from 'react'
import { FilterBar, FilterDef, FilterValues } from '../components/FilterBar'
import { EmptyState } from '../components/EmptyState'

type Skill = { id: string; name: string; file: string; description: string; enabled: boolean }

export default function SkillsPage() {
  const [skills, setSkills]   = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterValues>({ status: '', search: '' })

  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(d => { setSkills(d.skills ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const defs: FilterDef[] = [
    { type: 'select', key: 'status', label: 'Stato', value: filters.status,
      options: [{ value: 'enabled', label: 'Abilitata' }, { value: 'disabled', label: 'Disabilitata' }] },
    { type: 'search', key: 'search', label: 'Cerca', value: filters.search, placeholder: 'Nome o descrizione…' },
  ]

  const visible = skills.filter(s => {
    if (filters.status === 'enabled'  && !s.enabled)  return false
    if (filters.status === 'disabled' &&  s.enabled)  return false
    if (filters.search && !s.name.toLowerCase().includes(filters.search.toLowerCase())
      && !s.description.toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  })

  const enabledCount = skills.filter(s => s.enabled).length

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-4xl flex flex-col gap-6">

        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>sistema</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
              Skills
              {!loading && <span className="ml-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>
                {enabledCount}/{skills.length} attive
              </span>}
            </h1>
          </div>
          <FilterBar filters={defs} values={filters}
            onChange={(k, v) => setFilters(p => ({ ...p, [k]: v }))}
            onClear={() => setFilters({ status: '', search: '' })} />
        </div>

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon="⚡" title="Nessuna skill trovata" size="sm" />
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Nome', 'Descrizione', 'File', 'Stato'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: 'var(--color-dim)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((s, i) => (
                  <tr key={s.id} style={{
                    background: 'var(--color-panel)',
                    borderBottom: i < visible.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}>
                    <td className="px-4 py-3 text-[11px] font-mono font-semibold" style={{ color: 'var(--color-bright)' }}>
                      {s.name}
                    </td>
                    <td className="px-4 py-3 text-[10px]" style={{ color: 'var(--color-muted)', maxWidth: 320 }}>
                      <span className="line-clamp-2">{s.description}</span>
                    </td>
                    <td className="px-4 py-3 text-[9px] font-mono" style={{ color: 'var(--color-dim)' }}>
                      {s.file}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold"
                        style={{ color: s.enabled ? 'var(--color-green)' : 'var(--color-dim)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                        {s.enabled ? 'abilitata' : 'disabilitata'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
