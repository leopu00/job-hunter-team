// Scaling automatico della qualità grafica delle mappe MapLibre.
//
// Motivo (test utente 24/07, globo aperto da una VDI aziendale): senza
// GPU il WebGL cade su un rasterizer software (SwiftShader / llvmpipe /
// "Microsoft Basic Render Driver") e ogni pixel del globo lo disegna la
// CPU — poi, su VDI, il frame viene pure codificato e spedito in rete.
// Risultato: navigazione a scatti. La priorità dichiarata dall'utente è
// FLUIDITÀ, non fedeltà grafica: qui decidiamo quanto lavoro per frame
// concedere alla mappa, e lo ricalibriamo misurando gli FPS veri.
//
// Due segnali, in quest'ordine:
//   1) probe statico all'avvio (renderer WebGL, core CPU, RAM, DPR) →
//      tier di partenza, così una VDI non deve prima soffrire per capirlo;
//   2) FPS misurati durante il movimento → degrado (e ri-promozione)
//      con isteresi, perché il probe statico sbaglia in entrambi i sensi.
//
// L'utente può sempre forzare il tier dal selettore qualità del globo
// (preferenza persistita); "auto" = questa logica.

export type MapTier = "high" | "medium" | "low";
export type MapQualityPref = "auto" | MapTier;

export type MapTierProfile = {
  tier: MapTier;
  /** Pixel ratio del canvas: il moltiplicatore più diretto sul fillrate. */
  canvasPixelRatio: number;
  /** La proiezione globe costa più della mercator: sul tier low si cede. */
  projection: "globe" | "mercator";
  /** Halo radiale sfocato alla base dei fasci (circle-blur = fillrate). */
  beamHalo: boolean;
  /** Quanti raggi disegnare al massimo dentro l'icona di un gruppo. */
  maxBeams: number;
  /** Altezza massima in px del raggio più alto (dimensiona il canvas). */
  beamMaxHeight: number;
  /**
   * Scala di rendering dell'icona: 1 = risoluzione piena (nitida su
   * retina), 0.5 = un quarto dei pixel di texture. La dimensione a
   * schermo NON cambia — si compensa dichiarando a MapLibre un
   * pixelRatio pari a `2 * iconScale`.
   */
  iconScale: number;
  /** Fade dei simboli fra un frame di placement e l'altro. */
  fadeDuration: number;
  /** Durata delle animazioni di camera (flyTo/fitBounds); 0 = salto secco. */
  flyDuration: number;
  /** Etichette di testo della basemap (placement simboli = costo CPU). */
  basemapLabels: boolean;
  /** Tile tenute in cache: meno memoria, meno pressione GC. */
  maxTileCacheSize: number;
};

const BASE_PROFILES: Record<
  MapTier,
  Omit<MapTierProfile, "canvasPixelRatio">
> = {
  high: {
    tier: "high",
    projection: "globe",
    beamHalo: true,
    maxBeams: 24,
    beamMaxHeight: 400,
    iconScale: 1,
    fadeDuration: 300,
    flyDuration: 800,
    basemapLabels: true,
    maxTileCacheSize: 500,
  },
  medium: {
    tier: "medium",
    projection: "globe",
    beamHalo: false,
    maxBeams: 10,
    beamMaxHeight: 300,
    iconScale: 0.7,
    fadeDuration: 120,
    flyDuration: 400,
    basemapLabels: true,
    maxTileCacheSize: 200,
  },
  low: {
    tier: "low",
    // Ultimo gradino: si rinuncia alla sfera. È il singolo risparmio
    // più grosso su rasterizer software (meno tile in vista, vertex
    // shader semplice) e l'utente ha scelto fluidità sopra l'estetica.
    projection: "mercator",
    beamHalo: false,
    maxBeams: 5,
    beamMaxHeight: 180,
    iconScale: 0.5,
    fadeDuration: 0,
    flyDuration: 0,
    basemapLabels: false,
    maxTileCacheSize: 80,
  },
};

/** Pixel ratio effettivo: il tier alto rispetta il retina (cap 2), i
 *  tier bassi tagliano sotto 1 — su un rasterizer software il numero di
 *  pixel è direttamente proporzionale al tempo di frame. */
function pixelRatioFor(tier: MapTier, dpr: number): number {
  if (tier === "high") return Math.min(dpr, 2);
  if (tier === "medium") return Math.min(dpr, 1);
  return Math.min(dpr, 0.75);
}

export function profileFor(tier: MapTier, dpr?: number): MapTierProfile {
  const ratio =
    typeof dpr === "number"
      ? dpr
      : typeof window !== "undefined"
        ? window.devicePixelRatio || 1
        : 1;
  return {
    ...BASE_PROFILES[tier],
    canvasPixelRatio: pixelRatioFor(tier, ratio),
  };
}

const TIER_ORDER: MapTier[] = ["low", "medium", "high"];

function lowerTier(t: MapTier): MapTier {
  const i = TIER_ORDER.indexOf(t);
  return TIER_ORDER[Math.max(0, i - 1)];
}

function higherTier(t: MapTier): MapTier {
  const i = TIER_ORDER.indexOf(t);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)];
}

// ---------------------------------------------------------------------------
// Probe statico
// ---------------------------------------------------------------------------

// Nomi di renderer che indicano rasterizzazione software o GPU
// virtualizzata: è esattamente il caso VDI/remote desktop.
const SOFTWARE_RENDERER_RE =
  /swiftshader|llvmpipe|softpipe|basic render|software|mesa offscreen|generic renderer|virtualbox|vmware|parallels|microsoft remote|rdp|citrix/i;

function readGlRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    // Libera subito il contesto: i contesti WebGL sono una risorsa
    // limitata (~16 per pagina) e questo è usa-e-getta.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

export type MapTierProbe = {
  tier: MapTier;
  /** Perché: utile in console e nel tooltip del selettore. */
  reason: string;
  renderer: string | null;
  softwareRenderer: boolean;
};

/** Tier di partenza dedotto dall'hardware, senza ancora aver disegnato
 *  nulla. Volutamente prudente: partire basso e risalire è molto meno
 *  fastidioso che il contrario. */
export function probeMapTier(): MapTierProbe {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      tier: "high",
      reason: "ssr",
      renderer: null,
      softwareRenderer: false,
    };
  }
  const renderer = readGlRenderer();
  const software = renderer != null && SOFTWARE_RENDERER_RE.test(renderer);
  if (renderer == null) {
    return {
      tier: "low",
      reason: "webgl-unavailable",
      renderer,
      softwareRenderer: false,
    };
  }
  if (software) {
    return {
      tier: "low",
      reason: `software-renderer:${renderer}`,
      renderer,
      softwareRenderer: true,
    };
  }
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (cores <= 2 || memory <= 2) {
    return {
      tier: "low",
      reason: `weak-host:cores=${cores},mem=${memory}`,
      renderer,
      softwareRenderer: false,
    };
  }
  if (cores <= 4 || memory <= 4) {
    return {
      tier: "medium",
      reason: `modest-host:cores=${cores},mem=${memory}`,
      renderer,
      softwareRenderer: false,
    };
  }
  // Chi chiede meno animazioni ha spesso anche una macchina in
  // difficoltà (o semplicemente non le vuole): niente tier alto.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return {
      tier: "medium",
      reason: "prefers-reduced-motion",
      renderer,
      softwareRenderer: false,
    };
  }
  return {
    tier: "high",
    reason: `capable-host:cores=${cores},mem=${memory}`,
    renderer,
    softwareRenderer: false,
  };
}

// ---------------------------------------------------------------------------
// Preferenza utente + memoria del tier osservato
// ---------------------------------------------------------------------------

const PREF_KEY = "jht:map-quality";
const OBSERVED_KEY = "jht:map-tier-observed";

export function readQualityPref(): MapQualityPref {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(PREF_KEY);
    if (v === "high" || v === "medium" || v === "low" || v === "auto") return v;
  } catch {
    /* storage negato (private mode / policy aziendale): resta auto */
  }
  return "auto";
}

export function writeQualityPref(pref: MapQualityPref): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_KEY, pref);
  } catch {
    /* non bloccare la UI se lo storage è negato */
  }
}

/** Tier a cui il monitor è arrivato l'ultima volta su questa macchina:
 *  al reload si riparte da lì invece di rifare la discesa a scatti. */
export function readObservedTier(): MapTier | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(OBSERVED_KEY);
    if (v === "high" || v === "medium" || v === "low") return v;
  } catch {
    /* ignora */
  }
  return null;
}

export function writeObservedTier(tier: MapTier): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OBSERVED_KEY, tier);
  } catch {
    /* ignora */
  }
}

/** Tier iniziale in modalità auto: il minimo fra probe hardware e
 *  l'esito misurato in una sessione precedente. */
export function initialAutoTier(): { tier: MapTier; probe: MapTierProbe } {
  const probe = probeMapTier();
  const observed = readObservedTier();
  if (!observed) return { tier: probe.tier, probe };
  const tier =
    TIER_ORDER.indexOf(observed) < TIER_ORDER.indexOf(probe.tier)
      ? observed
      : probe.tier;
  return { tier, probe };
}

// ---------------------------------------------------------------------------
// Monitor FPS runtime
// ---------------------------------------------------------------------------

/** Sotto questi FPS la navigazione è percepita "a scatti" → si degrada. */
const DEGRADE_FPS = 24;
/** Sopra questi FPS c'è margine per rialzare la qualità. */
const PROMOTE_FPS = 52;
/** Campioni per finestra di valutazione (~1s a 45fps). */
const WINDOW_SAMPLES = 45;
/** Una macchina lentissima non arriverà mai a WINDOW_SAMPLES in tempi
 *  utili: dopo questo tempo di movimento si decide con quello che c'è
 *  (purché ci siano almeno MIN_SAMPLES campioni). */
const WINDOW_MS = 1500;
const MIN_SAMPLES = 5;
/** Finestre buone consecutive richieste prima di ri-promuovere. */
const WINDOWS_BEFORE_PROMOTE = 4;
/** Finestre storte consecutive prima di degradare (la prima può essere
 *  solo il caricamento iniziale delle tile). */
const WINDOWS_BEFORE_DEGRADE = 2;
/** Dopo un degrado, niente promozioni per un po': evita il ping-pong. */
const PROMOTE_COOLDOWN_MS = 20000;
/** Due degradi dallo stesso tier = quel tier non regge: lo blocchiamo. */
const MAX_PROMOTIONS = 2;

type MapEvent = "render" | "movestart" | "moveend";

type MinimalMap = {
  on: (type: MapEvent, cb: () => void) => unknown;
  off: (type: MapEvent, cb: () => void) => unknown;
};

export type FpsMonitorHandle = {
  stop: () => void;
  /** Chiamare quando il tier cambia per motivi esterni (scelta utente). */
  reset: (tier: MapTier) => void;
};

/**
 * Osserva gli intervalli fra i frame che MapLibre disegna davvero e
 * propone cambi di tier.
 *
 * Si campiona SOLO mentre la mappa si muove (fra `movestart` e
 * `moveend`), non in base a una soglia sull'intervallo fra frame: a 3
 * fps i frame distano 300+ ms e un filtro temporale li scarterebbe
 * come "mappa ferma" — cioè si perderebbe esattamente il caso che
 * questa funzione esiste per riconoscere.
 */
export function attachFpsMonitor(
  map: MinimalMap,
  startTier: MapTier,
  onTierChange: (
    tier: MapTier,
    info: { fps: number; direction: "down" | "up" },
  ) => void,
): FpsMonitorHandle {
  // Un intervallo oltre questo non è lentezza: è la mappa che riprende
  // a disegnare dopo una pausa (es. tile arrivate tardi dalla rete).
  const MAX_PLAUSIBLE_GAP = 3000;
  let tier = startTier;
  let moving = false;
  let last = 0;
  let windowStart = 0;
  let samples: number[] = [];
  let goodWindows = 0;
  let badWindows = 0;
  let promotions = 0;
  let lastDegradeAt = 0;
  let floor: MapTier | null = null;

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const evaluate = () => {
    const n = samples.length;
    // FPS MEDI sulla finestra (n / tempo trascorso), non mediana degli
    // intervalli: con il thread saturo MapLibre alterna stalli lunghi e
    // raffiche di frame ravvicinati, e la mediana leggerebbe "tutto
    // liscio" proprio mentre l'utente vede gli scatti. Gli stalli qui
    // pesano, che è quello che conta.
    const elapsed = samples.reduce((a, b) => a + b, 0);
    samples = [];
    if (n === 0 || elapsed <= 0) return;
    const fps = (n * 1000) / elapsed;

    if (fps < DEGRADE_FPS && tier !== "low") {
      badWindows += 1;
      // Una sola finestra storta può essere il caricamento iniziale
      // delle tile: si degrada alla seconda consecutiva.
      if (badWindows < WINDOWS_BEFORE_DEGRADE) return;
      badWindows = 0;
      const next = lowerTier(tier);
      // Il tier che si è appena rivelato insufficiente diventa il
      // soffitto per il resto della sessione.
      floor = tier;
      tier = next;
      goodWindows = 0;
      lastDegradeAt = now();
      writeObservedTier(next);
      onTierChange(next, { fps, direction: "down" });
      return;
    }

    badWindows = 0;

    if (fps >= PROMOTE_FPS && tier !== "high") {
      goodWindows += 1;
      const canPromote =
        goodWindows >= WINDOWS_BEFORE_PROMOTE &&
        promotions < MAX_PROMOTIONS &&
        now() - lastDegradeAt > PROMOTE_COOLDOWN_MS &&
        (floor == null ||
          TIER_ORDER.indexOf(higherTier(tier)) < TIER_ORDER.indexOf(floor));
      if (canPromote) {
        const next = higherTier(tier);
        tier = next;
        promotions += 1;
        goodWindows = 0;
        writeObservedTier(next);
        onTierChange(next, { fps, direction: "up" });
      }
      return;
    }

    goodWindows = 0;
  };

  const onRender = () => {
    if (!moving) return;
    const t = now();
    const dt = t - last;
    last = t;
    if (dt <= 0 || dt > MAX_PLAUSIBLE_GAP) return;
    if (samples.length === 0) windowStart = t;
    samples.push(dt);
    const enough =
      samples.length >= WINDOW_SAMPLES ||
      (samples.length >= MIN_SAMPLES && t - windowStart >= WINDOW_MS);
    if (enough) evaluate();
  };

  const onMoveStart = () => {
    moving = true;
    last = now();
    samples = [];
  };
  const onMoveEnd = () => {
    moving = false;
    // Coda troppo corta per essere significativa: si scarta invece di
    // far pesare due frame sfortunati su una decisione di qualità.
    if (samples.length >= MIN_SAMPLES) evaluate();
    else samples = [];
  };

  map.on("render", onRender);
  map.on("movestart", onMoveStart);
  map.on("moveend", onMoveEnd);

  return {
    stop: () => {
      map.off("render", onRender);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
    },
    reset: (t: MapTier) => {
      tier = t;
      samples = [];
      goodWindows = 0;
      badWindows = 0;
      last = now();
    },
  };
}
