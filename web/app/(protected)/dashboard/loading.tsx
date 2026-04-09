export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-64 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-48 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="h-2.5 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-8 w-14 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Pipeline skeleton */}
      <div className="h-3 w-40 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-3 last:mb-0">
            <div className="w-16 h-2.5 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="w-10 h-3 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Recent section skeleton */}
      <div className="h-3 w-36 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 flex items-center gap-4">
            <div className="w-2 h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="flex-1">
              <div className="h-3.5 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
              <div className="h-2.5 w-32 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
            <div className="h-5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
