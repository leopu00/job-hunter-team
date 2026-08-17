// Glifi decorativi dei pannelli, disegnati invece che scritti in emoji.
// Stesso stile delle icone di /positions e di ActorIcon (Feather: viewBox 24,
// tratto 2, currentColor, round caps): niente emoji nella UI di prodotto —
// direttiva dell'utente del 18/07.
//
// Perché non bastava cancellarli e basta (#166): questi tre non sono prefissi
// ornamentali di un titolo che dice gia' la stessa cosa a parole. La clessidra
// sta accanto a un orario e non a una frase, la lavagnetta apre un pannello
// che senza di lei parte con un blocco di solo testo, e la faccina che dorme
// e' l'unica cosa che si vede quando non e' successo NIENTE — cioe' proprio il
// caso in cui la pagina deve dire qualcosa.
//
// Decorative: accanto c'e' sempre il testo che le nomina, quindi `aria-hidden`
// e nessun testo alternativo — un lettore di schermo direbbe due volte la
// stessa cosa.

function Glyph({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** Lavagnetta: l'elenco delle direttive in vigore. */
export function IconClipboard({ size = 14 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </Glyph>
  );
}

/** Orologio: la finestra oraria in cui la squadra ha il permesso di lavorare. */
export function IconClock({ size = 14 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </Glyph>
  );
}

/**
 * Freccia di apertura: la voce si puo' espandere. Non e' decorativa — e'
 * l'unica cosa che distingue una riga cliccabile da una che non lo e', e
 * ruota di 90 gradi quando la riga e' aperta. Chi la usa tiene la rotazione
 * sul contenitore, cosi' la transizione resta dov'era.
 */
export function IconChevronRight({ size = 9 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="m9 5 7 7-7 7" />
    </Glyph>
  );
}

/**
 * Luna: nessuna attivita' nel periodo scelto. Non e' un errore e non e' un
 * vuoto da riempire — la squadra puo' essere legittimamente ferma, e il testo
 * accanto lo spiega.
 */
export function IconAsleep({ size = 28 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </Glyph>
  );
}
