'use client'

import { useState, useEffect, useRef, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface Command {
  id:        string
  label:     string
  icon?:     React.ReactNode
  shortcut?: string
  group?:    string
  action:    () => void
}

interface Matched extends Command { indices: number[] }

export interface CommandPaletteProps {
  commands: Command[]
  open:     boolean
  onClose:  () => void
}

// ── Fuzzy match ────────────────────────────────────────────────────────────

function fuzzy(query: string, text: string) {
  if (!query) return { match: true, indices: [] as number[] }
  const q = query.toLowerCase(), t = text.toLowerCase()
  const indices: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++)
    if (t[ti] === q[qi]) { indices.push(ti); qi++ }
  return { match: qi === q.length, indices }
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices)
  return <>{text.split('').map((ch, i) =>
    set.has(i)
      ? <mark key={i} style={{ background: 'none', color: 'var(--color-green)', fontWeight: 700 }}>{ch}</mark>
      : <span key={i}>{ch}</span>
  )}</>
}

// ── CommandPalette ─────────────────────────────────────────────────────────

export function CommandPalette({ commands, open, onClose }: CommandPaletteProps) {
  const [query,  setQuery]  = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])

  const filtered = useMemo<Matched[]>(() =>
    commands.map(c => { const r = fuzzy(query, c.label); return r.match ? { ...c, indices: r.indices } : null })
      .filter(Boolean) as Matched[]
  , [commands, query])

  const groups = useMemo(() => {
    const map = new Map<string, Matched[]>()
    filtered.forEach(c => { const g = c.group ?? ''; if (!map.has(g)) map.set(g, []); map.get(g)!.push(c) })
    return map
  }, [filtered])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter') { const cmd = filtered[active]; if (cmd) { cmd.action(); onClose() } }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  return (
    <>
      <style>{`@keyframes cp-in { from { opacity:0; transform:scale(0.96) translateY(-8px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>

      <div className="fixed inset-0" style={{ zIndex: 80, background: 'rgba(0,0,0,0.6)' }} onClick={onClose} aria-hidden />

      <div role="dialog" aria-modal="true" aria-label="Palette comandi"
        className="fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2 rounded-xl overflow-hidden shadow-2xl"
        style={{ zIndex: 81, background: 'var(--color-deep)', border: '1px solid var(--color-border)', animation: 'cp-in 0.18s ease both' }}
        onKeyDown={onKey}>

        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-dim)', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }}
            placeholder="Cerca comandi…" className="flex-1 bg-transparent outline-none text-[12px]"
            style={{ color: 'var(--color-bright)' }} />
          <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} role="listbox" className="overflow-y-auto" style={{ maxHeight: 360 }}>
          {filtered.length === 0
            ? <p className="text-center py-8 text-[11px]" style={{ color: 'var(--color-dim)' }}>Nessun risultato per &ldquo;{query}&rdquo;</p>
            : Array.from(groups.entries()).map(([group, items]) => (
              <div key={group}>
                {group && <p className="px-4 pt-3 pb-1 text-[9px] font-semibold tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>{group}</p>}
                {items.map(cmd => {
                  const idx = filtered.indexOf(cmd)
                  return (
                    <div key={cmd.id} data-idx={idx} role="option" aria-selected={idx === active}
                      onClick={() => { cmd.action(); onClose() }}
                      onMouseEnter={() => setActive(idx)}
                      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                      style={{ background: idx === active ? 'var(--color-row)' : 'transparent' }}>
                      {cmd.icon && <span className="flex-shrink-0" style={{ color: 'var(--color-dim)' }}>{cmd.icon}</span>}
                      <span className="flex-1 text-[12px]" style={{ color: 'var(--color-bright)' }}>
                        <Highlight text={cmd.label} indices={cmd.indices} />
                      </span>
                      {cmd.shortcut && (
                        <kbd className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          }
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          {[['↑↓', 'naviga'], ['↵', 'seleziona'], ['esc', 'chiudi']].map(([k, v]) => (
            <span key={k} className="flex items-center gap-1">
              <kbd className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--color-row)', color: 'var(--color-dim)', border: '1px solid var(--color-border)' }}>{k}</kbd>
              <span className="text-[9px]" style={{ color: 'var(--color-dim)' }}>{v}</span>
            </span>
          ))}
        </div>
      </div>
    </>
  )
}

// ── useCommandPalette — Ctrl+K listener ───────────────────────────────────

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setOpen(v => !v) } }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [])
  return { open, setOpen, onClose: () => setOpen(false) }
}
