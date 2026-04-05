'use client'

import Link from 'next/link'
import { useState } from 'react'
import { SECTIONS, MODULES, CLI_COMMANDS, API_ROUTES } from './data'

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--color-green)', POST: 'var(--color-yellow)',
  PATCH: 'var(--color-orange)', DELETE: 'var(--color-red)',
}

function OverviewSection() {
  const stats = [
    { v: '40+', l: 'Pagine web' }, { v: '36', l: 'Moduli shared/' },
    { v: '27', l: 'Comandi CLI' }, { v: '24+', l: 'API routes' },
  ]
  const layers = [
    { name: 'Dashboard (Next.js)', desc: '40+ pagine React, API routes, componenti UI' },
    { name: 'CLI (Node.js)',        desc: '27 comandi jht, wizard setup, TUI interattiva' },
    { name: 'Agenti (tmux)',        desc: '8 agenti specializzati in sessioni JHT-*' },
    { name: 'Shared modules',       desc: '36 moduli TypeScript riusabili da CLI e web' },
    { name: 'Dati (~/.jht/)',       desc: 'JSON atomici, backup, migrations, secrets' },
  ]
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(s => (
          <div key={s.l} className="p-4 rounded-lg border flex flex-col gap-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
            <span className="text-xl font-bold text-[var(--color-green)]">{s.v}</span>
            <span className="text-[9px] text-[var(--color-dim)]">{s.l}</span>
          </div>
        ))}
      </div>
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)]">Stack</span>
        </div>
        {layers.map((l, i) => (
          <div key={l.name} className={`flex items-start gap-3 px-5 py-3 ${i < layers.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
            <span className="text-[11px] font-semibold text-[var(--color-bright)] w-44 flex-shrink-0">{l.name}</span>
            <span className="text-[10px] text-[var(--color-dim)]">{l.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModulesSection() {
  const groups = [...new Set(MODULES.map(m => m.group))]
  return (
    <div className="flex flex-col gap-5">
      {groups.map(g => (
        <div key={g}>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-dim)] mb-2">{g}</h3>
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
            {MODULES.filter(m => m.group === g).map((m, i, arr) => (
              <div key={m.id} className={`flex items-start gap-3 px-5 py-2.5 ${i < arr.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
                <span className="text-[10px] font-mono text-[var(--color-green)] w-28 flex-shrink-0">{m.id}</span>
                <span className="text-[10px] text-[var(--color-dim)]">{m.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function CliSection() {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
      {CLI_COMMANDS.map((c, i) => (
        <div key={c.cmd} className={`flex flex-col gap-0.5 px-5 py-2.5 ${i < CLI_COMMANDS.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-[var(--color-green)] flex-shrink-0">{c.cmd}</span>
            <span className="text-[10px] text-[var(--color-dim)]">{c.description}</span>
          </div>
          {c.example && <span className="text-[9px] font-mono text-[var(--color-border)] pl-0">$ {c.example}</span>}
        </div>
      ))}
    </div>
  )
}

function ApiSection() {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
      {API_ROUTES.map((r, i) => (
        <div key={`${r.method}-${r.path}`} className={`flex items-center gap-3 px-5 py-2.5 ${i < API_ROUTES.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}>
          <span className="text-[9px] font-mono font-bold w-12 flex-shrink-0" style={{ color: METHOD_COLOR[r.method] }}>{r.method}</span>
          <span className="text-[10px] font-mono text-[var(--color-muted)] w-48 flex-shrink-0 truncate">{r.path}</span>
          <span className="text-[10px] text-[var(--color-dim)]">{r.description}</span>
        </div>
      ))}
    </div>
  )
}

const CONTENT: Record<string, React.ReactNode> = {
  overview: <OverviewSection />,
  modules:  <ModulesSection />,
  cli:      <CliSection />,
  api:      <ApiSection />,
}

export default function DocsPage() {
  const [active, setActive] = useState('overview')

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Docs</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Documentazione</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Architettura, moduli, CLI e API del Job Hunter Team.</p>
        <div className="flex gap-1.5 flex-wrap mt-4" role="tablist" aria-label="Sezioni documentazione">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              role="tab" aria-selected={active === s.id} aria-controls={`docs-panel-${s.id}`} id={`docs-tab-${s.id}`}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ border: `1px solid ${active === s.id ? 'var(--color-green)' : 'var(--color-border)'}`, color: active === s.id ? 'var(--color-green)' : 'var(--color-dim)', background: active === s.id ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`docs-panel-${active}`} aria-labelledby={`docs-tab-${active}`} style={{ animation: 'fade-in 0.2s ease both' }} key={active}>
        {CONTENT[active]}
      </div>
    </div>
  )
}
