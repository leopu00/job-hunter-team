import { setWorkerUrl } from "maplibre-gl";

// MapLibre 6 spedisce il worker come modulo separato e di default lo risolve
// con `new URL(..., import.meta.url)`. Nel bundle di produzione di Next quel
// valore non è un URL http(s): la risoluzione torna vuota e il worker prova
// a importare la home del sito — muore in silenzio e ogni mappa mostra solo
// il background, senza tile né pin (il canvas disegna sul main thread, ma
// parsing di tile, sorgenti e simboli vivono tutti nel worker).
//
// L'URL va quindi fissato PRIMA di costruire qualunque Map, puntando alla
// copia same-origin che il postinstall mette in public/maplibre/ (vedi
// scripts/copy-maplibre-worker.mjs). Same-origin non è un dettaglio: con un
// URL della stessa origin MapLibre crea il worker direttamente (consentito
// dalla CSP `worker-src 'self'`), senza il wrapper blob che usa per gli URL
// cross-origin.
let applied = false;

export function ensureMaplibreWorkerUrl(): void {
  if (applied) return;
  applied = true;
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}
