'use client'

import { useMemo } from 'react'
import { CopyButton } from './CopyButton'

// ── Types ──────────────────────────────────────────────────────────────────

export type CodeLanguage = 'js' | 'ts' | 'jsx' | 'tsx' | 'python' | 'bash' | 'json' | 'css' | 'html' | 'text'

export interface CodeBlockProps {
  code:             string
  language?:        CodeLanguage
  showLineNumbers?: boolean
  maxHeight?:       number | string
  filename?:        string
  className?:       string
}

// ── Token types and colors ─────────────────────────────────────────────────

type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'operator' | 'function' | 'plain'

const TOKEN_COLOR: Record<TokenType, string> = {
  keyword:  'var(--color-blue)',
  string:   'var(--color-green)',
  comment:  'var(--color-dim)',
  number:   '#e09b5e',
  operator: 'var(--color-muted)',
  function: '#9ecbff',
  plain:    'var(--color-bright)',
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

const JS_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|default|new|typeof|async|await|try|catch|throw|null|undefined|true|false|void|in|of|extends|this|super)\b/g
const PY_KEYWORDS = /\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|lambda|try|except|finally|with|as|pass|break|continue|yield|async|await)\b/g
const SH_KEYWORDS = /\b(if|then|else|fi|for|while|do|done|case|esac|function|return|export|echo|cd|ls|mkdir|rm|cp|mv|grep|sed|awk|cat|curl|git|npm|npx)\b/g

interface Token { type: TokenType; value: string }

function tokenizeLine(line: string, lang: CodeLanguage): Token[] {
  if (lang === 'json') return tokenizeJson(line)
  if (lang === 'bash') return tokenizeWithKeywords(line, SH_KEYWORDS)
  if (lang === 'python') return tokenizeWithKeywords(line, PY_KEYWORDS)
  if (lang === 'css' || lang === 'html' || lang === 'text') return [{ type: 'plain', value: line }]
  return tokenizeWithKeywords(line, JS_KEYWORDS)
}

function tokenizeJson(line: string): Token[] {
  // Simple JSON: keys (green), strings (green), numbers (orange), keywords (blue)
  return [{ type: 'plain', value: line }] // fallback — highlight via regex below
    .flatMap(t => splitByRegex(t.value, /"([^"\\]|\\.)*"/g, 'string'))
    .flatMap(t => t.type === 'plain' ? splitByRegex(t.value, /\b(-?\d+\.?\d*)\b/g, 'number') : [t])
    .flatMap(t => t.type === 'plain' ? splitByRegex(t.value, /\b(true|false|null)\b/g, 'keyword') : [t])
}

function tokenizeWithKeywords(line: string, kwRegex: RegExp): Token[] {
  // comment first
  const commentIdx = line.indexOf('//')
  const hashIdx    = line.indexOf('#')
  const commentAt  = commentIdx >= 0 && hashIdx < 0 ? commentIdx : hashIdx >= 0 && commentIdx < 0 ? hashIdx : Math.min(commentIdx < 0 ? Infinity : commentIdx, hashIdx < 0 ? Infinity : hashIdx)
  if (commentAt < Infinity) {
    const before = line.slice(0, commentAt)
    const after  = line.slice(commentAt)
    return [...tokenizeCode(before, kwRegex), { type: 'comment', value: after }]
  }
  return tokenizeCode(line, kwRegex)
}

function tokenizeCode(text: string, kwRegex: RegExp): Token[] {
  return [{ type: 'plain', value: text }]
    .flatMap(t => splitByRegex(t.value, /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g, 'string'))
    .flatMap(t => t.type === 'plain' ? splitByRegex(t.value, /\b\d+\.?\d*\b/g, 'number') : [t])
    .flatMap(t => t.type === 'plain' ? splitByRegex(t.value, new RegExp(kwRegex.source, 'g'), 'keyword') : [t])
    .flatMap(t => t.type === 'plain' ? splitByRegex(t.value, /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, 'function') : [t])
}

function splitByRegex(text: string, re: RegExp, type: TokenType): Token[] {
  const tokens: Token[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'plain', value: text.slice(last, m.index) })
    tokens.push({ type, value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ type: 'plain', value: text.slice(last) })
  return tokens.length ? tokens : [{ type: 'plain', value: text }]
}

// ── CodeBlock ──────────────────────────────────────────────────────────────

export function CodeBlock({ code, language = 'text', showLineNumbers = false, maxHeight, filename, className = '' }: CodeBlockProps) {
  const lines = useMemo(() => code.split('\n'), [code])
  const tokenized = useMemo(() => lines.map(l => tokenizeLine(l, language)), [lines, language])

  return (
    <div className={`rounded-lg overflow-hidden ${className}`}
      style={{ background: 'var(--color-deep)', border: '1px solid var(--color-border)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-row)' }}>
        <span className="text-[9px] font-mono tracking-widest uppercase" style={{ color: 'var(--color-dim)' }}>
          {filename ?? language}
        </span>
        <CopyButton text={code} variant="inline" size="sm" />
      </div>

      {/* Code */}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse" aria-label="Codice sorgente" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65 }}>
          <tbody>
            {tokenized.map((tokens, i) => (
              <tr key={i} className="hover:bg-[var(--color-row)] transition-colors">
                {showLineNumbers && (
                  <td className="select-none text-right pr-4 pl-4 w-8"
                    style={{ color: 'var(--color-dim)', fontSize: 11, verticalAlign: 'top', userSelect: 'none' }}>
                    {i + 1}
                  </td>
                )}
                <td className="pr-6 pl-4 whitespace-pre" style={{ verticalAlign: 'top' }}>
                  {tokens.map((tok, j) => (
                    <span key={j} style={{ color: TOKEN_COLOR[tok.type] }}>{tok.value}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
