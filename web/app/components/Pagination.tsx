'use client'

type Props = {
  page: number
  totalPages: number
  perPage: number
  totalItems: number
  onPage: (p: number) => void
  onPerPage?: (n: number) => void
  perPageOptions?: number[]
}

const PER_PAGE_DEFAULTS = [10, 25, 50, 100]

function PageBtn({ label, onClick, active, disabled }: { label: string | number; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="min-w-[30px] h-[30px] px-2 rounded text-[10px] font-mono font-semibold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
      style={{
        border: `1px solid ${active ? 'var(--color-green)' : 'var(--color-border)'}`,
        color: active ? 'var(--color-green)' : 'var(--color-muted)',
        background: active ? 'rgba(0,232,122,0.08)' : 'transparent',
      }}>
      {label}
    </button>
  )
}

export function Pagination({ page, totalPages, perPage, totalItems, onPage, onPerPage, perPageOptions = PER_PAGE_DEFAULTS }: Props) {
  if (totalPages <= 0) return null
  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }
  const start = (page - 1) * perPage + 1
  const end   = Math.min(page * perPage, totalItems)
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 text-[10px]">
      <span style={{ color: 'var(--color-dim)' }}>{start}–{end} di {totalItems}</span>
      <div className="flex items-center gap-1">
        <PageBtn label="←" onClick={() => onPage(page - 1)} disabled={page <= 1} />
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} className="px-1" style={{ color: 'var(--color-dim)' }}>…</span>
            : <PageBtn key={p} label={p} onClick={() => onPage(p as number)} active={p === page} />
        )}
        <PageBtn label="→" onClick={() => onPage(page + 1)} disabled={page >= totalPages} />
      </div>
      {onPerPage && (
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--color-dim)' }}>per pagina</span>
          <select value={perPage} onChange={e => onPerPage(Number(e.target.value))}
            className="px-2 py-1 rounded text-[10px] font-mono cursor-pointer outline-none"
            style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', color: 'var(--color-muted)' }}>
            {perPageOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
