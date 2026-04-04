'use client'

import Link from 'next/link'

const TERMINAL_LINES = [
  { prefix: '>', text: ' jht scan --role "Frontend Developer" --location "Remote"', color: 'var(--color-white)' },
  { prefix: '[scout]', text: ' Scanning 12 job boards...', color: 'var(--color-blue)' },
  { prefix: '[scout]', text: ' Found 47 matching positions', color: 'var(--color-blue)' },
  { prefix: '[analista]', text: ' Analyzing requirements & culture fit...', color: 'var(--color-purple)' },
  { prefix: '[scorer]', text: ' Match scores computed — top: 94%', color: 'var(--color-yellow)' },
  { prefix: '[scrittore]', text: ' Generating tailored cover letter...', color: 'var(--color-orange)' },
  { prefix: '[critico]', text: ' Quality check passed ✓', color: 'var(--color-green)' },
  { prefix: '[capitano]', text: ' 3 applications ready for review', color: 'var(--color-green)' },
]

export default function LandingHero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 relative overflow-hidden">
      <div className="relative z-10 text-center max-w-3xl mx-auto" style={{ animation: 'fade-in 0.6s ease both' }}>
        <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full border border-[var(--color-border)]" style={{ background: 'var(--color-deep)' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-green)]" style={{ animation: 'pulse-dot 2s ease-in-out infinite' }} />
          <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[var(--color-green)]">beta pubblica</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-[var(--color-white)] leading-[1.1] mb-6">
          Il tuo team di agenti AI
          <br />
          <span className="text-gradient" style={{ color: 'var(--color-green)' }}>per trovare lavoro</span>
        </h1>

        <p className="text-[13px] md:text-[15px] text-[var(--color-muted)] leading-relaxed max-w-xl mx-auto mb-10">
          Un sistema multi-agente che automatizza ogni fase della ricerca:
          dalla scansione delle offerte alla candidatura personalizzata.
          Tu decidi la strategia, gli agenti eseguono.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/?login=true"
            className="px-6 py-3 rounded text-[12px] font-bold tracking-wider no-underline transition-all"
            style={{ background: 'var(--color-green)', color: '#060608', boxShadow: '0 0 20px rgba(0,232,122,0.25)' }}
          >
            Inizia gratis
          </Link>
          <a
            href="#features"
            className="px-6 py-3 rounded text-[12px] font-semibold tracking-wider no-underline transition-all border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-muted)] hover:text-[var(--color-bright)]"
          >
            Scopri come funziona
          </a>
        </div>
      </div>

      {/* Terminal mockup */}
      <div
        className="glass-panel relative z-10 w-full max-w-2xl mt-16 rounded-xl overflow-hidden"
        style={{ animation: 'fade-in 0.8s ease 0.3s both, float 8s ease-in-out infinite', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-red)', opacity: 0.7 }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-yellow)', opacity: 0.7 }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-green)', opacity: 0.7 }} />
          <span className="ml-2 text-[10px] text-[var(--color-dim)]">jht — terminal</span>
        </div>

        {/* Terminal body */}
        <div className="px-4 py-4 font-mono text-[11px] md:text-[12px] leading-relaxed">
          {TERMINAL_LINES.map((line, i) => (
            <div key={i} className="landing-term-line" style={{ animationDelay: `${0.8 + i * 0.35}s` }}>
              <span style={{ color: line.color, opacity: 0.7 }}>{line.prefix}</span>
              <span style={{ color: 'var(--color-base)' }}>{line.text}</span>
            </div>
          ))}
          <span className="landing-cursor" style={{ animationDelay: '3.8s' }}>_</span>
        </div>
      </div>
    </section>
  )
}
