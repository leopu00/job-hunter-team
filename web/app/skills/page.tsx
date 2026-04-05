'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Level = 'beginner' | 'intermediate' | 'advanced' | 'expert'
type Category = 'frontend' | 'backend' | 'devops' | 'soft-skills' | 'languages'
type Skill = { id: string; name: string; level: Level; category: Category; endorsements: number }
type RadarPoint = { name: string; score: number }

const LEVEL_CFG: Record<Level, { label: string; color: string }> = {
  beginner: { label: 'Base', color: 'var(--color-dim)' }, intermediate: { label: 'Intermedio', color: '#61affe' },
  advanced: { label: 'Avanzato', color: 'var(--color-yellow)' }, expert: { label: 'Esperto', color: 'var(--color-green)' },
}
const CAT_CFG: Record<Category, { label: string; color: string }> = {
  frontend: { label: 'Frontend', color: '#61affe' }, backend: { label: 'Backend', color: 'var(--color-green)' },
  devops: { label: 'DevOps', color: 'var(--color-yellow)' }, 'soft-skills': { label: 'Soft Skills', color: '#9b59b6' },
  languages: { label: 'Lingue', color: 'var(--color-red)' },
}
const CATEGORIES: Category[] = ['frontend', 'backend', 'devops', 'soft-skills', 'languages']
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced', 'expert']

function RadarChart({ points }: { points: RadarPoint[] }) {
  if (points.length < 3) return null
  const CX = 100, CY = 100, R = 80, n = points.length
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const gridLevels = [25, 50, 75, 100]
  const dataPath = points.map((p, i) => {
    const r = (p.score / 100) * R
    return `${i === 0 ? 'M' : 'L'}${CX + r * Math.cos(angle(i))},${CY + r * Math.sin(angle(i))}`
  }).join(' ') + ' Z'
  return (
    <svg viewBox="0 0 200 200" style={{ width: 220, height: 220 }} role="img" aria-label={`Radar competenze: ${points.length} categorie`}>
      {gridLevels.map(lv => {
        const r = (lv / 100) * R
        const path = Array.from({ length: n }, (_, i) => `${i === 0 ? 'M' : 'L'}${CX + r * Math.cos(angle(i))},${CY + r * Math.sin(angle(i))}`).join(' ') + ' Z'
        return <path key={lv} d={path} fill="none" stroke="var(--color-border)" strokeWidth="0.5" />
      })}
      {points.map((_, i) => <line key={i} x1={CX} y1={CY} x2={CX + R * Math.cos(angle(i))} y2={CY + R * Math.sin(angle(i))} stroke="var(--color-border)" strokeWidth="0.5" />)}
      <path d={dataPath} fill="rgba(0,232,122,0.15)" stroke="var(--color-green)" strokeWidth="1.5" />
      {points.map((p, i) => (
        <text key={i} x={CX + (R + 14) * Math.cos(angle(i))} y={CY + (R + 14) * Math.sin(angle(i))}
          textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="var(--color-muted)">{p.name}</text>
      ))}
    </svg>
  )
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [radar, setRadar] = useState<RadarPoint[]>([])
  const [filterCat, setFilterCat] = useState<string>('all')
  const [newName, setNewName] = useState('')
  const [newLevel, setNewLevel] = useState<Level>('beginner')
  const [newCat, setNewCat] = useState<Category>('frontend')

  const fetchSkills = useCallback(async () => {
    const p = new URLSearchParams()
    if (filterCat !== 'all') p.set('category', filterCat)
    const res = await fetch(`/api/skills?${p}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setSkills(data.skills ?? []); setRadar(data.radarTop6 ?? [])
  }, [filterCat])

  useEffect(() => { fetchSkills() }, [fetchSkills])

  const addSkill = async () => {
    if (!newName.trim()) return
    await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), level: newLevel, category: newCat }) })
    setNewName(''); fetchSkills()
  }
  const deleteSkill = async (id: string) => { await fetch(`/api/skills?id=${id}`, { method: 'DELETE' }); fetchSkills() }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Competenze</span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Competenze</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{skills.length} competenze registrate</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] flex justify-center">
          <RadarChart points={radar} />
        </div>
        <div className="md:col-span-2 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Aggiungi competenza</p>
          <div className="flex flex-wrap gap-2 items-end">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome competenza"
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)] flex-1 min-w-[140px]" />
            <select value={newCat} onChange={e => setNewCat(e.target.value as Category)} aria-label="Categoria competenza"
              className="text-[11px] px-2 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-muted)]">
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_CFG[c].label}</option>)}
            </select>
            <select value={newLevel} onChange={e => setNewLevel(e.target.value as Level)} aria-label="Livello competenza"
              className="text-[11px] px-2 py-1.5 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-muted)]">
              {LEVELS.map(l => <option key={l} value={l}>{LEVEL_CFG[l].label}</option>)}
            </select>
            <button onClick={addSkill} disabled={!newName.trim()} className="px-4 py-1.5 rounded-lg text-[11px] font-bold"
              style={{ background: newName.trim() ? 'var(--color-green)' : 'var(--color-border)', color: newName.trim() ? '#000' : 'var(--color-dim)', border: 'none', cursor: newName.trim() ? 'pointer' : 'default' }}>aggiungi</button>
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-4">
        <button onClick={() => setFilterCat('all')} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
          style={{ background: filterCat === 'all' ? 'var(--color-row)' : 'transparent', color: filterCat === 'all' ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filterCat === 'all' ? 'var(--color-border-glow)' : 'transparent'}` }}>tutte</button>
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setFilterCat(c)} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase cursor-pointer transition-colors"
            style={{ background: filterCat === c ? 'var(--color-row)' : 'transparent', color: filterCat === c ? CAT_CFG[c].color : 'var(--color-dim)', border: `1px solid ${filterCat === c ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {CAT_CFG[c].label}
          </button>
        ))}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
        {skills.length === 0 ? (
          <div className="py-16 text-center"><p className="text-[var(--color-dim)] text-[12px]">Nessuna competenza trovata.</p></div>
        ) : skills.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CAT_CFG[s.category]?.color ?? 'var(--color-dim)' }} />
            <span className="text-[12px] font-semibold text-[var(--color-bright)] flex-1">{s.name}</span>
            <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: LEVEL_CFG[s.level].color, border: `1px solid var(--color-border)` }}>{LEVEL_CFG[s.level].label}</span>
            <span className="text-[9px] text-[var(--color-dim)] w-10 text-right">{s.endorsements}★</span>
            <button onClick={() => deleteSkill(s.id)} className="text-[10px] font-bold cursor-pointer transition-colors"
              style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-red)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}
