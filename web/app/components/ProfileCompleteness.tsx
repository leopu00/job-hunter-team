'use client'

// ── Types ──────────────────────────────────────────────────────────────────

export type ProfileSection = {
  id:        string
  label:     string
  completed: boolean
  weight?:   number   // peso % (default 1)
  href?:     string   // CTA link per la sezione
}

export const DEFAULT_PROFILE_SECTIONS: ProfileSection[] = [
  { id: 'photo',       label: 'Foto profilo',   completed: false, weight: 1 },
  { id: 'experience',  label: 'Esperienza',      completed: false, weight: 2 },
  { id: 'education',   label: 'Formazione',      completed: false, weight: 2 },
  { id: 'skills',      label: 'Competenze',      completed: false, weight: 2 },
  { id: 'languages',   label: 'Lingue',          completed: false, weight: 1 },
  { id: 'bio',         label: 'Biografia',       completed: false, weight: 1 },
  { id: 'contacts',    label: 'Contatti',        completed: false, weight: 1 },
]

// ── SVG Ring ───────────────────────────────────────────────────────────────

function Ring({ pct, size = 120, stroke = 10 }: { pct: number; size?: number; stroke?: number }) {
  const r     = (size - stroke) / 2
  const circ  = 2 * Math.PI * r
  const dash  = (pct / 100) * circ
  const color = pct >= 80 ? 'var(--color-green)' : pct >= 50 ? 'var(--color-yellow)' : 'var(--color-blue)'

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      {/* Track */}
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="var(--color-border)" strokeWidth={stroke} />
      {/* Progress */}
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
    </svg>
  )
}

// ── Section row ────────────────────────────────────────────────────────────

function SectionRow({ section }: { section: ProfileSection }) {
  const row = (
    <div className="flex items-center gap-2 py-1">
      <span className="flex-shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px]"
        style={{
          background: section.completed ? 'var(--color-green)20' : 'var(--color-border)',
          border: `1px solid ${section.completed ? 'var(--color-green)60' : 'var(--color-border)'}`,
          color: section.completed ? 'var(--color-green)' : 'var(--color-dim)',
        }}>
        {section.completed ? '✓' : '·'}
      </span>
      <span className="text-[10px] flex-1 truncate"
        style={{ color: section.completed ? 'var(--color-muted)' : 'var(--color-bright)' }}>
        {section.label}
      </span>
      {!section.completed && (
        <span className="text-[8px] font-semibold uppercase tracking-wide flex-shrink-0"
          style={{ color: 'var(--color-blue)' }}>
          {section.href ? 'Aggiungi →' : 'Mancante'}
        </span>
      )}
    </div>
  )

  if (!section.completed && section.href) {
    return <a href={section.href} className="block hover:opacity-80 transition-opacity">{row}</a>
  }
  return row
}

// ── ProfileCompleteness ────────────────────────────────────────────────────

type ProfileCompletenessProps = {
  sections:   ProfileSection[]
  onComplete?: () => void    // callback CTA principale
  className?: string
}

export function ProfileCompleteness({ sections, onComplete, className }: ProfileCompletenessProps) {
  const totalWeight     = sections.reduce((s, x) => s + (x.weight ?? 1), 0)
  const completedWeight = sections.filter(x => x.completed).reduce((s, x) => s + (x.weight ?? 1), 0)
  const pct             = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0
  const missing         = sections.filter(x => !x.completed)
  const color           = pct >= 80 ? 'var(--color-green)' : pct >= 50 ? 'var(--color-yellow)' : 'var(--color-blue)'

  return (
    <div className={`rounded-xl overflow-hidden ${className ?? ''}`}
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>

      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>
          Completamento profilo
        </p>
      </div>

      <div className="p-4 flex gap-4">
        {/* Ring + % */}
        <div className="flex-shrink-0 relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
          <Ring pct={pct} size={96} stroke={8} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[20px] font-bold font-mono leading-none" style={{ color }}>{pct}</span>
            <span className="text-[8px] font-mono" style={{ color: 'var(--color-dim)' }}>%</span>
          </div>
        </div>

        {/* Sections list */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          {sections.map(s => <SectionRow key={s.id} section={s} />)}
        </div>
      </div>

      {/* CTA — solo se profilo incompleto */}
      {missing.length > 0 && (
        <div className="px-4 pb-4">
          <button
            onClick={onComplete}
            className="w-full py-2 rounded-lg text-[11px] font-semibold transition-opacity hover:opacity-80"
            style={{ background: `${color}18`, color, border: `1px solid ${color}44` }}>
            Completa profilo · {missing.length} {missing.length === 1 ? 'sezione mancante' : 'sezioni mancanti'}
          </button>
        </div>
      )}
    </div>
  )
}
