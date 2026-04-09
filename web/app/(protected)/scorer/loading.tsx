export default function AgentLoading() {
  return (
    <div aria-busy="true" aria-label="Loading scorer" style={{ animation: 'fade-in 0.2s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-4 w-32 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="mt-4 flex items-start gap-5">
          <div className="w-12 h-12 rounded-lg bg-[var(--color-border)] animate-pulse" />
          <div>
            <div className="h-7 w-36 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
            <div className="h-3 w-56 rounded bg-[var(--color-border)] animate-pulse" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 mb-8">
        <div className="h-10 w-28 rounded-lg bg-[var(--color-border)] animate-pulse" />
        <div className="h-10 w-36 rounded-lg bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-xl p-4" style={{ height: '40vh' }}>
        <div className="h-2.5 w-full rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-2.5 w-3/4 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-2.5 w-5/6 rounded bg-[var(--color-border)] mb-3 animate-pulse" />
        <div className="h-2.5 w-2/3 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  )
}
