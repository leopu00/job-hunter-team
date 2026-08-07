// @vitest-environment jsdom
//
// Il blocco d'asse del globo in home, provato con eventi VERI.
//
// Il test precedente cercava stringhe nel sorgente di JobsGlobe: diceva
// che il codice c'era, non che funzionasse. Qui si ricostruisce la
// situazione reale — un listener MapLibre-like registrato in RISALITA
// sullo stesso nodo del lock, che chiama `preventDefault()` come fa
// l'originale — e si guarda cosa succede a un dito che scorre.
//
// La domanda a cui deve rispondere è una sola e non è teorica: dopo uno
// swipe verticale sopra al globo, la pagina scorre o resta ferma? In
// Chrome «resta ferma» significa che qualcuno ha chiamato
// preventDefault prima che il browser avviasse lo scorrimento. Qui lo
// misuriamo contando i preventDefault che il finto MapLibre riesce a
// piazzare.
//
// jsdom implementa cattura/target/risalita, stopPropagation e
// stopImmediatePropagation secondo specifica: è esattamente la semantica
// in prova. Il volo reale sul browser (Playwright su iPhone emulato)
// resta e sta in `tests/js/tasks/landing-globe.test.ts` come nota, ma
// questo gira in CI a ogni push.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DECIDE_PX,
  attachTouchAxisLock,
} from "../../../web/lib/globe-touch-axis-lock";

type Punto = { clientX: number; clientY: number };

/**
 * Un `touchmove` come lo vede il browser: propaga, è annullabile, porta
 * i tocchi. jsdom non ha TouchEvent, ma al lock servono solo `touches` e
 * i due metodi di propagazione — quindi un Event con `touches` attaccato
 * è fedele a ciò che conta.
 */
function touchEvent(tipo: string, punti: Punto[]): Event {
  const e = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: punti, writable: false });
  Object.defineProperty(e, "targetTouches", { value: punti, writable: false });
  return e;
}

/** Il banco di prova: contenitore + canvas + un MapLibre finto ma fedele. */
function banco() {
  const el = document.createElement("div");
  const canvas = document.createElement("canvas");
  el.appendChild(canvas);
  document.body.appendChild(el);

  const spia = {
    visti: 0,
    prevenuti: 0,
    dragPan: true,
    interazioniIniziate: 0,
    interazioniFinite: 0,
  };

  // Il vero MapLibre registra così, verificato in maplibre-gl.js:
  //   [canvasContainer, "touchstart", {passive: true}]
  //   [canvasContainer, "touchmove",  {passive: false}]
  // …e nell'handler chiama preventDefault quando un handler reclama il
  // gesto. `dragPan` spento = nessuno lo reclama = nessun preventDefault.
  const maplibre = (e: Event) => {
    spia.visti += 1;
    if (!spia.dragPan) return;
    e.preventDefault();
    spia.prevenuti += 1;
  };
  el.addEventListener("touchmove", maplibre, { passive: false });

  const detach = attachTouchAxisLock({
    el,
    setDragPanEnabled: (on) => {
      spia.dragPan = on;
    },
    onHorizontalStart: () => {
      spia.interazioniIniziate += 1;
    },
    onHorizontalEnd: () => {
      spia.interazioniFinite += 1;
    },
  });
  return { el, canvas, spia, detach };
}

/** Uno swipe dal centro, in passi come quelli di un dito vero. */
function swipe(
  canvas: HTMLElement,
  dx: number,
  dy: number,
  passi = 12,
  x0 = 200,
  y0 = 300,
) {
  canvas.dispatchEvent(touchEvent("touchstart", [{ clientX: x0, clientY: y0 }]));
  for (let i = 1; i <= passi; i++) {
    canvas.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: x0 + (dx * i) / passi, clientY: y0 + (dy * i) / passi },
      ]),
    );
  }
  canvas.dispatchEvent(touchEvent("touchend", []));
}

describe("blocco d'asse del globo in vetrina", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("il dito verticale scorre la PAGINA: MapLibre non lo vede mai", () => {
    const { canvas, spia, detach } = banco();
    swipe(canvas, 0, -240);
    expect(spia.visti, "MapLibre ha ricevuto un touchmove verticale").toBe(0);
    expect(spia.prevenuti, "lo scorrimento è stato annullato").toBe(0);
    expect(spia.interazioniIniziate, "il tour è stato fermato").toBe(0);
    expect(spia.interazioniFinite).toBe(0);
    detach();
  });

  it("il dito orizzontale gira il GLOBO: MapLibre lo riceve", () => {
    const { canvas, spia, detach } = banco();
    swipe(canvas, 240, 0);
    expect(spia.visti).toBeGreaterThan(0);
    expect(spia.prevenuti).toBeGreaterThan(0);
    expect(spia.dragPan, "il pan è rimasto acceso").toBe(true);
    expect(spia.interazioniIniziate).toBe(1);
    expect(spia.interazioniFinite).toBe(1);
    detach();
  });

  it("in diagonale vince la componente maggiore", () => {
    const giu = banco();
    swipe(giu.canvas, 40, -200); // prevalentemente verticale
    expect(giu.spia.visti).toBe(0);
    giu.detach();

    const lato = banco();
    swipe(lato.canvas, 200, -40); // prevalentemente orizzontale
    expect(lato.spia.visti).toBeGreaterThan(0);
    lato.detach();
  });

  it("trattiene finché non sa dove va il dito, poi lascia passare", () => {
    const { canvas, spia, detach } = banco();
    // Micro-movimenti sotto soglia: nessuno dei due deve riceverli, o il
    // browser perderebbe lo scorrimento prima che si sappia se serviva.
    const x0 = 200;
    const y0 = 300;
    canvas.dispatchEvent(
      touchEvent("touchstart", [{ clientX: x0, clientY: y0 }]),
    );
    canvas.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: x0 + DECIDE_PX - 1, clientY: y0 },
      ]),
    );
    expect(spia.visti, "trattenuto sotto soglia").toBe(0);
    canvas.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: x0 + DECIDE_PX + 20, clientY: y0 },
      ]),
    );
    expect(spia.visti, "passato una volta deciso").toBe(1);
    detach();
  });

  it("spegne il pan per il gesto verticale e lo riaccende dopo", () => {
    const { canvas, spia, detach } = banco();
    const x0 = 200;
    const y0 = 300;
    canvas.dispatchEvent(
      touchEvent("touchstart", [{ clientX: x0, clientY: y0 }]),
    );
    canvas.dispatchEvent(
      touchEvent("touchmove", [{ clientX: x0, clientY: y0 - 60 }]),
    );
    expect(spia.dragPan, "il pan doveva spegnersi sul verticale").toBe(false);
    canvas.dispatchEvent(touchEvent("touchend", []));
    expect(spia.dragPan, "il pan doveva tornare per il mouse").toBe(true);
    detach();
  });

  it("resiste a un listener MapLibre sullo STESSO nodo in cattura", () => {
    // È il caso che stopPropagation da solo NON copre, e il motivo per
    // cui il lock usa stopImmediatePropagation: se un giorno MapLibre
    // registrasse in cattura sullo stesso elemento, un `stopPropagation`
    // non fermerebbe un listener della stessa fase sullo stesso nodo.
    const el = document.createElement("div");
    const canvas = document.createElement("canvas");
    el.appendChild(canvas);
    document.body.appendChild(el);

    const spia = { visti: 0, dragPan: true };
    const detach = attachTouchAxisLock({
      el,
      setDragPanEnabled: (on) => {
        spia.dragPan = on;
      },
    });
    // Registrato DOPO il lock, stessa fase, stesso nodo: senza
    // stopImmediatePropagation verrebbe eseguito lo stesso.
    el.addEventListener(
      "touchmove",
      (e) => {
        spia.visti += 1;
        e.preventDefault();
      },
      { capture: true, passive: false },
    );

    swipe(canvas, 0, -240);
    expect(spia.visti).toBe(0);
    detach();
  });

  it("con più dita si fa da parte (pinch e simili restano a MapLibre)", () => {
    const { canvas, spia, detach } = banco();
    canvas.dispatchEvent(
      touchEvent("touchstart", [
        { clientX: 180, clientY: 300 },
        { clientX: 220, clientY: 300 },
      ]),
    );
    canvas.dispatchEvent(
      touchEvent("touchmove", [
        { clientX: 170, clientY: 240 },
        { clientX: 230, clientY: 360 },
      ]),
    );
    expect(spia.visti).toBe(1);
    detach();
  });

  it("staccandolo, il globo torna quello di prima", () => {
    const { el, canvas, spia, detach } = banco();
    detach();
    swipe(canvas, 0, -240);
    // Senza lock il finto MapLibre riceve tutto, com'è giusto: il lock
    // non deve lasciare listener orfani attaccati al contenitore.
    expect(spia.visti).toBeGreaterThan(0);
    expect(el.isConnected).toBe(true);
  });
});
