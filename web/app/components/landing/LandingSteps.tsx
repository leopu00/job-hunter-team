'use client'

const STEPS = [
  {
    n: '01',
    title: 'Configura',
    desc: 'Imposta il tuo profilo, le competenze, il ruolo desiderato e i criteri di ricerca. Gli agenti si calibrano su di te.',
    code: 'jht profile set --role "Senior Dev" --stack "React, Node"',
  },
  {
    n: '02',
    title: 'Gli agenti lavorano',
    desc: 'Il team scansiona offerte, analizza requisiti, calcola match score e prepara candidature personalizzate.',
    code: '[scout] 47 found → [analista] 12 relevant → [scorer] 5 top matches',
  },
  {
    n: '03',
    title: 'Tu decidi',
    desc: 'Revisiona le candidature pronte nella dashboard. Approva, modifica o scarta. Sempre tu al comando.',
    code: '[capitano] 3 applications ready — awaiting your review ✓',
  },
]

export default function LandingSteps() {
  return (
    <section id="how" className="px-6 py-24 relative">
      {/* Divider line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-24" style={{ background: 'linear-gradient(180deg, transparent, var(--color-border))' }} />

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <span className="text-[10px] font-semibold tracking-[0.25em] uppercase text-[var(--color-green)] mb-3 block">
            workflow
          </span>
          <h2 className="text-2xl md:text-4xl font-bold text-[var(--color-white)] tracking-tight">
            Come funziona
          </h2>
        </div>

        <div className="flex flex-col gap-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-6 items-start">
              {/* Step number */}
              <div className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center border border-[var(--color-border)]"
                style={{ background: 'var(--color-panel)', color: 'var(--color-green)', fontSize: 14, fontWeight: 700 }}>
                {s.n}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3 className="text-[14px] font-bold text-[var(--color-white)] mb-2">{s.title}</h3>
                <p className="text-[12px] text-[var(--color-muted)] leading-relaxed mb-3">{s.desc}</p>

                {/* Code snippet */}
                <div className="rounded px-3 py-2 border border-[var(--color-border)] overflow-x-auto"
                  style={{ background: 'var(--color-void)' }}>
                  <code className="text-[10px] md:text-[11px] text-[var(--color-base)] whitespace-nowrap">{s.code}</code>
                </div>

                {/* Connector */}
                {i < STEPS.length - 1 && (
                  <div className="ml-6 mt-4 w-px h-6" style={{ background: 'var(--color-border)' }} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
