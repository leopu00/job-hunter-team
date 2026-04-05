export default function ReadyLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento candidature pronte" style={{ animation: 'fade-in 0.2s ease both' }}>
      {/* Header */}
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-44 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-64 rounded bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3.5 h-3.5 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
            <div className="h-6 w-10 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>

      {/* Pipeline progress */}
      <div className="mb-8 p-4 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg">
        <div className="flex justify-between mb-2">
          <div className="h-2.5 w-28 rounded bg-[var(--color-border)] animate-pulse" />
          <div className="h-2.5 w-16 rounded bg-[var(--color-border)] animate-pulse" />
        </div>
        <div className="h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
      </div>

      {/* Cards */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-2 h-2 rounded-full bg-[var(--color-border)] animate-pulse" />
        <div className="h-3 w-40 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-3 w-28 rounded bg-[var(--color-border)] animate-pulse" />
              </div>
              <div className="h-6 w-20 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
            <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-panel)] flex gap-2">
              <div className="h-7 w-16 rounded bg-[var(--color-border)] animate-pulse" />
              <div className="h-7 w-24 rounded bg-[var(--color-border)] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
