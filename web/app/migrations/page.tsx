'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type PendingMig = { version: string; description: string }
type AppliedMig = { version: string; description: string; appliedAt: number }
type MigResult = { version: string; description: string; success: boolean; error?: string }

function VersionBadge({ v, color }: { v: string; color: string }) {
  return <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded" style={{ color, border: `1px solid ${color}40` }}>{v}</span>
}

function MigRow({ version, description, status, date }: { version: string; description: string; status: 'applied' | 'pending'; date?: number }) {
  const isApplied = status === 'applied'
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <VersionBadge v={version} color={isApplied ? 'var(--color-green)' : 'var(--color-yellow)'} />
      <span className="flex-1 text-[11px] text-[var(--color-muted)]">{description}</span>
      <span className="badge text-[9px]" style={{
        color: isApplied ? 'var(--color-green)' : 'var(--color-yellow)',
        background: isApplied ? 'rgba(0,200,83,0.08)' : 'rgba(245,197,24,0.08)',
        border: `1px solid ${isApplied ? 'rgba(0,200,83,0.3)' : 'rgba(245,197,24,0.3)'}`,
      }}>{isApplied ? 'applicata' : 'pendente'}</span>
      {date && <span className="text-[10px] text-[var(--color-dim)]">{new Date(date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
  )
}

export default function MigrationsPage() {
  const [currentVersion, setCurrentVersion] = useState('0.0.0')
  const [applied, setApplied] = useState<AppliedMig[]>([])
  const [pending, setPending] = useState<PendingMig[]>([])
  const [total, setTotal] = useState(0)
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const fetchState = useCallback(async () => {
    const res = await fetch('/api/migrations').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setCurrentVersion(data.currentVersion ?? '0.0.0')
    setApplied(data.applied ?? [])
    setPending(data.pending ?? [])
    setTotal(data.totalRegistered ?? 0)
  }, [])

  useEffect(() => { fetchState() }, [fetchState])

  const runMigrations = async () => {
    setRunning(true); setMsg(null)
    const res = await fetch('/api/migrations', { method: 'POST' }).catch(() => null)
    setRunning(false)
    if (!res) { setMsg({ text: 'Errore di rete', ok: false }); return }
    const data = await res.json()
    if (data.ok) {
      const count = (data.applied as MigResult[]).filter(a => a.success).length
      setMsg({ text: `${count} migrazion${count === 1 ? 'e' : 'i'} applicat${count === 1 ? 'a' : 'e'} (${data.from} → ${data.to})`, ok: true })
    } else {
      const failed = (data.applied as MigResult[]).find(a => !a.success)
      setMsg({ text: `Errore in ${failed?.version}: ${failed?.error || 'sconosciuto'}${data.rolledBack ? ' — rollback eseguito' : ''}`, ok: false })
    }
    fetchState()
  }

  const rollback = async (targetVersion: string) => {
    if (!confirm(`Rollback a versione ${targetVersion}? Le migrazioni successive verranno revertite.`)) return
    setRunning(true); setMsg(null)
    const res = await fetch(`/api/migrations?target=${targetVersion}`, { method: 'PATCH' }).catch(() => null)
    setRunning(false)
    if (!res) { setMsg({ text: 'Errore di rete', ok: false }); return }
    const data = await res.json()
    if (data.ok) {
      setMsg({ text: `Rollback completato a ${targetVersion}`, ok: true })
    } else {
      setMsg({ text: data.error || 'Errore rollback', ok: false })
    }
    fetchState()
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Migrazioni</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Migrazioni</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Versione corrente: <span className="font-mono font-bold text-[var(--color-bright)]">{currentVersion}</span> · {applied.length}/{total} applicate · {pending.length} pendenti
            </p>
          </div>
          <div className="flex gap-2">
            {applied.length > 0 && (
              <button onClick={() => rollback('0.0.0')} disabled={running}
                className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer disabled:opacity-50"
                style={{ color: 'var(--color-red)', border: '1px solid rgba(255,69,96,0.3)' }}>
                rollback tutto
              </button>
            )}
            {pending.length > 0 && (
              <button onClick={runMigrations} disabled={running}
                className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wide transition-all cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--color-green)', color: '#000' }}>
                {running ? 'esecuzione...' : `esegui ${pending.length} migrazion${pending.length === 1 ? 'e' : 'i'}`}
              </button>
            )}
          </div>
        </div>
        {msg && (
          <div className="mt-3 px-4 py-2 rounded text-[11px] font-semibold"
            style={{ background: msg.ok ? 'rgba(0,200,83,0.08)' : 'rgba(255,69,96,0.08)', color: msg.ok ? 'var(--color-green)' : 'var(--color-red)', border: `1px solid ${msg.ok ? 'rgba(0,200,83,0.3)' : 'rgba(255,69,96,0.3)'}` }}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {pending.length === 0 && applied.length === 0
          ? <div className="flex flex-col items-center py-16 text-center">
              <p className="text-[var(--color-dim)] text-[12px]">Nessuna migrazione registrata.</p>
              <p className="text-[var(--color-dim)] text-[10px] mt-1">Le migrazioni appariranno qui quando il database viene aggiornato.</p>
            </div>
          : <>
              {pending.map(m => <MigRow key={m.version} version={m.version} description={m.description} status="pending" />)}
              {applied.map(m => <MigRow key={m.version} version={m.version} description={m.description} status="applied" date={m.appliedAt} />)}
            </>
        }
      </div>
    </div>
  )
}
