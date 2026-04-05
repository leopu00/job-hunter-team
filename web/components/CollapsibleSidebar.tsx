'use client'

import { useState } from 'react'

export interface SidebarItem {
  id: string
  label: string
  icon: string
  href?: string
  onClick?: () => void
  disabled?: boolean
}

export interface SidebarSection {
  title?: string
  items: SidebarItem[]
}

export interface CollapsibleSidebarProps {
  sections: SidebarSection[]
  activeId?: string
  collapsed?: boolean
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onItemClick?: (item: SidebarItem) => void
  /** Larghezza espansa in px */
  expandedWidth?: number
  /** Larghezza collapsed in px */
  collapsedWidth?: number
}

export default function CollapsibleSidebar({
  sections, activeId, collapsed: ctrl, defaultCollapsed = false,
  onCollapsedChange, onItemClick, expandedWidth = 220, collapsedWidth = 52,
}: CollapsibleSidebarProps) {
  const isCtrl   = ctrl !== undefined
  const [internal, setInternal] = useState(defaultCollapsed)
  const collapsed = isCtrl ? ctrl! : internal
  const [tooltip, setTooltip] = useState<{ id: string; y: number } | null>(null)

  const toggle = () => {
    const next = !collapsed
    if (!isCtrl) setInternal(next)
    onCollapsedChange?.(next)
    setTooltip(null)
  }

  const width = collapsed ? collapsedWidth : expandedWidth

  const sidebarStyle: React.CSSProperties = {
    width, minHeight: '100%',
    background: 'var(--color-panel)',
    borderRight: '1px solid var(--color-border)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
    flexShrink: 0,
    position: 'relative',
  }

  const itemStyle = (item: SidebarItem): React.CSSProperties => {
    const isActive = item.id === activeId
    return {
      display: 'flex', alignItems: 'center',
      gap: collapsed ? 0 : 10,
      padding: collapsed ? `8px 0` : '8px 12px',
      justifyContent: collapsed ? 'center' : 'flex-start',
      borderRadius: 7, cursor: item.disabled ? 'default' : 'pointer',
      opacity: item.disabled ? 0.4 : 1,
      background: isActive ? 'color-mix(in srgb, var(--color-green,#00e87a) 12%, transparent)' : 'transparent',
      color: isActive ? 'var(--color-green,#00e87a)' : 'var(--color-dim)',
      fontWeight: isActive ? 600 : 400,
      fontSize: 13, transition: 'background 0.15s, color 0.15s',
      position: 'relative', userSelect: 'none',
      margin: '1px 6px',
    }
  }

  return (
    <div style={sidebarStyle}>
      {/* Toggle button */}
      <button
        onClick={toggle}
        title={collapsed ? 'Espandi' : 'Comprimi'}
        style={{
          alignSelf: collapsed ? 'center' : 'flex-end',
          margin: collapsed ? '10px auto 4px' : '10px 10px 4px',
          background: 'none', border: '1px solid var(--color-border)',
          borderRadius: 6, padding: '4px 7px', cursor: 'pointer',
          color: 'var(--color-dim)', fontSize: 13, lineHeight: 1,
          transition: 'all 0.15s',
        }}>
        {collapsed ? '»' : '«'}
      </button>

      {/* Sezioni */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {sections.map((section, si) => (
          <div key={si} style={{ marginTop: si > 0 ? 8 : 0 }}>
            {/* Titolo sezione */}
            {section.title && !collapsed && (
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--color-border)',
                padding: '6px 18px 3px',
              }}>
                {section.title}
              </div>
            )}
            {section.title && collapsed && (
              <div style={{ height: 1, background: 'var(--color-border)', margin: '6px 10px 3px' }} />
            )}

            {/* Items */}
            {section.items.map(item => (
              <div
                key={item.id}
                style={itemStyle(item)}
                onClick={() => { if (!item.disabled) { onItemClick?.(item); item.onClick?.() } }}
                onMouseEnter={e => { if (collapsed) setTooltip({ id: item.id, y: (e.currentTarget as HTMLElement).getBoundingClientRect().top + window.scrollY }) }}
                onMouseLeave={() => setTooltip(null)}
              >
                <span style={{ fontSize: 17, flexShrink: 0, lineHeight: 1 }}>{item.icon}</span>
                {!collapsed && (
                  <span title={item.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                )}

                {/* Tooltip inline (collapsed) */}
                {collapsed && tooltip?.id === item.id && (
                  <div style={{
                    position: 'fixed', left: collapsedWidth + 6,
                    top: tooltip.y + 2,
                    background: 'var(--color-bright,#fff)', color: 'var(--color-panel,#000)',
                    fontSize: 11, fontWeight: 500, padding: '4px 8px',
                    borderRadius: 5, whiteSpace: 'nowrap', zIndex: 9999,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    pointerEvents: 'none',
                  }}>
                    {item.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
