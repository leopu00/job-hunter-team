/**
 * Piazzamento delle etichette dei fasci sul globo (il numero sotto il fascio).
 *
 * L'etichetta stava sempre sotto al pin, con l'halo per coprire i nomi della
 * mappa: dove il nome di un paese cade lì sotto («IRELAND3», «B2LGIUM») o due
 * città sono vicine, numero e nome si scrivono uno sull'altro. Qui, in pixel di
 * schermo e senza toccare MapLibre, si sceglie per ognuna il primo lato libero
 * fra quelli ammessi; la funzione è pura così si prova con un test di
 * collisione, senza WebGL.
 */

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Lato su cui sta il testo rispetto al pin, con lo stesso nome del
 * `text-anchor` di MapLibre (= il punto del TESTO attaccato al pin):
 *  top    → il testo sta sotto al pin (come prima, il default);
 *  left   → il testo sta a destra del pin;
 *  right  → il testo sta a sinistra del pin;
 *  bottom → il testo sta sopra al pin, sul fascio: l'ultima scelta.
 */
export type LabelAnchor = "top" | "left" | "right" | "bottom";
export const ANCHOR_ORDER: readonly LabelAnchor[] = [
  "top",
  "left",
  "right",
  "bottom",
];

/** Distanza testo-pin, in em: gli stessi valori di `text-offset` del layer. */
export const ANCHOR_OFFSET_EM: Record<LabelAnchor, [number, number]> = {
  top: [0, 0.3],
  left: [0.9, 0],
  right: [-0.9, 0],
  bottom: [0, -0.3],
};

export type LabelItem = {
  id: string;
  /** Pin in pixel di schermo. */
  x: number;
  y: number;
  /** Misura del testo, px. */
  w: number;
  h: number;
  /** Chi ha più priorità sceglie per primo (di solito il numero di posizioni). */
  priority: number;
};

export type Placement = {
  /**
   * Lato del testo sul pin. «center» = il testo sta lontano dal pin, al
   * centro di `rect`, e `leader` dice di quanto (px dal pin al centro del
   * testo): lo si collega al pin con una linea guida.
   */
  anchor: LabelAnchor | "center";
  rect: Rect;
  leader: { dx: number; dy: number } | null;
  /** true = nessuna posizione era libera: è stata presa quella che copre meno. */
  collides: boolean;
};

/**
 * Distanze (px dal bordo del testo al pin) e direzioni provate per la linea
 * guida, quando nessun lato attaccato al pin è libero. Prima i lati
 * orizzontali, poi le diagonali, poi su e giù.
 */
export const LEADER_DISTANCES = [26, 44, 66] as const;
export const LEADER_DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
  [0, -1],
  [0, 1],
];

/** Ingombro del testo a una distanza `d` dal pin, nella direzione (ux, uy). */
export function leaderRect(
  item: Pick<LabelItem, "x" | "y" | "w" | "h">,
  dir: readonly [number, number],
  d: number,
): { rect: Rect; dx: number; dy: number } {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / len;
  const uy = dir[1] / len;
  // Il centro del testo sta a d + metà del suo ingombro lungo la direzione.
  const reach = d + (item.w / 2) * Math.abs(ux) + (item.h / 2) * Math.abs(uy);
  const dx = Math.round(ux * reach);
  const dy = Math.round(uy * reach);
  return {
    rect: {
      x: item.x + dx - item.w / 2,
      y: item.y + dy - item.h / 2,
      w: item.w,
      h: item.h,
    },
    dx,
    dy,
  };
}

/** Ingombro del testo per un dato lato (px): `size` è il font-size. */
export function labelRect(
  anchor: LabelAnchor,
  item: Pick<LabelItem, "x" | "y" | "w" | "h">,
  size: number,
): Rect {
  const [ox, oy] = ANCHOR_OFFSET_EM[anchor];
  const dx = ox * size;
  const dy = oy * size;
  switch (anchor) {
    case "top":
      return {
        x: item.x - item.w / 2 + dx,
        y: item.y + dy,
        w: item.w,
        h: item.h,
      };
    case "left":
      return {
        x: item.x + dx,
        y: item.y - item.h / 2 + dy,
        w: item.w,
        h: item.h,
      };
    case "right":
      return {
        x: item.x + dx - item.w,
        y: item.y - item.h / 2 + dy,
        w: item.w,
        h: item.h,
      };
    case "bottom":
      return {
        x: item.x - item.w / 2 + dx,
        y: item.y + dy - item.h,
        w: item.w,
        h: item.h,
      };
  }
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Font-size del testo dei fasci a un dato zoom (lo stesso interpolato nel layer). */
export function labelFontSize(zoom: number): number {
  if (zoom <= 0) return 11;
  if (zoom <= 6) return 11 + (zoom / 6) * 1;
  if (zoom <= 12) return 12 + ((zoom - 6) / 6) * 2;
  return 14;
}

/** Larghezza stimata di un testo in grassetto: ~0.62 em a carattere. */
export function estimateTextWidth(text: string, size: number): number {
  return Math.ceil([...text].length * size * 0.62);
}

/**
 * Larghezza media di un carattere in em: maiuscolo e minuscolo del font dei
 * nomi della basemap (Montserrat Medium / Open Sans Bold).
 */
export const UPPER_EM = 0.7;
export const LOWER_EM = 0.56;

/**
 * Rettangolo di un nome della mappa (paese, città) centrato sul suo punto.
 * Il testo va a capo come in MapLibre (`text-max-width`, in em, default 10):
 * «UNITED KINGDOM» sono due righe, e conta la riga più larga.
 */
export function nameRect(
  point: { x: number; y: number },
  name: string,
  size = 12,
  uppercase = true,
  maxWidthEm = 10,
  letterSpacingEm = 0,
): Rect {
  const perChar = (uppercase ? UPPER_EM : LOWER_EM) + letterSpacingEm;
  const width = (text: string) => [...text].length * perChar * size;
  const limit = maxWidthEm * size;
  const lines: string[] = [];
  let line = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > limit) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  // Un margine attorno al testo: il punto della feature non è sempre dove
  // MapLibre ha poi disegnato il nome, e la stima della larghezza è
  // approssimata.
  const pad = 3;
  const w = Math.ceil(Math.max(0, ...lines.map(width))) + 2 * pad;
  const h = Math.ceil(lines.length * size * 1.2) + 2 * pad;
  return { x: point.x - w / 2, y: point.y - h / 2, w, h };
}

/**
 * Valore di una proprietà di stile MapLibre che può essere un numero fisso o
 * una funzione a stops ({stops: [[zoom, valore], ...]}): numerica interpolata
 * in modo lineare, altrimenti a gradini. `fallback` se non si capisce.
 */
export function styleValueAtZoom<T extends number | string>(
  prop: unknown,
  zoom: number,
  fallback: T,
): T {
  if (typeof prop === "number" || typeof prop === "string") return prop as T;
  const stops = (prop as { stops?: unknown } | null | undefined)?.stops;
  if (!Array.isArray(stops) || stops.length === 0) return fallback;
  const pairs = stops as [number, T][];
  if (zoom <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++) {
    const [z1, v1] = pairs[i];
    const [z0, v0] = pairs[i - 1];
    if (zoom <= z1) {
      if (typeof v0 === "number" && typeof v1 === "number") {
        return (v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0)) as T;
      }
      return v0;
    }
  }
  return pairs[pairs.length - 1][1];
}

/**
 * Sceglie un lato per ogni etichetta. Ordine: priorità decrescente, poi id (il
 * risultato non dipende dall'ordine in cui arrivano). Per ognuna, il primo lato
 * di `anchors` il cui ingombro non tocca né le etichette già piazzate né gli
 * `obstacles`; se non ce n'è, quello che ne copre di meno (`collides`). Nessuna
 * etichetta sparisce: il numero di posizioni è l'informazione.
 */
export function placeLabels(
  items: readonly LabelItem[],
  obstacles: readonly Rect[],
  size: number,
  anchors: readonly LabelAnchor[] = ANCHOR_ORDER,
): Map<string, Placement> {
  const order = [...items].sort(
    (a, b) =>
      b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const placed: Rect[] = [];
  const out = new Map<string, Placement>();
  for (const item of order) {
    const cost = (rect: Rect) => {
      let c = 0;
      for (const o of obstacles) c += overlapArea(rect, o);
      for (const p of placed) c += overlapArea(rect, p);
      return c;
    };
    let best: Placement | null = null;
    let bestCost = Infinity;
    const consider = (candidate: Placement, c: number) => {
      if (c < bestCost) {
        best = { ...candidate, collides: c > 0 };
        bestCost = c;
      }
    };
    for (const anchor of anchors) {
      const rect = labelRect(anchor, item, size);
      consider({ anchor, rect, leader: null, collides: false }, cost(rect));
      if (bestCost === 0) break;
    }
    // Nessun lato attaccato al pin è libero: il testo si sposta più lontano,
    // con una linea guida (prima la distanza minima in tutte le direzioni).
    if (bestCost > 0) {
      search: for (const d of LEADER_DISTANCES) {
        for (const dir of LEADER_DIRECTIONS) {
          const { rect, dx, dy } = leaderRect(item, dir, d);
          consider(
            { anchor: "center", rect, leader: { dx, dy }, collides: false },
            cost(rect),
          );
          if (bestCost === 0) break search;
        }
      }
    }
    // anchors vuoto non si dà: ne serve almeno uno.
    const choice = best as unknown as Placement;
    placed.push(choice.rect);
    out.set(item.id, choice);
  }
  return out;
}

/**
 * Testo sotto un fascio: niente per una posizione sola, il numero per un
 * gruppo, «N remote» per un gruppo di sole remote. Il «·» di prima («2 ·
 * remote») faceva leggere due cose staccate.
 */
export function groupLabel(
  count: number,
  remote: boolean,
  remoteWord: string,
): string {
  if (count <= 1) return "";
  return remote ? `${count} ${remoteWord}` : String(count);
}
