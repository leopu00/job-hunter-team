export type ApplicationStep =
  | 'saved' | 'applied' | 'screening' | 'interview' | 'offer' | 'rejected' | 'withdrawn'

export interface ApplicationProgressProps {
  currentStep: ApplicationStep
  /** Mostra etichette sotto gli step */
  showLabels?: boolean
  /** Compatta: solo pallini senza etichette */
  compact?: boolean
  /** Timestamp per ogni step (opzionale, mostra data sotto etichetta) */
  stepDates?: Partial<Record<ApplicationStep, number>>
  className?: string
}

const MAIN_STEPS: ApplicationStep[] = ['saved', 'applied', 'screening', 'interview', 'offer']

const STEP_LABEL: Record<ApplicationStep, string> = {
  saved:     'Salvato',
  applied:   'Candidato',
  screening: 'Screening',
  interview: 'Colloquio',
  offer:     'Offerta',
  rejected:  'Rifiutato',
  withdrawn: 'Ritirato',
}

const STEP_ICON: Record<ApplicationStep, string> = {
  saved:     '🔖',
  applied:   '📤',
  screening: '🔍',
  interview: '💬',
  offer:     '🎉',
  rejected:  '✕',
  withdrawn: '↩',
}

/** Indice dello step corrente nel percorso principale (rejected/withdrawn = -1) */
function stepIndex(step: ApplicationStep): number {
  return MAIN_STEPS.indexOf(step)
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

export default function ApplicationProgress({
  currentStep, showLabels = true, compact = false, stepDates = {},
}: ApplicationProgressProps) {
  const isTerminal = currentStep === 'rejected' || currentStep === 'withdrawn'
  const currentIdx = stepIndex(currentStep)

  // Banner terminale (rejected/withdrawn) — mostra barra al 100% con colore diverso
  if (isTerminal) {
    const color = currentStep === 'rejected' ? 'var(--color-red)' : 'var(--color-dim)'
    return (
      <div className="flex flex-col gap-1.5">
        <div className="relative h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
          <div className="h-full rounded-full" style={{ width: '100%', background: color, opacity: 0.5 }} />
        </div>
        {showLabels && !compact && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-[var(--color-dim)]">Saved</span>
            <span className="text-[9px] font-semibold" style={{ color }}>
              {STEP_ICON[currentStep]} {STEP_LABEL[currentStep]}
            </span>
          </div>
        )}
      </div>
    )
  }

  const progressPct = currentIdx <= 0 ? 0 : (currentIdx / (MAIN_STEPS.length - 1)) * 100

  return (
    <div className="flex flex-col gap-2">
      {/* Step dots + connector line */}
      <div className="relative flex items-center justify-between">
        {/* Linea di sfondo */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: 'var(--color-border)', zIndex: 0 }} />
        {/* Linea completata */}
        <div className="absolute top-1/2 left-0 h-px -translate-y-1/2 transition-all duration-500"
          style={{ width: `${progressPct}%`, background: 'var(--color-green)', zIndex: 1 }} />

        {MAIN_STEPS.map((step, i) => {
          const done    = i < currentIdx
          const active  = i === currentIdx
          const pending = i > currentIdx

          let bg     = 'var(--color-border)'
          let border = 'var(--color-border)'
          let color  = 'var(--color-dim)'
          let size   = compact ? 10 : 14

          if (done)   { bg = 'var(--color-green)'; border = 'var(--color-green)'; color = '#000'; size = compact ? 10 : 14 }
          if (active) { bg = 'var(--color-green)'; border = 'var(--color-green)'; color = '#000'; size = compact ? 12 : 16 }
          if (pending){ bg = 'var(--color-bg)';    border = 'var(--color-border)'; color = 'var(--color-dim)' }

          return (
            <div key={step} className="flex flex-col items-center gap-1 relative" style={{ zIndex: 2 }}>
              <div className="flex items-center justify-center rounded-full font-bold transition-all duration-300"
                style={{
                  width: size, height: size,
                  background: bg, border: `1.5px solid ${border}`,
                  color, fontSize: size * 0.55,
                  boxShadow: active ? `0 0 0 3px ${bg}33` : 'none',
                }}>
                {done ? '✓' : active ? STEP_ICON[step] : ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* Etichette */}
      {showLabels && !compact && (
        <div className="flex items-start justify-between">
          {MAIN_STEPS.map((step, i) => {
            const done   = i < currentIdx
            const active = i === currentIdx
            const date   = stepDates[step]
            return (
              <div key={step} className="flex flex-col items-center gap-0.5" style={{ flex: 1 }}>
                <span className="text-[9px] font-semibold text-center leading-tight"
                  style={{ color: active ? 'var(--color-green)' : done ? 'var(--color-muted)' : 'var(--color-dim)' }}>
                  {STEP_LABEL[step]}
                </span>
                {date && (
                  <span className="text-[8px] font-mono" style={{ color: 'var(--color-dim)' }}>{fmtDate(date)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Compact: solo step corrente label */}
      {compact && (
        <span className="text-[9px] font-mono text-center" style={{ color: 'var(--color-green)' }}>
          {STEP_LABEL[currentStep]}
        </span>
      )}
    </div>
  )
}
