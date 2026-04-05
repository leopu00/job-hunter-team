'use client'

import { useCallback, useRef, useState } from 'react'

export interface DataColumn<T> {
  key: string
  label: string
  width?: number
  sortable?: boolean
  render?: (value: unknown, row: T) => React.ReactNode
}

export interface DataTableProps<T extends { id: string }> {
  columns: DataColumn<T>[]
  rows: T[]
  /** Se presente sovrascrive il download CSV nativo */
  onExport?: (rows: T[]) => void
  ariaLabel?: string
}

type SortDir = 'asc' | 'desc' | null

function toCSV<T extends { id: string }>(rows: T[], cols: DataColumn<T>[]) {
  const esc = (v: string) => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
  const header = cols.map(c => esc(c.label)).join(',')
  const body   = rows.map(r => cols.map(c => esc(String((r as Record<string,unknown>)[c.key] ?? ''))).join(','))
  return [header, ...body].join('\n')
}

function downloadCSV(content: string) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' })),
    download: 'export.csv',
  })
  a.click(); URL.revokeObjectURL(a.href)
}

export default function DataTable<T extends { id: string }>({ columns, rows, onExport, ariaLabel }: DataTableProps<T>) {
  const [sortKey, setSortKey]     = useState<string | null>(null)
  const [sortDir, setSortDir]     = useState<SortDir>(null)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(columns.map(c => [c.key, c.width ?? 160]))
  )
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null)

  /* ── Sorting ── */
  const sorted = [...rows].sort((a, b) => {
    if (!sortKey || !sortDir) return 0
    const cmp = String((a as Record<string,unknown>)[sortKey] ?? '').localeCompare(
      String((b as Record<string,unknown>)[sortKey] ?? ''), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSort = (col: DataColumn<T>) => {
    if (!col.sortable) return
    if (sortKey !== col.key) { setSortKey(col.key); setSortDir('asc'); return }
    if (sortDir === 'asc')  { setSortDir('desc'); return }
    setSortKey(null); setSortDir(null)
  }

  /* ── Resize ── */
  const startResize = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault()
    resizeRef.current = { key, startX: e.clientX, startW: colWidths[key] }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const w = Math.max(60, resizeRef.current.startW + ev.clientX - resizeRef.current.startX)
      setColWidths(prev => ({ ...prev, [resizeRef.current!.key]: w }))
    }
    const onUp = () => { resizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [colWidths])

  /* ── Selection ── */
  const allSelected = sorted.length > 0 && sorted.every(r => selected.has(r.id))
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(sorted.map(r => r.id)))
  const toggleRow   = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  /* ── Export ── */
  const handleExport = () => {
    const target = selected.size > 0 ? sorted.filter(r => selected.has(r.id)) : sorted
    if (onExport) { onExport(target); return }
    downloadCSV(toCSV(target, columns))
  }

  const selCount = selected.size
  const th: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--color-border)', position: 'relative', userSelect: 'none' }
  const td: React.CSSProperties = { padding: '7px 10px', fontSize: 11, color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

  return (
    <div style={{ width: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--color-dim)', flex: 1 }}>
          {selCount > 0 ? `${selCount} selezionat${selCount === 1 ? 'o' : 'i'}` : `${sorted.length} righe`}
        </span>
        <button onClick={handleExport} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-green)]" style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-panel)', color: 'var(--color-muted)', cursor: 'pointer' }}>
          ↓ CSV{selCount > 0 ? ` (${selCount})` : ''}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--color-border)' }}>
        <table aria-label={ariaLabel} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ background: 'var(--color-row)' }}>
              <th scope="col" style={{ ...th, width: 36 }}>
                <input type="checkbox" aria-label="Seleziona tutti" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', accentColor: 'var(--color-green)' }} />
              </th>
              {columns.map(col => (
                <th key={col.key} scope="col" style={{ ...th, width: colWidths[col.key] }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => handleSort(col)}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-muted)', cursor: col.sortable ? 'pointer' : 'default', flex: 1, textAlign: 'left' }}>
                      {col.label}
                    </span>
                    {col.sortable && (
                      <span style={{ fontSize: 8, color: sortKey === col.key ? 'var(--color-green)' : 'var(--color-border)', flexShrink: 0 }}>
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )}
                  </div>
                  <div onMouseDown={e => startResize(e, col.key)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={row.id}
                style={{ background: selected.has(row.id) ? 'rgba(0,232,122,0.06)' : ri % 2 ? 'var(--color-row)' : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!selected.has(row.id)) e.currentTarget.style.background = 'rgba(0,232,122,0.03)' }}
                onMouseLeave={e => { if (!selected.has(row.id)) e.currentTarget.style.background = ri % 2 ? 'var(--color-row)' : 'transparent' }}>
                <td style={td}>
                  <input type="checkbox" aria-label="Seleziona riga" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} style={{ cursor: 'pointer', accentColor: 'var(--color-green)' }} />
                </td>
                {columns.map(col => (
                  <td key={col.key} style={td}>
                    {col.render ? col.render((row as Record<string,unknown>)[col.key], row) : String((row as Record<string,unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={columns.length + 1} style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--color-dim)' }}>Nessun dato</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
