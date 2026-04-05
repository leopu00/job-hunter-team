'use client'

// ── Types ──────────────────────────────────────────────────────────────────

export type SkillLevel = 'beginner' | 'intermediate' | 'expert' | string

export type OwnedSkill = {
  name:   string
  level?: SkillLevel
}

// ── Level config ───────────────────────────────────────────────────────────

const LEVEL_CFG: Record<string, { label: string; color: string; dots: number }> = {
  beginner:     { label: 'Base',     color: 'var(--color-dim)',    dots: 1 },
  intermediate: { label: 'Medio',    color: 'var(--color-yellow)', dots: 2 },
  expert:       { label: 'Esperto',  color: 'var(--color-green)',  dots: 3 },
}
function lcfg(level?: string) { return LEVEL_CFG[level ?? ''] ?? { label: level ?? '', color: 'var(--color-muted)', dots: 0 } }

// ── SkillBadge ─────────────────────────────────────────────────────────────

type SkillBadgeProps = {
  name:       string
  level?:     SkillLevel
  matched?:   boolean   // highlight verde se matched
  missing?:   boolean   // highlight rosso se mancante
  size?:      'sm' | 'md'
  className?: string
}

export function SkillBadge({ name, level, matched, missing, size = 'md', className }: SkillBadgeProps) {
  const { label, color, dots } = lcfg(level)
  const sm = size === 'sm'

  let bg    = 'var(--color-border)'
  let text  = 'var(--color-muted)'
  let border = 'transparent'
  if (matched) { bg = 'var(--color-green)18'; text = 'var(--color-green)'; border = 'var(--color-green)44' }
  if (missing) { bg = 'var(--color-red)18';   text = 'var(--color-red)';   border = 'var(--color-red)44'   }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium select-none ${sm ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'} ${className ?? ''}`}
      style={{ background: bg, color: text, border: `1px solid ${border}` }}
      title={level ? `${name} — ${label}` : name}>
      <span className="truncate max-w-[120px]">{name}</span>
      {dots > 0 && (
        <span className="flex gap-0.5 flex-shrink-0">
          {[1, 2, 3].map(i => (
            <span key={i} className="rounded-full" style={{
              width: sm ? 4 : 5, height: sm ? 4 : 5,
              background: i <= dots ? color : 'var(--color-border)',
              display: 'inline-block',
            }} />
          ))}
        </span>
      )}
    </span>
  )
}

// ── SkillMatcher ───────────────────────────────────────────────────────────

type SkillMatcherProps = {
  required:   string[]          // skills richieste dall'offerta
  owned:      OwnedSkill[]      // skills del candidato
  className?: string
}

function normalize(s: string) { return s.trim().toLowerCase() }

export function SkillMatcher({ required, owned, className }: SkillMatcherProps) {
  const ownedMap = new Map(owned.map(s => [normalize(s.name), s]))

  const matched: OwnedSkill[] = []
  const missing: string[]     = []

  for (const req of required) {
    const owned = ownedMap.get(normalize(req))
    if (owned) matched.push(owned)
    else        missing.push(req)
  }

  const extra = owned.filter(s => !required.map(normalize).includes(normalize(s.name)))

  const pct   = required.length > 0 ? Math.round((matched.length / required.length) * 100) : 0
  const color = pct >= 80 ? 'var(--color-green)' : pct >= 50 ? 'var(--color-yellow)' : 'var(--color-red)'

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>

      {/* Match score */}
      <div className="flex items-center gap-3">
        <span className="text-[24px] font-bold font-mono leading-none" style={{ color }}>{pct}%</span>
        <div className="flex-1 flex flex-col gap-1">
          <div className="flex justify-between text-[9px]" style={{ color: 'var(--color-dim)' }}>
            <span>Match competenze</span>
            <span>{matched.length}/{required.length}</span>
          </div>
          <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Match competenze" className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      </div>

      {/* Matched + Missing */}
      <div className="grid grid-cols-2 gap-3">
        {/* Matched */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-green)' }}>
            Presenti ({matched.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {matched.length > 0
              ? matched.map(s => <SkillBadge key={s.name} name={s.name} level={s.level} matched size="sm" />)
              : <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Nessuna</span>}
          </div>
        </div>

        {/* Missing */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-red)' }}>
            Mancanti ({missing.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {missing.length > 0
              ? missing.map(s => <SkillBadge key={s} name={s} missing size="sm" />)
              : <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>Nessuna</span>}
          </div>
        </div>
      </div>

      {/* Extra skills */}
      {extra.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-dim)' }}>
            Competenze extra ({extra.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {extra.map(s => <SkillBadge key={s.name} name={s.name} level={s.level} size="sm" />)}
          </div>
        </div>
      )}
    </div>
  )
}
