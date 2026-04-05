export default function ProfileLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-1">
        <div className="h-3 w-16 rounded bg-[var(--color-border)] animate-pulse" />
        <div className="h-3 w-2 rounded bg-[var(--color-border)]" />
        <div className="h-3 w-12 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Header skeleton */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)] mt-3">
        <div className="h-7 w-52 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-36 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Stats bar skeleton */}
      <div className="flex flex-col sm:flex-row gap-6 items-start mb-8">
        <div className="w-20 h-20 rounded-full bg-[var(--color-border)] animate-pulse flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="h-5 w-40 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
          <div className="h-3 w-56 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
                <div className="h-2 w-20 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-7 w-12 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Profile sections skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
            <div className="h-3 w-28 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
                <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
                <div className="h-3 w-28 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
