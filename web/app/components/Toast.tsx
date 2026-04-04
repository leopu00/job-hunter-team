'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

type Toast = { id: string; type: ToastType; message: string; durationMs?: number }
type ToastCtx = { toast: (message: string, type?: ToastType, durationMs?: number) => void }

const ToastContext = createContext<ToastCtx>({ toast: () => {} })
export const useToast = () => useContext(ToastContext)

const TYPE_CFG: Record<ToastType, { icon: string; color: string; border: string }> = {
  success: { icon: '✓', color: 'var(--color-green)',  border: 'rgba(0,232,122,0.3)'  },
  error:   { icon: '✗', color: 'var(--color-red)',    border: 'rgba(255,69,96,0.3)'  },
  warning: { icon: '⚠', color: 'var(--color-yellow)', border: 'rgba(245,197,24,0.3)' },
  info:    { icon: 'ℹ', color: 'var(--color-blue)',   border: 'rgba(77,159,255,0.3)' },
}

function ToastItem({ t, onRemove }: { t: Toast; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false)
  const cfg = TYPE_CFG[t.type]
  const dur = t.durationMs ?? 4000

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => { setVisible(false); setTimeout(() => onRemove(t.id), 300) }, dur)
    return () => clearTimeout(timer)
  }, [t.id, dur, onRemove])

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border text-[11px] max-w-sm w-full"
      style={{
        borderColor: cfg.border, background: 'var(--color-panel)',
        borderLeft: `3px solid ${cfg.color}`,
        transform: visible ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
      }}>
      <span className="flex-shrink-0 font-bold text-[13px]" style={{ color: cfg.color }}>{cfg.icon}</span>
      <span className="flex-1" style={{ color: 'var(--color-bright)' }}>{t.message}</span>
      <button onClick={() => { setVisible(false); setTimeout(() => onRemove(t.id), 300) }}
        className="flex-shrink-0 text-[14px] leading-none cursor-pointer"
        style={{ color: 'var(--color-dim)', background: 'none', border: 'none' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-muted)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-dim)'}>×</button>
    </div>
  )
}

function ToastStack({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  if (!toasts.length) return null
  return (
    <div className="fixed flex flex-col gap-2 items-end" style={{ bottom: 24, right: 24, zIndex: 9000 }}>
      {toasts.map(t => <ToastItem key={t.id} t={t} onRemove={remove} />)}
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const remove = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  const toast = useCallback((message: string, type: ToastType = 'info', durationMs?: number) => {
    const id = `t-${Date.now()}-${++counter.current}`
    setToasts(prev => [...prev.slice(-4), { id, type, message, durationMs }])
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastStack toasts={toasts} remove={remove} />
    </ToastContext.Provider>
  )
}
