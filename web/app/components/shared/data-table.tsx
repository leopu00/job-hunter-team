'use client'

import { ReactNode, useState, useMemo } from 'react'

export type Column<T> = {
  key: keyof T
  label: string
  sortable?: boolean
  render?: (value: T[keyof T], row: T) => ReactNode
}

type Props<T extends Record<string, unknown>> = {
  columns: Column<T>[]
  rows: T[]
  keyField: keyof T
  searchable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  maxRows?: number
}

type SortDir = 'asc' | 'desc'

export function DataTable<T extends Record<string, unknown>>({
  columns, rows, keyField, searchable, searchPlaceholder = 'Cerca…', emptyText = 'Nessun risultato', maxRows,
}: Props<T>) {
  const [query, setQuery]     = useState('')
  const [sortKey, setSortKey] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let result = rows
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return maxRows ? result.slice(0, maxRows) : result
  }, [rows, query, sortKey, sortDir, maxRows])

  return (
    <div className="flex flex-col gap-2">
      {searchable && (
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={searchPlaceholder}
          className="w-full px-3 py-2 rounded border text-[11px] font-mono outline-none bg-transparent"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-bright)' }}
          onFocus={e => e.currentTarget.style.borderColor = 'var(--color-green)'}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'} />
      )}
      <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {columns.map(col => (
                <th key={String(col.key)} scope="col" className="px-4 py-2.5 text-left font-semibold"
                  style={{ color: 'var(--color-dim)', cursor: col.sortable ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={() => col.sortable && toggleSort(col.key)}>
                  {col.label}
                  {col.sortable && sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={columns.length} className="px-4 py-6 text-center" style={{ color: 'var(--color-dim)' }}>{emptyText}</td></tr>
              : filtered.map(row => (
                  <tr key={String(row[keyField])} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    {columns.map(col => (
                      <td key={String(col.key)} className="px-4 py-2.5" style={{ color: 'var(--color-base)' }}>
                        {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))
            }
          </tbody>
        </table>
      </div>
      {maxRows && rows.length > maxRows && (
        <p className="text-[9px] text-right" style={{ color: 'var(--color-dim)' }}>Mostra {maxRows} di {rows.length}</p>
      )}
    </div>
  )
}
