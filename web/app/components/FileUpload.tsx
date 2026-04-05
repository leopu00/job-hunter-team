'use client'

import { useState, useRef, useCallback, useId } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

type UploadedFile = {
  id:        string
  file:      File
  progress:  number   // 0–100
  done:      boolean
  error?:    string
}

export type FileUploadProps = {
  accept?:     string[]   // MIME types o estensioni (es. ['application/pdf'])
  maxSizeMb?:  number     // default 10
  multiple?:   boolean
  onUpload?:   (files: File[]) => Promise<void>
  onRemove?:   (file: File) => void
  label?:      string
  className?:  string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024)         return `${bytes} B`
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(type: string) {
  if (type.includes('pdf'))   return '📄'
  if (type.includes('image')) return '🖼'
  if (type.includes('word') || type.includes('document')) return '📝'
  return '📎'
}

function validateFile(file: File, accept: string[], maxSizeMb: number): string | null {
  if (maxSizeMb && file.size > maxSizeMb * 1024 * 1024)
    return `File troppo grande (max ${maxSizeMb} MB)`
  if (accept.length > 0) {
    const ok = accept.some(a =>
      a.startsWith('.') ? file.name.toLowerCase().endsWith(a.toLowerCase()) : file.type === a
    )
    if (!ok) return `Tipo non supportato (accettati: ${accept.join(', ')})`
  }
  return null
}

// ── FileRow ────────────────────────────────────────────────────────────────

function FileRow({ uf, onRemove }: { uf: UploadedFile; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 rounded-lg" style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] flex-shrink-0">{fileIcon(uf.file.type)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium truncate" style={{ color: 'var(--color-bright)' }}>{uf.file.name}</p>
          <p className="text-[9px] font-mono" style={{ color: 'var(--color-dim)' }}>{fmtSize(uf.file.size)}</p>
        </div>
        {uf.done && !uf.error && <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-green)' }}>✓</span>}
        {uf.error && <span className="text-[9px] flex-shrink-0 truncate max-w-[100px]" style={{ color: 'var(--color-red)' }}>{uf.error}</span>}
        <button onClick={onRemove} aria-label="Rimuovi file" className="flex-shrink-0 text-[11px] hover:opacity-60 transition-opacity" style={{ color: 'var(--color-dim)' }}>✕</button>
      </div>
      {!uf.done && uf.progress > 0 && (
        <div className="h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width: `${uf.progress}%`, background: 'var(--color-blue)' }} />
        </div>
      )}
    </div>
  )
}

// ── FileUpload ─────────────────────────────────────────────────────────────

export function FileUpload({ accept = [], maxSizeMb = 10, multiple = false, onUpload, onRemove, label, className }: FileUploadProps) {
  const [files, setFiles]       = useState<UploadedFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const uid      = useId()

  const processFiles = useCallback(async (incoming: FileList | File[]) => {
    const arr = Array.from(incoming)
    const newUfs: UploadedFile[] = arr.map(f => ({
      id: `${uid}-${f.name}-${Date.now()}`, file: f,
      progress: 0, done: false,
      error: validateFile(f, accept, maxSizeMb) ?? undefined,
    }))
    setFiles(prev => multiple ? [...prev, ...newUfs] : newUfs)

    const valid = newUfs.filter(u => !u.error)
    if (!valid.length || !onUpload) {
      setFiles(prev => prev.map(u => newUfs.find(n => n.id === u.id) ? { ...u, done: true } : u))
      return
    }

    // Fake progress 0→85% during upload, 100% on complete
    const tick = setInterval(() => {
      setFiles(prev => prev.map(u =>
        valid.find(v => v.id === u.id) && !u.done ? { ...u, progress: Math.min(u.progress + 15, 85) } : u
      ))
    }, 200)
    try {
      await onUpload(valid.map(u => u.file))
      setFiles(prev => prev.map(u => valid.find(v => v.id === u.id) ? { ...u, progress: 100, done: true } : u))
    } catch {
      setFiles(prev => prev.map(u => valid.find(v => v.id === u.id) ? { ...u, error: 'Upload fallito' } : u))
    } finally {
      clearInterval(tick)
    }
  }, [accept, maxSizeMb, multiple, onUpload, uid])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files)
  }

  const handleRemove = (id: string) => {
    const uf = files.find(f => f.id === id)
    if (uf) onRemove?.(uf.file)
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const color = dragOver ? 'var(--color-blue)' : 'var(--color-border)'

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {label && <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>{label}</p>}

      {/* Drop zone */}
      <div role="button" tabIndex={0} onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        aria-label="Seleziona file da caricare"
        className="flex flex-col items-center justify-center gap-1 py-6 rounded-xl cursor-pointer transition-colors"
        style={{ border: `1.5px dashed ${color}`, background: dragOver ? 'var(--color-blue)08' : 'transparent' }}>
        <span className="text-[20px]">📂</span>
        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
          Trascina qui o <span style={{ color: 'var(--color-blue)' }}>seleziona file</span>
        </p>
        <p className="text-[9px]" style={{ color: 'var(--color-dim)' }}>
          {accept.length ? accept.join(', ') : 'Tutti i tipi'} · max {maxSizeMb} MB
        </p>
      </div>

      <input ref={inputRef} type="file" className="hidden"
        accept={accept.join(',')} multiple={multiple}
        onChange={e => e.target.files?.length && processFiles(e.target.files)} />

      {/* File list */}
      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {files.map(uf => <FileRow key={uf.id} uf={uf} onRemove={() => handleRemove(uf.id)} />)}
        </div>
      )}
    </div>
  )
}
