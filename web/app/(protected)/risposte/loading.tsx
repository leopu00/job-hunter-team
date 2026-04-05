export default function RisposteLoading() {
  return (
    <div style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
          <div className="h-2.5 w-32 rounded bg-[var(--color-border)] animate-pulse" />
        </div>
        <div className="h-7 w-36 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-56 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Response cards */}
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1">
                <div className="h-4 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-3 w-36 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] p-4 mb-3 bg-[var(--color-panel)]">
              <div className="h-2.5 w-28 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
              <div className="h-3 w-full rounded bg-[var(--color-border)] mb-2 animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
            <div className="flex gap-2 pt-3 border-t border-[var(--color-border)]">
              <div className="h-7 w-14 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-7 w-24 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
