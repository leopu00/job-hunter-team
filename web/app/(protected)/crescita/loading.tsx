export default function CrescitaLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-36 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-60 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Stat cards skeleton */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-panel)]">
            <div className="h-3 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-6 w-14 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="border border-[var(--color-border)] rounded-lg p-6 bg-[var(--color-panel)]">
        <div className="h-4 w-32 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-48 w-full rounded bg-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  )
}
