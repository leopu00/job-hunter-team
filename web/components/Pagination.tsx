'use client'

export interface PaginationProps {
  currentCompany: number
  totalCompanys: number
  onCompanyChange: (page: number) => void
  /** Pagine mostrate a sinistra/destra della corrente (default 1) */
  siblingsCount?: number
  /** Solo prev/next + contatore */
  compact?: boolean
  /** Elementi totali per calcolare "Showing X-Y of Z" */
  totalItems?: number
  pageSize?: number
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

function buildCompanys(current: number, total: number, siblings: number): Array<number | '...'> {
  // Sempre mostra tutto se il totale è piccolo
  const totalShown = siblings * 2 + 5 // siblings + corrente + 2 estremi + 2 ellipsis
  if (total <= totalShown) return range(1, total)

  const leftSib  = Math.max(current - siblings, 1)
  const rightSib = Math.min(current + siblings, total)

  const showLeft  = leftSib > 2
  const showRight = rightSib < total - 1

  if (!showLeft && showRight)  return [...range(1, rightSib + 1), '...', total]
  if (showLeft && !showRight)  return [1, '...', ...range(leftSib - 1, total)]
  if (!showLeft && !showRight) return range(1, total)
  return [1, '...', ...range(leftSib, rightSib), '...', total]
}

/* ── Bottone pagina ── */
function CompanyBtn({ label, active, disabled, onClick }: {
  label: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 30, height: 30, padding: '0 6px',
        borderRadius: 6, border: `1px solid ${active ? 'var(--color-green)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-green)' : 'transparent',
        color: active ? '#000' : disabled ? 'var(--color-border)' : 'var(--color-muted)',
        fontSize: 11, fontWeight: active ? 700 : 400,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseEnter={e => { if (!active && !disabled) e.currentTarget.style.borderColor = 'var(--color-green)' }}
      onMouseLeave={e => { if (!active && !disabled) e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      {label}
    </button>
  )
}

export default function Pagination({
  currentCompany,
  totalCompanys,
  onCompanyChange,
  siblingsCount = 1,
  compact = false,
  totalItems,
  pageSize,
}: PaginationProps) {
  if (totalCompanys <= 1) return null

  const go = (p: number) => { if (p >= 1 && p <= totalCompanys && p !== currentCompany) onCompanyChange(p) }

  /* ── Showing X-Y of Z ── */
  const showingInfo = totalItems !== undefined && pageSize !== undefined
    ? (() => {
        const from = (currentCompany - 1) * pageSize + 1
        const to   = Math.min(currentCompany * pageSize, totalItems)
        return `${from}–${to} di ${totalItems}`
      })()
    : null

  /* ── Compact ── */
  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {showingInfo && <span style={{ fontSize: 10, color: 'var(--color-dim)', marginRight: 4 }}>{showingInfo}</span>}
        <CompanyBtn label="‹" disabled={currentCompany === 1} onClick={() => go(currentCompany - 1)} />
        <span style={{ fontSize: 11, color: 'var(--color-muted)', minWidth: 60, textAlign: 'center' }}>
          {currentCompany} / {totalCompanys}
        </span>
        <CompanyBtn label="›" disabled={currentCompany === totalCompanys} onClick={() => go(currentCompany + 1)} />
      </div>
    )
  }

  /* ── Full ── */
  const pages = buildCompanys(currentCompany, totalCompanys, siblingsCount)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {showingInfo && (
        <span style={{ fontSize: 10, color: 'var(--color-dim)', marginRight: 8 }}>{showingInfo}</span>
      )}

      {/* First */}
      <CompanyBtn label="«" disabled={currentCompany === 1} onClick={() => go(1)} />
      {/* Prev */}
      <CompanyBtn label="‹" disabled={currentCompany === 1} onClick={() => go(currentCompany - 1)} />

      {/* Numeri + ellipsis */}
      {pages.map((p, i) =>
        p === '...'
          ? <span key={`e${i}`} style={{ fontSize: 11, color: 'var(--color-dim)', padding: '0 2px', userSelect: 'none' }}>…</span>
          : <CompanyBtn key={p} label={p} active={p === currentCompany} onClick={() => go(p as number)} />
      )}

      {/* Next */}
      <CompanyBtn label="›" disabled={currentCompany === totalCompanys} onClick={() => go(currentCompany + 1)} />
      {/* Last */}
      <CompanyBtn label="»" disabled={currentCompany === totalCompanys} onClick={() => go(totalCompanys)} />
    </div>
  )
}
