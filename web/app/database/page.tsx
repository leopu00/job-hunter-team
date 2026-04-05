'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'

type TableInfo = { name: string; rowCount: number; sizeKB: number; columns: string[]; source: string }

function TableRow({ t, onQuery }: { t: TableInfo; onQuery: (name: string) => void }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-row)] transition-colors">
      <span className="flex-1 text-[11px] font-mono text-[var(--color-bright)]">{t.name}</span>
      <span className="text-[9px] font-mono text-[var(--color-muted)] w-16 text-right">{t.rowCount >= 0 ? t.rowCount : '—'} righe</span>
      <span className="text-[9px] font-mono w-16 text-right" style={{ color: t.sizeKB > 100 ? 'var(--color-yellow)' : 'var(--color-dim)' }}>{t.sizeKB} KB</span>
      <span className="text-[9px] text-[var(--color-dim)] w-32 truncate text-right" title={t.source}>{t.source}</span>
      <button onClick={() => onQuery(t.name)} className="text-[9px] font-bold cursor-pointer" style={{ color: 'var(--color-green)' }}>query</button>
    </div>
  )
}

export default function DatabasePage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [totalSizeKB, setTotalSizeKB] = useState(0)
  const [totalRows, setTotalRows] = useState(0)
  const [selectedTable, setSelectedTable] = useState('')
  const [query, setQuery] = useState('SELECT * LIMIT 20')
  const [result, setResult] = useState<{ columns: string[]; rows: Record<string, unknown>[]; count: number } | null>(null)
  const [error, setError] = useState('')

  const fetchTables = useCallback(async () => {
    const res = await fetch('/api/database').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setTables(data.tables ?? []); setTotalSizeKB(data.totalSizeKB ?? 0); setTotalRows(data.totalRows ?? 0);
  }, [])

  useEffect(() => { fetchTables() }, [fetchTables])

  const runQuery = async () => {
    setError(''); setResult(null);
    const res = await fetch('/api/database', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table: selectedTable, query }) }).catch(() => null);
    if (!res) { setError('Errore di rete'); return; }
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Errore'); return; }
    setResult(data);
  }

  const openQuery = (name: string) => { setSelectedTable(name); setQuery('SELECT * LIMIT 20'); setResult(null); setError(''); }

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Database</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)] mt-3">Database</h1>
        <p className="text-[var(--color-muted)] text-[11px] mt-1">{tables.length} tabelle · {totalRows} righe · {totalSizeKB} KB totali</p>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)] mb-6">
        <div className="flex items-center gap-4 px-5 py-2 border-b border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <span className="flex-1 text-[8px] font-bold tracking-widest text-[var(--color-dim)]">TABELLA</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">RIGHE</span>
          <span className="w-16 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">SIZE</span>
          <span className="w-32 text-[8px] font-bold tracking-widest text-[var(--color-dim)] text-right">SOURCE</span>
          <span className="w-10" />
        </div>
        {tables.length === 0
          ? <div className="py-12 text-center">
              <p className="text-[var(--color-dim)] text-[12px]">Nessuna tabella trovata.</p>
              <p className="text-[var(--color-dim)] text-[10px] mt-1">Verifica che il database sia connesso e contenga almeno una tabella.</p>
            </div>
          : tables.map(t => <TableRow key={t.name + t.source} t={t} onQuery={openQuery} />)}
      </div>

      {selectedTable && (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-panel)]">
          <div className="px-5 py-2 border-b border-[var(--color-border)] flex items-center gap-3" style={{ background: 'var(--color-deep)' }}>
            <span className="text-[9px] font-bold tracking-widest text-[var(--color-dim)]">QUERY EXPLORER</span>
            <span className="text-[10px] font-mono text-[var(--color-green)]">{selectedTable}</span>
          </div>
          <div className="px-5 py-3 flex gap-2 items-center">
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runQuery()}
              aria-label="Query SQL"
              className="flex-1 text-[10px] font-mono px-3 py-1.5 rounded" style={{ background: 'var(--color-deep)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }} />
            <button onClick={runQuery} className="px-3 py-1.5 rounded text-[10px] font-bold cursor-pointer" style={{ background: 'var(--color-green)', color: '#000' }}>Esegui</button>
          </div>
          {error && <p role="alert" className="px-5 pb-3 text-[10px]" style={{ color: 'var(--color-red)' }}>{error}</p>}
          {result && (
            <div className="px-5 pb-3 overflow-x-auto">
              <p className="text-[9px] text-[var(--color-dim)] mb-2">{result.count} risultati</p>
              <table className="w-full text-[9px] font-mono" aria-label="Risultati query SQL">
                <thead><tr>{result.columns.map(c => <th key={c} scope="col" className="text-left px-2 py-1 text-[var(--color-dim)] border-b border-[var(--color-border)]">{c}</th>)}</tr></thead>
                <tbody>{result.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--color-row)]">{result.columns.map(c => <td key={c} className="px-2 py-1 text-[var(--color-muted)] border-b border-[var(--color-border)] max-w-[200px] truncate">{String(r[c] ?? '')}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
