'use client'

export type TimelineEventType =
  | 'application_sent' | 'interview_scheduled' | 'offer_received'
  | 'rejected' | 'follow_up' | 'note' | 'viewed' | 'custom'

export type TimelineEvent = {
  id:          string
  type:        TimelineEventType | string
  date:        string
  title:       string
  description?: string
  meta?:       string
}

// ── Event type config ──────────────────────────────────────────────────────
const TYPE_CFG: Record<string, { icon: string; color: string }> = {
  application_sent:     { icon: '📤', color: 'var(--color-blue)'   },
  interview_scheduled:  { icon: '📅', color: 'var(--color-yellow)' },
  offer_received:       { icon: '🎉', color: 'var(--color-green)'  },
  rejected:             { icon: '✕',  color: 'var(--color-red)'    },
  follow_up:            { icon: '🔄', color: 'var(--color-muted)'  },
  note:                 { icon: '📝', color: 'var(--color-dim)'    },
  viewed:               { icon: '👁',  color: 'var(--color-dim)'    },
  custom:               { icon: '●',  color: 'var(--color-muted)'  },
}
function cfg(type: string) { return TYPE_CFG[type] ?? TYPE_CFG.custom }

// ── Single event card ──────────────────────────────────────────────────────
function EventNode({ event, last, compact }: { event: TimelineEvent; last: boolean; compact: boolean }) {
  const { icon, color } = cfg(event.type)
  return (
    <div className="flex gap-3">
      {/* Left: dot + line */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
        <div className="flex items-center justify-center w-7 h-7 rounded-full text-[12px] z-10"
          style={{ background: `${color}18`, border: `1.5px solid ${color}55`, color, flexShrink: 0 }}>
          {icon}
        </div>
        {!last && <div className="flex-1 w-px mt-1" style={{ background: 'var(--color-border)', minHeight: 16 }} />}
      </div>

      {/* Right: content */}
      <div className={`flex-1 min-w-0 ${compact ? 'pb-3' : 'pb-4'}`}>
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className={`font-semibold ${compact ? 'text-[11px]' : 'text-[12px]'}`}
            style={{ color: 'var(--color-bright)' }}>{event.title}</p>
          <span className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--color-dim)' }}>{event.date}</span>
        </div>
        {event.description && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>{event.description}</p>
        )}
        {event.meta && (
          <p className="text-[9px] mt-0.5 font-mono" style={{ color: 'var(--color-dim)' }}>{event.meta}</p>
        )}
      </div>
    </div>
  )
}

// ── Timeline list ──────────────────────────────────────────────────────────
type TimelineProps = {
  events:    TimelineEvent[]
  compact?:  boolean
  className?: string
}

export function Timeline({ events, compact = false, className }: TimelineProps) {
  if (!events.length) return (
    <p className="text-[11px] py-4 text-center" style={{ color: 'var(--color-dim)' }}>Nessun evento</p>
  )
  return (
    <div className={`flex flex-col ${className ?? ''}`}>
      {events.map((e, i) => (
        <EventNode key={e.id} event={e} last={i === events.length - 1} compact={compact} />
      ))}
    </div>
  )
}

// ── Wrapped card variant ───────────────────────────────────────────────────
type TimelineCardProps = TimelineProps & { title?: string }

export function TimelineCard({ title, events, compact, className }: TimelineCardProps) {
  return (
    <div className={`rounded-xl overflow-hidden ${className ?? ''}`}
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-panel)' }}>
      {title && (
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>{title}</p>
        </div>
      )}
      <div className="px-4 pt-4">
        <Timeline events={events} compact={compact} />
      </div>
    </div>
  )
}
