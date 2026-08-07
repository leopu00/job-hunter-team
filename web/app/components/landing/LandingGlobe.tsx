"use client";

// Vetrina hero della landing: il globo delle posizioni (lo stesso di
// /map, riusato in modalità showcase) che compie un viaggio per
// continenti — Europa (capitali) → Americhe → Australia → Asia →
// Medio Oriente — sostando sulle città e mostrando le loro opportunità
// una alla volta, con la card sopra al pin, esattamente come fa la
// mappa dell'area riservata.
//
// Il giro è automatico ma non è una vetrina blindata: si può prendere
// il globo e girarlo, e cliccare i pin per leggerne la card. Appena la
// mano si ferma per RESUME_AFTER_IDLE_MS il giro riprende da solo — chi
// passa di lì e non tocca niente vede comunque il mondo girare.
//
// Prestazioni prima di tutto — è la prima cosa che vede uno
// sconosciuto, spesso da telefono:
//   • il globo (maplibre ~1 MB) NON è nel bundle della pagina: arriva
//     via dynamic import (JobsGlobeLazy) e solo DOPO che il browser è
//     in idle, così non contende banda/CPU al primo paint;
//   • sotto al canvas c'è sempre un'immagine statica del globo: è lei
//     l'LCP, e resta l'unica cosa mostrata se la macchina è debole
//     (probe tier "low" di map-perf), se il WebGL manca, se gli FPS
//     misurati crollano o se l'utente chiede prefers-reduced-motion.
//     In quel caso non c'è nemmeno l'interazione: meglio un'immagine
//     ferma e dignitosa di un globo che si trascina a scatti;
//   • MapLibre si ferma quando la tab è nascosta o il pannello esce dal
//     viewport: niente frame e batteria bruciata per una scena che nessuno
//     guarda. Il copione però avanza sul solo orologio e al rientro viene
//     ricostruito nel punto corrente, quindi il loop non ricomincia.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import JobsGlobeLazy from "@/app/components/JobsGlobeLazy";
import { initialAutoTier, type MapTier } from "@/lib/map-perf";
import { makeT } from "@/lib/i18n-dict";
import { useLandingI18n } from "./LandingI18n";
import { T } from "./LandingGlobe.i18n";
import {
  landingFamilyColors,
  landingShowcaseData,
  type LandingTourStop,
} from "./LandingGlobe.data";

// ── Copione dell'autopilota ─────────────────────────────────────────
// Vista d'insieme sul globo intero; lat ~22 tiene in quadro entrambe
// le fasce di città (Berlino… Melbourne) durante la rotazione.
const OVERVIEW_ZOOM = 1.7;
const IDLE_LAT = 22;
// Zoom tappa: in vetrina l'aggregazione è spenta (ogni offerta è già
// il suo pin), quindi lo zoom è solo inquadratura — abbastanza vicino
// da separare a schermo uffici distanti ~1-4 km.
const CITY_ZOOM = 10.6;
// Rotazione (solo intro e ripresa dopo pausa): passi lineari
// concatenati (≈3°/s).
const ROTATE_STEP_DEG = 18;
const ROTATE_STEP_MS = 6000;
// L'intro resta abbastanza a lungo da far leggere il globo intero e da
// lasciare assestare tile e fade prima del primo zoom.
const ROTATE_BEFORE_FLY_MS = 5500;
// Il tour è un viaggio per continenti: salti brevi fra città dello
// stesso continente, transizione più ampia (flyTo con curva più alta:
// si allontana fino a mostrare lo spostamento sul globo, poi
// riatterra) quando si cambia continente.
const HOP_FLY_MS = 8500;
const CONTINENT_FLY_MS = 14000;
// Anche il primo volo deve mostrare chiaramente zoom-out, viaggio e
// zoom-in: una discesa rapida sembra un cambio scena e non un globo.
const FIRST_FLY_MS = 12000;
// `curve` controlla quanto flyTo risale durante il viaggio. Anche i salti
// locali ora lasciano vedere più mondo; i cambi continente salgono ancora
// un poco di più.
const HOP_FLY_CURVE = 1.8;
const CONTINENT_FLY_CURVE = 2;
// Quanto resta a schermo la card di UNA opportunità. La sosta sulla
// città è il numero di pin per questo tempo: 7 secondi circa dove i pin
// sono tre, poco più di undici dove sono cinque.
const CARD_MS = 2300;
// Ripresa dopo che l'utente ha DAVVERO finito il gesto. Il conto non parte
// al pointerdown: sette decimi dopo il rilascio l'autopilota è già di nuovo
// in moto.
const RESUME_AFTER_IDLE_MS = 700;
// La rotazione non riappare a velocità piena: per 0,8 s accelera da ferma
// fino agli stessi 3°/s dei passi lineari. Con easing v², 1,2° in 0,8 s
// raccordano esattamente quella velocità finale.
const RESUME_RAMP_MS = 800;
const RESUME_RAMP_DEG = 1.2;
// Rientro alla vista d'insieme quando il giro riparte: se l'utente ha
// lasciato il globo zoomato su un quartiere, l'autopilota non riprende
// da lì — risale prima, poi ricomincia a girare.
const RECENTER_MS = 2200;

// Perché la pausa è in corso. Sono indipendenti: il globo fuori
// schermo NON deve ripartire allo scadere del timer dell'utente, e
// viceversa il rientro nel viewport non deve annullare una pausa
// chiesta da chi sta trascinando.
type PauseReason = "offscreen" | "user";

type AutopilotHandle = {
  pause: (reason: PauseReason) => void;
  unpause: (reason: PauseReason) => void;
  dispose: () => void;
};

// Macchina a stati del giro automatico: intro in rotazione, poi il
// viaggio — vola su una città → mostra le sue opportunità una alla
// volta → salta alla prossima; al cambio di continente la transizione
// si allarga. Vive fuori dal componente React: parla solo con
// l'istanza mappa e con due callback.
export function startAutopilot(
  map: MaplibreMap,
  tour: LandingTourStop[],
  opts: {
    onCardChange: (positionId: string | null) => void;
    onBegan: () => void;
  },
): AutopilotHandle {
  type CameraPoint = { lng: number; lat: number; zoom: number };
  type TourCursor =
    | {
        phase: "rotate";
        remainingMs: number;
        advancedMs: number;
        from: CameraPoint;
      }
    | {
        phase: "travel";
        remainingMs: number;
        totalMs: number;
        stopSeq: number;
        from: CameraPoint;
        descentOnly: boolean;
      }
    | {
        phase: "dwell";
        remainingMs: number;
        stopSeq: number;
        cardIndex: number;
      };

  let disposed = false;
  const paused = new Set<PauseReason>();
  const suspended = () => paused.size > 0;
  let phase: "rotate" | "travel" | "dwell" = "rotate";
  let idx = 0;
  // Invalida i callback moveend/idle di un volo interrotto da una pausa
  // o da dispose. MapLibre emette moveend anche quando map.stop() tronca
  // una camera animation: senza token una vecchia tappa potrebbe
  // riapparire.
  let travelSeq = 0;
  let timer: number | null = null;
  let timerDueAt: number | null = null;
  let travelDueAt: number | null = null;
  let currentTravelTotalMs = 0;
  let currentTravelFrom: CameraPoint | null = null;
  let currentTravelDescentOnly = false;
  let currentStopSeq = -1;
  let currentCardIndex = 0;
  let resumeStage: null | "ramp" | "recenter" = null;
  // Uscire dal viewport congela MapLibre (zero frame) ma non il copione:
  // questo cursore e il tempo a parete permettono di ricostruire al rientro
  // il punto che il loop avrebbe raggiunto continuando invisibile.
  let offscreenCursor: TourCursor | null = null;
  let offscreenStartedAt: number | null = null;
  let offscreenElapsedMs = 0;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
    timerDueAt = null;
  };
  const schedule = (fn: () => void, ms: number) => {
    clearTimer();
    timerDueAt = Date.now() + ms;
    timer = window.setTimeout(fn, ms);
  };

  const stopAt = (stopSeq: number) => tour[stopSeq % tour.length];
  const crossingAt = (stopSeq: number) => {
    const stop = stopAt(stopSeq);
    const prev = stopAt(stopSeq + tour.length - 1);
    return stopSeq === 0 || prev.continent !== stop.continent;
  };
  const travelDurationAt = (stopSeq: number) =>
    stopSeq === 0
      ? FIRST_FLY_MS
      : crossingAt(stopSeq)
        ? CONTINENT_FLY_MS
        : HOP_FLY_MS;
  const rowsAt = (stopSeq: number) =>
    [...stopAt(stopSeq).positions].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
  // Dopo il primo volo speciale il copione è perfettamente periodico.
  // Serve a saltare in O(1) giorni interi fuori viewport invece di
  // attraversare card per card al rientro.
  const loopDurationMs = tour.reduce((total, _stop, stopIndex) => {
    const repeatedStopSeq = tour.length + stopIndex;
    return (
      total +
      travelDurationAt(repeatedStopSeq) +
      rowsAt(repeatedStopSeq).length * CARD_MS
    );
  }, 0);
  const cameraPoint = (): CameraPoint => {
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  };

  const spinStep = () => {
    if (disposed || suspended() || phase !== "rotate") return;
    const c = map.getCenter();
    map.easeTo({
      center: [c.lng + ROTATE_STEP_DEG, IDLE_LAT],
      zoom: OVERVIEW_ZOOM,
      duration: ROTATE_STEP_MS,
      // Lineare: rotazione a velocità costante, senza "pulsazioni"
      // a ogni passo concatenato.
      easing: (v) => v,
    });
  };

  const startResumeRecenter = () => {
    if (disposed || suspended()) return;
    resumeStage = null;
    phase = "dwell";
    const c = map.getCenter();
    try {
      map.easeTo({
        // Durante il rientro la longitudine continua alla velocità appena
        // raggiunta dalla rampa: nessun arresto fra accelerazione e giro.
        center: [
          c.lng + (ROTATE_STEP_DEG * RECENTER_MS) / ROTATE_STEP_MS,
          IDLE_LAT,
        ],
        zoom: OVERVIEW_ZOOM,
        duration: RECENTER_MS,
        easing: (v) => v,
      });
      resumeStage = "recenter";
    } catch {
      phase = "rotate";
      spinStep();
      schedule(flyToNext, ROTATE_BEFORE_FLY_MS);
    }
  };

  const startResumeRamp = () => {
    if (disposed || suspended()) return;
    resumeStage = null;
    phase = "dwell";
    const c = map.getCenter();
    try {
      map.easeTo({
        center: [c.lng + RESUME_RAMP_DEG, c.lat],
        zoom: map.getZoom(),
        duration: RESUME_RAMP_MS,
        easing: (v) => v * v,
      });
      resumeStage = "ramp";
    } catch {
      startResumeRecenter();
    }
  };

  // Concatena passi lineari e le due parti della ripresa morbida. Il
  // controllo `suspended` impedisce a un moveend generato da map.stop()
  // di riavviare qualcosa mentre una mano è ancora sul globo.
  const onMoveEnd = () => {
    if (disposed || suspended()) return;
    if (resumeStage === "ramp") {
      startResumeRecenter();
      return;
    }
    if (resumeStage === "recenter") {
      resumeStage = null;
      phase = "rotate";
      spinStep();
      schedule(flyToNext, ROTATE_BEFORE_FLY_MS);
      return;
    }
    if (phase === "rotate") spinStep();
  };

  let flyToNext = () => {};

  const beginDwell = (
    stopSeq: number,
    cardIndex = 0,
    firstCardMs = CARD_MS,
  ) => {
    if (disposed || suspended()) return;
    const rows = rowsAt(stopSeq);
    if (cardIndex >= rows.length) {
      flyToNext();
      return;
    }
    phase = "dwell";
    travelDueAt = null;
    currentStopSeq = stopSeq;
    currentCardIndex = cardIndex;
    opts.onCardChange(rows[cardIndex].id);
    schedule(() => beginDwell(stopSeq, cardIndex + 1), firstCardMs);
  };

  const startTravel = (
    stopSeq: number,
    duration = travelDurationAt(stopSeq),
    resumeDescent = false,
  ) => {
    if (disposed || suspended()) return;
    opts.onCardChange(null);
    const stop = stopAt(stopSeq);
    const crossing = crossingAt(stopSeq);
    const from = cameraPoint();
    // Cambio continente (o primissimo volo, o rientro dal fondo del
    // tour): transizione ampia — durata maggiore e curva più alta, così
    // il volo si allontana abbastanza da far LEGGERE lo spostamento sul
    // globo prima di riavvicinarsi. Dentro il continente: salto corto,
    // il viaggio resta locale.
    // Ferma l'eventuale passo di rotazione PRIMA di entrare in travel:
    // il moveend generato da stop non deve essere scambiato per la fine
    // del nuovo volo.
    phase = "dwell";
    map.stop();
    phase = "travel";
    travelSeq += 1;
    const seq = travelSeq;
    currentStopSeq = stopSeq;
    currentCardIndex = 0;
    currentTravelTotalMs = duration;
    currentTravelFrom = from;
    currentTravelDescentOnly = resumeDescent;
    travelDueAt = Date.now() + duration;

    const onTravelEnd = () => {
      if (disposed || suspended() || phase !== "travel" || seq !== travelSeq)
        return;

      const settleAtStop = () => {
        if (disposed || suspended() || phase !== "travel" || seq !== travelSeq)
          return;
        beginDwell(stopSeq);
      };

      // Anche quando style e source risultano loaded, il frame finale può
      // avere tile/render ancora da stabilizzare. La card e il countdown
      // partono quindi sempre dal primo idle successivo al moveend.
      map.once("idle", settleAtStop);
    };

    if (resumeDescent) {
      // La parte già trascorsa del volo è stata ricostruita con jumpTo:
      // da lì resta solo la discesa morbida verso la città, senza un
      // secondo zoom-out artificiale.
      map.easeTo({
        center: [stop.lon, stop.lat],
        zoom: CITY_ZOOM,
        duration,
        easing: (v) => v * (2 - v),
      });
    } else {
      map.flyTo({
        center: [stop.lon, stop.lat],
        zoom: CITY_ZOOM,
        duration,
        curve: crossing ? CONTINENT_FLY_CURVE : HOP_FLY_CURVE,
        essential: true,
      });
    }
    // flyTo() chiama stop() internamente e può emettere il moveend della
    // camera precedente in modo sincrono. Registrarsi DOPO il ritorno evita
    // di scambiarlo per il moveend del volo appena avviato.
    map.once("moveend", onTravelEnd);
  };

  flyToNext = () => {
    if (disposed || suspended()) return;
    const stopSeq = idx;
    idx += 1;
    startTravel(stopSeq);
  };

  const captureTourCursor = (): TourCursor => {
    const now = Date.now();
    if (resumeStage != null) {
      return {
        phase: "rotate",
        remainingMs: ROTATE_BEFORE_FLY_MS,
        advancedMs: 0,
        from: cameraPoint(),
      };
    }
    if (phase === "travel" && currentStopSeq >= 0) {
      const remainingMs = Math.max(1, (travelDueAt ?? now + 1) - now);
      return {
        phase: "travel",
        remainingMs,
        totalMs: Math.max(remainingMs, currentTravelTotalMs),
        stopSeq: currentStopSeq,
        from: currentTravelFrom ?? cameraPoint(),
        descentOnly: currentTravelDescentOnly,
      };
    }
    if (phase === "dwell" && currentStopSeq >= 0) {
      return {
        phase: "dwell",
        remainingMs: Math.max(1, (timerDueAt ?? now + CARD_MS) - now),
        stopSeq: currentStopSeq,
        cardIndex: currentCardIndex,
      };
    }
    return {
      phase: "rotate",
      remainingMs: Math.max(
        1,
        (timerDueAt ?? now + ROTATE_BEFORE_FLY_MS) - now,
      ),
      advancedMs: 0,
      from: cameraPoint(),
    };
  };

  const travelCursor = (stopSeq: number, from: CameraPoint): TourCursor => {
    const duration = travelDurationAt(stopSeq);
    return {
      phase: "travel",
      remainingMs: duration,
      totalMs: duration,
      stopSeq,
      from,
      descentOnly: false,
    };
  };

  const advanceTourCursor = (
    initial: TourCursor,
    elapsedMs: number,
  ): TourCursor => {
    let cursor = initial;
    let left = Math.max(0, elapsedMs);
    const skipWholeLoops = () => {
      if (
        cursor.phase === "rotate" ||
        cursor.stopSeq < tour.length ||
        loopDurationMs <= 0 ||
        left < loopDurationMs
      ) {
        return;
      }
      const loops = Math.floor(left / loopDurationMs);
      const stopOffset = loops * tour.length;
      left -= loops * loopDurationMs;
      idx += stopOffset;
      cursor = { ...cursor, stopSeq: cursor.stopSeq + stopOffset };
    };
    skipWholeLoops();
    while (left >= cursor.remainingMs) {
      left -= cursor.remainingMs;
      if (cursor.phase === "rotate") {
        const from = {
          lng:
            cursor.from.lng +
            ((cursor.advancedMs + cursor.remainingMs) * ROTATE_STEP_DEG) /
              ROTATE_STEP_MS,
          lat: IDLE_LAT,
          zoom: OVERVIEW_ZOOM,
        };
        const stopSeq = idx;
        idx += 1;
        cursor = travelCursor(stopSeq, from);
      } else if (cursor.phase === "travel") {
        cursor = {
          phase: "dwell",
          remainingMs: CARD_MS,
          stopSeq: cursor.stopSeq,
          cardIndex: 0,
        };
      } else {
        const rows = rowsAt(cursor.stopSeq);
        if (cursor.cardIndex + 1 < rows.length) {
          cursor = {
            ...cursor,
            remainingMs: CARD_MS,
            cardIndex: cursor.cardIndex + 1,
          };
        } else {
          const fromStop = stopAt(cursor.stopSeq);
          const stopSeq = idx;
          idx += 1;
          cursor = travelCursor(stopSeq, {
            lng: fromStop.lon,
            lat: fromStop.lat,
            zoom: CITY_ZOOM,
          });
        }
      }
      skipWholeLoops();
    }
    if (cursor.phase === "rotate") cursor.advancedMs += left;
    cursor.remainingMs -= left;
    return cursor;
  };

  const shortestLng = (from: number, to: number, progress: number) => {
    const delta = ((to - from + 540) % 360) - 180;
    return from + delta * progress;
  };

  const restoreTourCursor = (cursor: TourCursor) => {
    resumeStage = null;
    opts.onCardChange(null);
    phase = "dwell";
    if (cursor.phase === "rotate") {
      try {
        map.jumpTo({
          center: [
            cursor.from.lng +
              (cursor.advancedMs * ROTATE_STEP_DEG) / ROTATE_STEP_MS,
            IDLE_LAT,
          ],
          zoom: OVERVIEW_ZOOM,
        });
      } catch {
        /* la rotazione riparte comunque dal frame disponibile */
      }
      phase = "rotate";
      spinStep();
      schedule(flyToNext, cursor.remainingMs);
      return;
    }

    const stop = stopAt(cursor.stopSeq);
    if (cursor.phase === "dwell") {
      try {
        map.jumpTo({ center: [stop.lon, stop.lat], zoom: CITY_ZOOM });
      } catch {
        /* il countdown e la card restano comunque coerenti */
      }
      beginDwell(cursor.stopSeq, cursor.cardIndex, cursor.remainingMs);
      return;
    }

    // Ricostruzione senza frame: posizione, zoom-out e indice del volo
    // avanzano in base al tempo trascorso, poi MapLibre anima soltanto la
    // discesa ancora mancante. È un singolo jump al rientro, mai un loop
    // di render invisibili.
    const progress = 1 - cursor.remainingMs / cursor.totalMs;
    const eased = progress * progress * (3 - 2 * progress);
    const curve = crossingAt(cursor.stopSeq)
      ? CONTINENT_FLY_CURVE
      : HOP_FLY_CURVE;
    let zoom: number;
    if (cursor.descentOnly) {
      zoom = cursor.from.zoom + (CITY_ZOOM - cursor.from.zoom) * eased;
    } else {
      const apexZoom = Math.min(
        cursor.from.zoom,
        OVERVIEW_ZOOM - (curve - 1.42) * 1.5,
      );
      const leg =
        progress < 0.5
          ? progress * 2
          : (progress - 0.5) * 2;
      const legEase = leg * leg * (3 - 2 * leg);
      zoom =
        progress < 0.5
          ? cursor.from.zoom + (apexZoom - cursor.from.zoom) * legEase
          : apexZoom + (CITY_ZOOM - apexZoom) * legEase;
    }
    try {
      map.jumpTo({
        center: [
          shortestLng(cursor.from.lng, stop.lon, eased),
          cursor.from.lat + (stop.lat - cursor.from.lat) * eased,
        ],
        zoom,
      });
    } catch {
      /* startTravel riparte dal frame disponibile */
    }
    startTravel(
      cursor.stopSeq,
      cursor.remainingMs,
      cursor.descentOnly || progress >= 0.5,
    );
  };

  const begin = () => {
    if (disposed) return;
    map.on("moveend", onMoveEnd);
    opts.onBegan();
    if (suspended()) return;
    phase = "rotate";
    spinStep();
    schedule(flyToNext, ROTATE_BEFORE_FLY_MS);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    travelSeq += 1;
    clearTimer();
    try {
      map.off("moveend", onMoveEnd);
    } catch {
      /* mappa già rimossa */
    }
  };

  if (map.loaded()) begin();
  else map.once("load", begin);
  // JobsGlobe chiama map.remove() al proprio unmount: da lì in poi
  // ogni chiamata sull'istanza è un errore — ci si stacca subito.
  map.once("remove", dispose);

  return {
    pause: (reason) => {
      if (disposed || paused.has(reason)) return;
      const wasRunning = !suspended();
      if (reason === "offscreen") {
        // Un primo intervallo offscreen può essere già concluso ma ancora
        // pendente perché la pausa utente tiene il rendering congelato. Un
        // secondo toggle deve partire da QUEL cursore avanzato, non dal
        // frame fisico vecchio rimasto sul canvas.
        offscreenCursor = offscreenCursor
          ? advanceTourCursor(offscreenCursor, offscreenElapsedMs)
          : captureTourCursor();
        offscreenStartedAt = Date.now();
        offscreenElapsedMs = 0;
      }
      paused.add(reason);
      if (!wasRunning) return;
      resumeStage = null;
      travelSeq += 1;
      clearTimer();
      // La card la tiene chi ha causato la pausa: se è stato l'utente,
      // sceglie lui quale pin guardare; se è uscito dal viewport, non
      // c'è niente da guardare.
      if (reason !== "user") opts.onCardChange(null);
      try {
        map.stop(); // congela l'animazione camera → niente più frame
      } catch {
        /* ignora */
      }
    },
    unpause: (reason) => {
      if (disposed || !paused.has(reason)) return;
      paused.delete(reason);
      if (reason === "offscreen" && offscreenStartedAt != null) {
        offscreenElapsedMs = Date.now() - offscreenStartedAt;
        offscreenStartedAt = null;
      }
      if (suspended()) return;
      if (offscreenCursor) {
        const cursor = advanceTourCursor(
          offscreenCursor,
          offscreenElapsedMs,
        );
        offscreenCursor = null;
        offscreenElapsedMs = 0;
        restoreTourCursor(cursor);
        return;
      }
      opts.onCardChange(null);
      // Rientro: prima una breve accelerazione, poi risale alla vista
      // d'insieme senza interrompere la rotazione appena avviata.
      startResumeRamp();
    },
    dispose,
  };
}

export default function LandingGlobe() {
  const { lang } = useLandingI18n();
  const tr = useMemo(() => makeT(T, lang), [lang]);

  // pending: solo immagine statica (SSR/primo paint). live: globo vero
  // sopra l'immagine. static: si resta sull'immagine, per scelta
  // (reduced-motion) o per forza (macchina debole / niente WebGL).
  const [mode, setMode] = useState<"pending" | "live" | "static">("pending");
  // Profilo grafico ridotto (tier "medium" di map-perf): si monta la
  // variante lean del dataset — meno pin da disegnare a ogni frame.
  const [lean, setLean] = useState(false);
  // Opportunità la cui card è aperta sopra al pin. La scrivono in due:
  // l'autopilota durante il giro, l'utente quando clicca un pin.
  const [cardId, setCardId] = useState<string | null>(null);
  const [began, setBegan] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const autopilotRef = useRef<AutopilotHandle | null>(null);
  // Visibilità corrente del pannello (viewport + tab): l'autopilota
  // può nascere DOPO che l'utente ha già scrollato via — si consulta
  // questo ref alla creazione, non solo agli eventi.
  const visibleRef = useRef(true);
  const resumeTimerRef = useRef<number | null>(null);

  // Decisione live/static rimandata all'idle del browser: il probe è
  // sincrono ma leggero, ed è soprattutto il dynamic import del globo
  // a non dover competere con il primo paint della pagina.
  useEffect(() => {
    let cancelled = false;
    const decide = () => {
      if (cancelled) return;
      const reduced =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ??
        false;
      if (reduced) {
        setMode("static");
        return;
      }
      const { tier } = initialAutoTier();
      // lean e mode nello stesso handler: il dataset è definitivo PRIMA
      // che il render "live" monti JobsGlobe (che legge le posizioni
      // una volta sola, al mount).
      setLean(tier === "medium");
      setMode(tier === "low" ? "static" : "live");
    };
    type IdleWindow = Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    let idleId: number | null = null;
    let toId: number | null = null;
    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(decide, { timeout: 2500 });
    } else {
      toId = window.setTimeout(decide, 1200);
    }
    return () => {
      cancelled = true;
      if (idleId != null) w.cancelIdleCallback?.(idleId);
      if (toId != null) window.clearTimeout(toId);
    };
  }, []);

  // Pausa quando non guardato: tab nascosta o pannello fuori viewport
  // (l'hero sta in cima: appena l'utente scrolla alle sezioni, il globo
  // smetterebbe di consumare CPU/batteria per niente).
  useEffect(() => {
    if (mode !== "live") return;
    const el = wrapRef.current;
    if (!el) return;
    const sync = () => {
      const watched = !document.hidden && visibleRef.current;
      if (watched) autopilotRef.current?.unpause("offscreen");
      else autopilotRef.current?.pause("offscreen");
    };
    const io = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mode]);

  useEffect(
    () => () => {
      autopilotRef.current?.dispose();
      if (resumeTimerRef.current != null)
        window.clearTimeout(resumeTimerRef.current);
    },
    [],
  );

  // Mano umana sul globo: il conto della ripresa nasce solo al rilascio.
  // Un gesto lungo o un multi-touch non può quindi essere interrotto da un
  // timeout partito quando il dito era ancora giù.
  const onUserInteractStart = useCallback(() => {
    autopilotRef.current?.pause("user");
    if (resumeTimerRef.current != null)
      window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = null;
  }, []);
  const onUserInteractEnd = useCallback(() => {
    if (resumeTimerRef.current != null)
      window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      setCardId(null);
      autopilotRef.current?.unpause("user");
    }, RESUME_AFTER_IDLE_MS);
  }, []);

  // Dataset del tour (pieno o lean): titoli e settori sono già tradotti,
  // quindi cambiare lingua dalla nav riscrive anche le card del globo.
  const show = useMemo(() => landingShowcaseData(lean, lang), [lean, lang]);
  const familyColors = useMemo(() => landingFamilyColors(lang), [lang]);
  // onMapReady è un contratto one-shot (parte al primo idle della mappa):
  // legge il tour dal ref invece di catturarlo, così un cambio di lingua
  // prima di quel momento non gli lascia in mano una lista vecchia.
  const tourRef = useRef(show.tour);
  tourRef.current = show.tour;
  const onMapReady = useCallback((map: MaplibreMap) => {
    autopilotRef.current?.dispose();
    autopilotRef.current = startAutopilot(map, tourRef.current, {
      onCardChange: setCardId,
      onBegan: () => setBegan(true),
    });
    if (!visibleRef.current || document.hidden) {
      autopilotRef.current.pause("offscreen");
    }
  }, []);
  const onTierChange = useCallback((tier: MapTier) => {
    // Gli FPS misurati dicono che la macchina non regge: meglio
    // un'immagine ferma e dignitosa che un globo a scatti.
    if (tier === "low") setMode("static");
  }, []);

  const showcase = useMemo(
    () => ({
      positions: show.positions,
      lang,
      cardId,
      onPinSelect: (id: string | null) => {
        setCardId(id);
        // Un tap sul pin è deliberato anche senza trascinamento: gli si
        // concede la stessa breve finestra di un click col mouse.
        if (id) {
          onUserInteractStart();
          onUserInteractEnd();
        }
      },
      onUserInteractStart,
      onUserInteractEnd,
      onMapReady,
      onTierChange,
    }),
    [
      show,
      lang,
      cardId,
      onUserInteractStart,
      onUserInteractEnd,
      onMapReady,
      onTierChange,
    ],
  );

  // Il passaggio dev'essere atomico: sfumare due rappresentazioni dello
  // stesso globo significa mostrarle entrambe per alcuni frame (con pin e
  // label doppi). `began` arriva solo dopo il primo idle del canvas, quindi
  // qui è sicuro sostituire l'immagine invece di sovrapporla.
  const liveReady = mode === "live" && began;

  return (
    <>
      <div
        ref={wrapRef}
        // Fascia a tutta larghezza (niente box): ritratto su telefono
        // (il globo respira e la card non lo copre), panoramico da tablet
        // in su. Sui monitor larghi l'aspect 16/9 darebbe un'altezza da
        // schermo intero: il max-h la tappa a ~60% del viewport, così
        // titolo sopra e inizio contenuti sotto restano nel fold. Il /var
        // (--zoom) è obbligatorio: il body è zoomato e i vh sono calcolati
        // sul viewport NON zoomato (vedi commento in globals.css).
        className="relative w-full overflow-hidden aspect-[3/4] sm:aspect-[4/3] md:aspect-[16/9] md:max-h-[calc(60vh/var(--zoom))] bg-[var(--color-deep)]"
      >
        {/* Base statica: LCP della pagina, ripiego per macchine deboli e
            descrizione accessibile dell'intera vetrina. */}
        {!liveReady && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/landing-globe-still.jpg"
            alt={tr("globe_alt")}
            width={1672}
            height={941}
            fetchPriority="high"
            // Non è una dissolvenza: su un canvas non opaco farebbe convivere
            // due globi e due serie di etichette. L'immagine esiste fino al
            // primo idle del canvas, poi viene rimossa nello stesso render che
            // rende visibile la scena live.
            // Il tema viene scritto su <html> dallo script pre-paint del
            // layout. Il filtro light è quindi applicato a QUESTO STESSO
            // elemento prima del primo frame, senza montare un secondo still.
            className="jht-globe-still absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Credito basemap per l'immagine statica (obbligo licenza
            CARTO/OSM: il render vivo ha il suo controllo attribution,
            l'immagine ferma deve portarselo scritto accanto). */}
        {!liveReady && (
          <div
            className="jht-globe-static-credit absolute bottom-2 right-2 z-10 pointer-events-none rounded-sm px-1.5 py-1 text-[10px] leading-tight"
            style={{
              color: "var(--color-muted)",
              background:
                "color-mix(in srgb, var(--color-panel) 78%, transparent)",
            }}
          >
            © CARTO · © OpenStreetMap contributors
          </div>
        )}

        {/* Globo vivo: montato solo a decisione presa (browser in idle,
            macchina capace).
            NIENTE aria-hidden qui dentro. Da quando la vetrina si può
            toccare, questo sottoalbero contiene roba VERA e raggiungibile
            col tab: il pulsante di chiusura della card e il credito
            basemap di MapLibre. Nasconderlo lascerebbe il focus atterrare
            su comandi che uno screen reader non annuncia — il classico
            focus fantasma.
            La descrizione della scena la porta questo contenitore con
            aria-label: quando il globo vivo prende il posto
            dell'immagine, l'alt sparisce e senza etichetta l'hero
            resterebbe muto. Nessun doppione: finché il fallback è a
            schermo questo blocco è `invisible`, cioè fuori
            dall'albero di accessibilità. */}
        {mode === "live" && (
          <div
            role="group"
            aria-label={tr("globe_live_label")}
            // Il canvas deve montare per arrivare al suo primo idle, ma non
            // deve disegnare sotto al fallback durante l'attesa: altrimenti un
            // cambiamento di opacità o compositing può riesporre due globi.
            className={`absolute inset-0 ${liveReady ? "visible" : "invisible"}`}
          >
            <JobsGlobeLazy
              fullscreen
              showcase={showcase}
              familyColors={familyColors}
            />
          </div>
        )}

        {/* Raccordo con la pagina: senza più il box, la fascia si fonde
            nello sfondo con due sfumature (dal colore di fondo del sito,
            theme-aware, verso il trasparente). Niente z-index: card e
            credito (z-10) e l'attribution di maplibre (z proprio)
            restano sopra; pointer-events-none lascia cliccabile la (i)
            dell'attribution sotto la sfumatura bassa — e soprattutto
            lascia passare il trascinamento del globo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-10 md:h-16"
          style={{
            background:
              "linear-gradient(to bottom, var(--color-void), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10 md:h-16"
          style={{
            background:
              "linear-gradient(to top, var(--color-void), transparent)",
          }}
        />
      </div>

      {/* Che cosa sta guardando chi guarda. Il globo mostra città,
          mestieri e punteggi con la stessa faccia che hanno nell'area
          riservata: senza una riga che lo dica, sembrerebbe che il
          prodotto stia trovando quelle offerte adesso. */}
      <p className="mx-auto mt-3 max-w-2xl px-6 text-center text-[11px] leading-relaxed text-[var(--color-muted)]">
        {tr("showcase_note")}
      </p>
    </>
  );
}
