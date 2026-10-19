/**
 * La lingua dei nomi della basemap (paesi, città, mari).
 *
 * Lo stile Carto legge solo `name_en` (e `name` a zoom alto): con
 * l'interfaccia in tedesco la mappa scriveva comunque «GERMANY». Le tile
 * portano però `name:xx` per ogni lingua dell'app, quindi il campo del testo
 * diventa «nella lingua dell'interfaccia, altrimenti inglese, altrimenti il
 * nome locale». Le strade, i punti d'interesse e i numeri civici restano nel
 * nome locale: non sono quello che la mappa deve tradurre.
 */

/** Livelli sorgente delle tile i cui nomi seguono la lingua dell'interfaccia. */
export const TRANSLATED_SOURCE_LAYERS: ReadonlySet<string> = new Set([
  "place",
  "water_name",
  "waterway",
]);

/** Espressione MapLibre per `text-field`. */
export function basemapNameExpression(lang: string): unknown[] {
  const own = ["get", `name:${lang}`];
  const english = ["get", "name_en"];
  const local = ["get", "name"];
  return ["coalesce", own, english, local];
}

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Lo stesso ordine dell'espressione, per i nomi letti dalle feature già disegnate. */
export function basemapNameOf(
  props: Record<string, unknown>,
  lang: string,
): string {
  return (
    text(props[`name:${lang}`]) ||
    text(props.name_en) ||
    text(props["name:latin"]) ||
    text(props.name)
  );
}

/** Vero se il livello è un simbolo di testo di cui si traduce il nome. */
export function isTranslatedNameLayer(layer: {
  type: string;
  "source-layer"?: string;
}): boolean {
  return (
    layer.type === "symbol" &&
    layer["source-layer"] != null &&
    TRANSLATED_SOURCE_LAYERS.has(layer["source-layer"])
  );
}
