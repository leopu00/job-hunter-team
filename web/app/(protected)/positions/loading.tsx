export default function PositionsLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-60 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Filters skeleton */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 rounded-lg bg-[var(--color-border)] animate-pulse" style={{ width: 60 + i * 10 }} />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="bg-[var(--color-panel)] border-b border-[var(--color-border)] px-4 py-3 flex gap-4">
          {['w-32', 'w-24', 'w-20', 'w-16', 'w-12'].map((w, i) => (
            <div key={i} className={`h-2.5 ${w} rounded bg-[var(--color-border)] animate-pulse`} />
          ))}
        </div>
        {/* Data rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex items-center gap-4 border-b border-[var(--color-border)] last:border-0">
            <div className="h-3.5 w-44 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-24 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-3 w-20 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-5 w-10 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
