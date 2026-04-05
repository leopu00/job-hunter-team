export default function PositionDetailLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <div className="h-3 w-16 rounded bg-[var(--color-border)] animate-pulse" />
        <div className="h-3 w-2 rounded bg-[var(--color-border)]" />
        <div className="h-3 w-16 rounded bg-[var(--color-border)] animate-pulse" />
        <div className="h-3 w-2 rounded bg-[var(--color-border)]" />
        <div className="h-3 w-20 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="h-7 w-72 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="flex gap-3">
              <div className="h-3.5 w-28 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-3.5 w-20 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-7 w-16 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="w-12 h-12 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="h-9 w-36 rounded-lg bg-[var(--color-border)] animate-pulse" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pro/Con */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="h-2.5 w-12 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="h-3 w-full rounded bg-[var(--color-border)] mb-2 last:mb-0 animate-pulse" />
                ))}
              </div>
            ))}
          </div>

          {/* Score breakdown */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
            <div className="h-3 w-32 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 mb-3 last:mb-0">
                <div className="w-28 h-2.5 rounded bg-[var(--color-border)] animate-pulse" />
                <div className="flex-1 h-1 rounded-full bg-[var(--color-border)] animate-pulse" />
                <div className="w-8 h-3 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>

          {/* JD */}
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
            <div className="h-3 w-32 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-2.5 rounded bg-[var(--color-border)] mb-2.5 animate-pulse" style={{ width: `${75 + Math.random() * 25}%` }} />
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="h-3 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between mb-2">
                <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
                <div className="h-2.5 w-24 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>
          <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="h-3 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex justify-between mb-2">
                <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
                <div className="h-2.5 w-20 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
