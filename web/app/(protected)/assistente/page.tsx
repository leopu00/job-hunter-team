'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'

type Status = { active: boolean; output: string }
type Check = { id: string; label: string; ok: boolean; detail?: string; hint?: string }

export default function AssistentePage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [checks, setChecks] = useState<Check[]>([])
  const [workspace, setWorkspace] = useState('')
  const [starting, setStarting] = useState(false)
  const [startMsg, setStartMsg] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const termRef = useRef<HTMLDivElement>(null)

  const hasWorkspace = workspace.trim().length > 0

  // Fetch stato agente
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/assistente/status')
      const data: Status = await res.json()
      setStatus(data)
    } catch {
      setStatus({ active: false, output: '' })
    }
  }, [])

  // Fetch check prerequisiti
  const fetchChecks = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/assistente/check')
      const data = await res.json()
      setChecks(data.checks ?? [])
      if (data.workspace) setWorkspace(data.workspace)
    } catch { /* ignore */ }
    setChecking(false)
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchChecks()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus, fetchChecks])

  // Scroll terminale in fondo
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight
    }
  }, [status?.output])

  // Apri file picker nativo
  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const res = await fetch('/api/assistente/browse', { method: 'POST' })
      const data = await res.json()
      if (data.ok && data.folder) {
        setWorkspace(data.folder)
      }
    } catch { /* ignore */ }
    setBrowsing(false)
  }

  const handleStart = async () => {
    setStarting(true)
    setStartMsg(null)
    try {
      const res = await fetch('/api/assistente/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      })
      const data = await res.json()
      setStartMsg(data.message ?? (data.ok ? 'Avviato' : data.error))
      await fetchStatus()
      setTimeout(fetchChecks, 2000)
    } catch {
      setStartMsg('Errore di rete')
    } finally {
      setStarting(false)
    }
  }

  const isActive = status?.active ?? false
  const okCount = checks.filter(c => c.ok).length
  const totalCount = checks.length

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Assistente</span>
        </div>

        <div className="mt-4 flex items-start gap-5">
          <div className="text-5xl leading-none select-none">🤖</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Assistente</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Ti aiuta a configurare il sistema e navigare la piattaforma
            </p>
          </div>
        </div>
      </div>

      {/* Step 1: Workspace — sempre visibile */}
      <div className="mb-8">
        <div className="section-label mb-3">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
            style={{ background: hasWorkspace ? 'var(--color-green)' : 'var(--color-border)', color: hasWorkspace ? '#000' : 'var(--color-dim)' }}>
            1
          </span>
          Seleziona cartella di lavoro
        </div>
        <p className="text-[10px] text-[var(--color-dim)] mb-3">
          Gli agenti lavoreranno in questa cartella. Il repo del framework resta intatto.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={handleBrowse}
            disabled={browsing}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all flex-shrink-0"
            style={{
              background: browsing ? 'var(--color-border)' : 'var(--color-green)',
              color: browsing ? 'var(--color-dim)' : '#000',
              cursor: browsing ? 'not-allowed' : 'pointer',
            }}
          >
            {browsing ? 'Seleziona…' : 'Seleziona cartella'}
          </button>

          {hasWorkspace && (
            <div className="flex items-center gap-2 px-3 py-2 rounded border font-mono text-[11px] min-w-0"
              style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-bright)' }}>
              <span className="truncate">{workspace}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tutto il resto — visibile solo con workspace selezionato */}
      {hasWorkspace && (
        <div style={{ animation: 'fade-in 0.25s ease both' }}>

          {/* Step 2: Checklist prerequisiti */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div className="section-label">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
                  style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  2
                </span>
                Prerequisiti
                {totalCount > 0 && (
                  <span className="ml-2 text-[10px]" style={{ color: okCount === totalCount ? 'var(--color-green)' : 'var(--color-yellow)' }}>
                    {okCount}/{totalCount}
                  </span>
                )}
              </div>
              <button
                onClick={fetchChecks}
                disabled={checking}
                className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-muted)] hover:text-[var(--color-green)] transition-colors cursor-pointer"
              >
                {checking ? 'verifica…' : 'verifica tutto'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {checks.map(c => (
                <div
                  key={c.id}
                  className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition-colors"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-card)' }}
                >
                  <div
                    className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                    style={{ background: c.ok ? 'var(--color-green)' : 'var(--color-red)' }}
                  />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[var(--color-bright)]">{c.label}</div>
                    {c.ok && c.detail && (
                      <div className="text-[10px] text-[var(--color-dim)] truncate">{c.detail}</div>
                    )}
                    {!c.ok && c.hint && (
                      <div className="text-[10px] text-[var(--color-red)]">{c.hint}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: Avvia assistente */}
          <div className="mb-8 pb-6 border-t border-[var(--color-border)] pt-6">
            <div className="section-label mb-3">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-2"
                style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                3
              </span>
              Assistente
            </div>

            <div className="flex items-center gap-4">
              {/* Badge stato */}
              <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: status == null
                      ? 'var(--color-dim)'
                      : isActive
                      ? 'var(--color-green)'
                      : 'var(--color-dim)',
                    animation: isActive ? 'pulse-dot 2s ease-in-out infinite' : undefined,
                  }}
                />
                <span
                  className="text-[11px] font-semibold tracking-widest uppercase"
                  style={{ color: status == null ? 'var(--color-dim)' : isActive ? 'var(--color-green)' : 'var(--color-dim)' }}
                >
                  {status == null ? 'connessione…' : isActive ? 'attivo' : 'inattivo'}
                </span>
              </div>

              {/* Bottone Avvia */}
              {!isActive && (
                <button
                  onClick={handleStart}
                  disabled={starting || status == null}
                  className="px-6 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all"
                  style={{
                    background: starting || status == null ? 'var(--color-border)' : 'var(--color-green)',
                    color: starting || status == null ? 'var(--color-dim)' : '#000',
                    cursor: starting || status == null ? 'not-allowed' : 'pointer',
                    opacity: starting ? 0.7 : 1,
                  }}
                >
                  {starting ? 'Avvio in corso…' : 'Avvia Assistente'}
                </button>
              )}

              {startMsg && (
                <span className="text-[11px] text-[var(--color-muted)]">{startMsg}</span>
              )}
            </div>
          </div>

          {/* Terminale live */}
          {isActive && (
            <div style={{ animation: 'fade-in 0.25s ease both' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="section-label">Output terminale</div>
                <span className="text-[9px] text-[var(--color-dim)] font-mono">
                  aggiornamento ogni 5s · sessione ASSISTENTE
                </span>
              </div>

              <div
                ref={termRef}
                className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4 font-mono text-[11px] leading-relaxed overflow-auto"
                style={{
                  height: '60vh',
                  background: '#0d1117',
                  color: 'var(--color-base)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  borderColor: 'var(--color-green)30',
                }}
              >
                {status?.output
                  ? status.output
                  : <span style={{ color: 'var(--color-dim)' }}>nessun output…</span>
                }
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isActive && status != null && !startMsg && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-4 opacity-30">🤖</div>
              <p className="text-[var(--color-muted)] text-[13px]">L&apos;Assistente non è attivo.</p>
              <p className="text-[var(--color-dim)] text-[11px] mt-1">
                Premi <span style={{ color: 'var(--color-green)' }}>Avvia Assistente</span> per iniziare la configurazione guidata.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state senza workspace */}
      {!hasWorkspace && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4 opacity-30">📁</div>
          <p className="text-[var(--color-muted)] text-[13px]">Seleziona una cartella di lavoro per iniziare.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">
            Gli agenti lavoreranno in sottocartelle separate dentro la cartella scelta.
          </p>
        </div>
      )}
    </div>
  )
}
