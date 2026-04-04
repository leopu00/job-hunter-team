'use client'

export interface StrengthCriterion {
  label: string
  test: (pw: string) => boolean
}

export interface PasswordStrengthProps {
  password: string
  /** Criteri custom — default: lunghezza, maiuscole, numeri, simboli */
  criteria?: StrengthCriterion[]
  showCriteria?: boolean
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const DEFAULT_CRITERIA: StrengthCriterion[] = [
  { label: 'Almeno 8 caratteri',       test: pw => pw.length >= 8 },
  { label: 'Lettera maiuscola',         test: pw => /[A-Z]/.test(pw) },
  { label: 'Numero',                    test: pw => /[0-9]/.test(pw) },
  { label: 'Carattere speciale (!@#…)', test: pw => /[^A-Za-z0-9]/.test(pw) },
]

const LEVELS = [
  { label: 'Debole',   color: '#ff4d4d' },
  { label: 'Scarsa',   color: '#ff8c00' },
  { label: 'Buona',    color: '#f5c000' },
  { label: 'Ottima',   color: '#00e87a' },
]

const SIZE_MAP = {
  sm: { segH: 3,  gap: 3,  font: 10, radius: 2 },
  md: { segH: 5,  gap: 4,  font: 12, radius: 3 },
  lg: { segH: 7,  gap: 5,  font: 13, radius: 4 },
}

function scorePassword(pw: string, criteria: StrengthCriterion[]): number {
  if (!pw) return 0
  return criteria.filter(c => c.test(pw)).length
}

export default function PasswordStrength({
  password,
  criteria = DEFAULT_CRITERIA,
  showCriteria = true,
  showLabel = true,
  size = 'md',
}: PasswordStrengthProps) {
  const { segH, gap, font, radius } = SIZE_MAP[size]
  const score    = scorePassword(password, criteria)
  const segments = criteria.length
  // mappa score (0..segments) su livello 0..3
  const level    = password.length === 0 ? -1 : Math.min(3, Math.floor((score / segments) * 4))
  const current  = level >= 0 ? LEVELS[level] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Barra segmenti */}
      <div style={{ display: 'flex', alignItems: 'center', gap: gap }}>
        <div style={{ display: 'flex', flex: 1, gap }}>
          {LEVELS.map((lv, i) => {
            const filled = level >= i
            return (
              <div
                key={i}
                style={{
                  flex: 1, height: segH, borderRadius: radius,
                  background: filled ? lv.color : 'var(--color-border)',
                  transition: 'background 0.3s ease',
                }}
              />
            )
          })}
        </div>

        {/* Label forza */}
        {showLabel && current && (
          <span style={{
            fontSize: font, fontWeight: 700, minWidth: 52, textAlign: 'right',
            color: current.color, transition: 'color 0.3s',
          }}>
            {current.label}
          </span>
        )}
      </div>

      {/* Checklist criteri */}
      {showCriteria && password.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {criteria.map((c, i) => {
            const ok = c.test(password)
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: font, height: font,
                  borderRadius: '50%',
                  background: ok ? 'var(--color-green,#00e87a)' : 'var(--color-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: font * 0.7, color: ok ? '#000' : 'transparent',
                  flexShrink: 0,
                  transition: 'background 0.2s',
                }}>
                  ✓
                </span>
                <span style={{
                  fontSize: font - 1,
                  color: ok ? 'var(--color-bright)' : 'var(--color-dim)',
                  transition: 'color 0.2s',
                }}>
                  {c.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
