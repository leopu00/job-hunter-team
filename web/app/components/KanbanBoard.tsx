'use client'

import { useState, useRef, useCallback } from 'react'

export type KanbanCard = {
  id:       string
  title:    string
  company:  string
  meta?:    string
  tag?:     string
}

export type KanbanColumn = {
  id:     string
  label:  string
  color?: string
  cards:  KanbanCard[]
}

export const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'saved',     label: 'Salvata',   color: 'var(--color-dim)',    cards: [] },
  { id: 'applied',   label: 'Inviata',   color: 'var(--color-blue)',   cards: [] },
  { id: 'interview', label: 'Colloquio', color: 'var(--color-yellow)', cards: [] },
  { id: 'offer',     label: 'Offerta',   color: 'var(--color-green)',  cards: [] },
  { id: 'rejected',  label: 'Rifiutata', color: 'var(--color-red)',    cards: [] },
]

type KanbanBoardProps = {
  columns?:   KanbanColumn[]
  onChange?:  (cols: KanbanColumn[]) => void
  className?: string
}

function Card({ card, onDragStart, grabbed, onKeyAction }: {
  card: KanbanCard; onDragStart: () => void; grabbed: boolean
  onKeyAction: (action: 'grab' | 'left' | 'right' | 'cancel') => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      draggable
      tabIndex={0}
      role="listitem"
      aria-roledescription="Carta spostabile"
      aria-label={`${card.title} — ${card.company}`}
      aria-grabbed={grabbed}
      onDragStart={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onKeyAction(grabbed ? 'grab' : 'grab') }
        if (grabbed && e.key === 'ArrowLeft')  { e.preventDefault(); onKeyAction('left') }
        if (grabbed && e.key === 'ArrowRight') { e.preventDefault(); onKeyAction('right') }
        if (grabbed && e.key === 'Escape')     { e.preventDefault(); onKeyAction('cancel') }
      }}
      className="rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-all outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)]"
      style={{
        background:  grabbed ? 'var(--color-row)' : hover ? 'var(--color-deep)' : 'var(--color-card)',
        border:      `1px solid ${grabbed ? 'var(--color-green)' : 'var(--color-border)'}`,
        transform:   hover && !grabbed ? 'translateY(-1px)' : 'none',
        boxShadow:   grabbed ? '0 0 0 2px rgba(0,232,122,0.25)' : hover ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
      }}>
      <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-bright)' }}>{card.title}</p>
      <p className="text-[10px] truncate" style={{ color: 'var(--color-muted)' }}>{card.company}</p>
      {card.meta && <p className="text-[9px] font-mono mt-0.5 truncate" style={{ color: 'var(--color-dim)' }}>{card.meta}</p>}
      {card.tag  && (
        <span className="inline-block mt-1.5 px-1.5 py-0.5 rounded text-[8px] font-semibold"
          style={{ background: 'var(--color-border)', color: 'var(--color-dim)' }}>{card.tag}</span>
      )}
    </div>
  )
}

function Column({ col, onDrop, onDragStart, dragOver, setDragOver, grabbedCardId, onKeyAction }:
  { col: KanbanColumn; onDrop: () => void; onDragStart: (cardId: string) => void
    dragOver: boolean; setDragOver: (v: boolean) => void; grabbedCardId: string | null
    onKeyAction: (cardId: string, action: 'grab' | 'left' | 'right' | 'cancel') => void }) {
  const color = col.color ?? 'var(--color-dim)'
  return (
    <div className="flex flex-col gap-2 min-w-[180px] flex-1"
      style={{ maxWidth: 240 }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop() }}>

      {/* Column header */}
      <div className="flex items-center justify-between px-2 py-1.5 rounded-lg"
        style={{ background: `${color}12`, border: `1px solid ${color}33` }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{col.label}</span>
        <span className="text-[10px] font-mono" style={{ color }}>{col.cards.length}</span>
      </div>

      {/* Drop zone */}
      <div role="list" aria-label={`Colonna ${col.label}`}
        className="flex flex-col gap-2 rounded-lg flex-1 p-1.5 transition-colors min-h-[80px]"
        style={{ background: dragOver ? `${color}08` : 'transparent', border: dragOver ? `1px dashed ${color}44` : '1px dashed transparent' }}>
        {col.cards.map(card => (
          <Card key={card.id} card={card}
            grabbed={grabbedCardId === card.id}
            onDragStart={() => onDragStart(card.id)}
            onKeyAction={action => onKeyAction(card.id, action)} />
        ))}
        {col.cards.length === 0 && !dragOver && (
          <p className="text-[9px] text-center py-4" style={{ color: 'var(--color-dim)' }}>Vuota</p>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({ columns, onChange, className }: KanbanBoardProps) {
  const [cols, setCols]       = useState<KanbanColumn[]>(columns ?? DEFAULT_KANBAN_COLUMNS)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [grabbedCard, setGrabbedCard] = useState<{ cardId: string; fromCol: string } | null>(null)
  const dragRef = useRef<{ cardId: string; fromCol: string } | null>(null)

  const handleDragStart = (cardId: string, fromCol: string) => { dragRef.current = { cardId, fromCol } }

  const moveCard = useCallback((cardId: string, fromColId: string, toColId: string) => {
    if (fromColId === toColId) return
    setCols(prev => {
      const next = prev.map(c => ({ ...c, cards: [...c.cards] }))
      const src = next.find(c => c.id === fromColId)
      const dst = next.find(c => c.id === toColId)
      if (!src || !dst) return prev
      const idx  = src.cards.findIndex(c => c.id === cardId)
      if (idx === -1) return prev
      const [card] = src.cards.splice(idx, 1)
      dst.cards.push(card)
      onChange?.(next)
      return next
    })
  }, [onChange])

  const handleDrop = (toColId: string) => {
    if (!dragRef.current) return
    moveCard(dragRef.current.cardId, dragRef.current.fromCol, toColId)
    dragRef.current = null
  }

  const handleKeyAction = useCallback((cardId: string, action: 'grab' | 'left' | 'right' | 'cancel') => {
    if (action === 'cancel') { setGrabbedCard(null); return }
    if (action === 'grab') {
      if (grabbedCard?.cardId === cardId) {
        // Drop — already in target column
        setGrabbedCard(null)
        return
      }
      const fromCol = cols.find(c => c.cards.some(card => card.id === cardId))
      if (fromCol) setGrabbedCard({ cardId, fromCol: fromCol.id })
      return
    }
    // Move left/right
    if (!grabbedCard) return
    const colIds = cols.map(c => c.id)
    const curIdx = colIds.indexOf(grabbedCard.fromCol)
    const newIdx = action === 'left' ? curIdx - 1 : curIdx + 1
    if (newIdx < 0 || newIdx >= colIds.length) return
    moveCard(grabbedCard.cardId, grabbedCard.fromCol, colIds[newIdx])
    setGrabbedCard({ cardId: grabbedCard.cardId, fromCol: colIds[newIdx] })
  }, [grabbedCard, cols, moveCard])

  return (
    <div role="group" aria-label="Kanban board" className={`flex gap-3 overflow-x-auto pb-2 ${className ?? ''}`}>
      {cols.map(col => (
        <Column key={col.id} col={col}
          dragOver={dragOver === col.id}
          setDragOver={v => setDragOver(v ? col.id : null)}
          onDragStart={cardId => handleDragStart(cardId, col.id)}
          onDrop={() => handleDrop(col.id)}
          grabbedCardId={grabbedCard?.cardId ?? null}
          onKeyAction={handleKeyAction} />
      ))}
    </div>
  )
}
