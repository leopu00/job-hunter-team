'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type ShortcutCtx = { registerEscape: (fn: () => void) => () => void }
const ShortcutContext = createContext<ShortcutCtx>({ registerEscape: () => () => {} })
export const useShortcuts = () => useContext(ShortcutContext)

const SHORTCUTS = [
  { keys: '⌘K',     label: 'Apri ricerca globale' },
  { keys: '⌘/',     label: 'Toggle sidebar' },
  { keys: 'Esc',    label: 'Chiudi modale / overlay' },
  { keys: '?',      label: 'Mostra questo help' },
  { keys: 'G D',    label: 'Vai a Dashboard' },
  { keys: 'G A',    label: 'Vai a Agenti' },
  { keys: 'G T',    label: 'Vai a Task' },
  { keys: 'G E',    label: 'Vai a Events' },
  { keys: 'G L',    label: 'Vai a Logs' },
]

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-5"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', animation: 'fade-in 0.15s ease both' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-sm rounded-xl overflow-hidden"
        style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', animation: 'fade-in 0.2s ease both' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-[12px] font-bold text-[var(--color-white)]">Scorciatoie tastiera</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-dim)', fontSize: 16 }}>×</button>
        </div>
        <ul className="px-5 py-4 flex flex-col gap-2.5">
          {SHORTCUTS.map(s => (
            <li key={s.keys} className="flex items-center justify-between gap-4">
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{s.label}</span>
              <kbd className="px-2 py-0.5 rounded text-[9px] font-mono font-bold flex-shrink-0"
                style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-bright)' }}>
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-[9px]" style={{ color: 'var(--color-dim)' }}>Premi <kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>Esc</kbd> o <kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)' }}>?</kbd> per chiudere</p>
      </div>
    </div>
  )
}

const GOTO: Record<string, string> = { d: '/dashboard', a: '/agents', t: '/tasks', e: '/events', l: '/logs' }

export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
  const [showHelp, setShowHelp] = useState(false)
  const [escapeFns] = useState<Set<() => void>>(new Set())
  const [pendingG, setPendingG] = useState(false)
  const router = useRouter()

  const registerEscape = useCallback((fn: () => void) => {
    escapeFns.add(fn)
    return () => escapeFns.delete(fn)
  }, [escapeFns])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable

      // Escape
      if (e.key === 'Escape') {
        if (showHelp) { setShowHelp(false); return }
        escapeFns.forEach(fn => fn())
        return
      }

      // Cmd+K — search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('jht:search'))
        return
      }

      // Cmd+/ — sidebar toggle
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('jht:sidebar-toggle'))
        return
      }

      if (typing) return

      // ? — help
      if (e.key === '?') { setShowHelp(h => !h); return }

      // G + letter — goto shortcut
      if (pendingG) {
        setPendingG(false)
        const dest = GOTO[e.key.toLowerCase()]
        if (dest) router.push(dest)
        return
      }
      if (e.key.toLowerCase() === 'g') { setPendingG(true); setTimeout(() => setPendingG(false), 1500) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showHelp, pendingG, escapeFns, router])

  return (
    <ShortcutContext.Provider value={{ registerEscape }}>
      {children}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </ShortcutContext.Provider>
  )
}
