'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type MemFile = { name: string; content: string; exists: boolean; size: number; updatedAt: number }
type MemData = { files: MemFile[]; identity: Record<string, string> | null; soul: Record<string, string> | null; total: number; existing: number }

const FILE_ICONS: Record<string, string> = {
  'SOUL.md': 'S', 'IDENTITY.md': 'I', 'MEMORY.md': 'M',
  'AGENTS.md': 'A', 'USER.md': 'U', 'TOOLS.md': 'T',
}

function FileTab({ file, active, onClick }: { file: MemFile; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 text-left rounded transition-colors cursor-pointer w-full"
      style={{ background: active ? 'var(--color-row)' : 'transparent', borderLeft: active ? '2px solid var(--color-green)' : '2px solid transparent' }}>
      <span className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center"
        style={{ background: file.exists ? 'var(--color-green)' : 'var(--color-border)', color: file.exists ? 'var(--color-bg)' : 'var(--color-dim)' }}>
        {FILE_ICONS[file.name] ?? '?'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-semibold truncate" style={{ color: active ? 'var(--color-bright)' : 'var(--color-muted)' }}>{file.name}</p>
        <p className="text-[9px] text-[var(--color-dim)]">{file.exists ? `${(file.size / 1024).toFixed(1)} KB` : 'Non esiste'}</p>
      </div>
    </button>
  )
}

function MetaSection({ title, data }: { title: string; data: Record<string, string> | null }) {
  if (!data || Object.keys(data).length === 0) return null
  return (
    <div className="mb-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <p className="text-[9px] uppercase tracking-widest text-[var(--color-dim)] mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(data).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[10px]">
            <span className="text-[var(--color-dim)] capitalize">{k.replace('_', ' ')}:</span>
            <span className="text-[var(--color-bright)] truncate">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MemoryPage() {
  const [data, setData] = useState<MemData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('SOUL.md')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/memory').catch(() => null)
    if (res?.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const current = data?.files.find(f => f.name === selected)

  function startEdit() {
    setDraft(current?.content ?? '')
    setEditing(true)
    setMsg('')
  }

  async function handleSave() {
    setSaving(true); setMsg('')
    const res = await fetch('/api/memory', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: selected, content: draft }),
    }).catch(() => null)
    if (res?.ok) { setEditing(false); await fetchData(); setMsg('Salvato') }
    else setMsg('Errore nel salvataggio')
    setSaving(false)
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Memory</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Memory</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">
          {data ? `${data.existing}/${data.total} file presenti` : 'Caricamento...'} — Soul, Identity, Memory
        </p>
      </div>

      {loading ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16 animate-pulse">Caricamento...</p>
      ) : !data ? (
        <p className="text-[var(--color-dim)] text-[12px] text-center py-16">Errore nel caricamento.</p>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            <MetaSection title="Identity" data={data.identity} />
            <MetaSection title="Soul" data={data.soul} />
          </div>

          <div className="flex gap-4">
            <div className="w-44 shrink-0 flex flex-col gap-0.5">
              {data.files.map(f => <FileTab key={f.name} file={f} active={selected === f.name} onClick={() => { setSelected(f.name); setEditing(false); setMsg('') }} />)}
            </div>

            <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
                <p className="text-[11px] font-semibold text-[var(--color-bright)]">{selected}</p>
                <div className="flex items-center gap-2">
                  {msg && <span className="text-[10px] text-[var(--color-green)]">{msg}</span>}
                  {!editing ? (
                    <button onClick={startEdit}
                      className="text-[10px] px-2.5 py-1 rounded font-semibold cursor-pointer transition-colors"
                      style={{ background: 'var(--color-row)', color: 'var(--color-bright)', border: '1px solid var(--color-border)' }}>
                      Modifica
                    </button>
                  ) : (
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditing(false)}
                        className="text-[10px] px-2.5 py-1 rounded cursor-pointer text-[var(--color-dim)] hover:text-[var(--color-muted)]">Annulla</button>
                      <button onClick={handleSave} disabled={saving}
                        className="text-[10px] px-3 py-1 rounded font-semibold cursor-pointer disabled:opacity-40"
                        style={{ background: 'var(--color-green)', color: 'var(--color-bg)' }}>
                        {saving ? 'Salvataggio...' : 'Salva'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-4">
                {editing ? (
                  <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={20}
                    aria-label="Contenuto memoria"
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded p-3 text-[11px] text-[var(--color-bright)] font-mono resize-y outline-none focus:border-[var(--color-border-glow)] transition-colors" />
                ) : current?.exists ? (
                  <pre className="text-[11px] text-[var(--color-muted)] font-mono whitespace-pre-wrap leading-relaxed">{current.content}</pre>
                ) : (
                  <p className="text-[var(--color-dim)] text-[11px] text-center py-8">File non ancora creato. Clicca Modifica per crearlo.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
