'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="it">
      <body style={{ margin: 0, background: '#060608', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div role="alert" style={{ textAlign: 'center', maxWidth: 420, padding: '0 20px' }}>
          <p aria-hidden="true" style={{ fontSize: 80, fontWeight: 800, lineHeight: 1, color: '#1a1a1f', margin: 0, letterSpacing: '-0.04em' }}>
            ERR
          </p>
          <div style={{ marginTop: -12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#f44336', display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' as const, color: '#f44336' }}>errore critico</span>
          </div>

          <h1 style={{ fontSize: 18, fontWeight: 700, color: '#e0e0f0', marginTop: 24, marginBottom: 8 }}>
            Qualcosa è andato storto
          </h1>
          <p style={{ fontSize: 12, color: '#888', lineHeight: 1.6, marginBottom: 24 }}>
            {error.message || 'Errore imprevisto nel caricamento dell\'applicazione.'}
          </p>

          {error.digest && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 8, background: '#0c0c10', border: '1px solid #1a1a1f', marginBottom: 24 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#555' }}>digest</span>
              <code style={{ fontSize: 10, fontFamily: 'monospace', color: '#888' }}>{error.digest}</code>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <button
              onClick={reset}
              style={{ padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: '#00e87a', color: '#000', border: 'none', cursor: 'pointer' }}
            >
              Riprova
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              style={{ padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'transparent', color: '#888', border: '1px solid #1a1a1f', cursor: 'pointer' }}
            >
              Torna alla home
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
