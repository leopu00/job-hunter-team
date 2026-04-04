'use client'

import { useEffect, useRef, useState } from 'react'

export type ProgressRingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface ProgressRingProps {
  /** Valore 0–100 */
  value: number
  size?: ProgressRingSize
  /** Sovrascrive il colore automatico */
  color?: string
  /** Spessore anello in px (default auto per size) */
  strokeWidth?: number
  /** Mostra label % al centro */
  showLabel?: boolean
  /** Testo custom al posto della % */
  label?: string
  /** Animazione all'mount */
  animate?: boolean
  /** Testo sotto l'anello */
  caption?: string
}

const SIZE_MAP: Record<ProgressRingSize, { px: number; stroke: number; fontSize: number; captionSize: number }> = {
  xs: { px: 32,  stroke: 3,  fontSize: 8,  captionSize: 7  },
  sm: { px: 48,  stroke: 4,  fontSize: 10, captionSize: 8  },
  md: { px: 72,  stroke: 5,  fontSize: 14, captionSize: 9  },
  lg: { px: 96,  stroke: 6,  fontSize: 18, captionSize: 10 },
  xl: { px: 128, stroke: 8,  fontSize: 22, captionSize: 11 },
}

function getColor(value: number): string {
  if (value < 30) return 'var(--color-red)'
  if (value < 70) return '#f59e0b'  // amber
  return 'var(--color-green)'
}

export default function ProgressRing({
  value,
  size = 'md',
  color,
  strokeWidth,
  showLabel = true,
  label,
  animate = true,
  caption,
}: ProgressRingProps) {
  const clampedValue = Math.min(100, Math.max(0, value))
  const { px, stroke: defaultStroke, fontSize, captionSize } = SIZE_MAP[size]
  const stroke = strokeWidth ?? defaultStroke
  const resolvedColor = color ?? getColor(clampedValue)

  const radius    = (px - stroke) / 2
  const circumference = 2 * Math.PI * radius

  // Animazione: parte da 0 e arriva a clampedValue
  const [displayed, setDisplayed] = useState(animate ? 0 : clampedValue)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!animate) { setDisplayed(clampedValue); return }
    const duration = 800
    const start    = performance.now()
    const from     = 0

    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(from + (clampedValue - from) * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [clampedValue, animate])

  // Re-anima se value cambia dopo il mount
  useEffect(() => {
    if (!animate) { setDisplayed(clampedValue); return }
    const duration = 500
    const start    = performance.now()
    const from     = displayed

    const tick = (now: number) => {
      const elapsed  = now - start
      const progress = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 3)
      setDisplayed(from + (clampedValue - from) * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedValue])

  const offset = circumference - (displayed / 100) * circumference
  const cx     = px / 2
  const cy     = px / 2

  const displayLabel = label ?? `${Math.round(displayed)}%`

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={px} height={px} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={resolvedColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke 0.3s ease' }}
        />
      </svg>

      {/* Label al centro (sovrapposta) */}
      {showLabel && (
        <div style={{
          position: 'relative',
          marginTop: -(px),
          width: px,
          height: px,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            fontSize,
            fontWeight: 700,
            color: resolvedColor,
            transition: 'color 0.3s ease',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}>
            {displayLabel}
          </span>
        </div>
      )}

      {/* Caption */}
      {caption && (
        <span style={{
          fontSize: captionSize,
          color: 'var(--color-dim)',
          textAlign: 'center',
          maxWidth: px,
          lineHeight: 1.3,
        }}>
          {caption}
        </span>
      )}
    </div>
  )
}
