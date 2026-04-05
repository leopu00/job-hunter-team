export default function CrescitaLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento crescita" style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-56 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-72 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* KPI cards */}
      <div className="h-3 w-24 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="h-2.5 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-8 w-14 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Conversion cards */}
      <div className="h-3 w-40 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
            <div className="h-2.5 w-32 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-10 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-1.5 w-full rounded-full bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="h-2.5 w-40 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Pipeline bars */}
      <div className="h-3 w-48 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-3 last:mb-0">
            <div className="w-16 h-2.5 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="w-14 h-3 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
