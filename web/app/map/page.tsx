'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Cluster = { city: string; area: string; count: number; avgSalary: number; topRoles: string[]; x: number; y: number }

function MapView({ clusters, selected, onSelect }: { clusters: Cluster[]; selected: Cluster | null; onSelect: (c: Cluster) => void }) {
  return (
    <svg viewBox="0 0 100 90" className="w-full" style={{ maxHeight: 420 }}>
      <rect x={0} y={0} width={100} height={90} fill="var(--color-deep)" rx={4} />
      {/* Grid lines */}
      {[20, 40, 60, 80].map(x => <line key={`vx${x}`} x1={x} y1={0} x2={x} y2={90} stroke="var(--color-border)" strokeWidth={0.2} />)}
      {[20, 40, 60, 80].map(y => <line key={`hy${y}`} x1={0} y1={y} x2={100} y2={y} stroke="var(--color-border)" strokeWidth={0.2} />)}
      {clusters.map(c => {
        const r = Math.max(2, Math.min(5, c.count / 4))
        const isSelected = selected?.city === c.city
        return (
          <g key={c.city} onClick={() => onSelect(c)} style={{ cursor: 'pointer' }}>
            <circle cx={c.x} cy={c.y} r={r + 1} fill={isSelected ? 'var(--color-green)' : 'transparent'} opacity={0.3} />
            <circle cx={c.x} cy={c.y} r={r} fill={isSelected ? 'var(--color-green)' : '#61affe'} opacity={0.8} />
            <text x={c.x} y={c.y - r - 1.5} textAnchor="middle" fill="var(--color-muted)" fontSize={2.8} fontWeight="bold">{c.city}</text>
            <text x={c.x} y={c.y + 0.8} textAnchor="middle" fill="#000" fontSize={2.2} fontWeight="bold">{c.count}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function MapPage() {
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Cluster | null>(null)

  const fetchData = useCallback(async () => {
    const params = filter ? `?location=${encodeURIComponent(filter)}` : ''
    const res = await fetch(`/api/map${params}`).catch(() => null)
    if (!res?.ok) return
    const d = await res.json()
    setClusters(d.clusters ?? []); setTotalJobs(d.totalJobs ?? 0); setAreas(d.areas ?? [])
  }, [filter])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Mappa</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Mappa Opportunità</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{totalJobs} posizioni in {clusters.length} città</p>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => { setFilter(''); setSelected(null) }} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
          style={{ background: !filter ? 'var(--color-green)' : 'var(--color-row)', color: !filter ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>Tutte</button>
        {areas.map(a => (
          <button key={a} onClick={() => { setFilter(a); setSelected(null) }} className="px-3 py-1 rounded text-[9px] font-bold cursor-pointer"
            style={{ background: filter === a ? 'var(--color-green)' : 'var(--color-row)', color: filter === a ? '#000' : 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{a}</button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <MapView clusters={clusters} selected={selected} onSelect={setSelected} />
        </div>

        <div>
          {selected ? (
            <div className="p-4 rounded-lg" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}>
              <h3 className="text-lg font-bold text-[var(--color-white)] mb-1">{selected.city}</h3>
              <p className="text-[9px] text-[var(--color-dim)] mb-3">{selected.area}</p>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between"><span className="text-[9px] text-[var(--color-dim)]">Posizioni</span><span className="text-[11px] font-bold text-[var(--color-green)]">{selected.count}</span></div>
                <div className="flex justify-between"><span className="text-[9px] text-[var(--color-dim)]">RAL media</span><span className="text-[11px] font-bold text-[var(--color-white)]">{(selected.avgSalary / 1000).toFixed(0)}k€</span></div>
                <div><span className="text-[9px] text-[var(--color-dim)]">Ruoli top</span>
                  <div className="flex flex-wrap gap-1 mt-1">{selected.topRoles.map(r => <span key={r} className="text-[8px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-deep)', color: 'var(--color-muted)' }}>{r}</span>)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
              <div className="px-3 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
                <span className="text-[8px] font-bold tracking-widest text-[var(--color-dim)]">CITTÀ PER N° POSIZIONI</span>
              </div>
              {clusters.sort((a, b) => b.count - a.count).map(c => (
                <div key={c.city} onClick={() => setSelected(c)} className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-row)] transition-colors">
                  <span className="text-[10px] text-[var(--color-muted)]">{c.city}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-deep)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(c.count / Math.max(...clusters.map(x => x.count))) * 100}%`, background: '#61affe' }} />
                    </div>
                    <span className="text-[9px] font-bold text-[var(--color-white)] w-6 text-right">{c.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
