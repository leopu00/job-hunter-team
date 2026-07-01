// Ancoraggio dello scroll tra pagine di beta tester: cambiando tester dalla
// sidebar (o dallo switcher mobile) si resta sulla STESSA sezione — così, se
// guardavi "Che tipo di ruoli" su un tester, ti ritrovi sul grafico equivalente
// dell'altro, anche se le pagine hanno altezze diverse.
//
// Meccanica: al clic ricordiamo la sezione in cima al viewport (data-cs-anchor);
// al montaggio della nuova pagina la riportiamo in vista con scrollIntoView (che
// rispetta lo scroll-margin-top delle ancore, così non finisce sotto la nav
// fissa). Lo stato vive a livello di modulo: sopravvive alla navigazione soft di
// Next (stessa scheda) e si azzera al reload completo (ingresso pulito in cima).

// Ordine VISIVO delle sezioni (la panoramica le riordina con `order-N`). Serve al
// fallback quando la sezione manca sul tester di destinazione (es. la mappa
// "Dove" è assente se non ci sono ancora città geocodificate).
export const CS_SECTIONS = [
  "profile",
  "where",
  "match",
  "roles",
  "budget",
  "sources",
  "funnel",
] as const;

const NAV_OFFSET = 72; // nav fissa (56px) + respiro; combacia con scroll-mt-[72px]

let pending: string | null = null;

function absTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY;
}

/** Ricorda la sezione attualmente in cima al viewport (da chiamare al clic sul
 *  link di un altro tester, PRIMA della navigazione). */
export function rememberCurrentSection(): void {
  if (typeof window === "undefined") return;
  const els = Array.from(document.querySelectorAll("[data-cs-anchor]"));
  if (els.length === 0) {
    pending = null;
    return;
  }
  const ref = window.scrollY + NAV_OFFSET + 4;
  // l'ultima sezione (in ordine visivo) il cui bordo alto è già sopra la linea
  // di riferimento = quella che occupa la cima del viewport.
  let key = els[0].getAttribute("data-cs-anchor");
  let bestTop = -Infinity;
  for (const el of els) {
    const top = absTop(el);
    if (top <= ref && top >= bestTop) {
      bestTop = top;
      key = el.getAttribute("data-cs-anchor");
    }
  }
  pending = key;
}

function nearestPresent(key: string): Element | null {
  const idx = (CS_SECTIONS as readonly string[]).indexOf(key);
  if (idx < 0) return null;
  for (let d = 1; d < CS_SECTIONS.length; d++) {
    for (const j of [idx + d, idx - d]) {
      // prima la successiva, poi la precedente
      if (j >= 0 && j < CS_SECTIONS.length) {
        const el = document.querySelector(`[data-cs-anchor="${CS_SECTIONS[j]}"]`);
        if (el) return el;
      }
    }
  }
  return null;
}

/** Riporta il viewport alla sezione ricordata sul nuovo tester (da chiamare al
 *  montaggio / cambio di tester). No-op se non c'è nulla da ripristinare. */
export function restoreSection(): void {
  if (typeof window === "undefined") return;
  const key = pending;
  pending = null;
  if (!key) return;
  const go = () => {
    const el =
      document.querySelector(`[data-cs-anchor="${key}"]`) ?? nearestPresent(key);
    if (el) (el as HTMLElement).scrollIntoView({ block: "start" });
  };
  // subito + due ritocchi: i grafici possono assestare l'altezza dopo il mount.
  go();
  requestAnimationFrame(go);
  window.setTimeout(go, 160);
}
