export default function ApplicationsLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento candidature" style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-44 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-52 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Filter tabs skeleton */}
      <div className="flex items-center gap-2 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-lg bg-[var(--color-border)] animate-pulse" />
        ))}
      </div>

      {/* Application cards skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <div className="h-4 w-52 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-3 w-28 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
              <div className="h-6 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
            <div className="flex gap-2 pt-3 border-t border-[var(--color-border)]">
              <div className="h-7 w-16 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-7 w-24 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
