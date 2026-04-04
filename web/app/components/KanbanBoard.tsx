'use client'

import { useState, useRef } from 'react'

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

function Card({ card, onDragStart }: { card: KanbanCard; onDragStart: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="rounded-lg px-3 py-2.5 cursor-grab active:cursor-grabbing select-none transition-all"
      style={{
        background:  hover ? 'var(--color-deep)' : 'var(--color-card)',
        border:      `1px solid var(--color-border)`,
        transform:   hover ? 'translateY(-1px)' : 'none',
        boxShadow:   hover ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
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

function Column({ col, onDrop, onDragStart, dragOver, setDragOver }:
  { col: KanbanColumn; onDrop: () => void; onDragStart: (cardId: string) => void; dragOver: boolean; setDragOver: (v: boolean) => void }) {
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
      <div className="flex flex-col gap-2 rounded-lg flex-1 p-1.5 transition-colors min-h-[80px]"
        style={{ background: dragOver ? `${color}08` : 'transparent', border: dragOver ? `1px dashed ${color}44` : '1px dashed transparent' }}>
        {col.cards.map(card => (
          <Card key={card.id} card={card} onDragStart={() => onDragStart(card.id)} />
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
  const dragRef = useRef<{ cardId: string; fromCol: string } | null>(null)

  const handleDragStart = (cardId: string, fromCol: string) => { dragRef.current = { cardId, fromCol } }

  const handleDrop = (toColId: string) => {
    if (!dragRef.current) return
    const { cardId, fromCol } = dragRef.current
    if (fromCol === toColId) return
    setCols(prev => {
      const next = prev.map(c => ({ ...c, cards: [...c.cards] }))
      const src = next.find(c => c.id === fromCol)
      const dst = next.find(c => c.id === toColId)
      if (!src || !dst) return prev
      const idx  = src.cards.findIndex(c => c.id === cardId)
      if (idx === -1) return prev
      const [card] = src.cards.splice(idx, 1)
      dst.cards.push(card)
      onChange?.(next)
      return next
    })
    dragRef.current = null
  }

  return (
    <div className={`flex gap-3 overflow-x-auto pb-2 ${className ?? ''}`}>
      {cols.map(col => (
        <Column key={col.id} col={col}
          dragOver={dragOver === col.id}
          setDragOver={v => setDragOver(v ? col.id : null)}
          onDragStart={cardId => handleDragStart(cardId, col.id)}
          onDrop={() => handleDrop(col.id)} />
      ))}
    </div>
  )
}
