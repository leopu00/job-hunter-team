export default function SetupLoading() {
  return (
    <main aria-busy="true" aria-label="Caricamento setup" className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg" style={{ animation: 'fade-in 0.2s ease both' }}>
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-[var(--color-green)] animate-pulse" />
            <div className="h-2 w-10 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
          <div className="h-7 w-36 rounded bg-[var(--color-border)] mx-auto mb-1 animate-pulse" />
          <div className="h-7 w-16 rounded bg-[var(--color-border)] mx-auto animate-pulse" />
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-8">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div
                className="h-1.5 rounded-full flex-1 animate-pulse"
                style={{
                  background: i === 0 ? 'var(--color-green)' : 'var(--color-border)',
                  opacity: i === 0 ? 0.6 : 0.4,
                }}
              />
            </div>
          ))}
        </div>

        {/* Card skeleton */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6">
          <div className="h-4 w-28 rounded bg-[var(--color-border)] mb-5 animate-pulse" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded bg-[var(--color-border)] animate-pulse flex-shrink-0" />
                <div className="h-3 rounded bg-[var(--color-border)] animate-pulse" style={{ width: `${60 + i * 15}%` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Buttons skeleton */}
        <div className="flex justify-between mt-6">
          <div className="h-9 w-24 rounded bg-[var(--color-border)] animate-pulse opacity-30" />
          <div className="h-9 w-24 rounded bg-[var(--color-border)] animate-pulse" />
        </div>
      </div>
    </main>
  )
}
