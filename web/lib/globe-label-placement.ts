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
  anchor: LabelAnchor;
  rect: Rect;
  /** true = nessun lato era libero: è stato preso quello che copre meno. */
  collides: boolean;
};

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
 * Rettangolo di un nome della mappa (paese, città) centrato sul suo punto.
 * I nomi dei paesi sono maiuscoli e spaziati: più larghi a parità di
 * caratteri.
 */
export function nameRect(
  point: { x: number; y: number },
  name: string,
  size = 12,
  uppercase = true,
): Rect {
  // Un margine attorno al testo: il punto della feature non è sempre dove
  // MapLibre ha poi disegnato il nome (le etichette dei paesi si spostano per
  // le collisioni), e la stima della larghezza è approssimata.
  const pad = 4;
  const w =
    Math.ceil([...name].length * size * (uppercase ? 0.78 : 0.6)) + 2 * pad;
  const h = Math.ceil(size * 1.3) + 2 * pad;
  return { x: point.x - w / 2, y: point.y - h / 2, w, h };
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
    let best: Placement | null = null;
    let bestCost = Infinity;
    for (const anchor of anchors) {
      const rect = labelRect(anchor, item, size);
      let cost = 0;
      for (const o of obstacles) cost += overlapArea(rect, o);
      for (const p of placed) cost += overlapArea(rect, p);
      if (cost < bestCost) {
        best = { anchor, rect, collides: cost > 0 };
        bestCost = cost;
      }
      if (cost === 0) break;
    }
    // anchors vuoto non si dà: ne serve almeno uno.
    const choice = best!;
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
