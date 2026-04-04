'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/* ── Particella ── */
interface Particle {
  x: number; y: number
  vx: number; vy: number
  color: string
  size: number
  rotation: number
  rotSpeed: number
  shape: 'rect' | 'circle' | 'ribbon'
  alpha: number
}

const COLORS = ['#00e87a','#4ade80','#facc15','#fb923c','#f472b6','#60a5fa','#a78bfa','#fff']

function makeParticle(canvasW: number): Particle {
  return {
    x: Math.random() * canvasW,
    y: -10 - Math.random() * 40,
    vx: (Math.random() - 0.5) * 3,
    vy: 2.5 + Math.random() * 3.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 5 + Math.random() * 8,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.2,
    shape: (['rect','rect','circle','ribbon'] as const)[Math.floor(Math.random() * 4)],
    alpha: 1,
  }
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.save()
  ctx.globalAlpha = p.alpha
  ctx.fillStyle   = p.color
  ctx.translate(p.x, p.y)
  ctx.rotate(p.rotation)
  if (p.shape === 'circle') {
    ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill()
  } else if (p.shape === 'ribbon') {
    ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3)
  } else {
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
  }
  ctx.restore()
}

/* ── Canvas component ── */
interface ConfettiCanvasProps { onDone: () => void; duration?: number }

function ConfettiCanvas({ onDone, duration = 3000 }: ConfettiCanvasProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const startRef   = useRef<number>(0)
  const particles  = useRef<Particle[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    // Burst iniziale: 120 particelle
    for (let i = 0; i < 120; i++) particles.current.push(makeParticle(canvas.width))

    const tick = (now: number) => {
      if (!startRef.current) startRef.current = now
      const elapsed = now - startRef.current
      const fadeStart = duration * 0.55
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      particles.current.forEach(p => {
        p.x += p.vx; p.y += p.vy
        p.vy += 0.08   // gravità
        p.vx *= 0.995  // attrito aria
        p.rotation += p.rotSpeed
        if (elapsed > fadeStart) p.alpha = Math.max(0, 1 - (elapsed - fadeStart) / (duration - fadeStart))
        drawParticle(ctx, p)
      })

      // Rimuovi particelle uscite dallo schermo
      particles.current = particles.current.filter(p => p.y < canvas.height + 20 && p.alpha > 0.01)

      if (elapsed < duration) {
        // Aggiungi nuove particelle nei primi 600ms
        if (elapsed < 600 && Math.random() < 0.6) particles.current.push(makeParticle(canvas.width))
        rafRef.current = requestAnimationFrame(tick)
      } else {
        onDone()
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [duration, onDone])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}
    />
  )
}

/* ── Hook ── */
export function useConfetti() {
  const [active, setActive] = useState(false)
  const fire = useCallback(() => setActive(true), [])
  const dismiss = useCallback(() => setActive(false), [])
  return { fire, dismiss, active }
}

/* ── Componente esportabile ── */
export interface ConfettiAnimationProps {
  active: boolean
  onDone?: () => void
  duration?: number
}

export default function ConfettiAnimation({ active, onDone, duration = 3000 }: ConfettiAnimationProps) {
  const handleDone = useCallback(() => { onDone?.() }, [onDone])
  if (!active) return null
  return <ConfettiCanvas onDone={handleDone} duration={duration} />
}
