'use client'

import Link from 'next/link'
import { useState, useCallback, useRef } from 'react'

type ImportTarget = 'sessions' | 'tasks' | 'config' | 'jobs' | 'contacts' | 'companies'
type ImportMode = 'merge' | 'replace'

const TARGETS: { id: ImportTarget; label: string; color: string; group: string }[] = [
  { id: 'jobs',      label: 'Offerte',   color: '#61affe',             group: 'Job Hunting' },
  { id: 'contacts',  label: 'Contatti',  color: '#9b59b6',             group: 'Job Hunting' },
  { id: 'companies', label: 'Aziende',   color: '#fca130',             group: 'Job Hunting' },
  { id: 'sessions',  label: 'Sessioni',  color: 'var(--color-green)',  group: 'Sistema' },
  { id: 'tasks',     label: 'Task',      color: 'var(--color-blue)',   group: 'Sistema' },
  { id: 'config',    label: 'Config',    color: 'var(--color-yellow)', group: 'Sistema' },
]

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
}

export default function ImportPage() {
  const [target, setTarget] = useState<ImportTarget>('jobs')
  const [mode, setMode] = useState<ImportMode>('merge')
  const [fileData, setFileData] = useState<unknown>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ ok: boolean; count: number; errors: string[] } | null>(null)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    setResult(null); setPreview(null)
    try {
      const text = await file.text()
      const data = file.name.endsWith('.csv') ? parseCsv(text) : JSON.parse(text)
      setFileData(data); setFileName(file.name)
      // Dry run per preview
      const res = await fetch('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, data, mode, dryRun: true }),
      })
      const r = await res.json()
      setPreview({ ok: r.ok, count: r.count ?? 0, errors: r.errors ?? [] })
    } catch { setPreview({ ok: false, count: 0, errors: ['File non è un JSON valido'] }) }
  }, [target, mode])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }, [processFile])

  const doImport = useCallback(async () => {
    if (!fileData) return
    setImporting(true); setResult(null)
    try {
      const res = await fetch('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, data: fileData, mode }),
      })
      const r = await res.json()
      if (r.ok) {
        const skip = r.skipped ? ` (${r.skipped} duplicati saltati)` : ''
        setResult({ ok: true, msg: `${r.count} record importati${skip}` })
      } else setResult({ ok: false, msg: r.errors?.join(', ') ?? r.error ?? 'Errore' })
    } catch { setResult({ ok: false, msg: 'Errore di rete' }) }
    finally { setImporting(false) }
  }, [fileData, target, mode])

  const reset = () => { setFileData(null); setFileName(null); setPreview(null); setResult(null) }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Importa</span>
        </nav>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Importa Dati</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">Importa dati job hunting e sistema da file JSON o CSV</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-5">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Destinazione</p>
            <div className="space-y-2">
              {['Job Hunting', 'Sistema'].map(group => (
                <div key={group}>
                  <p className="text-[8px] font-bold tracking-widest text-[var(--color-dim)] mb-1">{group.toUpperCase()}</p>
                  <div className="flex gap-1">
                    {TARGETS.filter(t => t.group === group).map(t => (
                      <button key={t.id} onClick={() => { setTarget(t.id); reset() }}
                        className="flex-1 px-2 py-1.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
                        style={{ border: `1px solid ${target === t.id ? t.color : 'var(--color-border)'}`, color: target === t.id ? t.color : 'var(--color-dim)', background: target === t.id ? `${t.color}0d` : 'transparent' }}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">Modalità</p>
            <div className="flex gap-2">
              {([{ id: 'merge' as const, l: 'Merge', d: 'Aggiungi solo record nuovi' }, { id: 'replace' as const, l: 'Sostituisci', d: 'Rimpiazza tutti i dati' }]).map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className="flex-1 px-3 py-2.5 rounded text-left cursor-pointer transition-all"
                  style={{ border: `1px solid ${mode === m.id ? 'var(--color-green)' : 'var(--color-border)'}`, background: mode === m.id ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                  <p className="text-[11px] font-semibold" style={{ color: mode === m.id ? 'var(--color-green)' : 'var(--color-muted)' }}>{m.l}</p>
                  <p className="text-[8px] text-[var(--color-dim)] mt-0.5">{m.d}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-2">File</p>
            <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-[var(--color-green)]' : 'border-[var(--color-border)]'}`}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}>
              <input ref={inputRef} type="file" accept=".json,.csv" className="hidden" onChange={handleFileInput} />
              {fileName ? (
                <div>
                  <p className="text-[12px] text-[var(--color-bright)] font-mono">{fileName}</p>
                  <button onClick={e => { e.stopPropagation(); reset() }} className="text-[9px] text-[var(--color-dim)] mt-1 cursor-pointer underline">rimuovi</button>
                </div>
              ) : (
                <div>
                  <p className="text-[12px] text-[var(--color-muted)]">Trascina un file JSON o CSV qui</p>
                  <p className="text-[9px] text-[var(--color-dim)] mt-1">oppure clicca per selezionare</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {preview && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-dim)] mb-3">Anteprima</p>
              {preview.ok ? (
                <div>
                  <p className="text-[14px] font-bold text-[var(--color-green)]">{preview.count} record trovati</p>
                  <p className="text-[9px] text-[var(--color-dim)] mt-1">Modalità: {mode === 'merge' ? 'merge (solo nuovi)' : 'sostituzione completa'}</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {preview.errors.map((e, i) => (
                    <p key={i} className="text-[10px] text-[var(--color-red)]">{e}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {preview?.ok && (
            <button onClick={doImport} disabled={importing}
              className="w-full px-4 py-2.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all"
              style={{ background: importing ? 'var(--color-border)' : 'var(--color-green)', color: importing ? 'var(--color-dim)' : '#000', border: 'none' }}>
              {importing ? 'Importazione…' : `Importa ${preview.count} record`}
            </button>
          )}

          {mode === 'replace' && preview?.ok && (
            <p className="text-[9px] text-[var(--color-red)] text-center">Attenzione: la sostituzione cancellerà tutti i dati esistenti</p>
          )}

          {result && (
            <div className="rounded-lg border p-3 text-[11px]"
              style={{ borderColor: result.ok ? 'rgba(0,232,122,0.3)' : 'rgba(255,69,96,0.3)', color: result.ok ? 'var(--color-green)' : 'var(--color-red)', background: result.ok ? 'rgba(0,232,122,0.05)' : 'rgba(255,69,96,0.05)' }}>
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
