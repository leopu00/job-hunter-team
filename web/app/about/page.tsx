'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type AboutData = {
  name: string; version: string; description: string; builtWith: string;
  stats: { sharedModules: number; webPages: number; apiRoutes: number; testFiles: number; cliCommands: number };
  modules: string[];
  stack: Record<string, string[]>;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center p-4 rounded-lg" style={{ background: 'var(--color-row)', border: '1px solid var(--color-border)' }}>
      <span className="text-2xl font-bold text-[var(--color-green)] font-mono">{value}</span>
      <span className="text-[10px] text-[var(--color-dim)] mt-1 text-center">{label}</span>
    </div>
  )
}

function StackSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase mb-2">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(item => (
          <span key={item} className="px-2.5 py-1 rounded text-[10px] font-mono"
            style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function AboutPage() {
  const [data, setData] = useState<AboutData | null>(null)

  const fetchAbout = useCallback(async () => {
    const res = await fetch('/api/about').catch(() => null)
    if (!res?.ok) return
    setData(await res.json())
  }, [])

  useEffect(() => { fetchAbout() }, [fetchAbout])

  if (!data) return <div className="flex items-center justify-center py-20"><p className="text-[var(--color-dim)] text-[12px]">Caricamento...</p></div>

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">About</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">{data.name}</h1>
          <p className="text-[var(--color-muted)] text-[11px] mt-1">{data.description}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.3)' }}>v{data.version}</span>
            <span className="text-[10px] text-[var(--color-dim)]">{data.builtWith}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-8">
        <StatCard label="Moduli Shared" value={data.stats.sharedModules} />
        <StatCard label="Pagine Web" value={data.stats.webPages} />
        <StatCard label="API Routes" value={data.stats.apiRoutes} />
        <StatCard label="File Test" value={data.stats.testFiles} />
        <StatCard label="Comandi CLI" value={data.stats.cliCommands} />
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-bold text-[var(--color-bright)] mb-4">Stack Tecnologico</h2>
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(data.stack).map(([k, v]) => <StackSection key={k} title={k} items={v} />)}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-bold text-[var(--color-bright)] mb-3">Moduli</h2>
        <div className="flex flex-wrap gap-1.5">
          {data.modules.map(m => (
            <span key={m} className="px-2 py-1 rounded text-[10px] font-mono"
              style={{ background: 'rgba(0,232,122,0.06)', color: 'var(--color-green)', border: '1px solid rgba(0,232,122,0.2)' }}>
              {m}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] pt-4">
        <p className="text-[10px] text-[var(--color-dim)] text-center">
          Job Hunter Team — Piattaforma multi-agente autonoma
        </p>
      </div>
    </div>
  )
}
