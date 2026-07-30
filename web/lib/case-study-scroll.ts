// Ancoraggio dello scroll tra pagine di beta tester: cambiando tester dalla
// sidebar (o dallo switcher mobile) si resta sulla STESSA sezione E alla stessa
// altezza DENTRO la sezione — così, se guardavi la mappa (che sta in fondo alla
// sezione "Dove", sotto label e introduzione), ti ritrovi sulla mappa dell'altro
// tester, non sull'introduzione.
//
// Meccanica: al clic ricordiamo (a) QUALE sezione è in cima (per NOME, via
// data-cs-anchor) e (b) di quanti px la linea di riferimento è ENTRATA in quella
// sezione. Sul nuovo tester riportiamo la stessa sezione allo stesso offset.
//
// Se la sezione ricordata NON esiste sul tester di destinazione (es. la mappa
// "Dove" è assente quando non ci sono ancora città geocodificate), si torna
// ALL'INIZIO — alla card di presentazione del profilo — non alla sezione vicina.
//
// Dettagli che contano (imparati a caro prezzo):
//  - globals.css: `html { scroll-behavior:smooth; scroll-padding-top:72px }`. Lo
//    smooth farebbe ANIMARE lo scroll (misure a metà volo): forziamo scrollTo
//    con `behavior:"instant"`. Usiamo scrollTo ESPLICITO (non scrollIntoView) per
//    poter aggiungere l'offset dentro la sezione; l'OFFSET 72 (= scroll-padding)
//    è applicato a mano, identico in rilevazione e ripristino → simmetrici.
//  - i grafici possono assestare l'altezza dopo il mount: ri-applichiamo per
//    qualche frame finché la posizione ASSOLUTA della sezione è stabile,
//    tenendola inchiodata; ci si ferma se l'utente scrolla.
//
// Lo stato vive a livello di modulo: sopravvive alla navigazione soft di Next
// (stessa scheda) e si azzera al reload completo (ingresso pulito in cima).

// Deve combaciare con `scroll-padding-top` in globals.css (nav fissa + respiro).
const OFFSET = 72;

let pending: { key: string; offset: number } | null = null;

function absTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY;
}

/** Ricorda sezione + offset interno della vista corrente. Da chiamare al clic
 *  sul link di un altro tester, PRIMA della navigazione. */
export function rememberCurrentSection(): void {
  if (typeof window === "undefined") return;
  const els = Array.from(
    document.querySelectorAll<HTMLElement>("[data-cs-anchor]"),
  );
  if (els.length === 0) {
    pending = null;
    return;
  }
  // Linea di riferimento = bordo alto dell'area utile (sotto la nav fissa). La
  // sezione "in cima" è l'ultima (per posizione visiva) il cui bordo alto è già
  // sopra/alla linea; l'offset è quanto la linea è entrata in quella sezione.
  const line = window.scrollY + OFFSET;
  let el = els[0];
  let best = -Infinity;
  for (const cur of els) {
    const top = absTop(cur);
    if (top <= line + 8 && top >= best) {
      best = top;
      el = cur;
    }
  }
  pending = {
    key: el.getAttribute("data-cs-anchor") ?? "",
    offset: Math.max(0, Math.round(line - absTop(el))),
  };
}

/** Riporta il viewport alla sezione + offset ricordati sul nuovo tester. Da
 *  chiamare al montaggio / cambio di tester. No-op se non c'è nulla in sospeso. */
export function restoreSection(): void {
  if (typeof window === "undefined") return;
  const target = pending;
  pending = null;
  if (!target) return;

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

  let last = Number.NaN;
  let stable = 0;
  let frames = 0;
  const tick = () => {
    if (aborted) return cleanup();
    const exact = document.querySelector<HTMLElement>(
      `[data-cs-anchor="${target.key}"]`,
    );
    // Fallback: sezione assente su questo tester → si torna alla presentazione
    // del profilo (in cima), senza offset.
    const el =
      exact ??
      document.querySelector<HTMLElement>('[data-cs-anchor="profile"]');
    if (el) {
      const top = Math.round(absTop(el)); // ASSOLUTA: cambia solo col layout
      // offset solo se la sezione esiste davvero, clampato alla sua altezza
      // (che può differire): non si sconfina nella sezione successiva.
      const off = exact
        ? Math.min(target.offset, Math.max(0, el.offsetHeight - 8))
        : 0;
      window.scrollTo({
        top: Math.max(0, top - OFFSET + off),
        behavior: "instant" as ScrollBehavior,
      });
      if (top === last) stable += 1;
      else {
        stable = 0;
        last = top;
      }
    } else {
      stable += 1;
    }
    frames += 1;
    // stop quando la sezione è ferma da qualche frame (layout assestato) o dopo
    // ~1.5s di sicurezza.
    if (stable < 5 && frames < 90) requestAnimationFrame(tick);
    else cleanup();
  };
  requestAnimationFrame(tick);
}
