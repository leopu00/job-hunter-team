export default function ScorerLoading() {
  return (
    <div aria-busy="true" aria-label="Caricamento scorer" style={{ animation: 'fade-in 0.2s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-24 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-7 w-28 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-52 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4">
            <div className="h-2.5 w-20 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
            <div className="h-8 w-14 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        ))}
      </div>
      <div className="h-3 w-36 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="h-4 w-28 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="h-5 w-10 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="text-center">
                <div className="h-2 w-14 mx-auto rounded bg-[var(--color-border)] mb-2 animate-pulse" />
                <div className="h-7 w-10 mx-auto rounded bg-[var(--color-border)] animate-pulse" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-14 h-2.5 rounded bg-[var(--color-border)] animate-pulse" />
            <div className="flex-1 h-1.5 rounded-full bg-[var(--color-border)] animate-pulse" />
            <div className="w-10 h-3 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}
