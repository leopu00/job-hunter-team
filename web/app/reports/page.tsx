'use client'

import { useState, useEffect } from 'react'
import { useToast } from '../components/Toast'
import { EmptyState } from '../components/EmptyState'

type Module  = { id: string; label: string }
type Row     = { module: string; metric: string; value: string; detail: string }
type Report  = { period: { from: string; to: string }; generated_at: string; modules: string[]; rows: Row[] }

const inp: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'var(--color-card)',
  color: 'var(--color-bright)', borderRadius: 6, fontSize: 11,
  padding: '6px 10px', outline: 'none', fontFamily: 'var(--font-mono)',
}

function exportCsv(report: Report) {
  const header = 'Modulo,Metrica,Valore,Dettaglio'
  const rows   = report.rows.map(r => [r.module, r.metric, r.value, r.detail].map(v => `"${v.replace(/"/g, '""')}"`).join(','))
  const csv    = [header, ...rows].join('\n')
  const a      = document.createElement('a')
  a.href       = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download   = `report-${report.period.from}-${report.period.to}.csv`
  a.click()
}

export default function ReportsPage() {
  const [modules,   setModules]   = useState<Module[]>([])
  const [selected,  setSelected]  = useState<string[]>([])
  const [from,      setFrom]      = useState(() => new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10))
  const [to,        setTo]        = useState(() => new Date().toISOString().slice(0, 10))
  const [report,    setReport]    = useState<Report | null>(null)
  const [busy,      setBusy]      = useState(false)
  const { addToast } = useToast()

  useEffect(() => {
    fetch('/api/reports').then(r => r.json()).then(d => {
      setModules(d.modules ?? [])
      setSelected((d.modules ?? []).map((m: Module) => m.id))
    }).catch(() => {})
  }, [])

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const generate = async () => {
    if (!selected.length) { addToast({ type: 'warning', message: 'Seleziona almeno un modulo' }); return }
    setBusy(true)
    try {
      const r = await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, modules: selected }) })
      const d = await r.json()
      if (d.report) { setReport(d.report); addToast({ type: 'success', message: 'Report generato' }) }
      else addToast({ type: 'error', message: d.error ?? 'Errore' })
    } catch { addToast({ type: 'error', message: 'Errore di rete' }) }
    finally { setBusy(false) }
  }

  const moduleLabel = (id: string) => modules.find(m => m.id === id)?.label ?? id

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="max-w-4xl flex flex-col gap-6">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.2em] uppercase mb-1" style={{ color: 'var(--color-green)' }}>sistema</p>
          <h1 className="text-xl font-bold" style={{ color: 'var(--color-white)' }}>Report</h1>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4 p-5 rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>Configurazione</p>

          <div className="flex gap-4 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>Da</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inp, colorScheme: 'dark' }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>A</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inp, colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>Moduli</label>
            <div className="flex gap-3 flex-wrap">
              {modules.map(m => {
                const on = selected.includes(m.id)
                return (
                  <button key={m.id} onClick={() => toggle(m.id)}
                    className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
                    style={{ border: `1px solid ${on ? 'var(--color-green)' : 'var(--color-border)'}`,
                      background: on ? 'rgba(0,232,122,0.08)' : 'transparent',
                      color: on ? 'var(--color-green)' : 'var(--color-dim)' }}>
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          <button onClick={generate} disabled={busy}
            className="self-start px-5 py-2 rounded text-[11px] font-bold cursor-pointer transition-all"
            style={{ background: busy ? 'var(--color-border)' : 'var(--color-green)', color: busy ? 'var(--color-dim)' : 'var(--color-void)', border: 'none' }}>
            {busy ? 'Generazione…' : 'Genera Report'}
          </button>
        </div>

        {/* Preview */}
        {report && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>
                Generato: {report.generated_at} · {report.rows.length} righe
              </p>
              <button onClick={() => exportCsv(report)}
                className="px-4 py-1.5 rounded text-[10px] font-semibold cursor-pointer"
                style={{ border: '1px solid var(--color-green)', color: 'var(--color-green)', background: 'transparent' }}>
                Export CSV ↓
              </button>
            </div>
            {report.rows.length === 0 ? (
              <EmptyState icon="📊" title="Nessun dato nel periodo selezionato" size="sm" />
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: 'var(--color-deep)', borderBottom: '1px solid var(--color-border)' }}>
                      {['Modulo', 'Metrica', 'Valore', 'Dettaglio'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider"
                          style={{ color: 'var(--color-dim)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i} style={{ background: 'var(--color-panel)', borderBottom: i < report.rows.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                        <td className="px-4 py-2.5"><span className="text-[9px] px-2 py-0.5 rounded font-mono"
                          style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-muted)' }}>
                          {moduleLabel(r.module)}</span></td>
                        <td className="px-4 py-2.5 text-[11px]" style={{ color: 'var(--color-muted)' }}>{r.metric}</td>
                        <td className="px-4 py-2.5 text-[11px] font-mono font-bold" style={{ color: 'var(--color-bright)' }}>{r.value}</td>
                        <td className="px-4 py-2.5 text-[10px]" style={{ color: 'var(--color-dim)' }}>{r.detail || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
