'use client'

const FEATURES = [
  {
    icon: '⚡',
    title: 'Team Multi-Agente',
    desc: '7 agenti AI specializzati — Scout, Analista, Scorer, Scrittore, Critico, Sentinella e Capitano — che collaborano come un vero team.',
    accent: 'var(--color-green)',
  },
  {
    icon: '◉',
    title: 'Scansione Continua',
    desc: 'Monitoring automatico di job board, LinkedIn e canali dedicati. Non perdere mai un\'opportunità rilevante.',
    accent: 'var(--color-blue)',
  },
  {
    icon: '✦',
    title: 'Candidature Smart',
    desc: 'CV e cover letter personalizzate per ogni posizione, ottimizzate per i sistemi ATS e per il recruiter.',
    accent: 'var(--color-purple)',
  },
  {
    icon: '△',
    title: 'Scoring Intelligente',
    desc: 'Ogni offerta viene analizzata e valutata in base al tuo profilo, competenze e preferenze. Focus su ciò che conta.',
    accent: 'var(--color-yellow)',
  },
  {
    icon: '◆',
    title: 'Dashboard Real-Time',
    desc: 'Metriche, analytics e stato di ogni candidatura. Tutto in una vista: token, costi, latenza, pipeline completa.',
    accent: 'var(--color-orange)',
  },
  {
    icon: '⬡',
    title: 'Tu al Comando',
    desc: 'Gli agenti propongono, tu decidi. Ogni candidatura richiede la tua approvazione prima dell\'invio.',
    accent: 'var(--color-green)',
  },
]

export default function LandingFeatures() {
  return (
    <section id="features" className="px-6 py-24 relative">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-3 block">
            capabilities
          </span>
          <h2 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight">
            Tutto ciò che serve,<br />niente di superfluo
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="landing-feature-card group rounded-lg p-6 border border-[var(--color-border)] transition-all duration-300"
              style={{ background: 'var(--color-panel)', animationDelay: `${i * 0.08}s` }}
            >
              <div
                className="w-8 h-8 rounded flex items-center justify-center text-[16px] mb-4"
                style={{ background: `${f.accent}15`, border: `1px solid ${f.accent}30` }}
              >
                {f.icon}
              </div>
              <h3 className="text-[13px] font-bold text-[var(--color-white)] mb-2 tracking-wide">
                {f.title}
              </h3>
              <p className="text-[11px] text-[var(--color-muted)] leading-relaxed">
                {f.desc}
              </p>
              {/* Glow border on hover */}
              <div
                className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ boxShadow: `inset 0 0 0 1px ${f.accent}40, 0 0 15px ${f.accent}08` }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
