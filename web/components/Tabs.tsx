'use client'

import { useEffect, useRef, useState } from 'react'

export type TabsVariant = 'underline' | 'pills' | 'boxed'

export interface TabItem {
  id: string
  label: string
  icon?: string
  badge?: string | number
  disabled?: boolean
}

export interface TabsProps {
  tabs: TabItem[]
  activeTab: string
  onTabChange: (id: string) => void
  variant?: TabsVariant
  /** Contenuto pannello — se omesso, Tabs è solo navigazione */
  renderPanel?: (tabId: string) => React.ReactNode
  className?: string
}

export default function Tabs({
  tabs,
  activeTab,
  onTabChange,
  variant = 'underline',
  renderPanel,
  className,
}: TabsProps) {
  const listRef   = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({})

  // Calcola posizione indicatore animato (solo variant=underline)
  useEffect(() => {
    if (variant !== 'underline') return
    const btn = activeRef.current
    const list = listRef.current
    if (!btn || !list) return
    const bRect = btn.getBoundingClientRect()
    const lRect = list.getBoundingClientRect()
    setIndicatorStyle({ left: bRect.left - lRect.left, width: bRect.width })
  }, [activeTab, variant])

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    const navigable = tabs.filter(t => !t.disabled)
    const navIdx    = navigable.findIndex(t => t.id === tabs[currentIdx].id)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = navigable[(navIdx + 1) % navigable.length]
      if (next) { onTabChange(next.id); focusTab(next.id) }
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = navigable[(navIdx - 1 + navigable.length) % navigable.length]
      if (prev) { onTabChange(prev.id); focusTab(prev.id) }
    }
    if (e.key === 'Home') { e.preventDefault(); const first = navigable[0]; if (first) { onTabChange(first.id); focusTab(first.id) } }
    if (e.key === 'End')  { e.preventDefault(); const last = navigable[navigable.length-1]; if (last) { onTabChange(last.id); focusTab(last.id) } }
  }

  const focusTab = (id: string) => {
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tabid="${id}"]`)?.focus()
  }

  /* ── Stili per variante ── */
  const listStyle: React.CSSProperties = {
    display: 'flex', position: 'relative', gap: variant === 'pills' ? 4 : 0,
    ...(variant === 'underline' && { borderBottom: '1px solid var(--color-border)' }),
    ...(variant === 'boxed'     && { border: '1px solid var(--color-border)', borderRadius: 8, padding: 3, background: 'var(--color-row)' }),
  }

  const tabStyle = (tab: TabItem, isActive: boolean): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 6,
      padding: variant === 'underline' ? '8px 14px' : '6px 14px',
      fontSize: 11, fontWeight: isActive ? 700 : 500,
      border: 'none', cursor: tab.disabled ? 'default' : 'pointer',
      opacity: tab.disabled ? 0.4 : 1,
      transition: 'color 0.15s, background 0.15s',
      outline: 'none', position: 'relative',
      borderRadius: variant === 'pills' ? 20 : variant === 'boxed' ? 6 : 0,
      whiteSpace: 'nowrap',
    }
    if (variant === 'underline') return { ...base,
      background: 'transparent',
      color: isActive ? 'var(--color-bright)' : 'var(--color-dim)',
      paddingBottom: 9,
    }
    if (variant === 'pills') return { ...base,
      background: isActive ? 'var(--color-green)' : 'transparent',
      color: isActive ? '#000' : 'var(--color-muted)',
    }
    // boxed
    return { ...base,
      background: isActive ? 'var(--color-panel)' : 'transparent',
      color: isActive ? 'var(--color-bright)' : 'var(--color-dim)',
      boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
    }
  }

  return (
    <div className={className}>
      {/* Tab list */}
      <div ref={listRef} role="tablist" style={listStyle}>
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              ref={isActive ? activeRef : undefined}
              data-tabid={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              disabled={tab.disabled}
              tabIndex={isActive ? 0 : -1}
              onClick={() => !tab.disabled && onTabChange(tab.id)}
              onKeyDown={e => handleKeyDown(e, i)}
              style={tabStyle(tab, isActive)}
              onMouseEnter={e => { if (!isActive && !tab.disabled) e.currentTarget.style.color = 'var(--color-muted)' }}
              onMouseLeave={e => { if (!isActive && !tab.disabled) e.currentTarget.style.color = 'var(--color-dim)' }}
            >
              {tab.icon && <span style={{ fontSize: 13 }}>{tab.icon}</span>}
              {tab.label}
              {tab.badge !== undefined && (
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                  background: isActive && variant !== 'pills' ? 'var(--color-green)' : 'var(--color-border)',
                  color: isActive && variant !== 'pills' ? '#000' : 'var(--color-dim)',
                  minWidth: 16, textAlign: 'center',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}

        {/* Indicatore animato underline */}
        {variant === 'underline' && (
          <div style={{
            position: 'absolute', bottom: -1, height: 2,
            background: 'var(--color-green)', borderRadius: 1,
            transition: 'left 0.2s ease, width 0.2s ease',
            ...indicatorStyle,
          }} />
        )}
      </div>

      {/* Pannello contenuto */}
      {renderPanel && (
        <div role="tabpanel" id={`panel-${activeTab}`} style={{ paddingTop: variant === 'underline' ? 16 : 12 }}>
          {renderPanel(activeTab)}
        </div>
      )}
    </div>
  )
}
