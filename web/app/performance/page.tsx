'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type CWV = { value: number; rating: 'good' | 'needs-improvement' | 'poor'; unit: string }
type PagePerf = { route: string; loadTimeMs: number; bundleKB: number; firstPaintMs: number }

const RATING_CLR: Record<string, string> = { good: 'var(--color-green)', 'needs-improvement': 'var(--color-yellow)', poor: 'var(--color-red)' }

function VitalCard({ name, metric }: { name: string; metric: CWV }) {
  const clr = RATING_CLR[metric.rating]
  return (
    <div className="flex flex-col p-4 rounded-lg" style={{ background: 'var(--color-row)', border: `1px solid ${clr}40` }}>
      <span className="text-[9px] font-bold tracking-widest text-[var(--color-dim)] uppercase">{name}</span>
      <span className="text-2xl font-bold font-mono mt-1" style={{ color: clr }}>{metric.value}<span className="text-[10px] text-[var(--color-dim)] ml-1">{metric.unit}</span></span>
      <span className="text-[9px] mt-1 font-semibold" style={{ color: clr }}>{metric.rating === 'good' ? 'buono' : metric.rating === 'needs-improvement' ? 'migliorabile' : 'scarso'}</span>
    </div>
  )
}

function LoadBar({ ms, max }: { ms: number; max: number }) {
  const pct = Math.min((ms / max) * 100, 100)
  const clr = ms < 150 ? 'var(--color-green)' : ms < 300 ? 'var(--color-yellow)' : 'var(--color-red)'
  return (
    <div className="flex items-center gap-2 w-32">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: clr }} />
      </div>
      <span className="text-[9px] font-mono w-10 text-right" style={{ color: clr }}>{ms}ms</span>
    </div>
  )
}

export default function PerformancePage() {
  const [cwv, setCwv] = useState<Record<string, CWV>>({})
  const [pages, setPages] = useState<PagePerf[]>([])
  const [totalBundle, setTotalBundle] = useState(0)
  const [avgLoad, setAvgLoad] = useState(0)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/performance').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setCwv(data.cwv ?? {})
    setPages(data.pages ?? [])
    setTotalBundle(data.totalBundleKB ?? 0)
    setAvgLoad(data.avgLoadMs ?? 0)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const maxLoad = Math.max(...pages.map(p => p.loadTimeMs), 300)
  const sorted = [...pages].sort((a, b) => b.loadTimeMs - a.loadTimeMs)

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Performance</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Performance</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{pages.length} pagine · {totalBundle} KB totali · {avgLoad}ms avg load</p>
      </div>

      {Object.keys(cwv).length > 0 && (
        <div className="grid grid-cols-5 gap-3 mb-8">
          {cwv.lcp && <VitalCard name="LCP" metric={cwv.lcp} />}
          {cwv.fid && <VitalCard name="FID" metric={cwv.fid} />}
          {cwv.cls && <VitalCard name="CLS" metric={cwv.cls} />}
          {cwv.ttfb && <VitalCard name="TTFB" metric={cwv.ttfb} />}
          {cwv.inp && <VitalCard name="INP" metric={cwv.inp} />}
        </div>
      )}

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">ROUTE</span>
          <span className="w-32 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">LOAD TIME</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">BUNDLE</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">FP</span>
        </div>
        {sorted.map(p => (
          <div key={p.route} className="flex items-center gap-4 px-5 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
            <span className="flex-1 text-[10px] font-mono text-[var(--color-muted)]">{p.route}</span>
            <LoadBar ms={p.loadTimeMs} max={maxLoad} />
            <span className="w-16 text-[10px] font-mono text-[var(--color-dim)] text-right">{p.bundleKB}KB</span>
            <span className="w-16 text-[10px] font-mono text-[var(--color-dim)] text-right">{p.firstPaintMs}ms</span>
          </div>
        ))}
      </div>
    </div>
  )
}
