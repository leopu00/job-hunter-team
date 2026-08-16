// Chi ha toccato per ultimo una posizione, disegnato invece che scritto in
// emoji. Stesso stile delle icone di /swipe (Feather: viewBox 24, tratto 2,
// currentColor, round caps): niente emoji nella UI di prodotto — scelta
// dell'utente del 18/07, e la colonna "Aggiornato da" era rimasta indietro.
//
// Le emoji non erano solo una questione di stile: sono glifi di un font di
// sistema, quindi cambiano faccia e LARGHEZZA fra macOS, Windows e Linux, e
// in una tabella a colonne fisse ogni piattaforma incolonnava diversamente.
// Un <svg> di 12px è 12px ovunque.
//
// Monocromatiche di proposito: il nome dell'istanza («scout-2») sta scritto
// accanto e porta già l'identità. Colorarle aggiungerebbe cinque tinte a una
// riga che ne ha già una per lo stato e una per lo score.

const ACTOR_PATHS: Record<string, React.ReactElement> = {
  // Scout: lente — cerca annunci.
  scout: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  // Analista: beuta — esamina l'annuncio prima che valga un punteggio.
  analista: (
    <>
      <path d="M9.5 3h5" />
      <path d="M10.5 3v6.2l-5 8.7A2 2 0 0 0 7.2 21h9.6a2 2 0 0 0 1.7-3.1l-5-8.7V3" />
    </>
  ),
  // Scorer: bersaglio — assegna il punteggio.
  scorer: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Scrittore: penna — scrive il CV.
  scrittore: (
    <>
      <path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  // Critico: bilancia — giudica ciò che lo Scrittore ha prodotto.
  critico: (
    <>
      <path d="M12 5v15" />
      <path d="M7.5 20h9" />
      <path d="M4.5 9h15" />
      <path d="M4.5 9 2 14.5h5Z" />
      <path d="M19.5 9 17 14.5h5Z" />
    </>
  ),
  // Utente: la persona davanti allo schermo — «l'hai fatto tu».
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
};

// Un agente che non conosciamo (istanza nuova, ruolo aggiunto dopo): resta
// una faccia da macchina, che è la cosa vera da dire.
const FALLBACK = (
  <>
    <rect x="4.5" y="7" width="15" height="12" rx="2.5" />
    <path d="M12 3v4" />
    <path d="M9 12h.01" />
    <path d="M15 12h.01" />
    <path d="M9.5 16h5" />
  </>
);

/**
 * Icona del ruolo che ha compiuto l'ultima azione. Decorativa: accanto c'è
 * sempre il nome dell'attore, quindi `aria-hidden` e nessun testo alternativo
 * — un lettore di schermo direbbe due volte la stessa cosa.
 */
export default function ActorIcon({
  role,
  size = 12,
}: {
  role: string | null | undefined;
  size?: number;
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
      {ACTOR_PATHS[role ?? ""] ?? FALLBACK}
    </svg>
  );
}
