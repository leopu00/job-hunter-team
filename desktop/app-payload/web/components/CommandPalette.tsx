'use client'

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { useRouter } from 'next/navigation'
import { useShortcuts } from '../app/components/KeyboardShortcuts'

// --- Context per coordinamento con SearchBar ---
type PaletteCtx = { isOpen: boolean }
export const CommandPaletteContext = createContext<PaletteCtx>({ isOpen: false })
export const useCommandPalette = () => useContext(CommandPaletteContext)

// --- Comandi statici ---
type Cmd = { id: string; label: string; detail: string; category: string; href?: string; action?: () => void }

const STATIC_COMMANDS: Cmd[] = [
  { id: 'overview',     label: 'Overview',         detail: 'Dashboard principale',             category: 'Pagine',  href: '/overview' },
  { id: 'agents',       label: 'Agenti',           detail: 'Lista e stato agenti',              category: 'Pagine',  href: '/agents' },
  { id: 'sessions',     label: 'Sessioni',         detail: 'Conversazioni e chat replay',       category: 'Pagine',  href: '/sessions' },
  { id: 'analytics',    label: 'Analytics',        detail: 'Token, costi, latenza p95',         category: 'Pagine',  href: '/analytics' },
  { id: 'health',       label: 'Health Check',     detail: 'Stato 7 moduli con semafori',       category: 'Pagine',  href: '/health' },
  { id: 'settings',     label: 'Impostazioni',     detail: 'Provider AI, Telegram, cron',       category: 'Pagine',  href: '/settings' },
  { id: 'credentials',  label: 'Credenziali',      detail: 'API key e OAuth cifrati AES-256',   category: 'Pagine',  href: '/credentials' },
  { id: 'plugins',      label: 'Plugin',           detail: 'Gestione plugin attivi/disabilitati', category: 'Pagine', href: '/plugins' },
  { id: 'logs',         label: 'Logs',             detail: 'Log strutturati con filtri',        category: 'Pagine',  href: '/logs' },
  { id: 'memory',       label: 'Memory',           detail: 'SOUL / IDENTITY / MEMORY agenti',  category: 'Pagine',  href: '/memory' },
  { id: 'queue',        label: 'Job Queue',        detail: 'Task in coda e dead-letter',        category: 'Pagine',  href: '/queue' },
  { id: 'events',       label: 'Events SSE',       detail: 'Stream eventi real-time',           category: 'Pagine',  href: '/events' },
  { id: 'cron',         label: 'Cron Jobs',        detail: 'Task schedulati',                   category: 'Pagine',  href: '/cron' },
  { id: 'export',       label: 'Export',           detail: 'Esporta sessioni, task, analytics', category: 'Azioni',  href: '/export' },
  { id: 'import',       label: 'Import',           detail: 'Importa dati con validazione',      category: 'Azioni',  href: '/import' },
  { id: 'backup',       label: 'Backup',           detail: 'Crea e ripristina backup',          category: 'Azioni',  href: '/backup' },
]

const CATEGORY_COLORS: Record<string, string> = {
  Pagine: 'var(--color-blue)',
  Azioni: 'var(--color-green)',
  Risultati: 'var(--color-cyan)',
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [extra, setExtra] = useState<Cmd[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { registerEscape } = useShortcuts()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const close = useCallback(() => { setOpen(false); setQuery(''); setExtra([]) }, [])

  useEffect(() => {
    if (!open) return
    const unreg = registerEscape(close)
    inputRef.current?.focus()
    return unreg
  }, [open, close, registerEscape])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Ricerca dinamica via /api/search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (query.length < 2) { setExtra([]); return }
    timerRef.current = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`).catch(() => null)
      if (!res?.ok) return
      const data = await res.json()
      setExtra((data.results ?? []).map((r: { id: string; title: string; detail: string; href: string }) => ({
        id: `search-${r.id}`, label: r.title, detail: r.detail, category: 'Risultati', href: r.href,
      })))
    }, 180)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  const filtered = [
    ...(query ? STATIC_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(query.toLowerCase()) ||
      c.detail.toLowerCase().includes(query.toLowerCase())
    ) : STATIC_COMMANDS),
    ...extra,
  ]

  const execute = useCallback((cmd: Cmd) => {
    close()
    if (cmd.action) cmd.action()
    else if (cmd.href) router.push(cmd.href)
  }, [close, router])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && filtered[selected]) { e.preventDefault(); execute(filtered[selected]) }
  }

  if (!open) return (
    <CommandPaletteContext.Provider value={{ isOpen: false }}>
      <></>
    </CommandPaletteContext.Provider>
  )

  return (
    <CommandPaletteContext.Provider value={{ isOpen: true }}>
      <div className="fixed inset-0 flex items-start justify-center pt-[10vh] px-4 z-[9990]"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={e => { if (e.target === e.currentTarget) close() }}>
        <div className="w-full max-w-xl rounded-xl overflow-hidden"
          style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)', boxShadow: '0 16px 48px rgba(0,0,0,0.6)', animation: 'fade-in 0.15s ease both' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="var(--color-dim)" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setSelected(0) }}
              onKeyDown={onKeyDown} placeholder="Cerca pagine, azioni, comandi…"
              aria-label="Cerca comandi"
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--color-bright)' }} />
            <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-border)', color: 'var(--color-dim)' }}>esc</kbd>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '55vh' }}>
            {filtered.length === 0 && (
              <p className="px-4 py-6 text-center text-[11px]" style={{ color: 'var(--color-dim)' }}>Nessun risultato</p>
            )}
            {filtered.map((cmd, i) => {
              const color = CATEGORY_COLORS[cmd.category] ?? 'var(--color-dim)'
              return (
                <button key={cmd.id} onClick={() => execute(cmd)} onMouseEnter={() => setSelected(i)}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-left cursor-pointer transition-colors"
                  style={{ background: selected === i ? 'var(--color-row)' : 'transparent' }}>
                  <span className="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold shrink-0 w-16 text-center"
                    style={{ background: `${color}22`, color }}>{cmd.category}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-bright)' }}>{cmd.label}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--color-dim)' }}>{cmd.detail}</p>
                  </div>
                  {cmd.href && <span className="text-[10px] shrink-0" style={{ color: 'var(--color-dim)' }}>↵</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </CommandPaletteContext.Provider>
  )
}
