'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Section = { name: string; filled: boolean; items: number }
type Profile = { id: string; name: string; role: string; completeness: number; sections: Section[]; updatedAt: number; source: string }

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${m}m fa`; if (m < 1440) return `${Math.floor(m / 60)}h fa`; return `${Math.floor(m / 1440)}g fa`;
}

function CompletenessBar({ pct }: { pct: number }) {
  const clr = pct >= 80 ? 'var(--color-green)' : pct >= 50 ? 'var(--color-yellow)' : 'var(--color-red)';
  return (
    <div className="flex items-center gap-2 w-32">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: clr }} />
      </div>
      <span className="text-[9px] font-mono w-8 text-right" style={{ color: clr }}>{pct}%</span>
    </div>
  )
}

function SectionBadge({ s }: { s: Section }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded mr-1 mb-1"
      style={{ color: s.filled ? 'var(--color-green)' : 'var(--color-dim)', background: s.filled ? 'rgba(0,200,83,0.08)' : 'transparent', border: `1px solid ${s.filled ? 'var(--color-green)' : 'var(--color-border)'}40` }}>
      {s.filled ? '✓' : '○'} {s.name}{s.items > 0 ? ` (${s.items})` : ''}
    </span>
  )
}

function ProfileCard({ p, expanded, onToggle }: { p: Profile; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[var(--color-border)]">
      <div role="button" tabIndex={0} aria-expanded={expanded} className="flex items-center gap-3 px-5 py-3 hover:bg-[var(--color-row)] transition-colors cursor-pointer" onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: 'var(--color-row)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>
          {p.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-[var(--color-bright)] font-medium">{p.name}</p>
          <p className="text-[9px] text-[var(--color-dim)]">{p.role}</p>
        </div>
        <CompletenessBar pct={p.completeness} />
        <span className="text-[9px] text-[var(--color-dim)] w-16 text-right">{timeAgo(p.updatedAt)}</span>
      </div>
      {expanded && (
        <div className="px-5 pb-3 pl-16">
          <p className="text-[9px] text-[var(--color-dim)] mb-2">Sezioni profilo:</p>
          <div className="flex flex-wrap">{p.sections.map(s => <SectionBadge key={s.name} s={s} />)}</div>
          <p className="text-[9px] text-[var(--color-dim)] mt-2">Source: <span className="font-mono">{p.source}</span></p>
        </div>
      )}
    </div>
  )
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [total, setTotal] = useState(0)
  const [avgCompleteness, setAvgCompleteness] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/profiles').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setProfiles(data.profiles ?? []); setTotal(data.total ?? 0); setAvgCompleteness(data.avgCompleteness ?? 0);
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Profili</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Profili Candidato</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{total} profili · {avgCompleteness}% completezza media</p>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="w-8" /><span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">PROFILO</span>
          <span className="w-32 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">COMPLETEZZA</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">AGGIORNATO</span>
        </div>
        {profiles.length === 0
          ? <div className="py-12 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessun profilo trovato.</p></div>
          : profiles.map(p => <ProfileCard key={p.id} p={p} expanded={expandedId === p.id} onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)} />)}
      </div>
    </div>
  )
}
