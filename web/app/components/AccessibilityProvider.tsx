'use client'

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'

// ─── Context ───────────────────────────────────────────────────────────────
type A11yCtx = { announce: (msg: string, assertive?: boolean) => void }
const A11yContext = createContext<A11yCtx>({ announce: () => {} })
export const useA11y = () => useContext(A11yContext)

// ─── Focus trap hook ───────────────────────────────────────────────────────
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const el = ref.current
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!nodes.length) return
    const first = nodes[0]
    const last  = nodes[nodes.length - 1]
    const prev  = document.activeElement as HTMLElement | null
    first.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus() }
      }
    }
    el.addEventListener('keydown', trap)
    return () => { el.removeEventListener('keydown', trap); prev?.focus() }
  }, [active, ref])
}

// ─── Provider ──────────────────────────────────────────────────────────────
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const politeRef   = useRef<HTMLDivElement>(null)
  const assertRef   = useRef<HTMLDivElement>(null)

  const announce = useCallback((msg: string, assertive = false) => {
    const el = assertive ? assertRef.current : politeRef.current
    if (!el) return
    el.textContent = ''
    requestAnimationFrame(() => { el.textContent = msg })
  }, [])

  return (
    <A11yContext.Provider value={{ announce }}>
      {/* Skip to main content — visible on focus only */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded focus:text-[11px] focus:font-bold focus:outline-none"
        style={{ background: 'var(--color-green)', color: 'var(--color-void)' }}
        tabIndex={0}
      >
        Salta al contenuto principale
      </a>

      {/* Aria live regions (sr-only) */}
      <div ref={politeRef}  aria-live="polite"   aria-atomic="true" className="sr-only" />
      <div ref={assertRef}  aria-live="assertive" aria-atomic="true" className="sr-only" />

      {children}
    </A11yContext.Provider>
  )
}
