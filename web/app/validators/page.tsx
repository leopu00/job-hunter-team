'use client'

import { useState, useEffect } from 'react'
import { EmptyState } from '../components/EmptyState'

type Schema = { name: string; type: string; fields: string[]; description: string }
type Module = { module: string; schemas: Schema[] }

const TYPE_COLORS: Record<string, string> = {
  object: 'var(--color-blue)',
  enum:   'var(--color-yellow)',
  string: 'var(--color-green)',
  number: 'var(--color-bright)',
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? 'var(--color-dim)'
  return (
    <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold"
      style={{ border: `1px solid ${color}44`, background: `${color}11`, color }}>
      {type}
    </span>
  )
}

function SchemaRow({ s }: { s: Schema }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className="cursor-pointer transition-colors" role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        style={{ borderBottom: '1px solid var(--color-border)', background: open ? 'var(--color-deep)' : 'var(--color-panel)' }}>
        <td className="px-4 py-2.5 text-[11px] font-mono font-semibold" style={{ color: 'var(--color-bright)' }}>{s.name}</td>
        <td className="px-4 py-2.5"><TypeBadge type={s.type} /></td>
        <td className="px-4 py-2.5 text-[10px]" style={{ color: 'var(--color-muted)' }}>{s.description}</td>
        <td className="px-4 py-2.5 text-[10px] font-mono" style={{ color: 'var(--color-dim)' }}>
          {s.fields.length ? s.fields.length + ' campi' : '—'}
        </td>
        <td className="px-4 py-2.5 text-[10px]" style={{ color: 'var(--color-dim)' }}>{open ? '▲' : '▼'}</td>
      </tr>
      {open && s.fields.length > 0 && (
        <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
          <td colSpan={5} className="px-6 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              {s.fields.map(f => (
                <span key={f} className="px-2 py-0.5 rounded text-[9px] font-mono"
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-muted)' }}>
                  {f}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function ValidatorsPage() {
  const [modules, setModules] = useState<Module[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    fetch('/api/validators').then(r => r.json()).then(d => { setModules(d.validators ?? []); setTotal(d.total ?? 0); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = modules.map(m => ({
    ...m,
    schemas: m.schemas.filter(s =>
      !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(m => m.schemas.length > 0)

  return (
    <main className="min-h-screen px-6 py-10" style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="max-w-4xl flex flex-col gap-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>sistema</p>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>
              Validators
              {!loading && <span className="ml-3 text-[11px] font-mono" style={{ color: 'var(--color-dim)' }}>{total} schemi</span>}
            </h1>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca schema…"
            aria-label="Cerca schema" className="px-3 py-1.5 rounded text-[11px] outline-none font-mono"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-bright)', minWidth: 200 }} />
        </div>

        {loading ? (
          <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Caricamento…</p>
        ) : filtered.length === 0 ? (
          <EmptyState icon="🔍" title="Nessuno schema trovato" size="sm" />
        ) : (
          filtered.map(m => (
            <div key={m.module} className="flex flex-col gap-0">
              <p className="text-[9px] font-bold uppercase tracking-widest px-1 pb-2"
                style={{ color: 'var(--color-dim)' }}>modulo: {m.module}</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <table className="w-full border-collapse" aria-label="Schema di validazione">
                  <thead>
                    <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
                      {['Schema', 'Tipo', 'Descrizione', 'Campi', ''].map(h => (
                        <th key={h} scope="col" className="px-4 py-2 text-left text-[9px] font-bold uppercase tracking-wider"
                          style={{ color: 'var(--color-dim)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.schemas.map(s => <SchemaRow key={s.name} s={s} />)}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
