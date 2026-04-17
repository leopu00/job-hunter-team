'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { CronJob, CronListResponse } from './types'
import { CronJobRow } from './CronJobRow'
import { CronForm }   from './CronForm'

export default function CronPage() {
  const [jobs,       setJobs]      = useState<CronJob[]>([])
  const [loading,    setLoading]   = useState(true)
  const [showForm,   setShowForm]  = useState(false)
  const [error,      setError]     = useState<string>()

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/cron')
      const data = await res.json() as CronListResponse
      setJobs(data.jobs ?? [])
    } catch { setError('Errore caricamento') }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  // Polling ogni 8s
  useEffect(() => { const t = setInterval(load, 8_000); return () => clearInterval(t) }, [load])

  const handleToggle = async (id: string, enabled: boolean) => {
    setJobs(js => js.map(j => j.id === id ? { ...j, enabled } : j))
    try {
      await fetch(`/api/cron/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
      load()
    } catch { load() }
  }

  const handleDelete = async (id: string) => {
    setJobs(js => js.filter(j => j.id !== id))
    try { await fetch(`/api/cron/${id}`, { method: 'DELETE' }) } catch { load() }
  }

  const active   = jobs.filter(j => j.enabled).length
  const inactive = jobs.filter(j => !j.enabled).length

  return (
    <main className="min-h-screen px-5 py-8" style={{ position: 'relative', zIndex: 1 }}>
      <div className="max-w-2xl mx-auto" style={{ animation: 'fade-in 0.4s ease both' }}>

        {/* Header */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-3">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Cron Jobs</span>
        </nav>
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--color-white)' }}>Cron Jobs</h1>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
              {loading ? 'Caricamento…' : `${active} attivi · ${inactive} in pausa`}
            </p>
          </div>
          <button onClick={() => setShowForm(s => !s)}
            className="px-4 py-2 rounded text-[12px] font-bold cursor-pointer transition-all"
            style={showForm
              ? { background: 'var(--color-card)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }
              : { background: 'var(--color-green)', color: '#000' }}>
            {showForm ? 'Annulla' : '+ Nuovo job'}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded border text-[11px]"
            style={{ borderColor: 'var(--color-red)', color: 'var(--color-red)', background: 'rgba(255,69,96,0.06)' }}>
            {error}
          </div>
        )}

        {/* Form nuovo job */}
        {showForm && (
          <div className="mb-6 border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden"
            style={{ animation: 'fade-in 0.2s ease both' }}>
            <div className="px-6 py-4 border-b border-[var(--color-border)]">
              <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-bright)' }}>Nuovo job</p>
            </div>
            <CronForm onCreated={() => { setShowForm(false); load() }} onCancel={() => setShowForm(false)} />
          </div>
        )}

        {/* Lista job */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: 'var(--color-bright)' }}>Job attivi</p>
            <p className="text-[10px]" style={{ color: 'var(--color-dim)' }}>aggiornamento ogni 8s</p>
          </div>
          {loading ? (
            <div className="px-6 py-8 text-center text-[11px]" style={{ color: 'var(--color-dim)' }} role="status" aria-live="polite">Caricamento…</div>
          ) : jobs.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-[12px]" style={{ color: 'var(--color-muted)' }}>Nessun job configurato.</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-dim)' }}>Usa &quot;+ Nuovo job&quot; per crearne uno.</p>
            </div>
          ) : (
            jobs.map(job => (
              <CronJobRow key={job.id} job={job} onToggle={handleToggle} onDelete={handleDelete} />
            ))
          )}
        </div>

        <p className="mt-6 text-center text-[9px]" style={{ color: 'var(--color-dim)' }}>
          v0.1.0-alpha · Job Hunter Team
        </p>
      </div>
    </main>
  )
}
