'use client'

import Link from 'next/link'

// Piramide del team — pagina iniziale: solo l'apice (User) popolato, gli
// altri livelli sono placeholder vuoti in attesa che l'utente definisca
// la struttura.
const LEVELS: { name: string; desc: string; count: number; nodes: ({ emoji: string; label: string } | null)[] }[] = [
  { name: 'Principal',  desc: 'Owns goals and decides',          count: 1, nodes: [{ emoji: '👤', label: 'User' }] },
  { name: 'Leadership', desc: 'Commands and guides the team',    count: 2, nodes: [
    { emoji: '\u{1F468}‍✈️', label: 'Captain' },
    { emoji: '🧙‍♂️', label: 'Maestro' },
  ] },
  { name: 'Oversight',  desc: 'Monitors, supports, audits',      count: 4, nodes: [
    { emoji: '👨‍💼', label: 'Assistant' },
    { emoji: '💂', label: 'Sentinel' },
    { emoji: '\u{1F468}‍⚕️', label: 'Doctor' },
    { emoji: '\u{1F468}‍⚖️', label: 'Critic' },
  ] },
  { name: 'Execution',  desc: 'Field operators on the pipeline', count: 6, nodes: [
    { emoji: '🕵️', label: 'Scout 1' },
    { emoji: '\u{1F468}‍🔬', label: 'Analyst 1' },
    { emoji: '\u{1F468}‍🔬', label: 'Analyst 2' },
    { emoji: '\u{1F468}‍💻', label: 'Scorer 1' },
    { emoji: '\u{1F468}‍🏫', label: 'Writer 1' },
    { emoji: '\u{1F468}‍🏫', label: 'Writer 2' },
  ] },
]

const SLOT_SIZE = 64
const SLOT_GAP = 36
const LEVEL_GAP = 72
// Padding ASIMMETRICO: orizzontale > verticale. Il triangolo ha apice in
// alto e base in basso; perché un livello stretto in alto e uno largo in
// basso entrambi stiano dentro l'ipotenusa, la base del triangolo deve
// essere abbastanza larga (PAD_X grande) e l'apice abbastanza basso
// rispetto al primo livello (PAD_Y_TOP non troppo piccolo) altrimenti la
// larghezza utile a metà altezza non basta a contenere il livello più
// ampio. Valori tarati per livelli 1/2/4/6 con SLOT/GAP correnti.
const PAD_X = 90
const PAD_Y_TOP = 60
const PAD_Y_BOTTOM = 32
// Spazio laterale per le etichette dei livelli (Principal/Leadership/...
// a sinistra, L1..L4 a destra), fuori dal triangolo.
const LABEL_GUTTER = 120

export default function TeamPyramidPage() {
  const maxRow = LEVELS[LEVELS.length - 1]
  const innerWidth = maxRow.count * SLOT_SIZE + (maxRow.count - 1) * SLOT_GAP
  const innerHeight = LEVELS.length * SLOT_SIZE + (LEVELS.length - 1) * LEVEL_GAP
  const outerWidth = innerWidth + PAD_X * 2
  const outerHeight = innerHeight + PAD_Y_TOP + PAD_Y_BOTTOM

  return (
    <div style={{ animation: 'fade-in 0.35s ease both' }}>
      <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 mb-1">
          <Link href="/dashboard" className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors">Dashboard</Link>
          <span className="text-[var(--color-border)]" aria-hidden="true">/</span>
          <span className="text-[10px] text-[var(--color-muted)]" aria-current="page">Team Pyramid</span>
        </nav>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">Team Pyramid</h1>
          </div>
          <Link
            href="/team"
            className="px-2.5 py-1.5 rounded-md text-[10px] tracking-wide no-underline transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--color-muted)',
              border: '1px dashed var(--color-border)',
              fontFamily: 'inherit',
            }}
            title="Torna alla pagina Team"
          >
            ← team
          </Link>
        </div>
      </div>

      <section className="py-12">
        <div
          className="relative mx-auto"
          style={{ width: outerWidth + LABEL_GUTTER * 2, height: outerHeight }}
        >
          {/* Etichette dei livelli su entrambi i lati: nome a sinistra,
              tag L1..L4 a destra, fuori dal triangolo, centrate
              verticalmente sul centro di ogni livello. */}
          {LEVELS.map((level, i) => {
            const yCenter = PAD_Y_TOP + (i + 0.5) * SLOT_SIZE + i * LEVEL_GAP
            return (
              <div
                key={`label-${i}`}
                className="pointer-events-none absolute"
                style={{ left: 0, top: yCenter - 8, width: outerWidth + LABEL_GUTTER * 2, height: 16 }}
                aria-hidden="true"
              >
                <span
                  className="absolute text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
                  style={{ left: 0, width: LABEL_GUTTER - 12, textAlign: 'right' }}
                >
                  {level.name}
                </span>
                <span
                  className="absolute text-[10px] uppercase tracking-[0.18em] text-[var(--color-dim)]"
                  style={{ right: 0, width: LABEL_GUTTER - 12, textAlign: 'left' }}
                >
                  L{i + 1}
                </span>
              </div>
            )
          })}

          {/* Wrapper della piramide vera e propria, centrato tra i due
              "gutter" laterali per le etichette. */}
          <div
            className="absolute"
            style={{ left: LABEL_GUTTER, top: 0, width: outerWidth, height: outerHeight }}
          >
          {/* Perimetro triangolare: apice in alto al centro (sopra User),
              base che abbraccia il livello più largo. Stesso stile delle
              frecce nel TeamOrgChart per coerenza visiva. */}
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute"
            viewBox={`-2 -2 ${outerWidth + 4} ${outerHeight + 4}`}
            width={outerWidth + 4}
            height={outerHeight + 4}
            style={{ left: -2, top: -2 }}
          >
            {/* Lati e base disegnati come <line> separate (anziché un
                unico polygon) per dare a ognuna un proprio dasharray
                fresco: con il polygon il pattern continua lungo l'intero
                perimetro e cade fuori fase sulla base, che risulta più
                rada e meno visibile dei lati. */}
            <line x1={outerWidth / 2} y1={0} x2={0} y2={outerHeight}
              stroke="rgba(255,255,255,0.28)" strokeWidth="1.5"
              strokeDasharray="4 8" strokeLinecap="butt" />
            <line x1={outerWidth / 2} y1={0} x2={outerWidth} y2={outerHeight}
              stroke="rgba(255,255,255,0.28)" strokeWidth="1.5"
              strokeDasharray="4 8" strokeLinecap="butt" />
            <line x1={0} y1={outerHeight} x2={outerWidth} y2={outerHeight}
              stroke="rgba(255,255,255,0.28)" strokeWidth="1.5"
              strokeDasharray="4 8" strokeLinecap="butt" />
            {/* Linee tratteggiate orizzontali che separano i livelli della
                piramide: ne disegniamo (LEVELS.length - 1), una a metà del
                gap tra ogni coppia di livelli, ferma al lato del triangolo
                a quella altezza. */}
            {LEVELS.slice(0, -1).map((_, i) => {
              const y = PAD_Y_TOP + (i + 1) * SLOT_SIZE + (i + 0.5) * LEVEL_GAP
              const progress = y / outerHeight
              // Insetto la linea di qualche px verso l'interno per non
              // sovrapporsi al perimetro del triangolo (che ha il suo
              // strokeWidth + linejoin) e per evitare che il linecap della
              // linea sbordi anche solo di un pixel oltre l'ipotenusa.
              const inset = 6
              const xLeft = (outerWidth / 2) * (1 - progress) + inset
              const xRight = (outerWidth / 2) * (1 + progress) - inset
              return (
                <line
                  key={i}
                  x1={xLeft}
                  y1={y}
                  x2={xRight}
                  y2={y}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="1.25"
                  strokeDasharray="4 8"
                  strokeLinecap="butt"
                />
              )
            })}
          </svg>

          <div
            className="absolute flex flex-col items-center"
            style={{
              top: PAD_Y_TOP,
              left: PAD_X,
              width: innerWidth,
              gap: LEVEL_GAP,
            }}
          >
            {LEVELS.map((level, levelIdx) => (
              <div
                key={levelIdx}
                className="flex justify-center"
                style={{ gap: SLOT_GAP }}
                aria-label={`Pyramid level ${levelIdx + 1}`}
              >
                {level.nodes.map((node, nodeIdx) => (
                  <div
                    key={nodeIdx}
                    className="flex flex-col items-center justify-center"
                    style={{
                      width: SLOT_SIZE,
                      height: SLOT_SIZE,
                      border: node ? '1px solid var(--color-border)' : '1px dashed var(--color-border)',
                      borderRadius: 8,
                      background: node ? 'rgba(255,255,255,0.04)' : 'transparent',
                    }}
                  >
                    {node ? (
                      <>
                        <span className="text-2xl leading-none" aria-hidden="true">{node.emoji}</span>
                        <span className="mt-1 text-[10px] font-semibold tracking-wide text-[var(--color-bright)]">{node.label}</span>
                      </>
                    ) : (
                      <span className="text-[var(--color-dim)] text-[18px] leading-none" aria-hidden="true">·</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          </div>
        </div>

        {/* Paragrafo discorsivo full-width sotto la piramide. La base del
            triangolo (linea tratteggiata) fa da divisore tra il diagramma
            e il testo. */}
        <div className="mt-10 w-full">
          <p className="text-center text-[12px] leading-relaxed text-[var(--color-muted)]">
            L1 is the principal — the user, who owns the goals and makes
            the calls. L2 is leadership: Captain runs the day-to-day, Maestro
            tracks the longer career arc. L3 is oversight: Assistant talks
            to the user, Sentinel watches rate-limits, Doctor unblocks
            stuck agents, Critic reviews the output. L4 is execution:
            Scouts find openings, Analysts read them, Scorer ranks them,
            Writers craft the materials.
          </p>
        </div>
      </section>
    </div>
  )
}
