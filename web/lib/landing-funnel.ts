// O-47 — da quale campagna arriva il traffico.
//
// Dall'8 agosto si compra pubblicità su due canali insieme e i download sono
// passati da 2-8 per release a ~115 in due giorni: il traffico c'è, ma non si
// sa da quale dei due arrivi, quindi si continua a comprare al buio. Due
// percorsi brevi — /r e /t — danno la risposta senza chiedere niente a chi
// clicca: il conteggio è per canale e per ora, e basta a dire dove mettere i
// soldi.
//
// Stessa forma del funnel di download (`download-funnel.ts`), con la stessa
// regola: mai una riga per richiesta, mai un timestamp pieno, mai IP,
// user-agent, referrer, cookie o geolocalizzazione. Un contatore aggregato
// non diventa un profilo per sbaglio.

import { downloadHour } from "@/lib/download-funnel";

/** I canali che hanno un percorso dedicato. Chiuso: la cardinalità è il punto. */
export const LANDING_SOURCES = {
  r: "reddit",
  t: "tiktok",
} as const;

export type LandingPath = keyof typeof LANDING_SOURCES;
export type LandingSource = (typeof LANDING_SOURCES)[LandingPath];

export type LandingHit = {
  /** Ora UTC troncata: "2026-08-10T14". Mai il minuto, mai il secondo. */
  ts_hour: string;
  source: LandingSource;
};

export function isLandingPath(value: string): value is LandingPath {
  return Object.hasOwn(LANDING_SOURCES, value);
}

// L'ora la calcola `downloadHour`, non una copia: due contatori che dividono
// il tempo in modo diverso non si possono mettere sullo stesso grafico, ed è
// il grafico la ragione per cui questo codice esiste.
export function createLandingHit(path: LandingPath, now: Date): LandingHit {
  return { ts_hour: downloadHour(now), source: LANDING_SOURCES[path] };
}
