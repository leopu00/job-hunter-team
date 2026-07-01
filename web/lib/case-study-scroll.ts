// Ancoraggio dello scroll tra pagine di beta tester: cambiando tester dalla
// sidebar (o dallo switcher mobile) si resta sulla STESSA sezione — così, se
// guardavi "Che tipo di ruoli", ti ritrovi sul grafico equivalente dell'altro
// tester, anche se le pagine hanno altezze diverse.
//
// Meccanica: al clic ricordiamo QUALE sezione è in cima al viewport (per NOME,
// via data-cs-anchor); sul nuovo tester la riportiamo in cima con scrollIntoView.
//
// Dettagli che contano (imparati a caro prezzo):
//  - globals.css imposta `html { scroll-behavior: smooth; scroll-padding-top:72px }`.
//    Lo smooth farebbe ANIMARE lo scroll (misure a metà volo, loop che spiralano):
//    forziamo `behavior:"instant"`. Lo `scroll-padding-top:72px` è invece utile —
//    scrollIntoView lo rispetta e lascia 72px sotto la nav fissa da solo, quindi
//    NON serve (né va messo) alcun scroll-margin sulle ancore: si sommerebbe.
//  - la rilevazione della sezione "in cima" usa lo STESSO 72px → simmetrica al
//    ripristino.
//  - ri-applichiamo per qualche frame (i font/asset possono causare un piccolo
//    reflow) tenendo la sezione inchiodata; ci si ferma se l'utente scrolla.
//
// Lo stato vive a livello di modulo: sopravvive alla navigazione soft di Next
// (stessa scheda) e si azzera al reload completo (ingresso pulito in cima).

// Ordine VISIVO delle sezioni (la panoramica le riordina con `order-N`). Serve
// SOLO al fallback quando la sezione manca sul tester di destinazione (es. la
// mappa "Dove" è assente se non ci sono ancora città geocodificate).
export const CS_SECTIONS = [
  "profile",
  "where",
  "match",
  "roles",
  "budget",
  "sources",
  "funnel",
] as const;

// Deve combaciare con `scroll-padding-top` in globals.css (nav fissa + respiro).
const OFFSET = 72;

let pending: string | null = null;

function absTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY;
}

/** Ricorda la sezione attualmente in cima al viewport. Da chiamare al clic sul
 *  link di un altro tester, PRIMA della navigazione. */
export function rememberCurrentSection(): void {
  if (typeof window === "undefined") return;
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-cs-anchor]"));
  if (els.length === 0) {
    pending = null;
    return;
  }
  // Linea di riferimento = dove scrollIntoView allineerà il bordo alto (72px).
  // La sezione "in cima" è l'ultima (per posizione visiva) il cui bordo alto è
  // già sopra/alla linea (piccola tolleranza sub-pixel).
  const line = window.scrollY + OFFSET;
  let key = els[0].getAttribute("data-cs-anchor");
  let best = -Infinity;
  for (const el of els) {
    const top = absTop(el);
    if (top <= line + 8 && top >= best) {
      best = top;
      key = el.getAttribute("data-cs-anchor");
    }
  }
  pending = key;
}

function findAnchor(key: string): HTMLElement | null {
  const exact = document.querySelector<HTMLElement>(`[data-cs-anchor="${key}"]`);
  if (exact) return exact;
  // Fallback: la sezione manca sul tester di destinazione → la più vicina per
  // ordine visivo (prima la successiva, poi la precedente).
  const idx = (CS_SECTIONS as readonly string[]).indexOf(key);
  if (idx < 0) return null;
  for (let d = 1; d < CS_SECTIONS.length; d++) {
    for (const j of [idx + d, idx - d]) {
      if (j >= 0 && j < CS_SECTIONS.length) {
        const el = document.querySelector<HTMLElement>(
          `[data-cs-anchor="${CS_SECTIONS[j]}"]`,
        );
        if (el) return el;
      }
    }
  }
  return null;
}

/** Riporta il viewport alla sezione ricordata sul nuovo tester. Da chiamare al
 *  montaggio / cambio di tester. No-op se non c'è nulla in sospeso. */
export function restoreSection(): void {
  if (typeof window === "undefined") return;
  const key = pending;
  pending = null;
  if (!key) return;

  let aborted = false;
  const abort = () => {
    aborted = true;
  };
  // se l'utente scrolla di suo, smettiamo subito di riancorare
  window.addEventListener("wheel", abort, { passive: true, once: true });
  window.addEventListener("touchmove", abort, { passive: true, once: true });
  const cleanup = () => {
    window.removeEventListener("wheel", abort);
    window.removeEventListener("touchmove", abort);
  };

  let stableFrames = 0;
  let frames = 0;
  const tick = () => {
    if (aborted) return cleanup();
    const el = findAnchor(key);
    if (el) {
      // instant → niente animazione smooth; scroll-padding-top:72 fa l'offset.
      el.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
      // già allineata (bordo alto ≈ 72)? conta i frame stabili.
      const rectTop = Math.round(el.getBoundingClientRect().top);
      if (Math.abs(rectTop - OFFSET) <= 2) stableFrames += 1;
      else stableFrames = 0;
    }
    frames += 1;
    if (stableFrames < 3 && frames < 40) requestAnimationFrame(tick);
    else cleanup();
  };
  requestAnimationFrame(tick);
}
