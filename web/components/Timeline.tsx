'use client'

export type TimelineItemType = 'default' | 'success' | 'warning' | 'error'
export type TimelineOrientation = 'left' | 'right' | 'alternate'

export interface TimelineItem {
  id: string
  date: string
  title: string
  description?: string
  icon?: string
  type?: TimelineItemType
  /** Badge/etichetta aggiuntiva */
  badge?: string
}

export interface TimelineProps {
  items: TimelineItem[]
  orientation?: TimelineOrientation
  /** Mostra linea connettore tra eventi */
  showConnector?: boolean
}

const TYPE_COLOR: Record<TimelineItemType, string> = {
  default: 'var(--color-muted)',
  success: 'var(--color-green)',
  warning: '#f59e0b',
  error:   'var(--color-red)',
}

const TYPE_BG: Record<TimelineItemType, string> = {
  default: 'rgba(148,163,184,0.12)',
  success: 'rgba(0,232,122,0.10)',
  warning: 'rgba(245,158,11,0.10)',
  error:   'rgba(239,68,68,0.10)',
}

const DEFAULT_ICONS: Record<TimelineItemType, string> = {
  default: '●', success: '✓', warning: '⚠', error: '✕',
}

function TimelineNode({ item, side, isLast, showConnector }: {
  item: TimelineItem; side: 'left' | 'right'; isLast: boolean; showConnector: boolean
}) {
  const type  = item.type ?? 'default'
  const color = TYPE_COLOR[type]
  const bg    = TYPE_BG[type]
  const icon  = item.icon ?? DEFAULT_ICONS[type]
  const isRight = side === 'right'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, flexDirection: isRight ? 'row-reverse' : 'row' }}>
      {/* Contenuto */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 24, [isRight ? 'paddingLeft' : 'paddingRight']: 16 }}>
        <div style={{
          borderRadius: 8, border: `1px solid var(--color-border)`,
          background: bg, padding: '10px 14px',
          borderLeftColor: !isRight ? color : undefined,
          borderRightColor: isRight ? color : undefined,
          borderLeftWidth: !isRight ? 2 : 1,
          borderRightWidth: isRight ? 2 : 1,
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: item.description ? 4 : 0, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-bright)', flex: 1 }}>{item.title}</span>
            {item.badge && (
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--color-border)', color: 'var(--color-dim)' }}>
                {item.badge}
              </span>
            )}
            <span style={{ fontSize: 9, color: 'var(--color-dim)', whiteSpace: 'nowrap' }}>{item.date}</span>
          </div>
          {item.description && (
            <p style={{ margin: 0, fontSize: 10, color: 'var(--color-muted)', lineHeight: 1.5 }}>{item.description}</p>
          )}
        </div>
      </div>

      {/* Pallino + connettore */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: `2px solid ${color}`,
          background: 'var(--color-panel)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color, fontWeight: 700, zIndex: 1,
          boxShadow: `0 0 0 3px var(--color-panel)`,
        }}>
          {icon}
        </div>
        {/* Linea connettore */}
        {showConnector && !isLast && (
          <div style={{ width: 2, flex: 1, minHeight: 24, background: 'var(--color-border)', marginTop: 2 }} />
        )}
      </div>
    </div>
  )
}

export default function Timeline({ items, orientation = 'left', showConnector = true }: TimelineProps) {
  if (items.length === 0) return (
    <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-dim)', padding: '24px 0' }}>
      Nessun evento
    </div>
  )

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        let side: 'left' | 'right' = 'right'
        if (orientation === 'left')     side = 'right'
        if (orientation === 'right')    side = 'left'
        if (orientation === 'alternate') side = i % 2 === 0 ? 'right' : 'left'

        return (
          <TimelineNode
            key={item.id}
            item={item}
            side={side}
            isLast={isLast}
            showConnector={showConnector}
          />
        )
      })}
    </div>
  )
}
