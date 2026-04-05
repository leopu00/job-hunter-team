'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

type Issue = { path: string; message: string }
type ConfigData = { exists: boolean; config: unknown; issues: Issue[]; valid: boolean }

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-lg border text-[11px]"
      style={{ borderColor: 'rgba(0,232,122,0.25)', background: 'rgba(0,232,122,0.04)', color: 'var(--color-green)' }}>
      ✓ Configurazione valida
    </div>
  )
  return (
    <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'rgba(255,69,96,0.25)', background: 'var(--color-panel)' }}>
      <div className="px-4 py-2 border-b text-[10px] font-bold" style={{ borderColor: 'rgba(255,69,96,0.2)', color: 'var(--color-red)' }}>
        ✗ {issues.length} errore{issues.length !== 1 ? 'i' : ''}
      </div>
      <ul className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
        {issues.map((iss, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0" style={{ borderColor: 'rgba(255,69,96,0.1)' }}>
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5" style={{ background: 'rgba(255,69,96,0.1)', color: 'var(--color-red)' }}>{iss.path}</span>
            <span className="text-[11px] text-[var(--color-muted)]">{iss.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function ConfigPage() {
  const [data, setData] = useState<ConfigData | null>(null)
  const [text, setText] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    const res = await fetch('/api/config').catch(() => null)
    if (res?.ok) {
      const d: ConfigData = await res.json()
      setData(d)
      setText(d.config ? JSON.stringify(d.config, null, 2) : '{\n  "version": 1,\n  "active_provider": "claude",\n  "providers": {},\n  "channels": {},\n  "workspace": ""\n}')
      setIssues(d.issues)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleChange = useCallback((val: string) => {
    setText(val)
    setSaveMsg(null)
    if (validateTimer.current) clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(async () => {
      let parsed: unknown
      try { parsed = JSON.parse(val) } catch { setIssues([{ path: 'root', message: 'JSON non valido — controlla la sintassi' }]); return }
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: parsed, validateOnly: true }) }).catch(() => null)
      if (res?.ok) { const d = await res.json(); setIssues(d.issues ?? []) }
    }, 600)
  }, [])

  const handleSave = async () => {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { setIssues([{ path: 'root', message: 'JSON non valido' }]); return }
    setSaving(true)
    const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: parsed }) }).catch(() => null)
    const d = res ? await res.json() : null
    setSaving(false)
    if (d?.ok) { setSaveMsg('Salvato'); setIssues([]) }
    else { setIssues(d?.issues ?? [{ path: 'root', message: d?.error ?? 'Errore salvataggio' }]); setSaveMsg(null) }
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-6 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Config</span>
        </nav>
        <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Config</h1>
            <p className="text-[var(--color-muted)] text-[11px] mt-1">Editor visuale · jht.config.json · validazione live</p>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-[10px] text-[var(--color-green)]">✓ {saveMsg}</span>}
            <button onClick={fetchData} className="px-3 py-2 rounded-lg text-[11px] cursor-pointer transition-all"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}>
              ↻
            </button>
            <button onClick={handleSave} disabled={saving || issues.length > 0}
              className="px-4 py-2 rounded-lg text-[11px] font-bold cursor-pointer transition-all disabled:opacity-40"
              style={{ border: `1px solid ${issues.length ? 'var(--color-border)' : 'rgba(0,232,122,0.4)'}`, color: issues.length ? 'var(--color-dim)' : 'var(--color-green)', background: issues.length ? 'transparent' : 'rgba(0,232,122,0.08)' }}>
              {saving ? 'Salvataggio…' : '↳ salva'}
            </button>
          </div>
        </div>
      </div>

      {!data && <div className="flex justify-center py-16"><span className="text-[var(--color-dim)] text-[12px]">Caricamento…</span></div>}

      {data && (
        <div className="flex flex-col gap-4">
          <IssueList issues={issues} />
          <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
            <div className="px-4 py-2 border-b text-[9px] font-mono text-[var(--color-dim)]" style={{ borderColor: 'var(--color-border)' }}>
              ~/.jht/jht.config.json
            </div>
            <textarea
              value={text}
              onChange={e => handleChange(e.target.value)}
              spellCheck={false}
              className="w-full resize-none font-mono text-[11px] bg-transparent outline-none px-4 py-4"
              style={{ color: 'var(--color-bright)', minHeight: 400, lineHeight: 1.7 }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
