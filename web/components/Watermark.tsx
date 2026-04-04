'use client'

import { useEffect, useId, useRef, useState } from 'react'

export interface WatermarkProps {
  text: string
  children?: React.ReactNode
  rotate?: number
  opacity?: number
  fontSize?: number
  color?: string
  /** Gap tra ripetizioni in px */
  gap?: number
  /** Posizione: 'overlay' (sopra contenuto) | 'underlay' (sotto contenuto) */
  layer?: 'overlay' | 'underlay'
  className?: string
}

export default function Watermark({
  text,
  children,
  rotate = -30,
  opacity = 0.1,
  fontSize = 16,
  color = 'currentColor',
  gap = 60,
  layer = 'overlay',
  className,
}: WatermarkProps) {
  const id          = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement>(null)
  const [dataUrl, setDataUrl] = useState<string>('')

  /* ── Genera pattern via canvas offscreen ── */
  useEffect(() => {
    const canvas  = document.createElement('canvas')
    const ctx     = canvas.getContext('2d')!
    const rad     = (rotate * Math.PI) / 180

    // Misura testo
    ctx.font = `${fontSize}px sans-serif`
    const metrics = ctx.measureText(text)
    const tw = metrics.width
    const th = fontSize

    // Tile size con gap
    const tileW = Math.ceil(Math.abs(tw * Math.cos(rad)) + Math.abs(th * Math.sin(rad))) + gap
    const tileH = Math.ceil(Math.abs(tw * Math.sin(rad)) + Math.abs(th * Math.cos(rad))) + gap

    canvas.width  = tileW
    canvas.height = tileH

    // Colore con opacity
    const resolvedColor = color === 'currentColor' ? '#888' : color
    ctx.fillStyle = resolvedColor
    ctx.globalAlpha = opacity
    ctx.font = `${fontSize}px sans-serif`

    ctx.save()
    ctx.translate(tileW / 2, tileH / 2)
    ctx.rotate(rad)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 0, 0)
    ctx.restore()

    setDataUrl(canvas.toDataURL())
  }, [text, rotate, opacity, fontSize, color, gap])

  const patternStyle: React.CSSProperties = dataUrl ? {
    position: 'absolute', inset: 0, zIndex: layer === 'overlay' ? 10 : 0,
    pointerEvents: 'none',
    backgroundImage: `url(${dataUrl})`,
    backgroundRepeat: 'repeat',
    backgroundSize: 'auto',
  } : {}

  /* ── Se nessun children: solo div watermark standalone ── */
  if (!children) {
    return (
      <div
        ref={containerRef}
        className={className}
        style={{ position: 'relative', width: '100%', height: '100%', ...patternStyle, opacity: 1 }}
      />
    )
  }

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      {layer === 'underlay' && <div style={patternStyle} />}
      <div style={{ position: 'relative', zIndex: layer === 'overlay' ? 1 : 'auto' }}>
        {children}
      </div>
      {layer === 'overlay' && <div style={patternStyle} />}
    </div>
  )
}

/* ── WatermarkText — versione semplice solo CSS, no canvas ── */
export function WatermarkText({
  text, rotate = -30, opacity = 0.08, fontSize = 14, color = '#888', gap = 80,
}: Omit<WatermarkProps, 'children' | 'layer' | 'className'>) {
  const id = useId().replace(/:/g, '')
  const styleId = `wm-${id}`

  useEffect(() => {
    const existing = document.getElementById(styleId)
    if (existing) return
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .${styleId}::before {
        content: '';
        position: absolute; inset: 0;
        background-image: repeating-linear-gradient(
          ${rotate}deg,
          transparent 0px,
          transparent ${gap - 1}px,
          transparent ${gap}px
        );
        pointer-events: none;
        z-index: 10;
      }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, [styleId, rotate, gap])

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
      gap: gap, padding: gap / 2,
    }}>
      {Array.from({ length: 40 }).map((_, i) => (
        <span key={i} style={{
          fontSize, color, opacity,
          transform: `rotate(${rotate}deg)`,
          whiteSpace: 'nowrap',
          userSelect: 'none',
          display: 'inline-block',
        }}>
          {text}
        </span>
      ))}
    </div>
  )
}
