'use client'

import { useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TableColumn<T = Record<string, unknown>> {
  key:       keyof T | string
  label:     string
  sortable?: boolean
  width?:    string
  render?:   (value: unknown, row: T, index: number) => React.ReactNode
  align?:    'left' | 'center' | 'right'
}

export interface TableProps<T = Record<string, unknown>> {
  columns:       TableColumn<T>[]
  data:          T[]
  onRowClick?:   (row: T, index: number) => void
  striped?:      boolean
  hoverable?:    boolean
  compact?:      boolean
  emptyMessage?: string
  loading?:      boolean
  className?:    string
  ariaLabel?:    string
}

type SortDir = 'asc' | 'desc' | null

// ── Sort helper ────────────────────────────────────────────────────────────

function sortData<T>(data: T[], key: string, dir: SortDir): T[] {
  if (!dir) return data
  return [...data].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (av === bv) return 0
    const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })
    return dir === 'asc' ? cmp : -cmp
  })
}

// ── SortIcon ───────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: SortDir }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style={{ display: 'inline', marginLeft: 4 }}>
      <path d="M3 4l2-2 2 2" stroke={dir === 'asc'  ? 'var(--color-green)' : 'var(--color-border)'} strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 6l2 2 2-2" stroke={dir === 'desc' ? 'var(--color-green)' : 'var(--color-border)'} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ── Table ──────────────────────────────────────────────────────────────────

export function Table<T extends Record<string, unknown>>({
  columns, data, onRowClick, striped = false, hoverable = true,
  compact = false, emptyMessage = 'Nessun dato', loading = false, className = '', ariaLabel,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') setSortDir('desc')
    else { setSortKey(null); setSortDir(null) }
  }

  const rows = sortKey ? sortData(data, sortKey, sortDir) : data
  const pad  = compact ? 'px-3 py-1.5' : 'px-4 py-3'
  const fs   = compact ? 'text-[10px]' : 'text-[11px]'

  return (
    <div className={`w-full overflow-x-auto rounded-lg border ${className}`}
      style={{ borderColor: 'var(--color-border)' }}>
      <table className="w-full border-collapse" aria-label={ariaLabel}>
        {/* Head */}
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-row)' }}>
            {columns.map(col => (
              <th
                key={String(col.key)}
                scope="col"
                className={`${pad} text-left font-semibold tracking-widest uppercase select-none ${col.sortable ? 'cursor-pointer' : ''}`}
                style={{ width: col.width, textAlign: col.align ?? 'left', color: 'var(--color-dim)', fontSize: 9 }}
                onClick={col.sortable ? () => toggleSort(String(col.key)) : undefined}
                aria-sort={sortKey === String(col.key) ? (sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined) : undefined}
              >
                {col.label}
                {col.sortable && <SortIcon dir={sortKey === String(col.key) ? sortDir : null} />}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className={`${pad} text-center`} style={{ color: 'var(--color-dim)' }}>
                <span className={`${fs} animate-pulse`}>Caricamento…</span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={`${pad} text-center ${fs}`}
                style={{ color: 'var(--color-dim)' }}>
                {emptyMessage}
              </td>
            </tr>
          ) : rows.map((row, ri) => (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
              className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
              style={{
                borderBottom: ri < rows.length - 1 ? '1px solid var(--color-border)' : undefined,
                background: striped && ri % 2 === 1 ? 'color-mix(in srgb, var(--color-border) 30%, transparent)' : undefined,
              }}
              onMouseEnter={hoverable ? e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-row)' } : undefined}
              onMouseLeave={hoverable ? e => { (e.currentTarget as HTMLElement).style.background = striped && ri % 2 === 1 ? 'color-mix(in srgb, var(--color-border) 30%, transparent)' : '' } : undefined}
            >
              {columns.map(col => (
                <td key={String(col.key)} className={`${pad} ${fs}`}
                  style={{ textAlign: col.align ?? 'left', color: 'var(--color-muted)', maxWidth: col.width }}>
                  {col.render
                    ? col.render(row[col.key as keyof T], row, ri)
                    : String(row[col.key as keyof T] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
