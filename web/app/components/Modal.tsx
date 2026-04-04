'use client'

import { useEffect } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  width?: number
}

export function Modal({ open, onClose, title, children, width = 480 }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-5 z-50"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', animation: 'fade-in 0.15s ease both' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="w-full rounded-xl overflow-hidden"
        style={{ maxWidth: width, background: 'var(--color-panel)', border: '1px solid var(--color-border)', animation: 'fade-in 0.2s ease both' }}>
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <h2 className="text-[14px] font-bold" style={{ color: 'var(--color-white)' }}>{title}</h2>
            <button onClick={onClose} className="text-[18px] leading-none cursor-pointer transition-colors"
              style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--color-muted)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>×</button>
          </div>
        )}
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}
