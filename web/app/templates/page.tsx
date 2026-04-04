'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type Category = 'cover-letter' | 'follow-up' | 'thank-you' | 'referral' | 'salary'
type TemplateSummary = { name: string; title: string; summary: string; category: Category; variables: string[]; charCount: number }
type TemplateDetail = TemplateSummary & { content: string; frontmatter: Record<string, string> }

const CAT_LABELS: Record<Category, { label: string; color: string }> = {
  'cover-letter': { label: 'Cover Letter', color: '#61affe' },
  'follow-up':    { label: 'Follow-up', color: 'var(--color-yellow)' },
  'thank-you':    { label: 'Ringraziamento', color: 'var(--color-green)' },
  'referral':     { label: 'Referral', color: '#9b59b6' },
  'salary':       { label: 'RAL', color: 'var(--color-red)' },
}

function CatBadge({ category }: { category: Category }) {
  const c = CAT_LABELS[category] ?? { label: category, color: 'var(--color-dim)' }
  return <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ color: c.color, background: `${c.color}12`, border: `1px solid ${c.color}30` }}>{c.label}</span>
}

function VarBadge({ name }: { name: string }) {
  return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--color-yellow)', background: 'rgba(245,197,24,0.08)', border: '1px solid rgba(245,197,24,0.2)' }}>{`{${name}}`}</span>
}

function TemplateRow({ t, onSelect, selected }: { t: TemplateSummary; onSelect: (n: string) => void; selected: boolean }) {
  return (
    <div onClick={() => onSelect(t.name)} className="px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors cursor-pointer"
      style={{ background: selected ? 'var(--color-row)' : undefined }}>
      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
        <span className="text-[12px] font-semibold text-[var(--color-bright)]">{t.title}</span>
        <CatBadge category={t.category} />
      </div>
      <p className="text-[11px] text-[var(--color-muted)] truncate mb-1">{t.summary}</p>
      {t.variables.length > 0 && <div className="flex gap-1 flex-wrap">{t.variables.map(v => <VarBadge key={v} name={v} />)}</div>}
    </div>
  )
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [filterCat, setFilterCat] = useState<string>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [varValues, setVarValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState('')
  const [copied, setCopied] = useState(false)

  const fetchList = useCallback(async () => {
    const p = new URLSearchParams()
    if (filterCat !== 'all') p.set('category', filterCat)
    const res = await fetch(`/api/templates?${p}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setTemplates(data.templates ?? [])
    if (data.categories) setCategories(data.categories)
  }, [filterCat])

  useEffect(() => { fetchList() }, [fetchList])

  const selectTemplate = async (name: string) => {
    setSelected(name); setPreview(''); setVarValues({}); setCopied(false)
    const res = await fetch(`/api/templates?name=${encodeURIComponent(name)}`).catch(() => null)
    if (!res?.ok) return
    setDetail((await res.json()).template ?? null)
  }

  const runPreview = async () => {
    if (!selected) return
    const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: selected, variables: varValues }) }).catch(() => null)
    if (res?.ok) setPreview((await res.json()).rendered ?? '')
  }

  const displayText = preview || detail?.content || ''

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(displayText)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const downloadFile = () => {
    const blob = new Blob([displayText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = detail?.name?.replace('.md', '.txt') ?? 'template.txt'
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]">/</span>
          <span className="text-[10px] text-[var(--color-muted)]">Template</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-[var(--color-white)]">Template</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{templates.length} template disponibili</p>
      </div>

      <div className="flex gap-1 mb-4">
        <button onClick={() => setFilterCat('all')} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
          style={{ background: filterCat === 'all' ? 'var(--color-row)' : 'transparent', color: filterCat === 'all' ? 'var(--color-bright)' : 'var(--color-dim)', border: `1px solid ${filterCat === 'all' ? 'var(--color-border-glow)' : 'transparent'}` }}>tutte</button>
        {categories.map(c => (
          <button key={c} onClick={() => setFilterCat(c)} className="px-3 py-1 rounded text-[10px] font-semibold tracking-widest uppercase transition-colors cursor-pointer"
            style={{ background: filterCat === c ? 'var(--color-row)' : 'transparent', color: filterCat === c ? (CAT_LABELS[c as Category]?.color ?? 'var(--color-bright)') : 'var(--color-dim)', border: `1px solid ${filterCat === c ? 'var(--color-border-glow)' : 'transparent'}` }}>
            {CAT_LABELS[c as Category]?.label ?? c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {templates.length === 0
            ? <div className="flex flex-col items-center py-16"><p className="text-[var(--color-dim)] text-[12px]">Nessun template trovato.</p></div>
            : templates.map(t => <TemplateRow key={t.name} t={t} onSelect={selectTemplate} selected={selected === t.name} />)}
        </div>

        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-panel)] p-5" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {!detail ? (
            <div className="flex flex-col items-center py-16"><p className="text-[var(--color-dim)] text-[12px]">Seleziona un template.</p></div>
          ) : (
            <>
              <div className="mb-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between">
                <div>
                  <h2 className="text-[14px] font-bold text-[var(--color-bright)]">{detail.title}</h2>
                  <div className="flex items-center gap-2 mt-0.5"><CatBadge category={detail.category} /><span className="text-[9px] text-[var(--color-dim)]">{detail.charCount} chr</span></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyToClipboard} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-all"
                    style={{ border: '1px solid var(--color-border)', color: copied ? 'var(--color-green)' : 'var(--color-muted)', background: 'transparent' }}>{copied ? 'copiato!' : 'copia'}</button>
                  <button onClick={downloadFile} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-all"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)', background: 'transparent' }}>download</button>
                </div>
              </div>
              {detail.variables.length > 0 && (
                <div className="mb-4 p-3 rounded border border-[var(--color-border)]">
                  <p className="text-[10px] font-semibold text-[var(--color-muted)] mb-2 uppercase tracking-widest">Variabili</p>
                  <div className="flex flex-col gap-2">
                    {detail.variables.map(v => (
                      <div key={v} className="flex items-center gap-2">
                        <VarBadge name={v} />
                        <input value={varValues[v] ?? ''} onChange={e => setVarValues(p => ({ ...p, [v]: e.target.value }))} placeholder={`valore per {${v}}`}
                          className="flex-1 text-[11px] px-2 py-1 rounded border border-[var(--color-border)] bg-transparent text-[var(--color-bright)]" />
                      </div>
                    ))}
                  </div>
                  <button onClick={runPreview} className="mt-3 px-4 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>anteprima</button>
                </div>
              )}
              <p className="text-[10px] font-semibold text-[var(--color-muted)] mb-2 uppercase tracking-widest">{preview ? 'Anteprima' : 'Contenuto'}</p>
              <pre className="text-[11px] text-[var(--color-muted)] whitespace-pre-wrap font-mono leading-relaxed">{displayText}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
