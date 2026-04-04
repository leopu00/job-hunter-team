'use client'

import type { CSSProperties, ReactNode } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface HighlightProps {
  text:           string
  query:          string | string[]   // uno o più termini da evidenziare
  color?:         string              // colore bg match, default giallo
  textColor?:     string              // colore testo match
  caseSensitive?: boolean
  wholeWord?:     boolean             // match solo parole intere
  className?:     string
  markClassName?: string
  style?:         CSSProperties
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface Chunk { start: number; end: number; highlight: boolean }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildChunks(text: string, queries: string[], caseSensitive: boolean, wholeWord: boolean): Chunk[] {
  const terms = queries.filter(q => q.trim().length > 0)
  if (!terms.length) return [{ start: 0, end: text.length, highlight: false }]

  const flags   = caseSensitive ? 'g' : 'gi'
  const escaped = terms.map(escapeRegex).map(t => wholeWord ? `\\b${t}\\b` : t)
  const pattern = escaped.join('|')

  let regex: RegExp
  try { regex = new RegExp(pattern, flags) }
  catch { return [{ start: 0, end: text.length, highlight: false }] }

  // Raccogli tutti i match e uniscili (merge overlapping)
  const ranges: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length])
    if (m[0].length === 0) regex.lastIndex++ // evita loop infinito su match vuoti
  }

  if (!ranges.length) return [{ start: 0, end: text.length, highlight: false }]

  // Merge range sovrapposti
  const merged: [number, number][] = [ranges[0]]
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1]
    if (ranges[i][0] <= last[1]) { last[1] = Math.max(last[1], ranges[i][1]) }
    else merged.push(ranges[i])
  }

  // Costruisci chunk alternando testo normale / evidenziato
  const chunks: Chunk[] = []
  let pos = 0
  for (const [s, e] of merged) {
    if (s > pos) chunks.push({ start: pos, end: s, highlight: false })
    chunks.push({ start: s, end: e, highlight: true })
    pos = e
  }
  if (pos < text.length) chunks.push({ start: pos, end: text.length, highlight: false })
  return chunks
}

// ── Highlight ──────────────────────────────────────────────────────────────

export function Highlight({
  text, query, color = 'rgba(245,197,24,0.35)', textColor,
  caseSensitive = false, wholeWord = false,
  className = '', markClassName = '', style,
}: HighlightProps) {
  const queries = Array.isArray(query) ? query : [query]
  const chunks  = buildChunks(text, queries, caseSensitive, wholeWord)

  return (
    <span className={className} style={style}>
      {chunks.map((c, i) => {
        const part = text.slice(c.start, c.end)
        if (!c.highlight) return part
        return (
          <mark key={i} className={markClassName}
            style={{ background: color, color: textColor ?? 'inherit',
              borderRadius: 2, padding: '0 1px' }}>
            {part}
          </mark>
        )
      })}
    </span>
  )
}

// ── HighlightList ──────────────────────────────────────────────────────────

export interface HighlightListProps<T extends Record<string, unknown>> {
  items:       T[]
  query:       string
  fields:      (keyof T)[]            // campi su cui fare highlight
  renderItem:  (item: T, highlighted: Partial<Record<keyof T, ReactNode>>) => ReactNode
  color?:      string
  caseSensitive?: boolean
  className?:  string
}

export function HighlightList<T extends Record<string, unknown>>({
  items, query, fields, renderItem, color, caseSensitive = false, className = '',
}: HighlightListProps<T>) {
  return (
    <div className={className}>
      {items.map((item, i) => {
        const highlighted: Partial<Record<keyof T, ReactNode>> = {}
        for (const field of fields) {
          const val = item[field]
          if (typeof val === 'string') {
            highlighted[field] = (
              <Highlight text={val} query={query} color={color} caseSensitive={caseSensitive} />
            )
          }
        }
        return <div key={i}>{renderItem(item, highlighted)}</div>
      })}
    </div>
  )
}

// ── useHighlight ── hook semplice per ottenere i chunks ───────────────────

export function useHighlight(text: string, query: string | string[], caseSensitive = false, wholeWord = false) {
  const queries = Array.isArray(query) ? query : [query]
  const chunks  = buildChunks(text, queries, caseSensitive, wholeWord)
  const hasMatch = chunks.some(c => c.highlight)
  return { chunks, hasMatch }
}
