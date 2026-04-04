'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type VersionType    = 'major' | 'minor' | 'patch'
type ChangeCategory = { name: string; entries: string[] }
type Release        = { version: string; date: string; type: VersionType; categories: ChangeCategory[]; totalEntries: number }
type ChangelogRes   = { releases: Release[]; total: number }

const TYPE_CFG: Record<VersionType, { label: string; color: string }> = {
  major: { label: 'major', color: 'var(--color-red)'    },
  minor: { label: 'minor', color: 'var(--color-yellow)' },
  patch: { label: 'patch', color: 'var(--color-green)'  },
}

const CAT_ICON: Record<string, string> = {
  'Pipeline multi-agente': '🤖', 'CLI `jht`': '💻', 'TUI (Terminal UI)': '🖥️',
  'Web Dashboard (50+ pagine)': '🌐', 'Shared modules': '📦',
  'Testing': '🧪', 'CI/CD': '🔧',
}

function catIcon(name: string): string {
  return CAT_ICON[name] ?? (
    /test|vitest/i.test(name) ? '🧪' :
    /cli|command/i.test(name) ? '💻' :
    /web|dashboard|pagina/i.test(name) ? '🌐' :
    /fix|bug/i.test(name) ? '🐛' :
    /feat|feature/i.test(name) ? '✨' :
    /security|sicurezza/i.test(name) ? '🔒' :
    /deploy|ci|cd/i.test(name) ? '🔧' : '📋'
  )
}

export default function ChangelogPage() {
  const [data, setData]         = useState<ChangelogRes | null>(null)
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter]     = useState<'all' | VersionType>('all')

  useEffect(() => {
    fetch('/api/changelog')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setData(d)
          // Espandi la prima release di default
          if (d.releases?.[0]) setExpanded(new Set([d.releases[0].version]))
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleExpand = (v: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })

  const filtered = data?.releases.filter(r => filter === 'all' || r.type === filter) ?? []

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Changelog</span>
        </div>
        <div className="mt-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Changelog</h1>
          {data && <p className="text-[var(--color-muted)] text-[11px] mt-1">{data.total} release · {data.releases.reduce((s, r) => s + r.totalEntries, 0)} modifiche totali</p>}
        </div>
        <div className="flex gap-1.5 mt-4">
          {(['all', 'major', 'minor', 'patch'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ border: `1px solid ${filter === f ? 'var(--color-green)' : 'var(--color-border)'}`, color: filter === f ? 'var(--color-green)' : 'var(--color-dim)', background: filter === f ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
              {f === 'all' ? 'tutte' : f}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <span className="text-4xl">📋</span>
          <p className="text-[12px] font-semibold text-[var(--color-muted)]">Nessuna release trovata</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex flex-col gap-3">
          {filtered.map(release => {
            const open = expanded.has(release.version)
            const cfg  = TYPE_CFG[release.type]
            return (
              <div key={release.version} className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
                <button onClick={() => toggleExpand(release.version)} className="w-full flex items-center gap-3 px-5 py-4 cursor-pointer text-left transition-colors hover:bg-[var(--color-row)]" style={{ background: 'transparent', border: 'none' }}>
                  <span className="text-xl font-bold text-[var(--color-bright)]">v{release.version}</span>
                  <span className="badge text-[9px] font-mono" style={{ color: cfg.color, border: `1px solid ${cfg.color}44`, background: `${cfg.color}0d` }}>{cfg.label}</span>
                  <span className="text-[10px] text-[var(--color-dim)]">{release.date}</span>
                  <span className="text-[9px] text-[var(--color-dim)]">· {release.totalEntries} modifiche</span>
                  <span className="ml-auto text-[var(--color-dim)] text-xs">{open ? '▲' : '▼'}</span>
                </button>
                {open && (
                  <div className="border-t border-[var(--color-border)] px-5 py-4 flex flex-col gap-4" style={{ animation: 'fade-in 0.15s ease both' }}>
                    {release.categories.map(cat => (
                      <div key={cat.name}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-sm">{catIcon(cat.name)}</span>
                          <span className="text-[10px] font-bold text-[var(--color-muted)]">{cat.name}</span>
                        </div>
                        <ul className="flex flex-col gap-1 pl-5">
                          {cat.entries.map((e, i) => (
                            <li key={i} className="text-[11px] text-[var(--color-dim)] list-disc">{e}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
