'use client'

import Link from 'next/link'
import { useState, useCallback } from 'react'

type DataSource = 'sessions' | 'tasks' | 'analytics' | 'jobs' | 'applications' | 'contacts' | 'companies' | 'interviews'
type ExportFormat = 'json' | 'csv'

const SOURCES: { id: DataSource; label: string; desc: string; color: string; group: string }[] = [
  { id: 'jobs',         label: 'Offerte',       desc: 'Offerte di lavoro salvate',           color: '#61affe',             group: 'Job Hunting' },
  { id: 'applications', label: 'Candidature',   desc: 'Candidature inviate con timeline',    color: 'var(--color-green)',   group: 'Job Hunting' },
  { id: 'contacts',     label: 'Contatti',      desc: 'Contatti networking',                 color: '#9b59b6',             group: 'Job Hunting' },
  { id: 'companies',    label: 'Aziende',       desc: 'Aziende monitorate con rating',       color: '#fca130',             group: 'Job Hunting' },
  { id: 'interviews',   label: 'Colloqui',      desc: 'Colloqui programmati e completati',   color: '#50e3c2',             group: 'Job Hunting' },
  { id: 'sessions',     label: 'Sessioni',      desc: 'Sessioni agente con stato e metadata', color: 'var(--color-green)', group: 'Sistema' },
  { id: 'tasks',        label: 'Task',          desc: 'Task con status, tempi e agente',      color: 'var(--color-blue)',  group: 'Sistema' },
  { id: 'analytics',    label: 'Analytics',     desc: 'Chiamate API, token, costi, latenza',  color: 'var(--color-yellow)', group: 'Sistema' },
]

function today(): string { return new Date().toISOString().slice(0, 10) }
function daysAgo(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10) }

export default function ExportPage() {
  const [source, setSource] = useState<DataSource>('tasks')
  const [format, setFormat] = useState<ExportFormat>('json')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const doExport = useCallback(async () => {
    setExporting(true)
    setResult(null)
    try {
      const url = `/api/export?source=${source}&format=${format}&from=${from}&to=${to}`
      const res = await fetch(url)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Errore sconosciuto' }))
        setResult({ ok: false, msg: err.error ?? 'Errore' })
        return
      }
      const blob = await res.blob()
      const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? `export.${format}`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
      setResult({ ok: true, msg: `${filename} scaricato` })
    } catch { setResult({ ok: false, msg: 'Errore di rete' }) }
    finally { setExporting(false) }
  }, [source, format, from, to])

  const activeSrc = SOURCES.find(s => s.id === source)!

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Esporta</span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Esporta Dati</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Esporta dati job hunting e sistema in JSON o CSV</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Colonna sinistra — selezione */}
        <div className="space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Sorgente dati</p>
            <div className="space-y-3">
              {['Job Hunting', 'Sistema'].map(group => (
                <div key={group}>
                  <p className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] mb-1">{group.toUpperCase()}</p>
                  <div className="space-y-1">
                    {SOURCES.filter(s => s.group === group).map(s => (
                      <button key={s.id} onClick={() => setSource(s.id)}
                        className="w-full text-left px-3 py-2 rounded-lg transition-all cursor-pointer"
                        style={{ border: `1px solid ${source === s.id ? s.color : 'var(--color-border)'}`, background: source === s.id ? `${s.color}0d` : 'transparent' }}>
                        <p className="text-[11px] font-semibold" style={{ color: source === s.id ? s.color : 'var(--color-muted)' }}>{s.label}</p>
                        <p className="text-[8px] text-[var(--color-dim)]">{s.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Formato</p>
            <div className="flex gap-2">
              {(['json', 'csv'] as const).map(f => (
                <button key={f} onClick={() => setFormat(f)}
                  className="flex-1 px-3 py-2 rounded text-[11px] font-semibold uppercase cursor-pointer transition-all"
                  style={{ border: `1px solid ${format === f ? 'var(--color-green)' : 'var(--color-border)'}`, color: format === f ? 'var(--color-green)' : 'var(--color-dim)', background: format === f ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Periodo</p>
            <div className="flex gap-2 items-center">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="flex-1 text-[11px] px-3 py-2 rounded border bg-transparent font-mono"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} />
              <span className="text-[9px] text-[var(--color-dim)]">→</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="flex-1 text-[11px] px-3 py-2 rounded border bg-transparent font-mono"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} />
            </div>
            <div className="flex gap-1 mt-2">
              {[{ l: '7g', d: 7 }, { l: '30g', d: 30 }, { l: '90g', d: 90 }, { l: 'Tutto', d: 3650 }].map(p => (
                <button key={p.l} onClick={() => { setFrom(daysAgo(p.d)); setTo(today()) }}
                  className="px-2 py-1 rounded text-[9px] cursor-pointer transition-colors"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-dim)', background: 'transparent' }}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Colonna destra — anteprima e azione */}
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Riepilogo export</p>
            <div className="space-y-2">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">Sorgente</span>
                <span className="font-semibold" style={{ color: activeSrc.color }}>{activeSrc.label}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">Formato</span>
                <span className="text-[var(--color-muted)] font-mono uppercase">{format}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--color-dim)]">Periodo</span>
                <span className="text-[var(--color-muted)] font-mono">{from} → {to}</span>
              </div>
            </div>
            <button onClick={doExport} disabled={exporting}
              className="w-full mt-5 px-4 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
              style={{ background: exporting ? 'var(--color-border)' : 'var(--color-green)', color: exporting ? 'var(--color-dim)' : '#000', border: 'none' }}>
              {exporting ? 'Esportazione…' : 'Esporta'}
            </button>
          </div>

          {result && (
            <div className="rounded-lg border p-3 text-[11px]"
              style={{ borderColor: result.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,96,0.3)', color: result.ok ? 'var(--color-green)' : 'var(--color-red)', background: result.ok ? 'rgba(0,232,122,0.05)' : 'rgba(255,69,96,0.05)' }}>
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
