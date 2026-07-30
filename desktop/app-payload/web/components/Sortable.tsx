'use client'

import { useRef, useState } from 'react'

export interface SortableItem {
  id: string
  content: React.ReactNode
}

export interface SortableProps {
  items: SortableItem[]
  onReorder: (newItems: SortableItem[]) => void
  /** Mostra grip handle a sinistra */
  handle?: boolean
  disabled?: boolean
  /** Gap tra item in px */
  gap?: number
}

export default function Sortable({ items, onReorder, handle = true, disabled = false, gap = 4 }: SortableProps) {
  const [dragId, setDragId]       = useState<string | null>(null)
  const [overId, setOverId]       = useState<string | null>(null)
  const [dragPos, setDragPos]     = useState<'before' | 'after'>('after')
  const dragNode                   = useRef<HTMLDivElement | null>(null)

  const getDragIdx  = () => items.findIndex(i => i.id === dragId)
  const getOverIdx  = () => items.findIndex(i => i.id === overId)

  /* ── Handlers ── */
  const onDragStart = (e: React.DragEvent, id: string) => {
    if (disabled) return
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Ghost trasparente
    if (dragNode.current) {
      const ghost = dragNode.current.cloneNode(true) as HTMLElement
      ghost.style.cssText = 'position:fixed;top:-1000px;opacity:0.01'
      document.body.appendChild(ghost)
      e.dataTransfer.setDragImage(ghost, 0, 0)
      setTimeout(() => document.body.removeChild(ghost), 0)
    }
  }

  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    setDragPos(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
    setOverId(id)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragId || !overId || dragId === overId) { reset(); return }
    const from = getDragIdx()
    const to   = getOverIdx()
    if (from < 0 || to < 0) { reset(); return }

    const next = [...items]
    const [moved] = next.splice(from, 1)
    const insertAt = dragPos === 'after' ? (from < to ? to : to + 1) : (from > to ? to : to - 1)
    next.splice(Math.max(0, insertAt), 0, moved)
    onReorder(next)
    reset()
  }

  const reset = () => { setDragId(null); setOverId(null) }

  /* ── Placeholder index ── */
  const placeholderIdx = (() => {
    if (!dragId || !overId) return -1
    const to = getOverIdx()
    return dragPos === 'after' ? to + 1 : to
  })()

  return (
    <div role="list" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {items.map((item, i) => {
        const isDragging = item.id === dragId
        const isOver     = item.id === overId
        const showBefore = isOver && dragPos === 'before'
        const showAfter  = isOver && dragPos === 'after'

        return (
          <div key={item.id} role="listitem">
            {/* Placeholder PRIMA */}
            {showBefore && (
              <div style={{ height: 3, borderRadius: 2, background: 'var(--color-green)', margin: `${gap/2}px 0`, opacity: 0.8 }} />
            )}

            <div
              ref={isDragging ? dragNode : undefined}
              draggable={!disabled}
              onDragStart={e => onDragStart(e, item.id)}
              onDragOver={e => onDragOver(e, item.id)}
              onDrop={onDrop}
              onDragEnd={reset}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 8,
                border: `1px solid ${isOver ? 'var(--color-green)' : 'var(--color-border)'}`,
                background: isDragging ? 'transparent' : 'var(--color-panel)',
                opacity: isDragging ? 0.35 : 1,
                cursor: disabled ? 'default' : handle ? 'default' : 'grab',
                transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
                userSelect: 'none',
              }}>
              {/* Handle grip */}
              {handle && !disabled && (
                <div
                  draggable
                  onDragStart={e => onDragStart(e, item.id)}
                  style={{ cursor: 'grab', flexShrink: 0, padding: '0 2px', color: 'var(--color-dim)', fontSize: 14, lineHeight: 1 }}>
                  ⠿
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>{item.content}</div>
              {/* Indice ordine */}
              <span style={{ fontSize: 9, color: 'var(--color-dim)', flexShrink: 0 }}>{i + 1}</span>
            </div>

            {/* Placeholder DOPO */}
            {showAfter && (
              <div style={{ height: 3, borderRadius: 2, background: 'var(--color-green)', margin: `${gap/2}px 0`, opacity: 0.8 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}
