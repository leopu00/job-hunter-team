export default function Loading() {
  return (
    <main role="status" aria-busy="true" aria-label="Caricamento" className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full animate-bounce"
              style={{
                background: 'var(--color-green)',
                animationDelay: `${i * 0.15}s`,
                animationDuration: '0.9s',
              }}
            />
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--color-dim)' }}>
          caricamento…
        </p>
      </div>
    </main>
  )
}
