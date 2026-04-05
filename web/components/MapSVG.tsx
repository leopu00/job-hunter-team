'use client'

import { useMemo, useState } from 'react'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  label: string
  color?: string
  value?: number
}

export interface MapSVGProps {
  markers?: MapMarker[]
  onMarkerClick?: (marker: MapMarker) => void
  width?: number
  height?: number
  /** Distanza in px entro cui clusterizzare i marker */
  clusterRadius?: number
}

/* ── Proiezione equirettangolare ── */
function project(lat: number, lng: number, w: number, h: number) {
  return { x: ((lng + 180) / 360) * w, y: ((90 - lat) / 180) * h }
}

/* ── Continenti semplificati (poligoni approssimativi) ── */
const LAND: Array<[number,number][]> = [
  // Nord America
  [[-168,72],[-50,72],[-50,48],[-80,28],[-83,10],[-80,8],[-77,8],[-60,4],[-55,2],[-60,-5],[-80,-5],[-100,20],[-110,22],[-120,32],[-125,48],[-140,60],[-168,72]],
  // Sud America
  [[-80,12],[-60,12],[-50,5],[-35,-5],[-35,-55],[-55,-55],[-68,-55],[-75,-45],[-80,-15],[-80,12]],
  // Europa
  [[-10,36],[40,36],[40,72],[-10,72],[-10,36]],
  // Africa
  [[-18,38],[52,38],[52,-35],[-18,-35],[-18,38]],
  // Asia (est)
  [[40,72],[145,72],[145,10],[105,-5],[80,5],[60,5],[40,36],[40,72]],
  // Australia
  [[114,-20],[154,-20],[154,-44],[114,-44],[114,-20]],
  // Giappone (semplificato)
  [[130,31],[145,31],[145,45],[130,45],[130,31]],
  // UK
  [[-6,50],[2,50],[2,60],[-6,60],[-6,50]],
]

/* ── Clustering ── */
interface Cluster { cx: number; cy: number; markers: MapMarker[] }

function clusterMarkers(pts: Array<MapMarker & { px: number; py: number }>, r: number): Cluster[] {
  const used = new Set<string>()
  const clusters: Cluster[] = []
  for (const p of pts) {
    if (used.has(p.id)) continue
    const group = pts.filter(q => !used.has(q.id) && Math.hypot(p.px - q.px, p.py - q.py) < r)
    group.forEach(q => used.add(q.id))
    const cx = group.reduce((s, q) => s + q.px, 0) / group.length
    const cy = group.reduce((s, q) => s + q.py, 0) / group.length
    clusters.push({ cx, cy, markers: group })
  }
  return clusters
}

export default function MapSVG({ markers = [], onMarkerClick, width = 600, height = 300, clusterRadius = 20 }: MapSVGProps) {
  const [tip, setTip] = useState<Cluster | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  const landPaths = useMemo(() => LAND.map(poly =>
    poly.map(([lng, lat], i) => {
      const { x, y } = project(lat, lng, width, height)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ') + 'Z'
  ), [width, height])

  const pts = useMemo(() => markers.map(m => ({ ...m, ...project(m.lat, m.lng, width, height) })), [markers, width, height])
  const clusters = useMemo(() => clusterMarkers(pts.map(p => ({ ...p, px: p.x, py: p.y })), clusterRadius), [pts, clusterRadius])

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <svg role="img" aria-label="Mappa posizioni" width={width} height={height} style={{ borderRadius: 8, border: '1px solid var(--color-border)' }}>
        {/* Oceano */}
        <rect width={width} height={height} fill="#0a1628" rx={8} />

        {/* Terra */}
        {landPaths.map((d, i) => (
          <path key={i} d={d} fill="#1e3a2f" stroke="#2d5a3d" strokeWidth={0.5} />
        ))}

        {/* Griglia lat/lng */}
        {[-60,-30,0,30,60].map(lat => {
          const { y } = project(lat, 0, width, height)
          return <line key={lat} x1={0} y1={y} x2={width} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        })}
        {[-120,-60,0,60,120].map(lng => {
          const { x } = project(0, lng, width, height)
          return <line key={lng} x1={x} y1={0} x2={x} y2={height} stroke="rgba(255,255,255,0.04)" strokeWidth={0.5} />
        })}

        {/* Cluster / Marker */}
        {clusters.map((cl, i) => {
          const isCluster = cl.markers.length > 1
          const m = cl.markers[0]
          const c = m.color ?? 'var(--color-green)'
          const r = isCluster ? 10 + Math.min(cl.markers.length, 8) : 6
          return (
            <g key={i}
              role="button"
              tabIndex={0}
              aria-label={isCluster ? `${cl.markers.length} posizioni raggruppate` : m.label}
              style={{ cursor: 'pointer', outline: 'none' }}
              onFocus={() => { setTip(cl); setTipPos({ x: cl.cx, y: cl.cy }) }}
              onBlur={() => setTip(null)}
              onMouseEnter={() => { setTip(cl); setTipPos({ x: cl.cx, y: cl.cy }) }}
              onMouseLeave={() => setTip(null)}
              onClick={() => !isCluster && onMarkerClick?.(m)}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !isCluster) { e.preventDefault(); onMarkerClick?.(m) } }}>
              <circle cx={cl.cx} cy={cl.cy} r={r + 4} fill={c} opacity={0.15} />
              <circle cx={cl.cx} cy={cl.cy} r={r} fill={c} stroke="#000" strokeWidth={1} opacity={0.9} />
              {isCluster && (
                <text x={cl.cx} y={cl.cy + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#000">
                  {cl.markers.length}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Tooltip */}
      {tip && (
        <div role="tooltip" style={{
          position: 'absolute', pointerEvents: 'none', zIndex: 10,
          left: tipPos.x + 12, top: tipPos.y - 8,
          background: 'var(--color-panel)', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '5px 9px', fontSize: 10, color: 'var(--color-bright)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', maxWidth: 180,
        }}>
          {tip.markers.length === 1
            ? <><b>{tip.markers[0].label}</b>{tip.markers[0].value !== undefined && ` — ${tip.markers[0].value}`}</>
            : <><b>{tip.markers.length} posizioni</b><br />{tip.markers.slice(0,3).map(m => m.label).join(', ')}{tip.markers.length > 3 ? '…' : ''}</>
          }
        </div>
      )}
    </div>
  )
}
