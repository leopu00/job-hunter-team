'use client'

import { useCallback, useMemo, useState } from 'react'

export interface CoverLetterPreviewProps {
  /** Testo della cover letter con variabili {{nome}}, {{azienda}}, {{ruolo}}, ecc. */
  content: string
  /** Valori per la sostituzione delle variabili */
  variables?: Record<string, string>
  /** Permette editing inline */
  editable?: boolean
  onChange?: (newContent: string) => void
  onSave?: (content: string) => void
}

const VAR_REGEX = /\{\{(\w+)\}\}/g

/** Evidenzia variabili nel testo renderizzato */
function HighlightedText({ text, variables }: { text: string; variables: Record<string, string> }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  const re = new RegExp(VAR_REGEX.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const key = match[1]!
    const val = variables[key]
    if (val) {
      parts.push(
        <mark key={`${key}-${match.index}`} style={{ background: 'rgba(0,232,122,0.18)', color: 'var(--color-green)', borderRadius: 3, padding: '0 2px', fontWeight: 600, fontStyle: 'normal' }}>
          {val}
        </mark>
      )
    } else {
      parts.push(
        <mark key={`${key}-${match.index}`} style={{ background: 'rgba(255,140,66,0.18)', color: 'var(--color-orange)', borderRadius: 3, padding: '0 2px', fontWeight: 600, fontStyle: 'normal', textDecoration: 'underline dotted' }}>
          {`{{${key}}}`}
        </mark>
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))

  return (
    <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-muted)', fontFamily: 'inherit' }}>
      {parts}
    </p>
  )
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function charCount(text: string): number {
  return text.length
}

export default function CoverLetterPreview({
  content: initialContent, variables = {}, editable = true, onChange, onSave,
}: CoverLetterPreviewProps) {
  const [content, setContent]   = useState(initialContent)
  const [mode, setMode]         = useState<'preview' | 'edit'>('preview')
  const [copied, setCopied]     = useState(false)
  const [saved, setSaved]       = useState(false)

  const resolved = useMemo(() => content.replace(VAR_REGEX, (_, k) => variables[k] ?? `{{${k}}}`), [content, variables])
  const words = wordCount(content)
  const chars = charCount(content)
  const varNames = useMemo(() => {
    const found = new Set<string>()
    let m: RegExpExecArray | null
    const re = new RegExp(VAR_REGEX.source, 'g')
    while ((m = re.exec(content)) !== null) found.add(m[1]!)
    return [...found]
  }, [content])
  const unresolved = varNames.filter(v => !variables[v])

  const handleChange = useCallback((val: string) => {
    setContent(val)
    onChange?.(val)
    setSaved(false)
  }, [onChange])

  const copy = async () => {
    await navigator.clipboard.writeText(resolved).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const save = () => {
    onSave?.(content)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          {/* Toggle preview/edit */}
          {editable && (
            <>
              <button onClick={() => setMode('preview')}
                className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all"
                style={{ border: `1px solid ${mode === 'preview' ? 'var(--color-green)' : 'var(--color-border)'}`, color: mode === 'preview' ? 'var(--color-green)' : 'var(--color-dim)', background: mode === 'preview' ? 'rgba(0,232,122,0.08)' : 'transparent' }}>
                Preview
              </button>
              <button onClick={() => setMode('edit')}
                className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all"
                style={{ border: `1px solid ${mode === 'edit' ? 'var(--color-yellow)' : 'var(--color-border)'}`, color: mode === 'edit' ? 'var(--color-yellow)' : 'var(--color-dim)', background: mode === 'edit' ? 'rgba(245,197,24,0.08)' : 'transparent' }}>
                Modifica
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Word/char count */}
          <span className="text-[9px] font-mono text-[var(--color-dim)]">{words} parole · {chars} caratteri</span>
          {/* Unresolved vars warning */}
          {unresolved.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,140,66,0.1)', color: 'var(--color-orange)', border: '1px solid rgba(255,140,66,0.3)' }}>
              ⚠ {unresolved.length} var mancanti
            </span>
          )}
          {/* Copy */}
          <button onClick={copy} className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all"
            style={{ border: '1px solid var(--color-border)', color: copied ? 'var(--color-green)' : 'var(--color-dim)', background: 'transparent' }}>
            {copied ? '✓ copiato' : '⎘ copia'}
          </button>
          {/* Save */}
          {editable && onSave && (
            <button onClick={save} className="px-3 py-1 rounded text-[10px] font-semibold cursor-pointer transition-all"
              style={{ background: saved ? 'var(--color-border)' : 'var(--color-green)', color: saved ? 'var(--color-muted)' : '#000', border: 'none' }}>
              {saved ? '✓ salvato' : 'salva'}
            </button>
          )}
        </div>
      </div>

      {/* Variabili pills */}
      {varNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {varNames.map(v => (
            <span key={v} className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: variables[v] ? 'rgba(0,232,122,0.08)' : 'rgba(255,140,66,0.08)', color: variables[v] ? 'var(--color-green)' : 'var(--color-orange)', border: `1px solid ${variables[v] ? 'rgba(0,232,122,0.2)' : 'rgba(255,140,66,0.2)'}` }}>
              {`{{${v}}}`}{variables[v] ? ` → ${variables[v]}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* Content area */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: mode === 'edit' ? 'var(--color-yellow)' : 'var(--color-border)', background: 'var(--color-panel)' }}>
        {mode === 'edit' ? (
          <textarea value={content} onChange={e => handleChange(e.target.value)}
            className="w-full p-5 text-[12px] leading-relaxed resize-none outline-none"
            rows={16}
            style={{ background: 'transparent', color: 'var(--color-muted)', fontFamily: 'inherit', border: 'none' }} />
        ) : (
          <div className="p-5">
            <HighlightedText text={content} variables={variables} />
          </div>
        )}
      </div>
    </div>
  )
}
