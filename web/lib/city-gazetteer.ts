// Gazetteer città → coordinate (centro-città) come FALLBACK per la mappa.
//
// Perché serve: `resolveCityPins` (lib/city-coords.ts) ricava il centro di
// ogni città dai record che HANNO già coordinate ufficio (office_lat/lon) e ci
// appoggia le posizioni senza coordinate della stessa città. Ma un account che
// NON ha ancora geocodificato NESSUN ufficio (VPS fresca — [GEOCODE-NEW-VPS]) ha
// zero "semi": ogni città resta senza centro → nessun pin, anche con loc_city
// popolata su quasi tutte le posizioni. L'intento del design è che "paese +
// città" basti a piazzare un pin; questo file lo realizza con una tabella di
// coordinate note.
//
// Copertura: capitali + grandi città (EU-centrica, più hub globali) — la coda
// lunga di paesini non è qui (resta nel bucket "senza coordinate" finché il
// team geocodifica l'ufficio, che ha comunque la precedenza). È additivo: può
// solo AGGIUNGERE pin, mai spostare quelli con coordinate ufficio reali.
//
// Coordinate = centro città (lat, lon), gradi decimali WGS84.

type LatLon = { lat: number; lon: number };

// Chiave canonica "paese|città" (entrambi lowercase, senza accenti, alias
// risolti). Un indice città-sola viene derivato più sotto per i casi in cui il
// paese è assente o scritto in modo incoerente.
const GAZETTEER: Record<string, LatLon> = {
  // ── Italia ──
  "italy|rome": { lat: 41.9028, lon: 12.4964 },
  "italy|milan": { lat: 45.4642, lon: 9.19 },
  "italy|naples": { lat: 40.8518, lon: 14.2681 },
  "italy|turin": { lat: 45.0703, lon: 7.6869 },
  "italy|florence": { lat: 43.7696, lon: 11.2558 },
  "italy|venice": { lat: 45.4408, lon: 12.3155 },
  "italy|bologna": { lat: 44.4949, lon: 11.3426 },
  "italy|genoa": { lat: 44.4056, lon: 8.9463 },
  "italy|palermo": { lat: 38.1157, lon: 13.3615 },
  "italy|bari": { lat: 41.1171, lon: 16.8719 },
  "italy|catania": { lat: 37.5079, lon: 15.083 },
  "italy|verona": { lat: 45.4384, lon: 10.9916 },
  "italy|padua": { lat: 45.4064, lon: 11.8768 },
  "italy|monza": { lat: 45.5845, lon: 9.2744 },
  "italy|fiumicino": { lat: 41.7686, lon: 12.2261 },
  "italy|pisa": { lat: 43.7228, lon: 10.4017 },
  "italy|trieste": { lat: 45.6495, lon: 13.7768 },
  "italy|bergamo": { lat: 45.6983, lon: 9.6773 },
  "italy|brescia": { lat: 45.5416, lon: 10.2118 },
  "italy|parma": { lat: 44.8015, lon: 10.3279 },
  // ── Emirati / Golfo ──
  "united arab emirates|dubai": { lat: 25.2048, lon: 55.2708 },
  "united arab emirates|abu dhabi": { lat: 24.4539, lon: 54.3773 },
  "qatar|doha": { lat: 25.2854, lon: 51.531 },
  "saudi arabia|riyadh": { lat: 24.7136, lon: 46.6753 },
  // ── Spagna ──
  "spain|madrid": { lat: 40.4168, lon: -3.7038 },
  "spain|barcelona": { lat: 41.3851, lon: 2.1734 },
  "spain|valencia": { lat: 39.4699, lon: -0.3763 },
  "spain|seville": { lat: 37.3891, lon: -5.9845 },
  "spain|palma": { lat: 39.5696, lon: 2.6502 },
  "spain|malaga": { lat: 36.7213, lon: -4.4213 },
  "spain|bilbao": { lat: 43.263, lon: -2.935 },
  // ── Francia ──
  "france|paris": { lat: 48.8566, lon: 2.3522 },
  "france|lyon": { lat: 45.764, lon: 4.8357 },
  "france|marseille": { lat: 43.2965, lon: 5.3698 },
  "france|toulouse": { lat: 43.6047, lon: 1.4442 },
  "france|nice": { lat: 43.7102, lon: 7.262 },
  "france|bordeaux": { lat: 44.8378, lon: -0.5792 },
  "france|lille": { lat: 50.6292, lon: 3.0573 },
  "france|nantes": { lat: 47.2184, lon: -1.5536 },
  // ── Regno Unito / Irlanda ──
  "united kingdom|london": { lat: 51.5074, lon: -0.1278 },
  "united kingdom|manchester": { lat: 53.4808, lon: -2.2426 },
  "united kingdom|birmingham": { lat: 52.4862, lon: -1.8904 },
  "united kingdom|edinburgh": { lat: 55.9533, lon: -3.1883 },
  "united kingdom|glasgow": { lat: 55.8642, lon: -4.2518 },
  "united kingdom|leeds": { lat: 53.8008, lon: -1.5491 },
  "united kingdom|bristol": { lat: 51.4545, lon: -2.5879 },
  "united kingdom|cambridge": { lat: 52.2053, lon: 0.1218 },
  "ireland|dublin": { lat: 53.3498, lon: -6.2603 },
  // ── Germania ──
  "germany|berlin": { lat: 52.52, lon: 13.405 },
  "germany|munich": { lat: 48.1351, lon: 11.582 },
  "germany|hamburg": { lat: 53.5511, lon: 9.9937 },
  "germany|frankfurt": { lat: 50.1109, lon: 8.6821 },
  "germany|cologne": { lat: 50.9375, lon: 6.9603 },
  "germany|stuttgart": { lat: 48.7758, lon: 9.1829 },
  "germany|dusseldorf": { lat: 51.2277, lon: 6.7735 },
  // ── Benelux ──
  "netherlands|amsterdam": { lat: 52.3676, lon: 4.9041 },
  "netherlands|rotterdam": { lat: 51.9244, lon: 4.4777 },
  "netherlands|the hague": { lat: 52.0705, lon: 4.3007 },
  "netherlands|utrecht": { lat: 52.0907, lon: 5.1214 },
  "netherlands|eindhoven": { lat: 51.4416, lon: 5.4697 },
  "belgium|brussels": { lat: 50.8503, lon: 4.3517 },
  "belgium|antwerp": { lat: 51.2194, lon: 4.4025 },
  "luxembourg|luxembourg": { lat: 49.6116, lon: 6.1319 },
  // ── Svizzera / Austria ──
  "switzerland|zurich": { lat: 47.3769, lon: 8.5417 },
  "switzerland|geneva": { lat: 46.2044, lon: 6.1432 },
  "switzerland|basel": { lat: 47.5596, lon: 7.5886 },
  "switzerland|bern": { lat: 46.948, lon: 7.4474 },
  "switzerland|lausanne": { lat: 46.5197, lon: 6.6323 },
  "austria|vienna": { lat: 48.2082, lon: 16.3738 },
  // ── Portogallo ──
  "portugal|lisbon": { lat: 38.7223, lon: -9.1393 },
  "portugal|porto": { lat: 41.1579, lon: -8.6291 },
  // ── Nordici ──
  "denmark|copenhagen": { lat: 55.6761, lon: 12.5683 },
  "sweden|stockholm": { lat: 59.3293, lon: 18.0686 },
  "sweden|gothenburg": { lat: 57.7089, lon: 11.9746 },
  "norway|oslo": { lat: 59.9139, lon: 10.7522 },
  "finland|helsinki": { lat: 60.1699, lon: 24.9384 },
  // ── Europa centro-orientale / Sud-est ──
  "poland|warsaw": { lat: 52.2297, lon: 21.0122 },
  "poland|krakow": { lat: 50.0647, lon: 19.945 },
  "czechia|prague": { lat: 50.0755, lon: 14.4378 },
  "hungary|budapest": { lat: 47.4979, lon: 19.0402 },
  "romania|bucharest": { lat: 44.4268, lon: 26.1025 },
  "greece|athens": { lat: 37.9838, lon: 23.7275 },
  "croatia|zagreb": { lat: 45.815, lon: 15.9819 },
  // ── Nord America ──
  "united states|new york": { lat: 40.7128, lon: -74.006 },
  "united states|san francisco": { lat: 37.7749, lon: -122.4194 },
  "united states|los angeles": { lat: 34.0522, lon: -118.2437 },
  "united states|boston": { lat: 42.3601, lon: -71.0589 },
  "united states|chicago": { lat: 41.8781, lon: -87.6298 },
  "united states|seattle": { lat: 47.6062, lon: -122.3321 },
  "united states|austin": { lat: 30.2672, lon: -97.7431 },
  "united states|washington": { lat: 38.9072, lon: -77.0369 },
  "united states|miami": { lat: 25.7617, lon: -80.1918 },
  "canada|toronto": { lat: 43.6532, lon: -79.3832 },
  "canada|montreal": { lat: 45.5017, lon: -73.5673 },
  "canada|vancouver": { lat: 49.2827, lon: -123.1207 },
  // ── Asia / Pacifico ──
  "singapore|singapore": { lat: 1.3521, lon: 103.8198 },
  "hong kong|hong kong": { lat: 22.3193, lon: 114.1694 },
  "japan|tokyo": { lat: 35.6762, lon: 139.6503 },
  "australia|sydney": { lat: -33.8688, lon: 151.2093 },
  "australia|melbourne": { lat: -37.8136, lon: 144.9631 },
  // ── Coda lunga (città comparse nei dati reali, 19/07 — alimentano il
  //    pin della card Località quando manca l'ufficio geocodato) ──
  "germany|mannheim": { lat: 49.4875, lon: 8.466 },
  "germany|walldorf": { lat: 49.3064, lon: 8.6424 },
  "germany|ratingen": { lat: 51.2973, lon: 6.8494 },
  "germany|garbsen": { lat: 52.4183, lon: 9.598 },
  "germany|falkenstein": { lat: 50.4779, lon: 12.3705 },
  "germany|leipzig": { lat: 51.3397, lon: 12.3731 },
  "germany|dresden": { lat: 51.0504, lon: 13.7373 },
  "germany|nuremberg": { lat: 49.4521, lon: 11.0767 },
  "germany|hannover": { lat: 52.3759, lon: 9.732 },
  "germany|bremen": { lat: 53.0793, lon: 8.8017 },
  "germany|bonn": { lat: 50.7374, lon: 7.0982 },
  "germany|karlsruhe": { lat: 49.0069, lon: 8.4037 },
  "germany|heidelberg": { lat: 49.3988, lon: 8.6724 },
  "germany|darmstadt": { lat: 49.8728, lon: 8.6512 },
  "austria|graz": { lat: 47.0707, lon: 15.4395 },
  "austria|linz": { lat: 48.3069, lon: 14.2858 },
  "austria|salzburg": { lat: 47.8095, lon: 13.055 },
  "belgium|ghent": { lat: 51.0543, lon: 3.7174 },
  "ireland|limerick": { lat: 52.6638, lon: -8.6267 },
  "norway|fornebu": { lat: 59.8967, lon: 10.6273 },
  "spain|a coruna": { lat: 43.3623, lon: -8.4115 },
  "spain|quart de poblet": { lat: 39.4815, lon: -0.4419 },
  "malta|birkirkara": { lat: 35.8972, lon: 14.4611 },
  "malta|msida": { lat: 35.8956, lon: 14.4844 },
  "czech republic|hradec kralove": { lat: 50.2092, lon: 15.8328 },
  "italy|castelfranco veneto": { lat: 45.672, lon: 11.928 },
  "italy|grottaminarda": { lat: 41.071, lon: 15.0602 },
  "india|bengaluru": { lat: 12.9716, lon: 77.5946 },
  "indonesia|jakarta": { lat: -6.2088, lon: 106.8456 },
};

// Alias nomi-paese → forma canonica inglese (dopo strip accenti + lowercase).
const COUNTRY_ALIAS: Record<string, string> = {
  italia: "italy",
  espana: "spain",
  deutschland: "germany",
  osterreich: "austria",
  belgie: "belgium",
  belgique: "belgium",
  suisse: "switzerland",
  schweiz: "switzerland",
  svizzera: "switzerland",
  nederland: "netherlands",
  "paesi bassi": "netherlands",
  grecia: "greece",
  portogallo: "portugal",
  espagne: "spain",
  allemagne: "germany",
  francia: "france",
  uae: "united arab emirates",
  "u.a.e.": "united arab emirates",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  "great britain": "united kingdom",
  england: "united kingdom",
  scotland: "united kingdom",
  wales: "united kingdom",
  usa: "united states",
  "u.s.a.": "united states",
  us: "united states",
  "united states of america": "united states",
  "czech republic": "czechia",
};

// Alias nomi-città (nativo/altra lingua) → forma canonica del gazetteer (dopo
// strip accenti + lowercase).
const CITY_ALIAS: Record<string, string> = {
  roma: "rome",
  milano: "milan",
  napoli: "naples",
  torino: "turin",
  firenze: "florence",
  venezia: "venice",
  genova: "genoa",
  padova: "padua",
  munchen: "munich",
  koln: "cologne",
  wien: "vienna",
  praha: "prague",
  warszawa: "warsaw",
  lisboa: "lisbon",
  bruxelles: "brussels",
  brussel: "brussels",
  antwerpen: "antwerp",
  geneve: "geneva",
  genf: "geneva",
  zuerich: "zurich",
  goteborg: "gothenburg",
  kobenhavn: "copenhagen",
  "den haag": "the hague",
  bucuresti: "bucharest",
  sevilla: "seville",
  lisbona: "lisbon",
  atene: "athens",
  vienne: "vienna",
  "citta del vaticano": "rome",
};

function stripAccents(s: string): string {
  // Rimuove i segni diacritici combinanti (U+0300–U+036F) dopo NFD.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function norm(s: string | null): string {
  return stripAccents((s ?? "").trim().toLowerCase()).replace(/\s+/g, " ");
}

// Indice città-sola (ultima vince tra le poche omonime dei major): usato quando
// il paese manca o è scritto in modo non riconosciuto.
const CITY_ONLY: Record<string, LatLon> = (() => {
  const out: Record<string, LatLon> = {};
  for (const [key, coord] of Object.entries(GAZETTEER)) {
    const city = key.split("|")[1];
    if (city) out[city] = coord;
  }
  return out;
})();

/**
 * Coordinate centro-città note per (paese, città), o null se la città non è nel
 * gazetteer. La corrispondenza è tollerante: normalizza accenti/case/spazi e
 * risolve gli alias più comuni (Roma→Rome, Italia→Italy). Se il paese non
 * combacia, ripiega su una ricerca città-sola.
 */
export function gazetteerCity(
  country: string | null,
  city: string | null,
): LatLon | null {
  const c = norm(city);
  if (!c) return null;
  const canonCity = CITY_ALIAS[c] ?? c;
  const co = norm(country);
  const canonCountry = COUNTRY_ALIAS[co] ?? co;
  return (
    GAZETTEER[`${canonCountry}|${canonCity}`] ?? CITY_ONLY[canonCity] ?? null
  );
}
