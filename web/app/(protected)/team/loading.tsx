export default function TeamLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento team" style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-7 w-32 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-48 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Agent cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--color-border)] animate-pulse" />
              <div>
                <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-1.5 animate-pulse" />
                <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            </div>
            <div className="h-2.5 w-full rounded bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="h-2.5 w-3/4 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="h-7 w-20 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-7 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
