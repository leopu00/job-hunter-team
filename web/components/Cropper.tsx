'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface CropperProps {
  src: string
  aspectRatio?: number | 'free'
  onCrop: (dataURL: string, blob: Blob) => void
  onCancel?: () => void
  outputSize?: number
}

interface Crop { x: number; y: number; w: number; h: number }

const CANVAS_SIZE = 320

export default function Cropper({ src, aspectRatio = 1, onCrop, onCancel, outputSize = 512 }: CropperProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const imgRef      = useRef<HTMLImageElement | null>(null)
  const [zoom, setZoom]     = useState(1)
  const [rotate, setRotate] = useState(0)
  const [crop, setCrop]     = useState<Crop>({ x: 60, y: 60, w: 200, h: 200 })
  const [dragging, setDragging] = useState<'move' | 'resize' | null>(null)
  const dragStart  = useRef({ mx: 0, my: 0, crop: crop })

  /* ── Carica immagine ── */
  useEffect(() => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => { imgRef.current = img; draw() }
    img.src = src
  }, [src])

  /* ── Disegna canvas ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current; const img = imgRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Immagine con zoom e rotate
    ctx.save()
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.scale(zoom, zoom)
    const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height)
    const iw = img.width * scale; const ih = img.height * scale
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih)
    ctx.restore()

    // Overlay scuro
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Buco crop — redraw immagine nell'area crop
    ctx.save()
    ctx.beginPath()
    ctx.rect(crop.x, crop.y, crop.w, crop.h)
    ctx.clip()
    ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2)
    ctx.rotate((rotate * Math.PI) / 180)
    ctx.scale(zoom, zoom)
    ctx.drawImage(img, -iw! / 2, -ih! / 2, iw!, ih!)
    ctx.restore()

    // Border crop
    ctx.strokeStyle = 'var(--color-green, #00e87a)'
    ctx.lineWidth = 2; ctx.setLineDash([])
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h)

    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5
    ;[1,2].forEach(n => {
      ctx.beginPath(); ctx.moveTo(crop.x + crop.w * n / 3, crop.y); ctx.lineTo(crop.x + crop.w * n / 3, crop.y + crop.h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(crop.x, crop.y + crop.h * n / 3); ctx.lineTo(crop.x + crop.w, crop.y + crop.h * n / 3); ctx.stroke()
    })

    // Handles angoli
    ctx.fillStyle = '#fff'
    ;[[crop.x,crop.y],[crop.x+crop.w,crop.y],[crop.x,crop.y+crop.h],[crop.x+crop.w,crop.y+crop.h]].forEach(([hx,hy]) => {
      ctx.fillRect(hx! - 4, hy! - 4, 8, 8)
    })
  }, [crop, zoom, rotate])

  useEffect(() => { draw() }, [draw])

  /* ── Mouse interaction ── */
  const onMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width)
    const my = (e.clientY - rect.top)  * (CANVAS_SIZE / rect.height)
    const nearEdge = mx > crop.x + crop.w - 16 && my > crop.y + crop.h - 16
    setDragging(nearEdge ? 'resize' : 'move')
    dragStart.current = { mx, my, crop: { ...crop } }
  }

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width)
    const my = (e.clientY - rect.top)  * (CANVAS_SIZE / rect.height)
    const dx = mx - dragStart.current.mx; const dy = my - dragStart.current.my
    const c  = dragStart.current.crop
    if (dragging === 'move') {
      setCrop({ ...c, x: Math.max(0, Math.min(CANVAS_SIZE - c.w, c.x + dx)), y: Math.max(0, Math.min(CANVAS_SIZE - c.h, c.y + dy)) })
    } else {
      const newW = Math.max(40, c.w + dx)
      const newH = aspectRatio === 'free' ? Math.max(40, c.h + dy) : newW / (aspectRatio as number)
      setCrop({ ...c, w: Math.min(newW, CANVAS_SIZE - c.x), h: Math.min(newH, CANVAS_SIZE - c.y) })
    }
  }, [dragging, aspectRatio])

  /* ── Export ── */
  const handleCrop = () => {
    const img = imgRef.current; if (!img) return
    const out = document.createElement('canvas'); out.width = outputSize; out.height = outputSize
    const ctx = out.getContext('2d')!
    const scaleX = (img.width  * Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * zoom) / CANVAS_SIZE
    const scaleY = (img.height * Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height) * zoom) / CANVAS_SIZE
    ctx.drawImage(img, (crop.x / CANVAS_SIZE) * img.width / scaleX, (crop.y / CANVAS_SIZE) * img.height / scaleY, (crop.w / CANVAS_SIZE) * img.width / scaleX, (crop.h / CANVAS_SIZE) * img.height / scaleY, 0, 0, outputSize, outputSize)
    const dataURL = out.toDataURL('image/jpeg', 0.92)
    out.toBlob(blob => { if (blob) onCrop(dataURL, blob) }, 'image/jpeg', 0.92)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, userSelect: 'none' }}>
      <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={() => setDragging(null)} onMouseLeave={() => setDragging(null)}
        style={{ borderRadius: 8, border: '1px solid var(--color-border)', cursor: dragging ? 'grabbing' : 'crosshair', width: '100%', maxWidth: CANVAS_SIZE }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--color-dim)', flexShrink: 0 }}>🔍</span>
        <input type="range" min={0.5} max={3} step={0.05} value={zoom} onChange={e => setZoom(+e.target.value)} style={{ flex: 1, accentColor: 'var(--color-green)' }} />
        <button onClick={() => setRotate(r => r - 90)} style={{ fontSize: 14, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>↺</button>
        <button onClick={() => setRotate(r => r + 90)} style={{ fontSize: 14, background: 'none', border: '1px solid var(--color-border)', color: 'var(--color-muted)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>↻</button>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button onClick={onCancel} style={{ padding: '6px 14px', fontSize: 11, borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }}>Annulla</button>}
        <button onClick={handleCrop} style={{ padding: '6px 16px', fontSize: 11, fontWeight: 700, borderRadius: 7, border: 'none', background: 'var(--color-green)', color: '#000', cursor: 'pointer' }}>Ritaglia ✓</button>
      </div>
    </div>
  )
}
