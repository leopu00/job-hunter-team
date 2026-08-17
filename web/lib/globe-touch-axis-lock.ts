/**
 * Blocco d'asse per il dito sul globo in vetrina: un gesto va al globo
 * OPPURE alla pagina, mai a entrambi.
 *
 * Il problema che risolve non è ovvio e vale scriverlo. Su una home il
 * globo occupa mezza schermata: se si trascina come una mappa, il dito
 * che scorre la pagina lo trova incollato. La cura naturale — `touch-action:
 * pan-y` sul canvas — **non basta**: MapLibre chiama `preventDefault()`
 * sul primo `touchmove`, e a quel punto Chrome non ha ancora avviato lo
 * scorrimento, quindi lo annulla per l'INTERO gesto. Misurato: con il solo
 * CSS la home restava immobile sotto uno swipe verticale.
 *
 * Qui i primi millimetri non arrivano a MapLibre. Si guarda dove sta
 * andando il dito e poi si decide una volta per tutte:
 *   • verticale  → l'evento non passa, il browser scorre la pagina;
 *   • orizzontale → passa, e il globo gira (il gesto del mappamondo).
 *
 * Due garanzie, non una, perché la prima dipende dall'ordine dei listener
 * e l'ordine è roba di libreria che può cambiare sotto i piedi:
 *   1. `stopImmediatePropagation()` in cattura sul contenitore. MapLibre
 *      oggi ascolta in RISALITA sullo stesso nodo (verificato in
 *      `maplibre-gl.js`: `[el, "touchmove", {passive:false}]`), quindi la
 *      cattura arriva prima; `stopPropagation` da solo però non fermerebbe
 *      un listener registrato sullo STESSO nodo nella STESSA fase, e la
 *      variante `Immediate` copre anche quel caso.
 *   2. `dragPan` spento per il resto del gesto verticale. Questa non
 *      dipende da nessun ordine: anche se un evento passasse, nessun
 *      handler lo reclama, quindi MapLibre non chiama `preventDefault` e
 *      lo scorrimento resta al browser.
 *
 * Il modulo è separato da JobsGlobe apposta: così il comportamento si
 * prova con eventi veri in un DOM vero, invece che cercando stringhe nel
 * sorgente (vedi `tests/js/tasks/globe-touch-axis-lock.test.ts`).
 */

/** Ciò che il lock deve poter toccare: il nodo e l'interruttore del pan. */
export type TouchAxisLockTarget = {
  /** Il contenitore del canvas: `map.getCanvasContainer()`. */
  el: HTMLElement;
  /** Accende/spegne il trascinamento della mappa. */
  setDragPanEnabled: (enabled: boolean) => void;
  /** Il gesto ha scelto l'asse orizzontale e ora controlla il globo. */
  onHorizontalStart?: () => void;
  /** L'ultimo dito del gesto orizzontale è stato sollevato/cancellato. */
  onHorizontalEnd?: () => void;
};

/**
 * Millimetri di gesto prima di decidere: due frame di dito. Sotto questa
 * soglia una carezza verticale e una orizzontale non si distinguono, e nel
 * dubbio l'evento si trattiene (nessuno dei due lo riceve).
 */
export const DECIDE_PX = 8;

type LockedEvent = Pick<
  TouchEvent,
  "touches" | "stopPropagation" | "stopImmediatePropagation"
>;

export function attachTouchAxisLock(target: TouchAxisLockTarget): () => void {
  const { el, setDragPanEnabled, onHorizontalStart, onHorizontalEnd } = target;
  let startX = 0;
  let startY = 0;
  // null = ancora indeciso. "x" = il gesto è del globo. "y" = della pagina.
  let axis: null | "x" | "y" = null;
  // Ricordiamo se siamo stati noi a spegnere il pan: riaccenderlo a caso
  // riattiverebbe un trascinamento che il chiamante aveva disabilitato.
  let dragPanSuspended = false;
  let horizontalActive = false;

  const finishHorizontal = () => {
    if (!horizontalActive) return;
    horizontalActive = false;
    onHorizontalEnd?.();
  };

  const restoreDragPan = () => {
    if (!dragPanSuspended) return;
    dragPanSuspended = false;
    setDragPanEnabled(true);
  };

  const withhold = (e: LockedEvent) => {
    // Immediate: ferma anche eventuali listener sullo stesso nodo nella
    // stessa fase, non solo la propagazione verso il target.
    e.stopImmediatePropagation();
    e.stopPropagation();
  };

  const onStart = (e: TouchEvent) => {
    restoreDragPan();
    // Più dita: non è un trascinamento a un dito, non ci mettiamo in mezzo.
    if (e.touches.length !== 1) {
      axis = "x";
      return;
    }
    axis = null;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };

  const onMove = (e: TouchEvent) => {
    if (axis === "x") return;
    if (axis === "y") {
      withhold(e);
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - startX);
    const dy = Math.abs(t.clientY - startY);
    if (Math.max(dx, dy) < DECIDE_PX) {
      withhold(e);
      return;
    }
    axis = dx > dy ? "x" : "y";
    if (axis === "x") {
      horizontalActive = true;
      onHorizontalStart?.();
    } else {
      withhold(e);
      // Seconda garanzia, indipendente dall'ordine dei listener.
      dragPanSuspended = true;
      setDragPanEnabled(false);
    }
  };

  const onEnd = (e: TouchEvent) => {
    // Multi-touch: la fine di un solo dito non conclude il gesto.
    if (e.touches.length > 0) return;
    axis = null;
    restoreDragPan();
    finishHorizontal();
  };

  // In cattura: i listener di MapLibre stanno sullo stesso elemento ma in
  // risalita, quindi qui si arriva prima di loro. Passivi: non chiamiamo
  // mai preventDefault — è esattamente ciò che non vogliamo che accada.
  const opts = { capture: true, passive: true } as const;
  el.addEventListener("touchstart", onStart, opts);
  el.addEventListener("touchmove", onMove, opts);
  el.addEventListener("touchend", onEnd, opts);
  el.addEventListener("touchcancel", onEnd, opts);

  return () => {
    el.removeEventListener("touchstart", onStart, opts);
    el.removeEventListener("touchmove", onMove, opts);
    el.removeEventListener("touchend", onEnd, opts);
    el.removeEventListener("touchcancel", onEnd, opts);
    restoreDragPan();
    // Detach significa teardown, non fine volontaria del gesto: non deve
    // armare un nuovo timer nel componente che si sta smontando.
    horizontalActive = false;
  };
}
