'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Category = 'applications' | 'networking' | 'skills' | 'streak' | 'profile'
type Achievement = { id: string; title: string; description: string; icon: string; category: Category; current: number; target: number; unlocked: boolean; unlockedAt?: number }
type CatInfo = { total: number; unlocked: number; label: string }

const CAT_CFG: Record<Category, { label: string; color: string }> = {
  applications: { label: 'Candidature', color: '#61affe' }, networking: { label: 'Networking', color: 'var(--color-green)' },
  skills: { label: 'Competenze', color: 'var(--color-yellow)' }, streak: { label: 'Costanza', color: 'var(--color-red)' },
  profile: { label: 'Profilo', color: '#9b59b6' },
}

function ProgressBar({ current, target, color }: { current: number; target: number; color: string }) {
  const pct = Math.min(100, Math.round((current / target) * 100))
  return (
    <div className="w-full h-1.5 rounded-full mt-2" style={{ background: 'var(--color-border)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [byCategory, setByCategory] = useState<Record<string, CatInfo>>({})
  const [unlocked, setUnlocked] = useState(0)
  const [total, setTotal] = useState(0)
  const [filterCat, setFilterCat] = useState<string>('all')

  const fetchData = useCallback(async () => {
    const p = new URLSearchParams()
    if (filterCat !== 'all') p.set('category', filterCat)
    const res = await fetch(`/api/achievements?${p}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setAchievements(data.achievements ?? []); setByCategory(data.byCategory ?? {})
    setUnlocked(data.unlocked ?? 0); setTotal(data.total ?? 0)
  }, [filterCat])

  useEffect(() => { fetchData() }, [fetchData])

  const fmtDate = (ts?: number) => ts ? new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : ''
  const CATEGORIES: Category[] = ['applications', 'networking', 'skills', 'streak', 'profile']

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Achievement</span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Achievement</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{unlocked}/{total} sbloccati</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {CATEGORIES.map(c => {
          const info = byCategory[c]
          if (!info) return null
          const pct = info.total > 0 ? Math.round((info.unlocked / info.total) * 100) : 0
          return (
            <div key={c} className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: CAT_CFG[c].color }}>{CAT_CFG[c].label}</p>
              <p className="text-lg font-bold text-[var(--color-bright)] mt-1">{info.unlocked}/{info.total}</p>
              <div className="w-full h-1 rounded-full mt-1.5" style={{ background: 'var(--color-border)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CAT_CFG[c].color }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex gap-1 mb-4">
        <button onClick={() => setFilterCat('all')} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
          style={{ background: filterCat === 'all' ? 'var(--color-row)' : 'transparent', color: filterCat === 'all' ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filterCat === 'all' ? 'var(--color-border-glow)' : 'transparent'}` }}>tutti</button>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setFilterCat(c)} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: filterCat === c ? 'var(--color-row)' : 'transparent', color: filterCat === c ? CAT_CFG[c].color : 'var(--color-dim)', border: `1px solid ${filterCat === c ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {CAT_CFG[c].label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {achievements.length === 0 ? (
          <div className="md:col-span-2 border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] py-16 text-center">
            <p className="text-[var(--color-dim)] text-[12px]">Nessun achievement trovato.</p>
          </div>
        ) : achievements.map(a => {
          const cat = CAT_CFG[a.category]
          const pct = Math.min(100, Math.round((a.current / a.target) * 100))
          return (
            <div key={a.id} className="flex items-start gap-3 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] transition-colors hover:bg-[var(--color-row)]"
              style={{ opacity: a.unlocked ? 1 : 0.5 }}>
              <span className="text-2xl flex-shrink-0">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-semibold text-[var(--color-bright)]">{a.title}</span>
                  {a.unlocked && <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--color-green)', border: '1px solid var(--color-border)' }}>sbloccato</span>}
                </div>
                <p className="text-[10px] text-[var(--color-dim)] mt-0.5">{a.description}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                    style={{ color: cat.color, border: '1px solid var(--color-border)' }}>{cat.label}</span>
                  <span className="text-[9px] text-[var(--color-muted)]">{a.current}/{a.target} ({pct}%)</span>
                  {a.unlocked && a.unlockedAt && <span className="text-[9px] text-[var(--color-dim)]">{fmtDate(a.unlockedAt)}</span>}
                </div>
                <ProgressBar current={a.current} target={a.target} color={a.unlocked ? 'var(--color-green)' : cat.color} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
