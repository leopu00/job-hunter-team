'use client'

// ── Types ──────────────────────────────────────────────────────────────────

export type MatchCategory = {
  id:     string
  label:  string
  score:  number   // 0-100
  icon?:  string
}

export const DEFAULT_MATCH_CATEGORIES: MatchCategory[] = [
  { id: 'skills',     label: 'Competenze',  score: 0, icon: '⚡' },
  { id: 'experience', label: 'Esperienza',  score: 0, icon: '📋' },
  { id: 'education',  label: 'Formazione',  score: 0, icon: '🎓' },
  { id: 'location',   label: 'Posizione',   score: 0, icon: '📍' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 80) return 'var(--color-green)'
  if (s >= 60) return 'var(--color-yellow)'
  if (s >= 40) return 'var(--color-blue)'
  return 'var(--color-red)'
}

function radarPoints(cats: MatchCategory[], cx: number, cy: number, r: number): string {
  return cats.map((c, i) => {
    const angle = (i / cats.length) * 2 * Math.PI - Math.PI / 2
    const v = (c.score / 100) * r
    return `${cx + v * Math.cos(angle)},${cy + v * Math.sin(angle)}`
  }).join(' ')
}

function webPoints(cx: number, cy: number, r: number, n: number, frac: number): string {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2
    return `${cx + r * frac * Math.cos(angle)},${cy + r * frac * Math.sin(angle)}`
  }).join(' ')
}

// ── Radar Chart ────────────────────────────────────────────────────────────

function RadarChart({ categories, size = 140 }: { categories: MatchCategory[]; size?: number }) {
  const cx = size / 2
  const cy = size / 2
  const r  = size / 2 - 18
  const n  = categories.length
  const avg = Math.round(categories.reduce((s, c) => s + c.score, 0) / n)
  const fill = scoreColor(avg)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Web rings */}
      {[0.25, 0.5, 0.75, 1].map(frac => (
        <polygon key={frac} points={webPoints(cx, cy, r, n, frac)}
          fill="none" stroke="var(--color-border)" strokeWidth={frac === 1 ? 1 : 0.5} />
      ))}

      {/* Axes */}
      {categories.map((_, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2
        return (
          <line key={i}
            x1={cx} y1={cy}
            x2={cx + r * Math.cos(angle)}
            y2={cy + r * Math.sin(angle)}
            stroke="var(--color-border)" strokeWidth={0.5} />
        )
      })}

      {/* Score polygon */}
      <polygon points={radarPoints(categories, cx, cy, r)}
        fill={`${fill}22`} stroke={fill} strokeWidth={1.5} strokeLinejoin="round" />

      {/* Axis labels */}
      {categories.map((c, i) => {
        const angle = (i / n) * 2 * Math.PI - Math.PI / 2
        const lx = cx + (r + 12) * Math.cos(angle)
        const ly = cy + (r + 12) * Math.sin(angle)
        return (
          <text key={c.id} x={lx} y={ly}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={8} fill="var(--color-dim)">
            {c.icon ?? c.label[0]}
          </text>
        )
      })}
    </svg>
  )
}

// ── CategoryRow ────────────────────────────────────────────────────────────

function CategoryRow({ cat }: { cat: MatchCategory }) {
  const color = scoreColor(cat.score)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] w-4 text-center flex-shrink-0">{cat.icon}</span>
      <span className="text-[10px] w-20 truncate flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{cat.label}</span>
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${cat.score}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono w-7 text-right flex-shrink-0" style={{ color }}>{cat.score}</span>
    </div>
  )
}

// ── JobMatchScore ──────────────────────────────────────────────────────────

type JobMatchScoreProps = {
  score:       number
  categories:  MatchCategory[]
  jobTitle?:   string
  className?:  string
}

export function JobMatchScore({ score, categories, jobTitle, className }: JobMatchScoreProps) {
  const color = scoreColor(score)
  const label = score >= 80 ? 'Ottimo' : score >= 60 ? 'Buono' : score >= 40 ? 'Discreto' : 'Basso'

  return (
    <div className={`rounded-xl overflow-hidden ${className ?? ''}`}
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>

      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>
          Match score{jobTitle ? ` — ${jobTitle}` : ''}
        </p>
      </div>

      <div className="p-4 flex gap-4 items-center">
        {/* Radar */}
        <div className="flex-shrink-0">
          <RadarChart categories={categories} size={140} />
        </div>

        {/* Right panel */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Big score */}
          <div className="flex items-baseline gap-2">
            <span className="text-[36px] font-bold font-mono leading-none" style={{ color }}>{score}</span>
            <div className="flex flex-col">
              <span className="text-[10px] font-mono" style={{ color: 'var(--color-dim)' }}>/100</span>
              <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
            </div>
          </div>

          {/* Category bars */}
          <div className="flex flex-col gap-1.5">
            {categories.map(c => <CategoryRow key={c.id} cat={c} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
