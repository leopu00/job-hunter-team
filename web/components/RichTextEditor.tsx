'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface RichTextEditorProps {
  value?: string
  onChange?: (html: string) => void
  placeholder?: string
  minHeight?: number
  disabled?: boolean
}

// Tag permessi nell'output
const ALLOWED_TAGS = new Set(['b','strong','i','em','u','a','ul','ol','li','h2','h3','p','br','span'])
const ALLOWED_ATTRS: Record<string, string[]> = { a: ['href', 'target', 'rel'] }

function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  function clean(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) return node.cloneNode()
    if (node.nodeType !== Node.ELEMENT_NODE) return null
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) {
      // Conserva il testo interno, rimuove solo il tag
      const frag = document.createDocumentFragment()
      el.childNodes.forEach(c => { const n = clean(c); if (n) frag.appendChild(n) })
      return frag
    }
    const out = document.createElement(tag)
    const allowed = ALLOWED_ATTRS[tag] ?? []
    allowed.forEach(a => { if (el.hasAttribute(a)) out.setAttribute(a, el.getAttribute(a)!) })
    if (tag === 'a') { out.setAttribute('target', '_blank'); out.setAttribute('rel', 'noopener noreferrer') }
    el.childNodes.forEach(c => { const n = clean(c); if (n) out.appendChild(n) })
    return out
  }
  const frag = document.createDocumentFragment()
  doc.body.childNodes.forEach(c => { const n = clean(c); if (n) frag.appendChild(n) })
  const tmp = document.createElement('div')
  tmp.appendChild(frag)
  return tmp.innerHTML
}

type ToolAction = { cmd: string; arg?: string }
const TOOLS: Array<{ label: string; title: string; action: ToolAction } | 'sep'> = [
  { label: 'B',  title: 'Grassetto',   action: { cmd: 'bold' } },
  { label: 'I',  title: 'Corsivo',     action: { cmd: 'italic' } },
  { label: 'U',  title: 'Sottolineato', action: { cmd: 'underline' } },
  'sep',
  { label: 'H2', title: 'Titolo 2',    action: { cmd: 'formatBlock', arg: 'h2' } },
  { label: 'H3', title: 'Titolo 3',    action: { cmd: 'formatBlock', arg: 'h3' } },
  'sep',
  { label: '≡',  title: 'Lista puntata', action: { cmd: 'insertUnorderedList' } },
  { label: '1.', title: 'Lista numerata', action: { cmd: 'insertOrderedList' } },
  'sep',
  { label: '🔗', title: 'Inserisci link', action: { cmd: 'createLink', arg: '__prompt__' } },
  { label: '✕',  title: 'Rimuovi link',   action: { cmd: 'unlink' } },
]

export default function RichTextEditor({ value = '', onChange, placeholder = 'Scrivi qui...', minHeight = 160, disabled = false }: RichTextEditorProps) {
  const editorRef  = useRef<HTMLDivElement>(null)
  const lastHtml   = useRef(value)
  const [focused, setFocused] = useState(false)
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set())

  // Inizializza contenuto
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value
      lastHtml.current = value
    }
  }, []) // solo mount

  // Aggiorna formati attivi al cambio selezione
  const updateFormats = useCallback(() => {
    const cmds = ['bold','italic','underline']
    setActiveFormats(new Set(cmds.filter(c => document.queryCommandState(c))))
  }, [])

  const handleInput = useCallback(() => {
    if (!editorRef.current) return
    const clean = sanitize(editorRef.current.innerHTML)
    if (clean !== lastHtml.current) { lastHtml.current = clean; onChange?.(clean) }
    updateFormats()
  }, [onChange, updateFormats])

  const exec = useCallback((action: ToolAction) => {
    if (disabled) return
    editorRef.current?.focus()
    let arg = action.arg
    if (arg === '__prompt__') {
      arg = window.prompt('URL del link:') ?? undefined
      if (!arg) return
      // Forza https se manca schema
      if (!/^https?:\/\//i.test(arg)) arg = 'https://' + arg
    }
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(action.cmd, false, arg)
    handleInput()
  }, [disabled, handleInput])

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 7px', fontSize: 11, fontWeight: active ? 700 : 400, borderRadius: 4,
    border: 'none', cursor: disabled ? 'default' : 'pointer',
    background: active ? 'var(--color-green)' : 'transparent',
    color: active ? '#000' : 'var(--color-muted)',
    transition: 'background 0.15s, color 0.15s',
  })

  return (
    <div style={{ border: `1px solid ${focused ? 'var(--color-green)' : 'var(--color-border)'}`, borderRadius: 8, overflow: 'hidden', opacity: disabled ? 0.6 : 1, transition: 'border-color 0.2s' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '4px 6px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-row)', flexWrap: 'wrap' }}>
        {TOOLS.map((t, i) =>
          t === 'sep'
            ? <div key={i} style={{ width: 1, height: 16, background: 'var(--color-border)', margin: '0 3px' }} />
            : <button key={t.label} title={t.title} onMouseDown={e => { e.preventDefault(); exec(t.action) }}
                style={btnStyle(activeFormats.has(t.action.cmd))}>
                {t.label}
              </button>
        )}
      </div>

      {/* Editable area */}
      <div style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyUp={updateFormats}
          onMouseUp={updateFormats}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            minHeight, padding: '10px 12px', outline: 'none', fontSize: 12,
            color: 'var(--color-bright)', lineHeight: 1.6,
            background: 'var(--color-panel)',
          }}
        />
        {/* Placeholder */}
        {!lastHtml.current && !focused && (
          <div style={{ position: 'absolute', top: 10, left: 12, fontSize: 12, color: 'var(--color-dim)', pointerEvents: 'none' }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  )
}
