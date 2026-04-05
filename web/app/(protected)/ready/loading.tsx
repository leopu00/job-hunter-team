export default function ReadyLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-40 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-56 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-panel)]">
            <div className="h-4 w-36 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-3 w-28 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="h-3 w-20 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
            <div className="h-8 w-full rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
