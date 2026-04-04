'use client'

import { useRef } from 'react'

export type Tab<T extends string = string> = {
  id: T
  label: string
  badge?: number | string
  disabled?: boolean
}

type Props<T extends string> = {
  tabs: Tab<T>[]
  active: T
  onChange: (id: T) => void
  size?: 'sm' | 'md'
}

export function Tabs<T extends string>({ tabs, active, onChange, size = 'md' }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const fs = size === 'sm' ? '10px' : '11px'

  const handleKeyDown = (e: React.KeyboardEvent, id: T) => {
    const all = tabs.filter(t => !t.disabled)
    const idx = all.findIndex(t => t.id === id)
    if (e.key === 'ArrowRight') { e.preventDefault(); if (idx < all.length - 1) onChange(all[idx + 1].id) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); if (idx > 0) onChange(all[idx - 1].id) }
    if (e.key === 'Home')       { e.preventDefault(); onChange(all[0].id) }
    if (e.key === 'End')        { e.preventDefault(); onChange(all[all.length - 1].id) }
  }

  return (
    <div ref={listRef} role="tablist" className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
      {tabs.map(tab => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            tabIndex={isActive ? 0 : -1}
            onClick={() => !tab.disabled && onChange(tab.id)}
            onKeyDown={e => handleKeyDown(e, tab.id)}
            className="flex items-center gap-1.5 px-3 py-2.5 font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none relative"
            style={{
              fontSize: fs,
              color: isActive ? 'var(--color-green)' : 'var(--color-dim)',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--color-green)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {tab.label}
            {tab.badge !== undefined && (
              <span className="px-1.5 py-0.5 rounded font-mono"
                style={{
                  fontSize: '9px',
                  background: isActive ? 'rgba(0,232,122,0.12)' : 'var(--color-card)',
                  color: isActive ? 'var(--color-green)' : 'var(--color-dim)',
                  border: `1px solid ${isActive ? 'rgba(0,232,122,0.25)' : 'var(--color-border)'}`,
                }}>
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
