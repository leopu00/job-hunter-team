'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback } from 'react'

type Status = { active: boolean; output: string }

export default function CapitanoPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [starting, setStarting] = useState(false)
  const [startMsg, setStartMsg] = useState<string | null>(null)
  const termRef = useRef<HTMLDivElement>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/capitano/status')
      const data: Status = await res.json()
      setStatus(data)
    } catch {
      setStatus({ active: false, output: '' })
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [fetchStatus])

  // Scroll terminale in fondo quando cambia l'output
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight
    }
  }, [status?.output])

  const handleStart = async () => {
    setStarting(true)
    setStartMsg(null)
    try {
      const res = await fetch('/api/capitano/start', { method: 'POST' })
      const data = await res.json()
      setStartMsg(data.message ?? (data.ok ? 'Avviato' : data.error))
      await fetchStatus()
    } catch {
      setStartMsg('Errore di rete')
    } finally {
      setStarting(false)
    }
  }

  const isActive = status?.active ?? false

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Dashboard
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <Link href="/team" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">
            Team
          </Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Capitano</span>
        </div>

        <div className="mt-4 flex items-start gap-5">
          <div className="text-5xl leading-none select-none">👨‍✈️</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Capitano</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">
              Orchestra tutta la pipeline Job Hunter
            </p>
          </div>
        </div>
      </div>

      {/* Stato + Bottone avvio */}
      <div className="flex items-center gap-4 mb-8">

        {/* Badge stato */}
        <div className="flex items-center gap-2 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg px-4 py-2.5">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: status == null
                ? 'var(--color-dim)'
                : isActive
                ? '#ff9100'
                : 'var(--color-dim)',
              animation: isActive ? 'pulse-dot 2s ease-in-out infinite' : undefined,
            }}
          />
          <span
            className="text-[11px] font-semibold tracking-widest uppercase"
            style={{ color: status == null ? 'var(--color-dim)' : isActive ? '#ff9100' : 'var(--color-dim)' }}
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
              background: starting || status == null ? 'var(--color-border)' : '#ff9100',
              color: starting || status == null ? 'var(--color-dim)' : '#000',
              cursor: starting || status == null ? 'not-allowed' : 'pointer',
              opacity: starting ? 0.7 : 1,
            }}
          >
            {starting ? 'Avvio in corso…' : 'Avvia Capitano'}
          </button>
        )}

        {/* Bottone Ferma */}
        {isActive && (
          <button
            onClick={async () => {
              await fetch('/api/capitano/stop', { method: 'POST' })
              await fetchStatus()
            }}
            className="px-5 py-2.5 rounded-lg text-[12px] font-bold tracking-wide transition-all border border-[var(--color-red)] hover:bg-[var(--color-red)] hover:text-[#000]"
            style={{ color: 'var(--color-red)', cursor: 'pointer' }}
          >
            Ferma
          </button>
        )}

        {startMsg && (
          <span className="text-[11px] text-[var(--color-muted)]">{startMsg}</span>
        )}
      </div>

      {/* Terminale live — visibile solo se attivo */}
      {isActive && (
        <div style={{ animation: 'fade-in 0.25s ease both' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="section-label">Output terminale</div>
            <span className="text-[9px] text-[var(--color-dim)] font-mono">
              aggiornamento ogni 5s · sessione ALFA
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
              borderColor: '#ff910030',
            }}
          >
            {status?.output
              ? status.output
              : <span style={{ color: 'var(--color-dim)' }}>nessun output…</span>
            }
          </div>
        </div>
      )}

      {/* Empty state — non attivo e nessun messaggio di avvio */}
      {!isActive && status != null && !startMsg && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4 opacity-30">👨‍✈️</div>
          <p className="text-[var(--color-muted)] text-[13px]">Il Capitano non è attivo.</p>
          <p className="text-[var(--color-dim)] text-[11px] mt-1">
            Premi <span style={{ color: '#ff9100' }}>Avvia Capitano</span> per avviare la sessione.
          </p>
        </div>
      )}

    </div>
  )
}
