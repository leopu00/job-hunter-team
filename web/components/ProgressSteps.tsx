'use client'

export type StepStatus = 'completed' | 'active' | 'pending' | 'error'

export interface Step {
  label: string
  description?: string
  status?: StepStatus
}

export interface ProgressStepsProps {
  steps: Step[]
  /** Indice dello step attivo (0-based) — se omesso si ricava dagli status */
  activeIndex?: number
  /** Mostra percentuale di completamento */
  showPercent?: boolean
  /** Mostra etichette sotto i nodi */
  showLabels?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const COLORS: Record<StepStatus, { bg: string; border: string; text: string }> = {
  completed: { bg: 'var(--color-green, #00e87a)',  border: 'var(--color-green, #00e87a)',  text: '#000' },
  active:    { bg: 'var(--color-panel)',            border: 'var(--color-green, #00e87a)',  text: 'var(--color-green, #00e87a)' },
  pending:   { bg: 'var(--color-panel)',            border: 'var(--color-border)',          text: 'var(--color-dim)' },
  error:     { bg: 'var(--color-red, #ff4d4d)',     border: 'var(--color-red, #ff4d4d)',    text: '#fff' },
}

const SIZE_MAP = {
  sm: { node: 20, font: 10, label: 10, lineH: 2  },
  md: { node: 28, font: 12, label: 11, lineH: 3  },
  lg: { node: 36, font: 14, label: 12, lineH: 4  },
}

function resolveStatuses(steps: Step[], activeIndex?: number): StepStatus[] {
  if (steps.every(s => s.status)) return steps.map(s => s.status!)
  const ai = activeIndex ?? 0
  return steps.map((_, i) => {
    if (i < ai)  return 'completed'
    if (i === ai) return 'active'
    return 'pending'
  })
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2 6 5 9 10 3" />
    </svg>
  )
}

function ErrorIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size * 0.5} height={size * 0.5} viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <line x1="3" y1="3" x2="9" y2="9" /><line x1="9" y1="3" x2="3" y2="9" />
    </svg>
  )
}

export default function ProgressSteps({
  steps,
  activeIndex,
  showPercent = false,
  showLabels  = true,
  size = 'md',
}: ProgressStepsProps) {
  const { node, font, label: labelFont, lineH } = SIZE_MAP[size]
  const statuses  = resolveStatuses(steps, activeIndex)
  const completed = statuses.filter(s => s === 'completed').length
  const percent   = steps.length > 1 ? Math.round((completed / (steps.length - 1)) * 100) : 100

  return (
    <div style={{ width: '100%' }}>
      {/* Header percentuale */}
      {showPercent && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 10, fontSize: font,
        }}>
          <span style={{ color: 'var(--color-bright)', fontWeight: 600 }}>
            {completed} / {steps.length} step
          </span>
          <span style={{ color: 'var(--color-green, #00e87a)', fontWeight: 700 }}>
            {percent}%
          </span>
        </div>
      )}

      {/* Track + nodi */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start' }}>
        {/* Linea di sfondo */}
        <div style={{
          position: 'absolute',
          top: node / 2 - lineH / 2,
          left: node / 2,
          right: node / 2,
          height: lineH,
          background: 'var(--color-border)',
          borderRadius: lineH,
          zIndex: 0,
        }} />

        {/* Linea completata */}
        <div style={{
          position: 'absolute',
          top: node / 2 - lineH / 2,
          left: node / 2,
          width: steps.length > 1
            ? `calc(${(completed / (steps.length - 1)) * 100}% - ${node}px)`
            : '0%',
          height: lineH,
          background: 'var(--color-green, #00e87a)',
          borderRadius: lineH,
          zIndex: 1,
          transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)',
        }} />

        {/* Nodi */}
        {steps.map((step, i) => {
          const status = statuses[i]
          const c = COLORS[status]
          const isActive = status === 'active'
          return (
            <div key={i} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              position: 'relative', zIndex: 2,
            }}>
              {/* Cerchio nodo */}
              <div style={{
                width: node, height: node,
                borderRadius: '50%',
                background: c.bg,
                border: `${lineH}px solid ${c.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.text,
                fontSize: font,
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, var(--color-green, #00e87a) 25%, transparent)` : 'none',
                transition: 'box-shadow 0.3s ease, background 0.3s ease',
              }}>
                {status === 'completed' && <CheckIcon size={node} />}
                {status === 'error'     && <ErrorIcon size={node} />}
                {(status === 'active' || status === 'pending') && (
                  <span>{i + 1}</span>
                )}
              </div>

              {/* Label */}
              {showLabels && (
                <div style={{
                  marginTop: 6, textAlign: 'center',
                  fontSize: labelFont,
                  color: status === 'pending' ? 'var(--color-dim)' : 'var(--color-bright)',
                  fontWeight: isActive ? 600 : 400,
                  lineHeight: 1.3,
                  maxWidth: 80,
                }}>
                  {step.label}
                  {step.description && (
                    <div style={{ fontSize: labelFont - 1, color: 'var(--color-dim)', fontWeight: 400 }}>
                      {step.description}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
