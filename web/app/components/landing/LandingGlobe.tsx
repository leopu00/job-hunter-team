"use client";

// Vetrina hero della landing: il globo delle posizioni (lo stesso di
// /map, riusato in modalità showcase) che compie un viaggio per
// continenti — Europa (capitali) → Americhe → Australia → Asia →
// Medio Oriente — sostando sulle città e mostrando offerte
// dimostrative con punteggi, un pin per offerta (mai gruppi numerati).
//
// Prestazioni prima di tutto — è la prima cosa che vede uno
// sconosciuto, spesso da telefono:
//   • il globo (maplibre ~1 MB) NON è nel bundle della pagina: arriva
//     via dynamic import (JobsGlobeLazy) e solo DOPO che il browser è
//     in idle, così non contende banda/CPU al primo paint;
//   • sotto al canvas c'è sempre un'immagine statica del globo: è lei
//     l'LCP, e resta l'unica cosa mostrata se la macchina è debole
//     (probe tier "low" di map-perf), se il WebGL manca, se gli FPS
//     misurati crollano o se l'utente chiede prefers-reduced-motion;
//   • l'autopilota si ferma quando la tab è nascosta o il pannello
//     esce dal viewport: niente batteria bruciata per una scena che
//     nessuno guarda.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import JobsGlobeLazy from "@/app/components/JobsGlobeLazy";
import { initialAutoTier, type MapTier } from "@/lib/map-perf";
import { scoreSpectrumCss } from "@/lib/score-color";
import { makeT } from "@/lib/i18n-dict";
import { useLandingI18n } from "./LandingI18n";
import { T } from "./LandingGlobe.i18n";
import { landingShowcaseData, type LandingTourStop } from "./LandingGlobe.data";

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
// Attesa prima del primo volo: breve. Chi apre la home deve vedere il
// primo movimento interessante entro pochi secondi, non una sfera che
// gira piano per 7" (l'intro serve solo a far assestare tile e fade).
const ROTATE_BEFORE_FLY_MS = 3500;
// Il tour è un viaggio per continenti: salti brevi fra città dello
// stesso continente, transizione più ampia (flyTo con curva più alta:
// si allontana fino a mostrare lo spostamento sul globo, poi
// riatterra) quando si cambia continente.
const HOP_FLY_MS = 2800;
const CONTINENT_FLY_MS = 6200;
// Primo volo assoluto: più corto di un cambio continente — l'utente è
// appena arrivato, meglio scendere presto sulla prima capitale.
const FIRST_FLY_MS = 4500;
const DWELL_MS = 6500;

type AutopilotHandle = {
  suspend: () => void;
  resume: () => void;
  dispose: () => void;
};

// Macchina a stati del giro automatico: intro in rotazione, poi il
// viaggio — vola su una città → sosta (card visibile) → salta alla
// prossima; al cambio di continente la transizione si allarga. Vive
// fuori dal componente React: parla solo con l'istanza mappa e con due
// callback.
function startAutopilot(
  map: MaplibreMap,
  tour: LandingTourStop[],
  opts: {
    onStopChange: (stop: LandingTourStop | null) => void;
    onBegan: () => void;
  },
): AutopilotHandle {
  let disposed = false;
  let suspended = false;
  let phase: "rotate" | "travel" | "dwell" = "rotate";
  let idx = 0;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const schedule = (fn: () => void, ms: number) => {
    clearTimer();
    timer = window.setTimeout(fn, ms);
  };

  const spinStep = () => {
    if (disposed || suspended || phase !== "rotate") return;
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

  // Concatena i passi di rotazione: quando un easeTo finisce e siamo
  // ancora in fase rotate, se ne accoda un altro.
  const onMoveEnd = () => {
    if (phase === "rotate") spinStep();
  };

  const flyToNext = () => {
    if (disposed || suspended) return;
    phase = "travel";
    opts.onStopChange(null);
    const stop = tour[idx % tour.length];
    const prev = tour[(idx + tour.length - 1) % tour.length];
    // Cambio continente (o primissimo volo, o rientro dal fondo del
    // tour): transizione ampia — durata maggiore e curva più alta, così
    // il volo si allontana abbastanza da far LEGGERE lo spostamento sul
    // globo prima di riavvicinarsi. Dentro il continente: salto corto,
    // il viaggio resta locale.
    const crossing = idx === 0 || prev.continent !== stop.continent;
    const duration =
      idx === 0 ? FIRST_FLY_MS : crossing ? CONTINENT_FLY_MS : HOP_FLY_MS;
    idx += 1;
    map.flyTo({
      center: [stop.lon, stop.lat],
      zoom: CITY_ZOOM,
      duration,
      curve: crossing ? 1.55 : 1.42,
      essential: true,
    });
    schedule(() => {
      if (disposed || suspended) return;
      phase = "dwell";
      opts.onStopChange(stop);
      schedule(flyToNext, DWELL_MS);
    }, duration + 300);
  };

  const begin = () => {
    if (disposed) return;
    map.on("moveend", onMoveEnd);
    opts.onBegan();
    phase = "rotate";
    spinStep();
    schedule(flyToNext, ROTATE_BEFORE_FLY_MS);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
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
    suspend: () => {
      if (disposed || suspended) return;
      suspended = true;
      clearTimer();
      opts.onStopChange(null);
      try {
        map.stop(); // congela l'animazione camera → niente più frame
      } catch {
        /* ignora */
      }
    },
    resume: () => {
      if (disposed || !suspended) return;
      suspended = false;
      phase = "rotate";
      spinStep();
      schedule(flyToNext, ROTATE_BEFORE_FLY_MS);
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
  const [stop, setStop] = useState<LandingTourStop | null>(null);
  const [began, setBegan] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const autopilotRef = useRef<AutopilotHandle | null>(null);
  // Visibilità corrente del pannello (viewport + tab): l'autopilota
  // può nascere DOPO che l'utente ha già scrollato via — si consulta
  // questo ref alla creazione, non solo agli eventi.
  const visibleRef = useRef(true);

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
      if (watched) autopilotRef.current?.resume();
      else autopilotRef.current?.suspend();
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

  useEffect(() => () => autopilotRef.current?.dispose(), []);

  // Dataset del tour (pieno o lean) + oggetto showcase: JobsGlobe lo
  // legge via ref e la callback onMapReady parte una sola volta, al
  // mount della mappa — lean è già deciso a quel punto (vedi decide()).
  const show = useMemo(() => landingShowcaseData(lean), [lean]);
  const showcase = useMemo(
    () => ({
      positions: show.positions,
      onMapReady: (map: MaplibreMap) => {
        autopilotRef.current?.dispose();
        autopilotRef.current = startAutopilot(map, show.tour, {
          onStopChange: setStop,
          onBegan: () => setBegan(true),
        });
        if (!visibleRef.current || document.hidden) {
          autopilotRef.current.suspend();
        }
      },
      onTierChange: (tier: MapTier) => {
        // Gli FPS misurati dicono che la macchina non regge: meglio
        // un'immagine ferma e dignitosa che un globo a scatti.
        if (tier === "low") setMode("static");
      },
    }),
    [show],
  );

  // Card: le posizioni della tappa corrente, migliori in alto.
  const stopRows = useMemo(
    () =>
      stop
        ? [...stop.positions].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        : [],
    [stop],
  );

  return (
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/landing-globe-still.jpg"
        alt={tr("globe_alt")}
        width={1672}
        height={941}
        fetchPriority="high"
        className="jht-globe-still absolute inset-0 w-full h-full object-cover"
      />

      {/* Credito basemap per l'immagine statica (obbligo licenza
          CARTO/OSM: il render vivo ha il suo controllo attribution,
          l'immagine ferma deve portarselo scritto accanto). */}
      {mode !== "live" && (
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
          macchina capace). aria-hidden: è una scena animata, la voce
          accessibile è l'alt dell'immagine sotto. */}
      {mode === "live" && (
        <div
          aria-hidden
          className={`absolute inset-0 transition-opacity duration-700 ${
            began ? "opacity-100" : "opacity-0"
          }`}
        >
          <JobsGlobeLazy fullscreen showcase={showcase} />
        </div>
      )}

      {/* Raccordo con la pagina: senza più il box, la fascia si fonde
          nello sfondo con due sfumature (dal colore di fondo del sito,
          theme-aware, verso il trasparente). Niente z-index: badge,
          card e credito (z-10) e l'attribution di maplibre (z proprio)
          restano sopra; pointer-events-none lascia cliccabile la (i)
          dell'attribution sotto la sfumatura bassa. */}
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
          background: "linear-gradient(to top, var(--color-void), transparent)",
        }}
      />

      {/* Dicitura demo: sobria ma sempre visibile — i punteggi sono un
          esempio, non risultati reali. */}
      <div
        aria-hidden
        className="jht-globe-badge absolute top-3 right-3 z-10 pointer-events-none px-2.5 py-1.5 sm:px-2 sm:py-1 border border-[var(--color-border)] text-[11px] sm:text-[9px] font-semibold tracking-[0.18em] uppercase text-[var(--color-muted)]"
        style={{
          background: "color-mix(in srgb, var(--color-panel) 78%, transparent)",
        }}
      >
        {tr("demo_badge")}
      </div>

      {/* Card della tappa: città + posizioni dimostrative con score. */}
      {stop && (
        <div
          aria-hidden
          className="jht-globe-card absolute left-3 bottom-3 sm:left-5 sm:bottom-5 z-10 pointer-events-none border border-[var(--color-border)] rounded-md p-2.5 sm:p-3 text-[12px] sm:text-[11px] w-[216px] sm:w-[280px]"
          style={{
            maxWidth: "calc(100% - 24px)",
            background:
              "color-mix(in srgb, var(--color-panel) 92%, transparent)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            animation: "fade-in 0.35s ease both",
          }}
        >
          <div
            className="text-[10px] sm:text-[8px] leading-tight font-semibold tracking-[0.08em] sm:tracking-widest uppercase mb-1"
            style={{ color: "var(--color-green)" }}
          >
            {tr("card_kicker")}
          </div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span
              className="font-bold text-[14px] sm:text-[13px] leading-tight"
              style={{ color: "var(--color-white)" }}
            >
              {stop.city}
            </span>
            <span
              className="text-[11px] sm:text-[10px]"
              style={{ color: "var(--color-muted)" }}
            >
              {/* Il continente rende leggibile il filo del viaggio:
                  Europa → Americhe → Australia → Asia → Medio Oriente. */}
              {stop.country} · {tr(`continent_${stop.continent}`)}
            </span>
          </div>
          {stopRows.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 py-1 sm:py-1.5"
              style={{ borderTop: "1px solid var(--color-border)" }}
            >
              <span className="min-w-0">
                <span
                  className="block font-semibold leading-tight truncate"
                  style={{ color: "var(--color-bright)" }}
                >
                  {p.title}
                </span>
                <span
                  className="block text-[11px] sm:text-[10px] truncate"
                  style={{ color: "var(--color-muted)" }}
                >
                  {p.company}
                  {p.role_family ? ` · ${p.role_family}` : ""}
                </span>
              </span>
              <span
                className="text-[16px] font-bold leading-none tabular-nums flex-shrink-0"
                style={{ color: scoreSpectrumCss(p.score ?? null) }}
              >
                {p.score ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
