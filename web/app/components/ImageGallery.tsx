'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export type GalleryImage = {
  src:     string
  alt?:    string
  caption?: string
}

export type ImageGalleryProps = {
  images:     GalleryImage[]
  columns?:   number    // default 3
  gap?:       number    // px, default 8
  className?: string
}

// ── Lightbox ───────────────────────────────────────────────────────────────

type LightboxProps = {
  images:  GalleryImage[]
  index:   number
  onClose: () => void
  onNav:   (i: number) => void
}

function Lightbox({ images, index, onClose, onNav }: LightboxProps) {
  const img      = images[index]
  const hasPrev  = index > 0
  const hasNext  = index < images.length - 1
  const [zoom, setZoom] = useState(false)

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      { onClose() }
      if (e.key === 'ArrowLeft'  && hasPrev) onNav(index - 1)
      if (e.key === 'ArrowRight' && hasNext) onNav(index + 1)
      if (e.key === 'z' || e.key === 'Z')    setZoom(v => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, hasPrev, hasNext, onClose, onNav])

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div role="dialog" aria-label={`Immagine ${index + 1} di ${images.length}`} className="fixed inset-0 flex flex-col items-center justify-center"
      style={{ zIndex: 9999, background: 'rgba(0,0,0,0.92)', animation: 'lb-in 0.18s ease' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)' }}>
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-dim)' }}>
          {index + 1} / {images.length}
        </span>
        <div className="flex items-center gap-3">
          <button onClick={() => setZoom(v => !v)} title="Zoom (Z)" aria-label={zoom ? 'Riduci zoom' : 'Ingrandisci'}
            className="text-[11px] px-2 py-1 rounded transition-opacity hover:opacity-70"
            style={{ background: zoom ? 'var(--color-blue)22' : 'transparent', color: zoom ? 'var(--color-blue)' : 'var(--color-dim)', border: `1px solid ${zoom ? 'var(--color-blue)44' : 'var(--color-border)'}` }}>
            {zoom ? '⊖' : '⊕'}
          </button>
          <button onClick={onClose} title="Chiudi (Esc)" aria-label="Chiudi lightbox"
            className="text-[18px] leading-none hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-dim)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
      </div>

      {/* Prev */}
      {hasPrev && (
        <button onClick={() => onNav(index - 1)} aria-label="Immagine precedente"
          className="absolute left-3 text-[24px] w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>‹</button>
      )}

      {/* Image */}
      <img src={img.src} alt={img.alt ?? ''}
        onClick={() => setZoom(v => !v)}
        className="transition-transform duration-200"
        style={{
          maxWidth:  zoom ? '95vw' : '80vw',
          maxHeight: zoom ? '90vh' : '75vh',
          objectFit: 'contain',
          borderRadius: 8,
          cursor: zoom ? 'zoom-out' : 'zoom-in',
          transform: zoom ? 'scale(1.05)' : 'scale(1)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        }} />

      {/* Next */}
      {hasNext && (
        <button onClick={() => onNav(index + 1)} aria-label="Immagine successiva"
          className="absolute right-3 text-[24px] w-10 h-10 rounded-full flex items-center justify-center hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}>›</button>
      )}

      {/* Caption + dots */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-2 px-4 pb-4"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
        {img.caption && (
          <p className="text-[11px] text-center max-w-lg" style={{ color: 'var(--color-muted)' }}>{img.caption}</p>
        )}
        <div className="flex gap-1.5">
          {images.map((_, i) => (
            <button key={i} onClick={() => onNav(i)} aria-label={`Vai all'immagine ${i + 1}`}
              className="rounded-full transition-all"
              style={{ width: i === index ? 16 : 6, height: 6, background: i === index ? 'var(--color-blue)' : 'var(--color-dim)', border: 'none', cursor: 'pointer' }} />
          ))}
        </div>
      </div>

      <style>{`@keyframes lb-in { from { opacity:0 } to { opacity:1 } }`}</style>
    </div>
  )
}

// ── ImageGallery ───────────────────────────────────────────────────────────

export function ImageGallery({ images, columns = 3, gap = 8, className }: ImageGalleryProps) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  const close = useCallback(() => setLightbox(null), [])
  const nav   = useCallback((i: number) => setLightbox(i), [])

  if (!images.length) return null

  return (
    <>
      <div className={`grid ${className ?? ''}`}
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap }}>
        {images.map((img, i) => (
          <button key={i} onClick={() => setLightbox(i)}
            className="relative overflow-hidden rounded-lg group transition-transform hover:scale-[1.02]"
            style={{ aspectRatio: '4/3', background: 'var(--color-deep)', border: '1px solid var(--color-border)', cursor: 'zoom-in', padding: 0 }}>
            <img src={img.src} alt={img.alt ?? ''}
              className="w-full h-full object-cover transition-opacity group-hover:opacity-80" />
            {img.caption && (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'rgba(0,0,0,0.7)' }}>
                <p className="text-[9px] truncate" style={{ color: 'var(--color-muted)' }}>{img.caption}</p>
              </div>
            )}
          </button>
        ))}
      </div>

      {lightbox !== null && (
        <Lightbox images={images} index={lightbox} onClose={close} onNav={nav} />
      )}
    </>
  )
}
