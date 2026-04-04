'use client'

import { useRef, useState } from 'react'

export interface DDItem {
  id: string
  content: React.ReactNode
  disabled?: boolean
}

export interface DragDropListProps {
  items: DDItem[]
  onReorder: (items: DDItem[]) => void
  gap?: number
  /** Mostra numero ordine a sinistra */
  showIndex?: boolean
}

export default function DragDropList({ items, onReorder, gap = 4, showIndex = false }: DragDropListProps) {
  const dragId      = useRef<string | null>(null)
  const [overId, setOverId]       = useState<string | null>(null)
  const [overPos, setOverPos]     = useState<'before' | 'after'>('before')
  const [dragging, setDragging]   = useState<string | null>(null)

  const handleDragStart = (e: React.DragEvent, id: string) => {
    dragId.current = id
    setDragging(id)
    e.dataTransfer.effectAllowed = 'move'
    // Ghost image trasparente
    const ghost = document.createElement('div')
    ghost.style.cssText = 'position:fixed;top:-9999px;opacity:0'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 0, 0)
    setTimeout(() => document.body.removeChild(ghost), 0)
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === dragId.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pos  = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setOverId(id)
    setOverPos(pos)
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    const srcId = dragId.current
    if (!srcId || srcId === targetId) { reset(); return }

    const next = [...items]
    const srcIdx = next.findIndex(i => i.id === srcId)
    const [moved] = next.splice(srcIdx, 1)
    let tgtIdx = next.findIndex(i => i.id === targetId)
    if (overPos === 'after') tgtIdx += 1
    next.splice(tgtIdx, 0, moved)
    onReorder(next)
    reset()
  }

  const reset = () => { dragId.current = null; setDragging(null); setOverId(null) }

  const Placeholder = () => (
    <div style={{ height: 3, borderRadius: 2, background: 'var(--color-green,#00e87a)', margin: `${gap / 2}px 0`, transition: 'all 0.1s' }} />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}
      onDragEnd={reset}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) reset() }}
    >
      {items.map((item, idx) => {
        const isDragging = dragging === item.id
        const isOver     = overId === item.id
        return (
          <div key={item.id}>
            {isOver && overPos === 'before' && <Placeholder />}

            <div
              draggable={!item.disabled}
              onDragStart={e => handleDragStart(e, item.id)}
              onDragOver={e => handleDragOver(e, item.id)}
              onDrop={e => handleDrop(e, item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px',
                marginBottom: gap,
                background: isDragging
                  ? 'color-mix(in srgb,var(--color-green,#00e87a) 6%,transparent)'
                  : 'var(--color-row)',
                border: `1px solid ${isDragging ? 'var(--color-green,#00e87a)' : 'var(--color-border)'}`,
                borderRadius: 8,
                opacity: isDragging ? 0.5 : 1,
                cursor: item.disabled ? 'default' : 'default',
                transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
                userSelect: 'none',
              }}
            >
              {/* Drag handle */}
              {!item.disabled && (
                <span
                  style={{ fontSize: 16, color: 'var(--color-border)', cursor: 'grab', flexShrink: 0, lineHeight: 1, padding: '0 2px' }}
                  onMouseDown={e => e.currentTarget.style.cursor = 'grabbing'}
                  onMouseUp={e => e.currentTarget.style.cursor = 'grab'}
                >
                  ⠿
                </span>
              )}
              {item.disabled && <span style={{ width: 20, flexShrink: 0 }} />}

              {/* Index */}
              {showIndex && (
                <span style={{ fontSize: 11, color: 'var(--color-dim)', minWidth: 18, textAlign: 'right', flexShrink: 0 }}>
                  {idx + 1}.
                </span>
              )}

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>{item.content}</div>
            </div>

            {isOver && overPos === 'after' && <Placeholder />}
          </div>
        )
      })}
    </div>
  )
}
