'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import TeamOrgChart from '../_components/TeamOrgChart'

type AgentStatus = 'running' | 'stopped' | 'pending'

const COLORS: Record<string, string> = {
  capitano: '#ff9100',
  sentinella: '#9c27b0',
}

type ArrowPath = { id: string; d: string }

export default function TeamV2Company() {
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({
    capitano: 'stopped',
    sentinella: 'stopped',
    assistente: 'stopped',
  })

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (!res.ok) return
      const data = await res.json()
      if (!Array.isArray(data?.agents)) return
      const next: Record<string, AgentStatus> = { capitano: 'stopped', sentinella: 'stopped', assistente: 'stopped' }
      for (const a of data.agents as { id: string; status: string }[]) {
        if (a.id === 'capitano' || a.id === 'sentinella' || a.id === 'assistente') {
          next[a.id] = (a.status as AgentStatus) ?? 'stopped'
        }
      }
      setStatuses(next)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 5000)
    return () => clearInterval(t)
  }, [fetchStatus])

  // Frecce extra v2 (User → Assistant/Maestro, Sentinel/Captain → Doctor).
  // Stesso pattern di TeamOrgChart: ref sui nodi, ResizeObserver, paths SVG
  // posizionati in absolute sul container.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const userRef = useRef<HTMLSpanElement | null>(null)
  const assistantRef = useRef<HTMLSpanElement | null>(null)
  const maestroRef = useRef<HTMLSpanElement | null>(null)
  const doctorRef = useRef<HTMLSpanElement | null>(null)
  const [overlay, setOverlay] = useState<{ width: number; height: number; paths: ArrowPath[] }>({
    width: 0, height: 0, paths: [],
  })

  useEffect(() => {
    let frame = 0

    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const flow = containerRef.current
        if (!flow) return
        const flowRect = flow.getBoundingClientRect()
        const sentinelEl = flow.querySelector<HTMLElement>('[data-team-node="sentinel"]')
        const captainEl = flow.querySelector<HTMLElement>('[data-team-node="captain"]')

        const paths: ArrowPath[] = []

        const drawDown = (id: string, src: HTMLElement | null, dst: HTMLElement | null) => {
          if (!src || !dst) return
          const s = src.getBoundingClientRect()
          const d = dst.getBoundingClientRect()
          const sX = s.left + s.width / 2 - flowRect.left
          const sY = s.bottom - flowRect.top + 6
          const eX = d.left + d.width / 2 - flowRect.left
          const eY = d.top - flowRect.top - 6
          paths.push({ id, d: `M ${sX} ${sY} L ${eX} ${eY}` })
        }

        drawDown('user-to-assistant', userRef.current, assistantRef.current)
        drawDown('user-to-maestro', userRef.current, maestroRef.current)
        drawDown('sentinel-to-doctor', sentinelEl, doctorRef.current)
        drawDown('captain-to-doctor', captainEl, doctorRef.current)

        setOverlay(prev => {
          const width = Math.round(flowRect.width)
          const height = Math.round(flowRect.height)
          const same = prev.width === width
            && prev.height === height
            && prev.paths.length === paths.length
            && prev.paths.every((p, i) => p.id === paths[i].id && p.d === paths[i].d)
          if (same) return prev
          return { width, height, paths }
        })
      })
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    if (userRef.current) ro.observe(userRef.current)
    if (assistantRef.current) ro.observe(assistantRef.current)
    if (maestroRef.current) ro.observe(maestroRef.current)
    if (doctorRef.current) ro.observe(doctorRef.current)
    // I nodi top-row vivono dentro TeamOrgChart: osserviamo via querySelector
    // (potrebbero non essere nel DOM al primo render).
    const sentinel = containerRef.current?.querySelector<HTMLElement>('[data-team-node="sentinel"]')
    const captain = containerRef.current?.querySelector<HTMLElement>('[data-team-node="captain"]')
    if (sentinel) ro.observe(sentinel)
    if (captain) ro.observe(captain)
    window.addEventListener('resize', measure)

    // Re-measure dopo qualche frame per catturare i ref dei nodi figli che
    // arrivano dopo il primo paint (TeamOrgChart si misura asincrono).
    const retries = [50, 200, 600].map(ms => setTimeout(measure, ms))

    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', measure)
      retries.forEach(clearTimeout)
    }
  }, [])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <Link href="/team" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Team</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">v2</span>
        </nav>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Job Hunter Team — v2</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Work in progress.</p>
          </div>
          <Link
            href="/team"
            className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--color-muted)',
              border: '1px dashed var(--color-border)',
              fontFamily: 'inherit',
            }}
            title="Torna alla pagina Team v1"
          >
            ← v1
          </Link>
        </div>
      </div>

      <section className="py-10">
        <div ref={containerRef} className="relative mx-auto w-full max-w-[1080px]">
          {/* SVG overlay v2: User→Assistant, User→Maestro, Sentinel/Captain→Doctor.
              Stile copiato dalle frecce di TeamOrgChart per coerenza visiva. */}
          {overlay.width > 0 && overlay.paths.length > 0 && (
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${overlay.width} ${overlay.height}`}
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <defs>
                <marker
                  id="team-v2-arrowhead"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  markerUnits="userSpaceOnUse"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0 L10 5 L0 10 Z" fill="rgba(255,255,255,0.42)" />
                </marker>
              </defs>
              {overlay.paths.map(p => (
                <path
                  key={p.id}
                  id={p.id}
                  d={p.d}
                  fill="none"
                  stroke="rgba(255,255,255,0.28)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  markerEnd="url(#team-v2-arrowhead)"
                  strokeDasharray="4 8"
                />
              ))}
            </svg>
          )}

          {/* Riga User: User centrato (col-3 su 5), Assistant col-2, Maestro col-4. */}
          <div className="grid grid-cols-5 justify-items-center items-end mb-12">
            <div />
            <div className="inline-flex flex-col items-center gap-2">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">
                <span ref={assistantRef}>🤖</span>
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">Assistant</span>
            </div>
            <div className="inline-flex flex-col items-center gap-2">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">
                <span ref={userRef}>👤</span>
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">User</span>
            </div>
            <div className="inline-flex flex-col items-center gap-2">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">
                <span ref={maestroRef}>🧙‍♂️</span>
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">Maestro</span>
            </div>
            <div />
          </div>

          {/* Spazio verticale per le frecce User → Assistant/Maestro:
              i nodi User sono allineati al fondo (items-end) e i target
              della riga seguente partono dalla cima del top-row del
              TeamOrgChart, quindi le frecce attraversano questo gap. */}

          <TeamOrgChart
            topRowOnly
            agents={{
              capitano:   { status: statuses.capitano   ?? 'stopped', color: COLORS.capitano,   role: 'Capitano',   link: '/team/capitano' },
              sentinella: { status: statuses.sentinella ?? 'stopped', color: COLORS.sentinella, role: 'Sentinella', link: '/team/sentinella' },
            }}
          />

          {/* Riga Doctor: centrato fra Sentinel (col-2) e Captain (col-3) del
              TeamOrgChart top row. Lo posizioniamo nella col-3 di un grid 5
              col come compromesso (sotto Captain, freccia da Sentinel). */}
          <div className="grid grid-cols-5 justify-items-center items-start mt-16">
            <div />
            <div />
            <div className="inline-flex flex-col items-center gap-2">
              <span className="text-2xl md:text-3xl leading-none" aria-hidden="true">
                <span ref={doctorRef}>🩺</span>
              </span>
              <span className="text-[12px] md:text-[13px] font-semibold tracking-wide text-[var(--color-bright)]">Doctor</span>
            </div>
            <div />
            <div />
          </div>
        </div>
      </section>
    </div>
  )
}
