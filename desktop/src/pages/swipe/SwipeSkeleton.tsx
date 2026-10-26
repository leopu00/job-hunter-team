/** The deck's shape while the positions are read: the card to judge and the row of verdict buttons. */
export default function SwipeSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="swipe-skeleton"
      className="desktop-swipe-page flex flex-col gap-3 min-h-0"
      style={{ animation: "fade-in 0.2s ease both" }}
    >
      <div className="mx-auto w-full max-w-2xl flex-1 min-h-[12rem] rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="h-3 w-24 rounded bg-[var(--color-border)] mb-4 animate-pulse" />
        <div className="h-6 w-3/4 rounded bg-[var(--color-border)] mb-2 animate-pulse" />
        <div className="h-3.5 w-1/2 rounded bg-[var(--color-border)] mb-6 animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-2.5 rounded bg-[var(--color-border)] mb-2.5 animate-pulse" style={{ width: `${95 - i * 7}%` }} />
        ))}
      </div>
      <div className="mx-auto flex gap-3 pb-2" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 w-12 rounded-full bg-[var(--color-border)] animate-pulse" />
        ))}
      </div>
    </div>
  );
}
