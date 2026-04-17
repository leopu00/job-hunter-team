import Link from 'next/link'

interface CloudDownloadLandingProps {
  userEmail: string | null
}

export default function CloudDownloadLanding({ userEmail }: CloudDownloadLandingProps) {
  return (
    <div className="min-h-[calc(100vh-14rem)] flex items-center justify-center px-5" style={{ animation: 'fade-in 0.4s ease both' }}>
      <div className="max-w-xl w-full text-center">

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
          style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--color-green)]">
            account collegato
          </span>
          {userEmail && (
            <span className="text-[10px] text-[var(--color-dim)] truncate max-w-[220px]">· {userEmail}</span>
          )}
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--color-white)] mb-4 leading-[1.1]">
          Scarica l&apos;app per iniziare
        </h1>

        <p className="text-[13px] text-[var(--color-bright)] leading-relaxed mb-2 max-w-md mx-auto">
          Questo sito è la <span className="text-[var(--color-green)] font-medium">vetrina</span> dei risultati del tuo team AI.
          Per configurare il profilo e far lavorare gli agenti serve l&apos;app desktop che gira sul tuo computer.
        </p>
        <p className="text-[11px] text-[var(--color-muted)] leading-relaxed mb-8 max-w-md mx-auto">
          Una volta installata, l&apos;app sincronizza qui le posizioni trovate, i CV scritti e le candidature così puoi consultarle da qualsiasi device — telefono, PC del lavoro, tablet.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <Link
            href="/download"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-[12px] font-bold tracking-wide no-underline transition-all hover:opacity-90"
            style={{ background: 'var(--color-green)', color: '#000' }}
          >
            Scarica Job Hunter Team
          </Link>
          <Link
            href="/project"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-[12px] font-bold tracking-wide no-underline transition-colors"
            style={{ background: 'var(--color-card)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
          >
            Come funziona
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
          <Step n="1" title="Scarica l'app" body="macOS, Windows o Linux. Un singolo installer che prepara tutto." />
          <Step n="2" title="Configura il profilo" body="L'assistente AI locale estrae i dati dal tuo CV e compila il profilo." />
          <Step n="3" title="Torna qui" body="I risultati del team compaiono automaticamente in questa dashboard." />
        </div>

        <p className="text-[9px] text-[var(--color-dim)] mt-10 leading-relaxed">
          Nessun token è a nostro carico: l&apos;assistente usa l&apos;abbonamento del provider AI
          (Claude Code, Codex, Kimi) che hai già.
        </p>
      </div>
    </div>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="p-4 rounded-lg" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="text-[9px] font-bold tracking-widest text-[var(--color-green)] mb-2">STEP {n}</div>
      <div className="text-[11px] font-semibold text-[var(--color-bright)] mb-1">{title}</div>
      <div className="text-[10px] text-[var(--color-dim)] leading-relaxed">{body}</div>
    </div>
  )
}
