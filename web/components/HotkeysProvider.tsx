'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/* ── Tipi ── */
export interface Hotkey {
  /** Es: 'ctrl+k', 'mod+shift+p', '?' — mod = ctrl su Win, cmd su Mac */
  keys: string
  handler: (e: KeyboardEvent) => void
  description?: string
  scope?: string
  enabled?: boolean
}

interface HotkeysCtx {
  register:   (h: Hotkey) => () => void
  activeScope: string
  setScope:   (s: string) => void
  all:        Hotkey[]
}

const Ctx = createContext<HotkeysCtx | null>(null)

/* ── Normalizza combo ── */
function normalizeKeys(keys: string): string {
  return keys.toLowerCase()
    .replace(/mod/g,   typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? 'meta' : 'ctrl')
    .replace(/\s/g, '')
}

function eventToCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey)  parts.push('ctrl')
  if (e.metaKey)  parts.push('meta')
  if (e.altKey)   parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const k = e.key.toLowerCase()
  if (!['control','meta','alt','shift'].includes(k)) parts.push(k)
  return parts.join('+')
}

/* ── Provider ── */
export function HotkeysProvider({ children, defaultScope = 'global' }: { children: React.ReactNode; defaultScope?: string }) {
  const hotkeysRef = useRef<Hotkey[]>([])
  const [activeScope, setScope] = useState(defaultScope)
  const [showCheatsheet, setShow] = useState(false)

  const register = useCallback((h: Hotkey) => {
    hotkeysRef.current = [...hotkeysRef.current, h]
    return () => { hotkeysRef.current = hotkeysRef.current.filter(x => x !== h) }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignora input/textarea salvo Escape
      const tag = (e.target as HTMLElement)?.tagName
      if (['INPUT','TEXTAREA','SELECT'].includes(tag) && e.key !== 'Escape') return

      const combo = eventToCombo(e)

      // Shortcut speciale: '?' apre cheatsheet
      if (combo === '?' || combo === 'shift+/') { e.preventDefault(); setShow(v => !v); return }

      hotkeysRef.current.forEach(h => {
        if (h.enabled === false) return
        if (h.scope && h.scope !== activeScope) return
        if (normalizeKeys(h.keys) !== combo) return
        e.preventDefault()
        h.handler(e)
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activeScope])

  return (
    <Ctx.Provider value={{ register, activeScope, setScope, all: hotkeysRef.current }}>
      {children}
      {showCheatsheet && (
        <Cheatsheet hotkeys={hotkeysRef.current} onClose={() => setShow(false)} />
      )}
    </Ctx.Provider>
  )
}

/* ── Hook ── */
export function useHotkeys(hotkeys: Omit<Hotkey, 'handler'>[], handlers: ((e: KeyboardEvent) => void)[]) {
  const ctx = useContext(Ctx)
  useEffect(() => {
    if (!ctx) return
    const cleanups = hotkeys.map((h, i) => ctx.register({ ...h, handler: handlers[i] }))
    return () => cleanups.forEach(fn => fn())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])
}

export function useHotkeysScope() {
  const ctx = useContext(Ctx)
  return { scope: ctx?.activeScope ?? 'global', setScope: ctx?.setScope ?? (() => {}) }
}

/* ── Cheatsheet modal ── */
function Cheatsheet({ hotkeys, onClose }: { hotkeys: Hotkey[]; onClose: () => void }) {
  const grouped = hotkeys.reduce<Record<string, Hotkey[]>>((acc, h) => {
    const s = h.scope ?? 'global'
    ;(acc[s] ??= []).push(h)
    return acc
  }, {})

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '20px 24px', maxWidth: 480, width: '100%', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--color-bright)' }}>Scorciatoie tastiera</h3>
          <kbd style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--color-border)', color: 'var(--color-dim)' }}>?</kbd>
        </div>
        {Object.entries(grouped).map(([scope, hs]) => (
          <div key={scope} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{scope}</div>
            {hs.filter(h => h.description).map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{h.description}</span>
                <kbd style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-row)', color: 'var(--color-bright)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{h.keys}</kbd>
              </div>
            ))}
          </div>
        ))}
        {hotkeys.filter(h => h.description).length === 0 && (
          <p style={{ fontSize: 11, color: 'var(--color-dim)', textAlign: 'center' }}>Nessuna shortcut registrata</p>
        )}
      </div>
    </div>
  )
}
