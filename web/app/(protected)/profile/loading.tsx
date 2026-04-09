export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading profile" style={{ animation: 'fade-in 0.2s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <div className="h-7 w-48 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3 w-64 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
      <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-6">
        <div className="h-4 w-full rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-4 w-4/5 rounded bg-[var(--color-border)] animate-pulse" />
      </div>
    </div>
  )
}
