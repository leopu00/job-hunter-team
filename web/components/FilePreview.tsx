'use client'

import { useRef, useState } from 'react'

export interface PreviewFile {
  id: string
  name: string
  size: number
  /** URL object o data-URL per immagini */
  url?: string
  type: string
}

export interface FilePreviewProps {
  files: PreviewFile[]
  onDelete?: (id: string) => void
  onReorder?: (files: PreviewFile[]) => void
  /** Larghezza thumbnail immagini in px */
  thumbSize?: number
}

/* ── Icone per tipo file ── */
const ICONS: Record<string, string> = {
  pdf:   '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  ppt:   '📑', pptx: '📑', zip: '🗜️', rar: '🗜️', txt: '📃',
  mp4:   '🎬', mp3: '🎵', default: '📎',
}

function getIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ICONS[ext] ?? ICONS.default
}

function isImage(type: string): boolean {
  return type.startsWith('image/')
}

function fmtSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function truncate(name: string, max = 22): string {
  if (name.length <= max) return name
  const ext   = name.includes('.') ? '.' + name.split('.').pop() : ''
  const base  = name.slice(0, name.length - ext.length)
  return base.slice(0, max - ext.length - 1) + '…' + ext
}

/* ── Singolo item ── */
function FileItem({
  file, thumbSize, onDelete, isDragging,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  file: PreviewFile; thumbSize: number; onDelete?: (id: string) => void
  isDragging: boolean
  onDragStart: () => void; onDragOver: (e: React.DragEvent) => void
  onDrop: () => void; onDragEnd: () => void
}) {
  const img = isImage(file.type)

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 8px',
    background: 'var(--color-row)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    opacity: isDragging ? 0.4 : 1,
    cursor: 'grab',
    transition: 'opacity 0.15s, background 0.15s',
    userSelect: 'none',
  }

  const thumbStyle: React.CSSProperties = {
    width: thumbSize, height: thumbSize,
    borderRadius: 6,
    objectFit: 'cover',
    flexShrink: 0,
    background: 'var(--color-panel)',
    border: '1px solid var(--color-border)',
  }

  const iconStyle: React.CSSProperties = {
    width: thumbSize, height: thumbSize,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: thumbSize * 0.5,
    background: 'var(--color-panel)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    flexShrink: 0,
  }

  return (
    <div
      draggable
      style={itemStyle}
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver(e) }}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      {/* Thumbnail o icona */}
      {img && file.url
        ? <img src={file.url} alt={file.name} style={thumbStyle} />
        : <div style={iconStyle}>{getIcon(file.name)}</div>
      }

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 500,
          color: 'var(--color-bright)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {truncate(file.name)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-dim)', marginTop: 2 }}>
          {fmtSize(file.size)}
        </div>
      </div>

      {/* Grip handle */}
      <span style={{ fontSize: 14, color: 'var(--color-border)', cursor: 'grab', padding: '0 2px' }}>
        ⠿
      </span>

      {/* Delete */}
      {onDelete && (
        <button
          onClick={() => onDelete(file.id)}
          title="Rimuovi file"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-red, #ff4d4d)', fontSize: 16,
            padding: '0 2px', lineHeight: 1, flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

/* ── Componente principale ── */
export default function FilePreview({ files, onDelete, onReorder, thumbSize = 40 }: FilePreviewProps) {
  const dragIdx = useRef<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const handleDragStart = (idx: number, id: string) => {
    dragIdx.current = idx
    setDraggingId(id)
  }

  const handleDrop = (targetIdx: number) => {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return
    const next = [...files]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(targetIdx, 0, moved)
    onReorder?.(next)
    dragIdx.current = null
  }

  const handleDragEnd = () => { dragIdx.current = null; setDraggingId(null) }

  if (!files.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {files.map((f, i) => (
        <FileItem
          key={f.id}
          file={f}
          thumbSize={thumbSize}
          onDelete={onDelete}
          isDragging={draggingId === f.id}
          onDragStart={() => handleDragStart(i, f.id)}
          onDragOver={() => {}}
          onDrop={() => handleDrop(i)}
          onDragEnd={handleDragEnd}
        />
      ))}
    </div>
  )
}
